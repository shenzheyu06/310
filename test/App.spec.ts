import fs from "fs/promises";
import { expect } from "chai";
import request from "supertest";
import { StatusCodes } from "http-status-codes";
import { Application, createApp } from "../src/App";
import path from "path";
import http from "http";
import { createReusableServer } from "./TestServer";

// test

const {
	OK, // 200
	CREATED, // 201
	ACCEPTED, // 202
	NO_CONTENT, // 204
	BAD_REQUEST, // 400
	NOT_FOUND, // 404
	REQUEST_TOO_LONG, // 413
	UNPROCESSABLE_ENTITY, // 422
} = StatusCodes;

// Do not change datadir
const datadir = "./data" as const;

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDatasetProcessing(app: Application | http.Server, url: string): Promise<request.Response> {
	let status = await request(app).get(url);
	while (status.body.status === "processing") {
		// eslint-disable-next-line @ubccpsc310/descriptive/no-await-in-loop
		await sleep(500);
		// eslint-disable-next-line @ubccpsc310/descriptive/no-await-in-loop
		status = await request(app).get(url);
	}
	return status;
}

async function waitForUploadToFinish(
	app: Application | http.Server,
	initialResponse: request.Response
): Promise<request.Response> {
	let process = initialResponse;
	while (process.body.status === "processing") {
		// eslint-disable-next-line @ubccpsc310/descriptive/no-await-in-loop
		process = await request(app).get(`/api/v1/datasets/${process.body.id}`);
		// eslint-disable-next-line @ubccpsc310/descriptive/no-await-in-loop
		await sleep(250);
	}
	return process;
}

describe("REST API v2", function () {
	const testServer = createReusableServer();
	const app = testServer.server;

	beforeEach(async () => {
		testServer.setHandler(await createApp({ datadir }));
	});

	afterEach(async () => {
		await fs.rm(datadir, { recursive: true, force: true });
	});

	after(async () => {
		await testServer.close();
	});

	it("Test 0: GET /api should respond with status OK and text 'App is running!'", async () => {
		const res = await request(app).get("/api");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.property("text", "App is running!");
	});

	//----------------------------------------------------------------------------------------------------//
	//                                                                                                    //
	//                                        V2 BULK UPLOAD                                              //
	//                                                                                                    //
	//----------------------------------------------------------------------------------------------------//

	//----------------------------------------------POST--------------------------------------------------//

	//----------------------BACK-COMPATABLE------------------------//

	it("Test 99a: POST /api/v2/datasets should respond with status ACCEPTED, id 0, status processing, kind course_offerings, and correct message", async () => {
		const datasetBuffer = await fs.readFile(path.resolve(__dirname, "test_data", "partial-pair.zip"));
		const res = await request(app)
			.post("/api/v2/datasets")
			.field("kind", "course_offerings")
			.attach("archive", datasetBuffer, "pair.zip");

		await waitForDatasetProcessing(app, "/api/v2/datasets/0");

		expect(res).to.have.property("status", ACCEPTED);
		expect(res).to.have.deep.property("body", {
			id: "0",
			status: "processing",
			kind: "course_offerings",
			message: "Dataset accepted for processing",
		});
	});

	//----------------------------NEW------------------------------//

	it("Test 98a: POST /api/v2/datasets should respond with status UNPROCESSABLE_ENTITY and error message for missing fields", async () => {
		const res = await request(app).post("/api/v2/datasets").send({});

		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				kind: "required but missing",
				archive: "required but missing",
			},
		});
	});

	it("Test 98b: POST /api/v2/datasets should respond with status UNPROCESSABLE_ENTITY and error message for incorrect field values", async () => {
		const datasetBuffer = await fs.readFile(path.resolve(__dirname, "test_data", "empty.zip"));
		const res = await request(app)
			.post("/api/v2/datasets")
			.field("kind", "cry_me_@_river")
			.attach("archive", datasetBuffer, "empty.zip");

		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				kind: "expected to be course_offerings or facilities",
				archive: "expected non-empty file",
			},
		});
	});

	it("Test 98b_1: POST /api/v2/datasets should respond with status UNPROCESSABLE_ENTITY and error message for incorrect field types", async () => {
		const res = await request(app).post("/api/v2/datasets").send({
			kind: 0,
			archive: 0,
		});

		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				kind: "expected to be course_offerings or facilities",
				archive: "expected non-empty file",
			},
		});
	});

	it("Test 98c: POST /api/v2/datasets should respond with status ACCEPTED, id 0, status processing, kind facilities, and correct message", async () => {
		const datasetBuffer = await fs.readFile(path.resolve(__dirname, "test_data", "campus.zip"));
		const res = await request(app)
			.post("/api/v2/datasets")
			.field("kind", "facilities")
			.attach("archive", datasetBuffer, "campus.zip");

		await sleep(500);

		expect(res).to.have.property("status", ACCEPTED);
		expect(res).to.have.deep.property("body", {
			id: "0",
			status: "processing",
			kind: "facilities",
			message: "Dataset accepted for processing",
		});
	});

	//-----------------------------------------------GET--------------------------------------------------//
	//----------------------BACK-COMPATABLE------------------------//

	it("Test 97a: GET /api/v2/datasets/{id} should respond with status OK and correct correct stats", async () => {
		const datasetBuffer = await fs.readFile(path.resolve(__dirname, "test_data", "partial-pair.zip"));
		await request(app)
			.post("/api/v2/datasets")
			.field("kind", "course_offerings")
			.attach("archive", datasetBuffer, "partial-pair.zip");

		await waitForDatasetProcessing(app, "/api/v2/datasets/0");

		const res = await request(app).get("/api/v2/datasets/0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "0",
			status: "completed",
			kind: "course_offerings",
			stats: {
				files_total: 462,
				files_processed: 461,
				files_skipped: 1,
				courses_seen: 346,
				courses_added: 346,
				courses_modified: 0,
				sections_seen: 4987,
				sections_added: 4987,
				sections_modified: 0,
			},
			message: "Dataset processing complete",
		});
	});

	it("Test 97c: GET /api/v2/datasets/{id} should respond with status NOT_FOUND and correct error message", async () => {
		const res = await request(app).get("/api/v2/datasets/0");

		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no dataset with id '0'",
		});
	});

	it("Test 97d: GET /api/v2/datasets/{id} should respond with status NOT_FOUND and correct error message", async () => {
		const res = await request(app).get("/api/v2/datasets/1");

		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no dataset with id '1'",
		});
	});

	it("Test 97e: GET /api/v2/datasets/{id} should respond with status NOT_FOUND and correct error message", async () => {
		const datasetBuffer = await fs.readFile(path.resolve(__dirname, "test_data", "small_1.zip"));
		await request(app).post("/api/v2/datasets").field("kind", 4).attach("archive", datasetBuffer, "small_1.zip");

		const res = await request(app).get("/api/v2/datasets/1");

		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no dataset with id '1'",
		});
	});

	it("Test 97f: GET /api/v2/datasets/{id} should respond with status OK and a failed upload with 'Missing root courses directory'", async () => {
		const datasetBuffer = await fs.readFile(path.resolve(__dirname, "test_data", "wrong_directory.zip"));
		await request(app)
			.post("/api/v2/datasets")
			.field("kind", "course_offerings")
			.attach("archive", datasetBuffer, "wrong_directory.zip");

		await sleep(50);

		const res = await request(app).get("/api/v2/datasets/0");

		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "0",
			status: "failed",
			kind: "course_offerings",
			stats: {
				files_total: 0,
				files_processed: 0,
				files_skipped: 0,
				courses_seen: 0,
				courses_added: 0,
				courses_modified: 0,
				sections_seen: 0,
				sections_added: 0,
				sections_modified: 0,
			},
			message: "Missing root courses directory",
		});
	});

	//----------------------------NEW------------------------------//

	// don't have to worry about
	// - dataset ID not existing
	// ALL OTHER FAILS must be accounted for
	// all success states (both still processing and finished processing)
	// - there are really only two of these

	it("Test 97g: POST /api/v2/datasets should respond with status ACCEPTED, id 0, status processing, kind facilities, and correct message", async () => {
		const datasetBuffer = await fs.readFile(path.resolve(__dirname, "test_data", "campus.zip"));
		const initialResponse = await request(app)
			.post("/api/v2/datasets")
			.field("kind", "facilities")
			.attach("archive", datasetBuffer, "campus.zip");
		await waitForUploadToFinish(app, initialResponse);

		const res = await request(app).get("/api/v2/datasets/0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "0",
			status: "completed",
			kind: "facilities",
			stats: {
				buildings_added: 74,
				buildings_modified: 0,
				rooms_added: 364,
				rooms_modified: 0,
			},
			message: "Dataset processing complete",
		});
	});

	//----------------------------------------------------------------------------------------------------//
	//                                                                                                    //
	//                                       POST (BULK UPLOAD)                                           //
	//                                                                                                    //
	//----------------------------------------------------------------------------------------------------//

	//----------------------------------------------POST--------------------------------------------------//

	it("Test 13a: POST /api/v1/datasets should respond with status UNPROCESSABLE_ENTITY and error message for missing fields", async () => {
		const res = await request(app).post("/api/v1/datasets").send({});

		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				kind: "required but missing",
				archive: "required but missing",
			},
		});
	});

	it("Test 13b: POST /api/v1/datasets should respond with status UNPROCESSABLE_ENTITY and error message for incorrect field values", async () => {
		const datasetBuffer = await fs.readFile(path.resolve(__dirname, "test_data", "empty.zip"));
		const res = await request(app)
			.post("/api/v1/datasets")
			.field("kind", "cry_me_@_river")
			.attach("archive", datasetBuffer, "empty.zip");

		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				kind: "expected to be course_offerings",
				archive: "expected non-empty file",
			},
		});
	});

	it("Test 13b_1: POST /api/v1/datasets should respond with status UNPROCESSABLE_ENTITY and error message for incorrect field types", async () => {
		const res = await request(app).post("/api/v1/datasets").send({
			kind: 0,
			archive: 0,
		});

		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				kind: "expected to be course_offerings",
				archive: "expected non-empty file",
			},
		});
	});

	it("Test 13c: POST /api/v1/datasets should respond with status ACCEPTED, id 0, status processing, kind course_offerings, and correct message", async () => {
		const datasetBuffer = await fs.readFile(path.resolve(__dirname, "test_data", "small_1.zip"));
		const res = await request(app)
			.post("/api/v1/datasets")
			.field("kind", "course_offerings")
			.attach("archive", datasetBuffer, "small_1.zip");

		await sleep(500);

		expect(res).to.have.property("status", ACCEPTED);
		expect(res).to.have.deep.property("body", {
			id: "0",
			status: "processing",
			kind: "course_offerings",
			message: "Dataset accepted for processing",
		});
	});

	it("Test 13d: POST /api/v1/datasets should respond with status ACCEPTED, id 1, status processing, kind course_offerings, and correct message", async () => {
		const datasetBuffer = await fs.readFile(path.resolve(__dirname, "test_data", "small_1.zip"));
		await request(app)
			.post("/api/v1/datasets")
			.field("kind", "course_offerings")
			.attach("archive", datasetBuffer, "small_1.zip");

		const res = await request(app)
			.post("/api/v1/datasets")
			.field("kind", "course_offerings")
			.attach("archive", datasetBuffer, "small_1.zip");

		await sleep(500);

		expect(res).to.have.property("status", ACCEPTED);
		expect(res).to.have.deep.property("body", {
			id: "1",
			status: "processing",
			kind: "course_offerings",
			message: "Dataset accepted for processing",
		});
	});

	it("Test 13e: POST /api/v1/datasets should respond with status ACCEPTED, id 0, status processing, kind course_offerings, and correct message", async () => {
		const datasetBuffer = await fs.readFile(path.resolve(__dirname, "test_data", "partial-pair.zip"));
		const res = await request(app)
			.post("/api/v1/datasets")
			.field("kind", "course_offerings")
			.attach("archive", datasetBuffer, "pair.zip");

		await waitForDatasetProcessing(app, "/api/v1/datasets/0");

		expect(res).to.have.property("status", ACCEPTED);
		expect(res).to.have.deep.property("body", {
			id: "0",
			status: "processing",
			kind: "course_offerings",
			message: "Dataset accepted for processing",
		});
	});

	//-----------------------------------------------GET--------------------------------------------------//

	it("Test 14a: GET /api/v1/datasets/{id} should respond with status NOT_FOUND and correct error message", async () => {
		const res = await request(app).get("/api/v1/datasets/0");

		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no dataset with id '0'",
		});
	});

	it("Test 14b: GET /api/v1/datasets/{id} should respond with status NOT_FOUND and correct error message", async () => {
		const res = await request(app).get("/api/v1/datasets/1");

		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no dataset with id '1'",
		});
	});

	it("Test 14c: GET /api/v1/datasets/{id} should respond with status NOT_FOUND and correct error message", async () => {
		const datasetBuffer = await fs.readFile(path.resolve(__dirname, "test_data", "small_1.zip"));
		await request(app).post("/api/v1/datasets").field("kind", 4).attach("archive", datasetBuffer, "small_1.zip");

		const res = await request(app).get("/api/v1/datasets/1");

		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no dataset with id '1'",
		});
	});

	it("Test 14d: GET /api/v1/datasets/{id} should respond with status OK and a failed upload with 'Missing root courses directory'", async () => {
		const datasetBuffer = await fs.readFile(path.resolve(__dirname, "test_data", "wrong_directory.zip"));
		await request(app)
			.post("/api/v1/datasets")
			.field("kind", "course_offerings")
			.attach("archive", datasetBuffer, "wrong_directory.zip");

		await sleep(50);

		const res = await request(app).get("/api/v1/datasets/0");

		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "0",
			status: "failed",
			kind: "course_offerings",
			stats: {
				files_total: 0,
				files_processed: 0,
				files_skipped: 0,
				courses_seen: 0,
				courses_added: 0,
				courses_modified: 0,
				sections_seen: 0,
				sections_added: 0,
				sections_modified: 0,
			},
			message: "Missing root courses directory",
		});
	});

	it("Test 14e: GET /api/v1/datasets/{id} should respond with status OK and a failed upload with 'Data is not in a valid zip format'", async () => {
		const datasetBuffer = await fs.readFile(path.resolve(__dirname, "test_data", "not_a_zip.pdf"));
		await request(app)
			.post("/api/v1/datasets")
			.field("kind", "course_offerings")
			.attach("archive", datasetBuffer, "not_a_zip.pdf");

		await sleep(50);

		const res = await request(app).get("/api/v1/datasets/0");

		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "0",
			status: "failed",
			kind: "course_offerings",
			stats: {
				files_total: 0,
				files_processed: 0,
				files_skipped: 0,
				courses_seen: 0,
				courses_added: 0,
				courses_modified: 0,
				sections_seen: 0,
				sections_added: 0,
				sections_modified: 0,
			},
			message: "Data is not in a valid zip format",
		});
	});

	it("Test 14f: GET /api/v1/datasets/{id} should respond with status OK and a failed upload with 'Missing root courses directory'", async () => {
		const datasetBuffer = await fs.readFile(path.resolve(__dirname, "test_data", "wrong_directory.zip"));
		await request(app)
			.post("/api/v1/datasets")
			.field("kind", "course_offerings")
			.attach("archive", datasetBuffer, "wrong_directory.zip");

		await sleep(50);

		const res = await request(app).get("/api/v1/datasets/0");

		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "0",
			status: "failed",
			kind: "course_offerings",
			stats: {
				files_total: 0,
				files_processed: 0,
				files_skipped: 0,
				courses_seen: 0,
				courses_added: 0,
				courses_modified: 0,
				sections_seen: 0,
				sections_added: 0,
				sections_modified: 0,
			},
			message: "Missing root courses directory",
		});
	});

	it("Test 14g: GET /api/v1/datasets/{id} should respond with status OK and correct correct stats", async () => {
		const datasetBuffer = await fs.readFile(path.resolve(__dirname, "test_data", "small_1.zip"));
		await request(app)
			.post("/api/v1/datasets")
			.field("kind", "course_offerings")
			.attach("archive", datasetBuffer, "small_1.zip");

		await waitForDatasetProcessing(app, "/api/v1/datasets/0");

		const res = await request(app).get("/api/v1/datasets/0");

		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "0",
			status: "completed",
			kind: "course_offerings",
			stats: {
				files_total: 1,
				files_processed: 1,
				files_skipped: 0,
				courses_seen: 0,
				courses_added: 0,
				courses_modified: 0,
				sections_seen: 0,
				sections_added: 0,
				sections_modified: 0,
			},
			message: "Dataset processing complete",
		});
	});

	it("Test 14i: GET /api/v1/datasets/{id} should respond with status OK and correct correct stats", async () => {
		const datasetBuffer = await fs.readFile(path.resolve(__dirname, "test_data", "partial-pair2.zip"));
		await request(app)
			.post("/api/v1/datasets")
			.field("kind", "course_offerings")
			.attach("archive", datasetBuffer, "partial-pair2.zip");

		await waitForDatasetProcessing(app, "/api/v1/datasets/0");

		const res = await request(app).get("/api/v1/datasets/0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "0",
			status: "completed",
			kind: "course_offerings",
			stats: {
				files_total: 247,
				files_processed: 247,
				files_skipped: 0,
				courses_seen: 176,
				courses_added: 176,
				courses_modified: 0,
				sections_seen: 2311,
				sections_added: 2311,
				sections_modified: 0,
			},
			message: "Dataset processing complete",
		});
	});

	it("Test 14j: GET /api/v1/datasets/{id} should respond with status OK and correct correct stats", async () => {
		const datasetBuffer = await fs.readFile(path.resolve(__dirname, "test_data", "small_2.zip"));
		await request(app)
			.post("/api/v1/datasets")
			.field("kind", "course_offerings")
			.attach("archive", datasetBuffer, "small_2.zip");

		await waitForDatasetProcessing(app, "/api/v1/datasets/0");

		const res = await request(app).get("/api/v1/datasets/0");

		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "0",
			status: "completed",
			kind: "course_offerings",
			stats: {
				files_total: 1,
				files_processed: 1,
				files_skipped: 0,
				courses_seen: 1,
				courses_added: 1,
				courses_modified: 0,
				sections_seen: 1,
				sections_added: 1,
				sections_modified: 0,
			},
			message: "Dataset processing complete",
		});
	});

	it("Test 14k: GET /api/v1/datasets/{id} should respond with status OK and correct correct stats", async () => {
		const datasetBuffer = await fs.readFile(path.resolve(__dirname, "test_data", "small_2_1.zip"));
		await request(app)
			.post("/api/v1/datasets")
			.field("kind", "course_offerings")
			.attach("archive", datasetBuffer, "small_2_1.zip");

		await waitForDatasetProcessing(app, "/api/v1/datasets/0");

		const res = await request(app).get("/api/v1/datasets/0");

		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "0",
			status: "completed",
			kind: "course_offerings",
			stats: {
				files_total: 3,
				files_processed: 3,
				files_skipped: 0,
				courses_seen: 1,
				courses_added: 1,
				courses_modified: 0,
				sections_seen: 1,
				sections_added: 1,
				sections_modified: 0,
			},
			message: "Dataset processing complete",
		});
	});

	it("Test 14l: GET /api/v1/datasets/{id} should respond with status OK and correct correct stats", async () => {
		const datasetBuffer = await fs.readFile(path.resolve(__dirname, "test_data", "partial-pair.zip"));
		await request(app)
			.post("/api/v1/datasets")
			.field("kind", "course_offerings")
			.attach("archive", datasetBuffer, "partial-pair.zip");

		await waitForDatasetProcessing(app, "/api/v1/datasets/0");

		const res = await request(app).get("/api/v1/datasets/0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "0",
			status: "completed",
			kind: "course_offerings",
			stats: {
				files_total: 462,
				files_processed: 461,
				files_skipped: 1,
				courses_seen: 346,
				courses_added: 346,
				courses_modified: 0,
				sections_seen: 4987,
				sections_added: 4987,
				sections_modified: 0,
			},
			message: "Dataset processing complete",
		});
	});

	it("Test 14l: GET /api/v1/datasets/{id} should respond with status OK and correct correct stats", async () => {
		const datasetBuffer = await fs.readFile(path.resolve(__dirname, "test_data", "pair.zip"));
		await request(app)
			.post("/api/v1/datasets")
			.field("kind", "course_offerings")
			.attach("archive", datasetBuffer, "pair.zip");

		await waitForDatasetProcessing(app, "/api/v1/datasets/0");

		const res = await request(app).get("/api/v1/datasets/0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "0",
			status: "completed",
			kind: "course_offerings",
			stats: {
				files_total: 5944,
				files_processed: 5944,
				files_skipped: 0,
				courses_seen: 3589,
				courses_added: 3589,
				courses_modified: 0,
				sections_seen: 64612,
				sections_added: 64612,
				sections_modified: 0,
			},
			message: "Dataset processing complete",
		});
	});

	//----------------------------------------------------------------------------------------------------//
	//                                                                                                    //
	//                                     POST (SEARCH RESOURCES)                                        //
	//                                                                                                    //
	//----------------------------------------------------------------------------------------------------//

	async function addTestSections(): Promise<void> {
		await request(app).put("/api/v1/courses/cpsc110").send({
			title: "Computation, Programs, and Programming",
			dept: "Computer Science",
			code: "110",
		});
		await request(app).put("/api/v1/courses/cpsc210").send({
			title: "Software Construction",
			dept: "Computer Science",
			code: "210",
		});
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc210/sections/2024w201").send({
			instructor: "osveisi-fordoei, mehrdad",
			year: 2025,
			avg: 79.5,
			pass: 150,
			fail: 11,
			audit: 1,
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w202").send({
			instructor: "kerr, katharine",
			year: 2024,
			avg: 82.5,
			pass: 137,
			fail: 0,
			audit: 0,
		});
	}

	async function addTestRooms(): Promise<void> {
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "Hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/MCLD").send({
			name: "Hector J. MacLeod Building",
			address: "2356 Main Mall V6T 1Z4",
			lat: 49.26161,
			lon: -123.24941,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_310").send({
			building: "DMP",
			number: "310",
			type: "General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-310",
			seats: 160,
		});
		await request(app).put("/api/v2/buildings/MCLD/rooms/MCLD_2018").send({
			building: "MCLD",
			number: "2018",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/mcld-2018",
			seats: 124,
		});
	}

	//-----------------------------------------------V1---------------------------------------------------//

	it("Test 15a: POST /api/v1/search should respond with status UNPROCESSABLE_ENTITY and errors 'required but missing' for kind and query", async () => {
		const res = await request(app).post("/api/v1/search");
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				kind: "required but missing",
				query: "required but missing",
			},
		});
	});

	it("Test 15b: POST /api/v1/search should respond with status UNPROCESSABLE_ENTITY and errors 'required but missing' for query and 'expected to be course_offerings' for kind", async () => {
		const res = await request(app).post("/api/v1/search").send({ kind: 0 });
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				kind: "expected to be course_offerings",
				query: "required but missing",
			},
		});
	});

	it("Test 15c: POST /api/v1/search should respond with status UNPROCESSABLE_ENTITY and error 'expected to be course_offerings' for kind", async () => {
		const res = await request(app).post("/api/v1/search").send({ kind: "test", query: {} });
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				kind: "expected to be course_offerings",
			},
		});
	});

	it("Test 15d: POST /api/v1/search should respond with status UNPROCESSABLE_ENTITY and errors 'expected an object' for query", async () => {
		const res = await request(app).post("/api/v1/search").send({ kind: "course_offerings", query: true });
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				query: "expected an object",
			},
		});
	});

	it("Test 15e: POST /api/v1/search should respond with status BAD_REQUEST and error message 'Missing WHERE'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					OPTIONS: {
						COLUMNS: ["avg"],
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "Missing WHERE",
		});
	});

	it("Test 15f: POST /api/v1/search should respond with status BAD_REQUEST and error message 'Missing OPTIONS'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "Missing OPTIONS",
		});
	});

	it("Test 15g: POST /api/v1/search should respond with status BAD_REQUEST and error message 'Missing COLUMNS'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: {},
					COLUMNS: ["avg"],
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "Missing COLUMNS",
		});
	});

	it("Test 15h: POST /api/v1/search should respond with status BAD_REQUEST and error message 'Unknown key in COLUMNS'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail", "median"],
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "Unknown key in COLUMNS",
		});
	});

	it("Test 15i: POST /api/v1/search should respond with status BAD_REQUEST and error message 'ORDER must be a key in COLUMNS'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "year",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "ORDER must be a key in COLUMNS",
		});
	});

	it("Test 15j: POST /api/v1/search should respond with status BAD_REQUEST and error message 'WHERE must be an object with at most one FILTER'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							dept: "cpsc",
						},
						EQ: {
							avg: 85,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "WHERE must be an object with at most one FILTER",
		});
	});

	it("Test 15j_1: POST /api/v1/search should respond with status BAD_REQUEST and error message 'WHERE must be an object with at most one FILTER'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: 13,
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "WHERE must be an object with at most one FILTER",
		});
	});

	it("Test 15k: POST /api/v1/search should respond with status BAD_REQUEST and error message 'OPTIONS must be an object with COLUMNS and optional ORDER'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							dept: "cpsc",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						SORT: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "OPTIONS must be an object with COLUMNS and optional ORDER",
		});
	});

	it("Test 15l: POST /api/v1/search should respond with status BAD_REQUEST and error message 'AND must be a non-empty array of FILTER objects'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						AND: 85,
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "AND must be a non-empty array of FILTER objects",
		});
	});

	it("Test 15l_1: POST /api/v1/search should respond with status BAD_REQUEST and error message 'AND must be a non-empty array of FILTER objects'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						AND: [],
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "AND must be a non-empty array of FILTER objects",
		});
	});

	it("Test 15l_2: POST /api/v1/search should respond with status BAD_REQUEST and error message 'AND must be a non-empty array of FILTER objects'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						AND: [374124, "nonsense", true],
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "AND must be a non-empty array of FILTER objects",
		});
	});

	it("Test 15l_3: POST /api/v1/search should respond with status BAD_REQUEST and error message 'AND must be a non-empty array of FILTER objects'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						AND: [
							{
								IS: {
									dept: "cpsc",
								},
							},
							{
								SI: {
									tepd: "cspc",
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "AND must be a non-empty array of FILTER objects",
		});
	});

	it("Test 15m: POST /api/v1/search should respond with status BAD_REQUEST and error message 'OR must be a non-empty array of FILTER objects'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						OR: 85,
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "OR must be a non-empty array of FILTER objects",
		});
	});

	it("Test 15m_1: POST /api/v1/search should respond with status BAD_REQUEST and error message 'OR must be a non-empty array of FILTER objects'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						OR: [],
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "OR must be a non-empty array of FILTER objects",
		});
	});

	it("Test 15m_2: POST /api/v1/search should respond with status BAD_REQUEST and error message 'OR must be a non-empty array of FILTER objects'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						OR: [13815, "test", false],
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "OR must be a non-empty array of FILTER objects",
		});
	});

	it("Test 15m_3: POST /api/v1/search should respond with status BAD_REQUEST and error message 'OR must be a non-empty array of FILTER objects'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						OR: [
							{
								IS: {
									dept: "cpsc",
								},
							},
							{
								SI: {
									tepd: "cspc",
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "OR must be a non-empty array of FILTER objects",
		});
	});

	it("Test 15n: POST /api/v1/search should respond with status BAD_REQUEST and error message 'NOT must be a FILTER object'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						NOT: false,
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "NOT must be a FILTER object",
		});
	});

	it("Test 15n_1: POST /api/v1/search should respond with status BAD_REQUEST and error message 'NOT must be a FILTER object'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						NOT: {},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "NOT must be a FILTER object",
		});
	});

	it("Test 15o: POST /api/v1/search should respond with status BAD_REQUEST and error message 'LT must be an object with one mfield of type number'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						LT: {},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "LT must be an object with one mfield of type number",
		});
	});

	it("Test 15o_1: POST /api/v1/search should respond with status BAD_REQUEST and error message 'LT must be an object with one mfield of type number'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						LT: {
							code: 200,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "LT must be an object with one mfield of type number",
		});
	});

	it("Test 15o_2: POST /api/v1/search should respond with status BAD_REQUEST and error message 'LT must be an object with one mfield of type number'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						LT: {
							avg: "85",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "LT must be an object with one mfield of type number",
		});
	});

	it("Test 15o_3: POST /api/v1/search should respond with status BAD_REQUEST and error message 'LT must be an object with one mfield of type number'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						LT: {
							avg: 85,
							pass: 100,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "LT must be an object with one mfield of type number",
		});
	});

	it("Test 15p: POST /api/v1/search should respond with status BAD_REQUEST and error message 'GT must be an object with one mfield of type number'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						GT: {},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "GT must be an object with one mfield of type number",
		});
	});

	it("Test 15p_1: POST /api/v1/search should respond with status BAD_REQUEST and error message 'GT must be an object with one mfield of type number'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						GT: {
							code: 199,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "GT must be an object with one mfield of type number",
		});
	});

	it("Test 15p_2: POST /api/v1/search should respond with status BAD_REQUEST and error message 'GT must be an object with one mfield of type number'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						GT: {
							avg: "85",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "GT must be an object with one mfield of type number",
		});
	});

	it("Test 15p_3: POST /api/v1/search should respond with status BAD_REQUEST and error message 'GT must be an object with one mfield of type number'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						GT: {
							avg: 85,
							pass: 100,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "GT must be an object with one mfield of type number",
		});
	});

	it("Test 15q: POST /api/v1/search should respond with status BAD_REQUEST and error message 'EQ must be an object with one mfield of type number'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						EQ: {},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "EQ must be an object with one mfield of type number",
		});
	});

	it("Test 15q_1: POST /api/v1/search should respond with status BAD_REQUEST and error message 'EQ must be an object with one mfield of type number'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						EQ: {
							code: 199,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "EQ must be an object with one mfield of type number",
		});
	});

	it("Test 15q_2: POST /api/v1/search should respond with status BAD_REQUEST and error message 'EQ must be an object with one mfield of type number'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						EQ: {
							avg: "85",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "EQ must be an object with one mfield of type number",
		});
	});

	it("Test 15q_3: POST /api/v1/search should respond with status BAD_REQUEST and error message 'EQ must be an object with one mfield of type number'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						EQ: {
							avg: 85,
							pass: 100,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "EQ must be an object with one mfield of type number",
		});
	});

	it("Test 15r: POST /api/v1/search should respond with status BAD_REQUEST and error message 'IS must be an object with one sfield of type string'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "IS must be an object with one sfield of type string",
		});
	});

	it("Test 15r_1: POST /api/v1/search should respond with status BAD_REQUEST and error message 'IS must be an object with one sfield of type string'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: 199,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "IS must be an object with one sfield of type string",
		});
	});

	it("Test 15r_2: POST /api/v1/search should respond with status BAD_REQUEST and error message 'IS must be an object with one sfield of type string'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							avg: "85",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "IS must be an object with one sfield of type string",
		});
	});

	it("Test 15r_3: POST /api/v1/search should respond with status BAD_REQUEST and error message 'IS must be an object with one sfield of type string'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "*10",
							dept: "c*",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "IS must be an object with one sfield of type string",
		});
	});

	it("Test 15s: POST /api/v1/search should respond with status BAD_REQUEST and error message 'IS asterisks can only be first or last character'", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							dept: "c*c",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "IS asterisks can only be first or last character",
		});
	});

	it("Test 16a: POST /api/v1/search should respond with status OK and empty array", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 16b: POST /api/v1/search should respond with status OK and empty array", async () => {
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						AND: [
							{
								OR: [
									{
										LT: {
											fail: 1,
										},
									},
									{
										EQ: {
											audit: 0,
										},
									},
								],
							},
							{
								NOT: {
									IS: {
										code: "2*",
									},
								},
							},
							{
								AND: [
									{
										GT: {
											avg: 85,
										},
									},
								],
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 16c: POST /api/v1/search should respond with status OK and correct unsorted and unfiltered array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["dept", "code", "avg", "pass", "fail"],
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res)
			.to.have.deep.property("body")
			.that.deep.members([
				{
					dept: "Computer Science",
					code: "210",
					avg: 79.5,
					pass: 150,
					fail: 11,
				},
				{
					dept: "Computer Science",
					code: "310",
					avg: 80.4,
					pass: 124,
					fail: 0,
				},
				{
					dept: "Computer Science",
					code: "310",
					avg: 82.5,
					pass: 137,
					fail: 0,
				},
			]);
	});

	it("Test 16c_1: POST /api/v1/search should respond with status OK and correct unfiltered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["dept", "code", "avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [
			{
				dept: "Computer Science",
				code: "210",
				avg: 79.5,
				pass: 150,
				fail: 11,
			},
			{
				dept: "Computer Science",
				code: "310",
				avg: 80.4,
				pass: 124,
				fail: 0,
			},
			{
				dept: "Computer Science",
				code: "310",
				avg: 82.5,
				pass: 137,
				fail: 0,
			},
		]);
	});

	it("Test 16c_2: POST /api/v1/search should respond with status OK and correct unfiltered array sorted by pass", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["dept", "code", "avg", "pass", "fail"],
						ORDER: "pass",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [
			{
				dept: "Computer Science",
				code: "310",
				avg: 80.4,
				pass: 124,
				fail: 0,
			},
			{
				dept: "Computer Science",
				code: "310",
				avg: 82.5,
				pass: 137,
				fail: 0,
			},
			{
				dept: "Computer Science",
				code: "210",
				avg: 79.5,
				pass: 150,
				fail: 11,
			},
		]);
	});

	it("Test 16c_3: POST /api/v1/search should respond with status OK and correct unfiltered array sorted by instructor", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["title", "year", "instructor", "audit"],
						ORDER: "instructor",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [
			{
				title: "Introduction to Software Engineering",
				year: 2024,
				instructor: "bradley, nicholas",
				audit: 0,
			},
			{
				title: "Introduction to Software Engineering",
				year: 2024,
				instructor: "kerr, katharine",
				audit: 0,
			},
			{
				title: "Software Construction",
				year: 2025,
				instructor: "osveisi-fordoei, mehrdad",
				audit: 1,
			},
		]);
	});

	it("Test 16d: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						LT: {
							avg: 100,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }, { avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 16d_1: POST /api/v1/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						LT: {
							avg: 0,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 16d_2: POST /api/v1/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						LT: {
							avg: 79.5,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 16d_3: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						LT: {
							avg: 79.6,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }]);
	});

	it("Test 16d_4: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						LT: {
							avg: 82.5,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }, { avg: 80.4 }]);
	});

	it("Test 16d_5: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						LT: {
							avg: 82.6,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }, { avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 16e: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						GT: {
							avg: 0,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }, { avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 16e_1: POST /api/v1/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						GT: {
							avg: 100,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 16e_2: POST /api/v1/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						GT: {
							avg: 82.5,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 16e_3: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						GT: {
							avg: 82.4,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 82.5 }]);
	});

	it("Test 16e_4: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						GT: {
							avg: 79.5,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 16e_5: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						GT: {
							avg: 79.4,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }, { avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 16f: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						EQ: {
							avg: 80.4,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 80.4 }]);
	});

	it("Test 16f_1: POST /api/v1/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						EQ: {
							avg: 80.3,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 16f_2: POST /api/v1/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						EQ: {
							avg: 80.5,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 16f_3: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						EQ: {
							year: 2024,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 16f_4: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						EQ: {
							year: 2025,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }]);
	});

	it("Test 16g: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "310",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 16g_1: POST /api/v1/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "1",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 16h: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "*",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }, { avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 16h_1: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "**",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }, { avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 16h_2: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "*10",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }, { avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 16h_3: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "*310",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 16h_4: POST /api/v1/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "*1",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 16h_5: POST /api/v1/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "*31",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 16h_6: POST /api/v1/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "*10-",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 16h_7: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "2*",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }]);
	});

	it("Test 16h_8: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "310*",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 16h_9: POST /api/v1/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "10*",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 16h_10: POST /api/v1/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "1*",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 16h_11: POST /api/v1/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "-310*",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 16h_12: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "*1*",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }, { avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 16h_13: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "*10*",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }, { avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 16h_14: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "*21*",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }]);
	});

	it("Test 16h_15: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "*310*",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 16h_16: POST /api/v1/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "*-310-*",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 16i: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						AND: [
							{
								IS: {
									code: "310",
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 16i_1: POST /api/v1/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						AND: [
							{
								IS: {
									code: "",
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 16i_2: POST /api/v1/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						AND: [
							{
								IS: {
									code: "*10",
								},
							},
							{
								EQ: {
									year: 2023,
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 16i_3: POST /api/v1/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						AND: [
							{
								IS: {
									code: "210",
								},
							},
							{
								EQ: {
									year: 2024,
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 16i_4: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						AND: [
							{
								IS: {
									code: "310",
								},
							},
							{
								EQ: {
									year: 2024,
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 16i_5: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						AND: [
							{
								IS: {
									code: "310",
								},
							},
							{
								LT: {
									avg: 81,
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 80.4 }]);
	});

	it("Test 16i_6: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						AND: [
							{
								AND: [
									{
										IS: {
											code: "*10",
										},
									},
									{
										LT: {
											avg: 81,
										},
									},
								],
							},
							{
								GT: {
									pass: 133,
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }]);
	});

	it("Test 16i_7: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						AND: [
							{
								LT: {
									avg: 85,
								},
							},
							{
								EQ: {
									fail: 0,
								},
							},
							{
								GT: {
									pass: 133,
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 82.5 }]);
	});

	it("Test 16j: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						OR: [
							{
								IS: {
									code: "310",
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 16j_1: POST /api/v1/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						OR: [
							{
								IS: {
									code: "",
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 16j_2: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						OR: [
							{
								GT: {
									avg: 81,
								},
							},
							{
								EQ: {
									year: 2025,
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }, { avg: 82.5 }]);
	});

	it("Test 16j_3: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						OR: [
							{
								IS: {
									code: "310",
								},
							},
							{
								LT: {
									avg: 82,
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }, { avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 16j_4: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						OR: [
							{
								IS: {
									code: "210",
								},
							},
							{
								IS: {
									title: "*Software*",
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }, { avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 16j_5: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						OR: [
							{
								IS: {
									code: "110",
								},
							},
							{
								GT: {
									fail: 0,
								},
							},
							{
								LT: {
									pass: 130,
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }, { avg: 80.4 }]);
	});

	it("Test 16k: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						NOT: {
							IS: {
								code: "21*",
							},
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 16k_1: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						NOT: {
							IS: {
								code: "",
							},
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }, { avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 16k_2: POST /api/v1/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						NOT: {
							IS: {
								code: "*0",
							},
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 16l: POST /api/v1/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						OR: [
							{
								NOT: {
									LT: {
										fail: 1,
									},
								},
							},
							{
								AND: [
									{
										OR: [
											{
												IS: {
													code: "3*",
												},
											},
											{
												EQ: {
													audit: 1,
												},
											},
										],
									},
									{
										GT: {
											avg: 80,
										},
									},
									{
										IS: {
											instructor: "*ine",
										},
									},
								],
							},
							{
								IS: {
									title: "Software",
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["audit", "avg", "code", "dept", "fail", "instructor", "pass", "title", "year"],
						ORDER: "fail",
					},
				},
			});
		// expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [
			{
				audit: 0,
				avg: 82.5,
				code: "310",
				dept: "Computer Science",
				fail: 0,
				instructor: "kerr, katharine",
				pass: 137,
				title: "Introduction to Software Engineering",
				year: 2024,
			},
			{
				audit: 1,
				avg: 79.5,
				code: "210",
				dept: "Computer Science",
				fail: 11,
				pass: 150,
				instructor: "osveisi-fordoei, mehrdad",
				title: "Software Construction",
				year: 2025,
			},
		]);
	});

	it("Test 16m: POST /api/v1/search should respond with status REQUEST_TOO_LONG and error message 'Query would return more than 5000 results' and the limit of 5000", async () => {
		const datasetBuffer = await fs.readFile(path.resolve(__dirname, "test_data", "pair.zip"));
		const initialResponse = await request(app)
			.post("/api/v1/datasets")
			.field("kind", "course_offerings")
			.attach("archive", datasetBuffer, "pair.zip");
		await waitForUploadToFinish(app, initialResponse);
		const res = await request(app)
			.post("/api/v1/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", REQUEST_TOO_LONG);
		expect(res).to.have.deep.property("body", {
			error: "Too many results",
			message: "Query would return more than 5000 results",
			limit: 5000,
		});
	});

	//-----------------------------------------------V2---------------------------------------------------//

	it("Test 25a: POST /api/v2/search should respond with status UNPROCESSABLE_ENTITY and errors 'required but missing' for kind and query", async () => {
		const res = await request(app).post("/api/v2/search");
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				kind: "required but missing",
				query: "required but missing",
			},
		});
	});

	it("Test 25b: POST /api/v2/search should respond with status UNPROCESSABLE_ENTITY and errors 'required but missing' for query and 'expected to be course_offerings or facilities' for kind", async () => {
		const res = await request(app).post("/api/v2/search").send({ kind: 0 });
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				kind: "expected to be course_offerings or facilities",
				query: "required but missing",
			},
		});
	});

	it("Test 25c: POST /api/v2/search should respond with status UNPROCESSABLE_ENTITY and error 'expected to be course_offerings or facilities' for kind", async () => {
		const res = await request(app).post("/api/v2/search").send({ kind: "test", query: {} });
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				kind: "expected to be course_offerings or facilities",
			},
		});
	});

	it("Test 25d: POST /api/v2/search should respond with status UNPROCESSABLE_ENTITY and errors 'expected an object' for query", async () => {
		const res = await request(app).post("/api/v2/search").send({ kind: "facilities", query: true });
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				query: "expected an object",
			},
		});
	});

	it("Test 25e: POST /api/v2/search should respond with status BAD_REQUEST and error message 'Missing WHERE'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					OPTIONS: {
						COLUMNS: ["avg"],
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "Missing WHERE",
		});
	});

	it("Test 25e_1: POST /api/v2/search should respond with status BAD_REQUEST and error message 'Missing WHERE'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					OPTIONS: {
						COLUMNS: ["address"],
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "Missing WHERE",
		});
	});

	it("Test 25f: POST /api/v2/search should respond with status BAD_REQUEST and error message 'Missing OPTIONS'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "Missing OPTIONS",
		});
	});

	it("Test 25f_1: POST /api/v2/search should respond with status BAD_REQUEST and error message 'Missing OPTIONS'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "Missing OPTIONS",
		});
	});

	it("Test 25g: POST /api/v2/search should respond with status BAD_REQUEST and error message 'Missing COLUMNS'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: {},
					COLUMNS: ["avg"],
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "Missing COLUMNS",
		});
	});

	it("Test 25g_1: POST /api/v2/search should respond with status BAD_REQUEST and error message 'Missing COLUMNS'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {},
					OPTIONS: {},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "Missing COLUMNS",
		});
	});

	it("Test 25h: POST /api/v2/search should respond with status BAD_REQUEST and error message 'Unknown key in COLUMNS'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail", "median"],
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "Unknown key in COLUMNS",
		});
	});

	it("Test 25h_1: POST /api/v2/search should respond with status BAD_REQUEST and error message 'Unknown key in COLUMNS'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["lat", "lon", "alt"],
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "Unknown key in COLUMNS",
		});
	});

	it("Test 25i: POST /api/v2/search should respond with status BAD_REQUEST and error message 'ORDER must be a key in COLUMNS'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "year",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "ORDER must be a key in COLUMNS",
		});
	});

	it("Test 25i_1: POST /api/v2/search should respond with status BAD_REQUEST and error message 'ORDER must be a key in COLUMNS'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["building", "number"],
						ORDER: "address",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "ORDER must be a key in COLUMNS",
		});
	});

	it("Test 25j: POST /api/v2/search should respond with status BAD_REQUEST and error message 'All ORDER keys must be in COLUMNS'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: {
							dir: "UP",
							keys: ["avg", "pass", "fail", "audit", "year"],
						},
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "All ORDER keys must be in COLUMNS",
		});
	});

	it("Test 25j_1: POST /api/v2/search should respond with status BAD_REQUEST and error message 'All ORDER keys must be in COLUMNS'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["building", "number"],
						ORDER: {
							dir: "DOWN",
							keys: ["address"],
						},
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "All ORDER keys must be in COLUMNS",
		});
	});

	it("Test 25k: POST /api/v2/search should respond with status BAD_REQUEST and error message 'Invalid sort direction (must be UP or DOWN)'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: {
							dir: 0,
							keys: ["avg"],
						},
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "Invalid sort direction (must be UP or DOWN)",
		});
	});

	it("Test 25k_1: POST /api/v2/search should respond with status BAD_REQUEST and error message 'Invalid sort direction (must be UP or DOWN)'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["building", "number"],
						ORDER: {
							dir: "DESCENDING",
							keys: ["building", "number"],
						},
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "Invalid sort direction (must be UP or DOWN)",
		});
	});

	it("Test 25l: POST /api/v2/search should respond with status BAD_REQUEST and error message 'WHERE must be an object with at most one FILTER'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							dept: "cpsc",
						},
						EQ: {
							avg: 85,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "WHERE must be an object with at most one FILTER",
		});
	});

	it("Test 25l_1: POST /api/v2/search should respond with status BAD_REQUEST and error message 'WHERE must be an object with at most one FILTER'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: 13,
					OPTIONS: {
						COLUMNS: ["lat", "lon"],
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "WHERE must be an object with at most one FILTER",
		});
	});

	it("Test 25m: POST /api/v2/search should respond with status BAD_REQUEST and error message 'OPTIONS must be an object with COLUMNS and optional ORDER'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							dept: "cpsc",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						SORT: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "OPTIONS must be an object with COLUMNS and optional ORDER",
		});
	});

	it("Test 25n: POST /api/v2/search should respond with status BAD_REQUEST and error message 'AND must be a non-empty array of FILTER objects'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						AND: 85,
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "AND must be a non-empty array of FILTER objects",
		});
	});

	it("Test 25n_1: POST /api/v2/search should respond with status BAD_REQUEST and error message 'AND must be a non-empty array of FILTER objects'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						AND: [],
					},
					OPTIONS: {
						COLUMNS: ["lat", "lon"],
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "AND must be a non-empty array of FILTER objects",
		});
	});

	it("Test 25n_2: POST /api/v2/search should respond with status BAD_REQUEST and error message 'AND must be a non-empty array of FILTER objects'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						AND: [374124, "nonsense", true],
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "AND must be a non-empty array of FILTER objects",
		});
	});

	it("Test 25n_3: POST /api/v2/search should respond with status BAD_REQUEST and error message 'AND must be a non-empty array of FILTER objects'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						AND: [
							{
								IS: {
									dept: "cpsc",
								},
							},
							{
								SI: {
									tepd: "cspc",
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "AND must be a non-empty array of FILTER objects",
		});
	});

	it("Test 25o: POST /api/v2/search should respond with status BAD_REQUEST and error message 'OR must be a non-empty array of FILTER objects'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						OR: 85,
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "OR must be a non-empty array of FILTER objects",
		});
	});

	it("Test 25o_1: POST /api/v2/search should respond with status BAD_REQUEST and error message 'OR must be a non-empty array of FILTER objects'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						OR: [],
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "OR must be a non-empty array of FILTER objects",
		});
	});

	it("Test 25o_2: POST /api/v2/search should respond with status BAD_REQUEST and error message 'OR must be a non-empty array of FILTER objects'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						OR: [13815, "test", false],
					},
					OPTIONS: {
						COLUMNS: ["building", "number"],
						ORDER: "building",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "OR must be a non-empty array of FILTER objects",
		});
	});

	it("Test 25o_3: POST /api/v2/search should respond with status BAD_REQUEST and error message 'OR must be a non-empty array of FILTER objects'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						OR: [
							{
								IS: {
									dept: "cpsc",
								},
							},
							{
								SI: {
									tepd: "cspc",
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "OR must be a non-empty array of FILTER objects",
		});
	});

	it("Test 25p: POST /api/v2/search should respond with status BAD_REQUEST and error message 'NOT must be a FILTER object'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						NOT: false,
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "NOT must be a FILTER object",
		});
	});

	it("Test 25p_1: POST /api/v2/search should respond with status BAD_REQUEST and error message 'NOT must be a FILTER object'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						NOT: {},
					},
					OPTIONS: {
						COLUMNS: ["building", "address", "number"],
						ORDER: "address",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "NOT must be a FILTER object",
		});
	});

	it("Test 25q: POST /api/v2/search should respond with status BAD_REQUEST and error message 'LT must be an object with one mfield of type number'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						LT: {},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "LT must be an object with one mfield of type number",
		});
	});

	it("Test 25q_1: POST /api/v2/search should respond with status BAD_REQUEST and error message 'LT must be an object with one mfield of type number'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						LT: {
							number: 200,
						},
					},
					OPTIONS: {
						COLUMNS: ["lat", "lon", "address"],
						ORDER: "lon",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "LT must be an object with one mfield of type number",
		});
	});

	it("Test 25q_2: POST /api/v2/search should respond with status BAD_REQUEST and error message 'LT must be an object with one mfield of type number'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						LT: {
							avg: "85",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "LT must be an object with one mfield of type number",
		});
	});

	it("Test 25q_3: POST /api/v2/search should respond with status BAD_REQUEST and error message 'LT must be an object with one mfield of type number'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						LT: {
							avg: 85,
							pass: 100,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "LT must be an object with one mfield of type number",
		});
	});

	it("Test 25r: POST /api/v2/search should respond with status BAD_REQUEST and error message 'GT must be an object with one mfield of type number'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						GT: {},
					},
					OPTIONS: {
						COLUMNS: ["lat", "lon", "address"],
						ORDER: "lat",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "GT must be an object with one mfield of type number",
		});
	});

	it("Test 25r_1: POST /api/v2/search should respond with status BAD_REQUEST and error message 'GT must be an object with one mfield of type number'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						GT: {
							code: 199,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "GT must be an object with one mfield of type number",
		});
	});

	it("Test 25r_2: POST /api/v2/search should respond with status BAD_REQUEST and error message 'GT must be an object with one mfield of type number'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						GT: {
							avg: "85",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "GT must be an object with one mfield of type number",
		});
	});

	it("Test 25r_3: POST /api/v2/search should respond with status BAD_REQUEST and error message 'GT must be an object with one mfield of type number'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						GT: {
							avg: 85,
							pass: 100,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "GT must be an object with one mfield of type number",
		});
	});

	it("Test 25s: POST /api/v2/search should respond with status BAD_REQUEST and error message 'EQ must be an object with one mfield of type number'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						EQ: {},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "EQ must be an object with one mfield of type number",
		});
	});

	it("Test 25s_1: POST /api/v2/search should respond with status BAD_REQUEST and error message 'EQ must be an object with one mfield of type number'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						EQ: {
							code: 199,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "EQ must be an object with one mfield of type number",
		});
	});

	it("Test 25s_2: POST /api/v2/search should respond with status BAD_REQUEST and error message 'EQ must be an object with one mfield of type number'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						EQ: {
							lat: "49",
						},
					},
					OPTIONS: {
						COLUMNS: ["lat", "lon", "address"],
						ORDER: "address",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "EQ must be an object with one mfield of type number",
		});
	});

	it("Test 25s_3: POST /api/v2/search should respond with status BAD_REQUEST and error message 'EQ must be an object with one mfield of type number'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						EQ: {
							avg: 85,
							pass: 100,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "EQ must be an object with one mfield of type number",
		});
	});

	it("Test 25t: POST /api/v2/search should respond with status BAD_REQUEST and error message 'IS must be an object with one sfield of type string'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "IS must be an object with one sfield of type string",
		});
	});

	it("Test 25t_1: POST /api/v2/search should respond with status BAD_REQUEST and error message 'IS must be an object with one sfield of type string'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: 199,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "IS must be an object with one sfield of type string",
		});
	});

	it("Test 25t_2: POST /api/v2/search should respond with status BAD_REQUEST and error message 'IS must be an object with one sfield of type string'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							avg: "85",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "IS must be an object with one sfield of type string",
		});
	});

	it("Test 25t_3: POST /api/v2/search should respond with status BAD_REQUEST and error message 'IS must be an object with one sfield of type string'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						IS: {
							number: "*10",
							building: "I*",
						},
					},
					OPTIONS: {
						COLUMNS: ["building", "number", "lat", "lon", "address"],
						ORDER: {
							dir: "DOWN",
							keys: ["building", "number"],
						},
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "IS must be an object with one sfield of type string",
		});
	});

	it("Test 25u: POST /api/v2/search should respond with status BAD_REQUEST and error message 'IS asterisks can only be first or last character'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							dept: "c*c",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "IS asterisks can only be first or last character",
		});
	});

	it("Test 25u_1: POST /api/v2/search should respond with status BAD_REQUEST and error message 'IS asterisks can only be first or last character'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						IS: {
							building: "i*s",
						},
					},
					OPTIONS: {
						COLUMNS: ["building", "number"],
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "IS asterisks can only be first or last character",
		});
	});

	it("Test 25v: POST /api/v2/search should respond with status BAD_REQUEST and error message 'Cannot mix course_offerings and facilities fields in one query'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						IS: {
							dept: "c*",
						},
					},
					OPTIONS: {
						COLUMNS: ["building", "number"],
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "Cannot mix course_offerings and facilities fields in one query",
		});
	});

	// Test 25v already covers IS with a section field in a facilities query.
	const mixedDatasetFilters = [
		{ kind: "course_offerings", operator: "LT", field: "seats", value: 100, column: "dept" },
		{ kind: "course_offerings", operator: "GT", field: "seats", value: 100, column: "dept" },
		{ kind: "course_offerings", operator: "EQ", field: "seats", value: 100, column: "dept" },
		{ kind: "course_offerings", operator: "IS", field: "building", value: "DMP", column: "dept" },
		{ kind: "facilities", operator: "LT", field: "avg", value: 80, column: "building" },
		{ kind: "facilities", operator: "GT", field: "avg", value: 80, column: "building" },
		{ kind: "facilities", operator: "EQ", field: "avg", value: 80, column: "building" },
	];

	for (const { kind, operator, field, value, column } of mixedDatasetFilters) {
		it(`Test 25v WHERE: ${kind} rejects ${operator} on the other dataset's ${field} field`, async () => {
			const res = await request(app)
				.post("/api/v2/search")
				.send({
					kind,
					query: {
						WHERE: { [operator]: { [field]: value } },
						OPTIONS: { COLUMNS: [column] },
					},
				});

			expect(res).to.have.property("status", BAD_REQUEST);
			expect(res).to.have.deep.property("body", {
				error: "Invalid query",
				message: "Cannot mix course_offerings and facilities fields in one query",
			});
		});
	}

	it("Test 25v_1: POST /api/v2/search should respond with status BAD_REQUEST and error message 'Cannot mix course_offerings and facilities fields in one query'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							dept: "c*",
						},
					},
					OPTIONS: {
						COLUMNS: ["building", "number"],
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "Cannot mix course_offerings and facilities fields in one query",
		});
	});

	it("Test 25v_2: POST /api/v2/search should respond with status BAD_REQUEST and error message 'Cannot mix course_offerings and facilities fields in one query'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							dept: "c*",
						},
					},
					OPTIONS: {
						COLUMNS: ["dept", "code", "maxSeats"],
					},
					TRANSFORMATIONS: {
						GROUP: ["dept", "code"],
						APPLY: [
							{
								maxSeats: {
									MAX: "seats",
								},
							},
						],
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "Cannot mix course_offerings and facilities fields in one query",
		});
	});

	it("Test 25w: POST /api/v2/search should respond with status BAD_REQUEST and error message 'Missing GROUP in TRANSFORMATIONS'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["maxSeats"],
					},
					TRANSFORMATIONS: {
						APPLY: [
							{
								maxSeats: {
									MAX: "seats",
								},
							},
						],
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "Missing GROUP in TRANSFORMATIONS",
		});
	});

	it("Test 25x: POST /api/v2/search should respond with status BAD_REQUEST and error message 'Missing APPLY in TRANSFORMATIONS'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["dept", "code"],
					},
					TRANSFORMATIONS: {
						GROUP: ["dept", "code"],
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "Missing APPLY in TRANSFORMATIONS",
		});
	});

	it("Test 25y: POST /api/v2/search should respond with status BAD_REQUEST and error message 'GROUP must be a non-empty array'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["maxSeats"],
					},
					TRANSFORMATIONS: {
						GROUP: [],
						APPLY: [
							{
								maxSeats: {
									MAX: "seats",
								},
							},
						],
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "GROUP must be a non-empty array",
		});
	});

	it("Test 25y_1: POST /api/v2/search should respond with status BAD_REQUEST and error message 'GROUP must be a non-empty array'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["maxSeats"],
					},
					TRANSFORMATIONS: {
						GROUP: false,
						APPLY: [
							{
								maxSeats: {
									MAX: "seats",
								},
							},
						],
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "GROUP must be a non-empty array",
		});
	});

	it("Test 25z: POST /api/v2/search should respond with status BAD_REQUEST and error message 'APPLY must be an array'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["dept", "code"],
					},
					TRANSFORMATIONS: {
						GROUP: ["dept", "code"],
						APPLY: "MAX",
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "APPLY must be an array",
		});
	});

	it("Test 25alpha: POST /api/v2/search should respond with status BAD_REQUEST and error message 'When TRANSFORMATIONS is present, all COLUMNS must be in GROUP or APPLY'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["dept", "code", "avgGrade"],
					},
					TRANSFORMATIONS: {
						GROUP: ["dept"],
						APPLY: [
							{
								avgGrade: {
									AVG: "avg",
								},
							},
						],
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "When TRANSFORMATIONS is present, all COLUMNS must be in GROUP or APPLY",
		});
	});

	it("Test 25alpha_1: POST /api/v2/search should respond with status BAD_REQUEST and error message 'When TRANSFORMATIONS is present, all COLUMNS must be in GROUP or APPLY'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["building", "maxSeats", "roomCount"],
					},
					TRANSFORMATIONS: {
						GROUP: ["building"],
						APPLY: [
							{
								maxSeats: {
									MAX: "seats",
								},
							},
						],
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "When TRANSFORMATIONS is present, all COLUMNS must be in GROUP or APPLY",
		});
	});

	it("Test 25beta: POST /api/v2/search should respond with status BAD_REQUEST and error message 'Invalid APPLYTOKEN (must be MAX, MIN, AVG, COUNT, or SUM)'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["dept", "code", "midGrade"],
					},
					TRANSFORMATIONS: {
						GROUP: ["dept", "code"],
						APPLY: [
							{
								midGrade: {
									MEDIAN: "avg",
								},
							},
						],
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "Invalid APPLYTOKEN (must be MAX, MIN, AVG, COUNT, or SUM)",
		});
	});

	it("Test 25gamma: POST /api/v2/search should respond with status BAD_REQUEST and error message 'MAX/MIN/AVG/SUM can only be applied to mfields'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["building", "maxNumber"],
					},
					TRANSFORMATIONS: {
						GROUP: ["building"],
						APPLY: [
							{
								maxNumber: {
									MAX: "number",
								},
							},
						],
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "MAX/MIN/AVG/SUM can only be applied to mfields",
		});
	});

	it("Test 25gamma_1: POST /api/v2/search should respond with status BAD_REQUEST and error message 'MAX/MIN/AVG/SUM can only be applied to mfields'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["building", "minAddress"],
					},
					TRANSFORMATIONS: {
						GROUP: ["building"],
						APPLY: [
							{
								minAddress: {
									MIN: "address",
								},
							},
						],
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "MAX/MIN/AVG/SUM can only be applied to mfields",
		});
	});

	it("Test 25gamma_2: POST /api/v2/search should respond with status BAD_REQUEST and error message 'MAX/MIN/AVG/SUM can only be applied to mfields'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["dept", "avgCode"],
					},
					TRANSFORMATIONS: {
						GROUP: ["dept"],
						APPLY: [
							{
								avgCode: {
									AVG: "code",
								},
							},
						],
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "MAX/MIN/AVG/SUM can only be applied to mfields",
		});
	});

	it("Test 25gamma_3: POST /api/v2/search should respond with status BAD_REQUEST and error message 'MAX/MIN/AVG/SUM can only be applied to mfields'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["dept", "code", "sumTitle"],
					},
					TRANSFORMATIONS: {
						GROUP: ["dept", "code"],
						APPLY: [
							{
								sumTitle: {
									SUM: "title",
								},
							},
						],
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "MAX/MIN/AVG/SUM can only be applied to mfields",
		});
	});

	it("Test 25delta: POST /api/v2/search should respond with status BAD_REQUEST and error message 'APPLYRULE must apply aggregation to a valid KEY'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["dept", "avgStudents"],
					},
					TRANSFORMATIONS: {
						GROUP: ["dept"],
						APPLY: [
							{
								avgStudents: {
									AVG: "students",
								},
							},
						],
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "APPLYRULE must apply aggregation to a valid KEY",
		});
	});

	it("Test 25delta_1: POST /api/v2/search should respond with status BAD_REQUEST and error message 'APPLYRULE must apply aggregation to a valid KEY'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["building", "three"],
					},
					TRANSFORMATIONS: {
						GROUP: ["building"],
						APPLY: [
							{
								three: {
									AVG: 3,
								},
							},
						],
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "APPLYRULE must apply aggregation to a valid KEY",
		});
	});

	it("Test 25delta_2: POST /api/v2/search should respond with status BAD_REQUEST and error message 'APPLYRULE must apply aggregation to a valid KEY'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["building", "southeast"],
					},
					TRANSFORMATIONS: {
						GROUP: ["building"],
						APPLY: [
							{
								southeast: {
									MAX: "lon",
									MIN: "lat",
								},
							},
						],
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "APPLYRULE must apply aggregation to a valid KEY",
		});
	});

	it("Test 25epsilon: POST /api/v2/search should respond with status BAD_REQUEST and error message 'Duplicate applykey in APPLY'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["dept", "applyKey"],
					},
					TRANSFORMATIONS: {
						GROUP: ["dept"],
						APPLY: [
							{
								applyKey: {
									AVG: "avg",
								},
							},
							{
								applyKey: {
									count: "instructor",
								},
							},
						],
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "Duplicate applykey in APPLY",
		});
	});

	it("Test 25zeta: POST /api/v2/search should respond with status BAD_REQUEST and error message 'applykey cannot be empty or contain underscore'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["building", "avg_seats"],
					},
					TRANSFORMATIONS: {
						GROUP: ["building"],
						APPLY: [
							{
								avg_seats: {
									AVG: "seats",
								},
							},
						],
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "applykey cannot be empty or contain underscore",
		});
	});

	it("Test 25zeta_1: POST /api/v2/search should respond with status BAD_REQUEST and error message 'applykey cannot be empty or contain underscore'", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["dept", ""],
					},
					TRANSFORMATIONS: {
						GROUP: ["dept"],
						APPLY: [
							{
								"": {
									AVG: "avg",
								},
							},
						],
					},
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid query",
			message: "applykey cannot be empty or contain underscore",
		});
	});

	it("Test 26a: POST /api/v2/search should respond with status OK and empty array", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["instructor"],
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26a_1: POST /api/v2/search should respond with status OK and empty array", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["building", "number"],
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26b: POST /api/v2/search should respond with status OK and empty array", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						AND: [
							{
								OR: [
									{
										LT: {
											fail: 1,
										},
									},
									{
										EQ: {
											audit: 0,
										},
									},
								],
							},
							{
								NOT: {
									IS: {
										code: "2*",
									},
								},
							},
							{
								AND: [
									{
										GT: {
											avg: 85,
										},
									},
								],
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["dept", "code", "avgGrade", "countInstructor", "sumPass", "maxFail", "minYear"],
						ORDER: {
							dir: "DOWN",
							keys: ["dept", "code", "avgGrade"],
						},
					},
					TRANSFORMATIONS: {
						GROUP: ["dept", "code"],
						APPLY: [
							{
								avgGrade: {
									AVG: "avg",
								},
							},
							{
								countInstructor: {
									COUNT: "instructor",
								},
							},
							{
								sumPass: {
									SUM: "pass",
								},
							},
							{
								maxFail: {
									MAX: "fail",
								},
							},
							{
								minYear: {
									MIN: "year",
								},
							},
						],
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26b_1: POST /api/v2/search should respond with status OK and empty array", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						AND: [
							{
								OR: [
									{
										LT: {
											lon: -123.24,
										},
									},
									{
										EQ: {
											seats: 120,
										},
									},
								],
							},
							{
								NOT: {
									IS: {
										number: "1*",
									},
								},
							},
							{
								AND: [
									{
										GT: {
											lat: 49,
										},
									},
								],
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["name", "building", "address", "countRooms", "avgSeats", "sumSeats", "maxLon", "minLat"],
						ORDER: {
							dir: "UP",
							keys: ["building", "address"],
						},
					},
					TRANSFORMATIONS: {
						GROUP: ["name", "building", "address"],
						APPLY: [
							{
								avgSeats: {
									AVG: "seats",
								},
							},
							{
								countRooms: {
									COUNT: "number",
								},
							},
							{
								sumSeats: {
									SUM: "seats",
								},
							},
							{
								maxLon: {
									MAX: "lon",
								},
							},
							{
								minLat: {
									MIN: "lat",
								},
							},
						],
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26c: POST /api/v2/search should respond with status OK and correct unsorted, unfiltered, and untransformed array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["dept", "code", "avg", "pass", "fail"],
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res)
			.to.have.deep.property("body")
			.that.deep.members([
				{
					dept: "Computer Science",
					code: "210",
					avg: 79.5,
					pass: 150,
					fail: 11,
				},
				{
					dept: "Computer Science",
					code: "310",
					avg: 80.4,
					pass: 124,
					fail: 0,
				},
				{
					dept: "Computer Science",
					code: "310",
					avg: 82.5,
					pass: 137,
					fail: 0,
				},
			]);
	});

	it("Test 26c_1: POST /api/v2/search should respond with status OK and correct unfiltered array sorted by seats", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["name", "number", "lat", "lon", "seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [
			{
				name: "Hugh Dempster Pavilion",
				number: "110",
				lat: 49.26117,
				lon: -123.24814,
				seats: 120,
			},
			{
				name: "Hector J. MacLeod Building",
				number: "2018",
				lat: 49.26161,
				lon: -123.24941,
				seats: 124,
			},
			{
				name: "Hugh Dempster Pavilion",
				number: "310",
				lat: 49.26117,
				lon: -123.24814,
				seats: 160,
			},
		]);
	});

	it("Test 26c_2: POST /api/v2/search should respond with status OK and correct unfiltered array sorted descending by fail and avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["dept", "code", "avg", "pass", "fail"],
						ORDER: {
							dir: "DOWN",
							keys: ["fail", "avg"],
						},
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [
			{
				dept: "Computer Science",
				code: "210",
				avg: 79.5,
				pass: 150,
				fail: 11,
			},
			{
				dept: "Computer Science",
				code: "310",
				avg: 82.5,
				pass: 137,
				fail: 0,
			},
			{
				dept: "Computer Science",
				code: "310",
				avg: 80.4,
				pass: 124,
				fail: 0,
			},
		]);
	});

	it("Test 26c_3: POST /api/v2/search should respond with status OK and correct unfiltered array sorted ascending by name and type", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["name", "number", "lat", "lon", "type"],
						ORDER: {
							dir: "UP",
							keys: ["name", "type"],
						},
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [
			{
				name: "Hector J. MacLeod Building",
				number: "2018",
				lat: 49.26161,
				lon: -123.24941,
				type: "Open Design General Purpose",
			},
			{
				name: "Hugh Dempster Pavilion",
				number: "310",
				lat: 49.26117,
				lon: -123.24814,
				type: "General Purpose",
			},
			{
				name: "Hugh Dempster Pavilion",
				number: "110",
				lat: 49.26117,
				lon: -123.24814,
				type: "Open Design General Purpose",
			},
		]);
	});

	it("Test 26d: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						LT: {
							avg: 100,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }, { avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 26d_1: POST /api/v2/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						LT: {
							avg: 0,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26d_2: POST /api/v2/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						LT: {
							avg: 79.5,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26d_3: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						LT: {
							avg: 79.6,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }]);
	});

	it("Test 26d_4: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						LT: {
							avg: 82.5,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }, { avg: 80.4 }]);
	});

	it("Test 26d_5: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						LT: {
							avg: 82.6,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }, { avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 26d_6: POST /api/v2/search should respond with status OK and correct filtered array sorted by seats", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						LT: {
							seats: 161,
						},
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ seats: 120 }, { seats: 124 }, { seats: 160 }]);
	});

	it("Test 26d_7: POST /api/v2/search should respond with status OK and correct filtered array sorted by seats", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						LT: {
							seats: 160,
						},
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ seats: 120 }, { seats: 124 }]);
	});

	it("Test 26d_8: POST /api/v2/search should respond with status OK and correct filtered array sorted by seats", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						LT: {
							seats: 121,
						},
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ seats: 120 }]);
	});

	it("Test 26d_9: POST /api/v2/search should respond with status OK and empty array", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						LT: {
							seats: 120,
						},
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26d_10: POST /api/v2/search should respond with status OK and correct filtered array sorted by seats", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						LT: {
							lon: -123.249,
						},
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ seats: 124 }]);
	});

	it("Test 26e: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						GT: {
							avg: 0,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }, { avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 26e_1: POST /api/v2/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						GT: {
							avg: 100,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26e_2: POST /api/v2/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						GT: {
							avg: 82.5,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26e_3: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						GT: {
							avg: 82.4,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 82.5 }]);
	});

	it("Test 26e_4: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						GT: {
							avg: 79.5,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 26e_5: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						GT: {
							avg: 79.4,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }, { avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 26e_6: POST /api/v2/search should respond with status OK and correct filtered array sorted by seats", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						GT: {
							seats: 119,
						},
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ seats: 120 }, { seats: 124 }, { seats: 160 }]);
	});

	it("Test 26e_7: POST /api/v2/search should respond with status OK and correct filtered array sorted by seats", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						GT: {
							seats: 120,
						},
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ seats: 124 }, { seats: 160 }]);
	});

	it("Test 26e_8: POST /api/v2/search should respond with status OK and correct filtered array sorted by seats", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						GT: {
							seats: 159,
						},
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ seats: 160 }]);
	});

	it("Test 26e_9: POST /api/v2/search should respond with status OK and empty array", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						GT: {
							seats: 160,
						},
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26e_10: POST /api/v2/search should respond with status OK and correct filtered array sorted by seats", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						GT: {
							lon: -123.249,
						},
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ seats: 120 }, { seats: 160 }]);
	});

	it("Test 26f: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						EQ: {
							avg: 80.4,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 80.4 }]);
	});

	it("Test 26f_1: POST /api/v2/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						EQ: {
							avg: 80.3,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26f_2: POST /api/v2/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						EQ: {
							avg: 80.5,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26f_3: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						EQ: {
							year: 2024,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 26f_4: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						EQ: {
							year: 2025,
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }]);
	});

	it("Test 26f_5: POST /api/v2/search should respond with status OK and correct filtered array sorted by seats", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						EQ: {
							seats: 124,
						},
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ seats: 124 }]);
	});

	it("Test 26f_6: POST /api/v2/search should respond with status OK and empty array", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						EQ: {
							seats: 123,
						},
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26f_7: POST /api/v2/search should respond with status OK and empty array", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						EQ: {
							seats: 125,
						},
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26f_8: POST /api/v2/search should respond with status OK and correct filtered array sorted by seats", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						EQ: {
							lat: 49.26117,
						},
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ seats: 120 }, { seats: 160 }]);
	});

	it("Test 26g: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "310",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 26g_1: POST /api/v2/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "1",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26g_2: POST /api/v2/search should respond with status OK and correct filtered array sorted by seats", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						IS: {
							name: "Hugh Dempster Pavilion",
						},
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ seats: 120 }, { seats: 160 }]);
	});

	it("Test 26g_3: POST /api/v2/search should respond with status OK and empty array", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						IS: {
							name: "H",
						},
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26h: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "*",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }, { avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 26h_1: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "**",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }, { avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 26h_2: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "*10",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }, { avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 26h_3: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "*310",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 26h_4: POST /api/v2/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "*1",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26h_5: POST /api/v2/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "*31",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26h_6: POST /api/v2/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "*10-",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26h_7: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "2*",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }]);
	});

	it("Test 26h_8: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "310*",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 26h_9: POST /api/v2/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "10*",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26h_10: POST /api/v2/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "1*",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26h_11: POST /api/v2/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "-310*",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26h_12: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "*1*",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }, { avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 26h_13: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "*10*",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }, { avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 26h_14: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "*21*",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }]);
	});

	it("Test 26h_15: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "*310*",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 26h_16: POST /api/v2/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						IS: {
							code: "*-310-*",
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26h_17: POST /api/v2/search should respond with status OK and correct filtered array sorted by seats", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						IS: {
							name: "*",
						},
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ seats: 120 }, { seats: 124 }, { seats: 160 }]);
	});

	it("Test 26h_18: POST /api/v2/search should respond with status OK and correct filtered array sorted by seats", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						IS: {
							name: "H*",
						},
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ seats: 120 }, { seats: 124 }, { seats: 160 }]);
	});

	it("Test 26h_19: POST /api/v2/search should respond with status OK and correct filtered array sorted by seats", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						IS: {
							name: "Hu*",
						},
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ seats: 120 }, { seats: 160 }]);
	});

	it("Test 26h_20: POST /api/v2/search should respond with status OK and correct filtered array sorted by seats", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						IS: {
							address: "* V6T 1Z4",
						},
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ seats: 120 }, { seats: 124 }, { seats: 160 }]);
	});

	it("Test 26h_21: POST /api/v2/search should respond with status OK and correct filtered array sorted by seats", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						IS: {
							address: "*l V6T 1Z4",
						},
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ seats: 124 }]);
	});

	it("Test 26h_22: POST /api/v2/search should respond with status OK and correct filtered array sorted by seats", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						IS: {
							name: "*n*",
						},
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ seats: 120 }, { seats: 124 }, { seats: 160 }]);
	});

	it("Test 26h_23: POST /api/v2/search should respond with status OK and correct filtered array sorted by seats", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						IS: {
							name: "*on*",
						},
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ seats: 120 }, { seats: 160 }]);
	});

	it("Test 26h_24: POST /api/v2/search should respond with status OK and empty array", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						IS: {
							address: "*2",
						},
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26h_25: POST /api/v2/search should respond with status OK and empty array", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						IS: {
							address: "4*",
						},
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26h_26: POST /api/v2/search should respond with status OK and empty array", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						IS: {
							address: "*Z",
						},
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26i: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						AND: [
							{
								IS: {
									code: "310",
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 26i_1: POST /api/v2/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						AND: [
							{
								IS: {
									code: "",
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26i_2: POST /api/v2/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						AND: [
							{
								IS: {
									code: "*10",
								},
							},
							{
								EQ: {
									year: 2023,
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26i_3: POST /api/v2/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						AND: [
							{
								IS: {
									code: "210",
								},
							},
							{
								EQ: {
									year: 2024,
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26i_4: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						AND: [
							{
								IS: {
									code: "310",
								},
							},
							{
								EQ: {
									year: 2024,
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 26i_5: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						AND: [
							{
								IS: {
									code: "310",
								},
							},
							{
								LT: {
									avg: 81,
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 80.4 }]);
	});

	it("Test 26i_6: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						AND: [
							{
								AND: [
									{
										IS: {
											code: "*10",
										},
									},
									{
										LT: {
											avg: 81,
										},
									},
								],
							},
							{
								GT: {
									pass: 133,
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }]);
	});

	it("Test 26i_7: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						AND: [
							{
								LT: {
									avg: 85,
								},
							},
							{
								EQ: {
									fail: 0,
								},
							},
							{
								GT: {
									pass: 133,
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 82.5 }]);
	});

	it("Test 26i_8: POST /api/v2/search should respond with status OK and correct filtered array sorted by seats", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						AND: [
							{
								IS: {
									number: "*10",
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ seats: 120 }, { seats: 160 }]);
	});

	it("Test 26i_9: POST /api/v2/search should respond with status OK and correct filtered array sorted by seats", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						AND: [
							{
								IS: {
									number: "*10",
								},
							},
							{
								GT: {
									seats: 120,
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ seats: 160 }]);
	});

	it("Test 26i_10: POST /api/v2/search should respond with status OK and empty array", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						AND: [
							{
								IS: {
									number: "*10",
								},
							},
							{
								GT: {
									seats: 120,
								},
							},
							{
								IS: {
									address: "23*",
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26j: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						OR: [
							{
								IS: {
									code: "310",
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 26j_1: POST /api/v2/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						OR: [
							{
								IS: {
									code: "",
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26j_2: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						OR: [
							{
								GT: {
									avg: 81,
								},
							},
							{
								EQ: {
									year: 2025,
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }, { avg: 82.5 }]);
	});

	it("Test 26j_3: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						OR: [
							{
								IS: {
									code: "310",
								},
							},
							{
								LT: {
									avg: 82,
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }, { avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 26j_4: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						OR: [
							{
								IS: {
									code: "210",
								},
							},
							{
								IS: {
									title: "*Software*",
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }, { avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 26j_5: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						OR: [
							{
								IS: {
									code: "110",
								},
							},
							{
								GT: {
									fail: 0,
								},
							},
							{
								LT: {
									pass: 130,
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }, { avg: 80.4 }]);
	});

	it("Test 26j_6: POST /api/v2/search should respond with status OK and correct filtered array sorted by seats", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						OR: [
							{
								IS: {
									number: "*10",
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ seats: 120 }, { seats: 160 }]);
	});

	it("Test 26j_7: POST /api/v2/search should respond with status OK and correct filtered array sorted by seats", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						OR: [
							{
								IS: {
									number: "1*",
								},
							},
							{
								LT: {
									lon: -123.249,
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ seats: 120 }, { seats: 124 }]);
	});

	it("Test 26j_8: POST /api/v2/search should respond with status OK and correct filtered array sorted by seats", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						OR: [
							{
								IS: {
									number: "110",
								},
							},
							{
								EQ: {
									seats: 124,
								},
							},
							{
								IS: {
									building: "DMP",
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ seats: 120 }, { seats: 124 }, { seats: 160 }]);
	});

	it("Test 26k: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						NOT: {
							IS: {
								code: "21*",
							},
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 26k_1: POST /api/v2/search should respond with status OK and correct filtered array sorted by avg", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						NOT: {
							IS: {
								code: "",
							},
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ avg: 79.5 }, { avg: 80.4 }, { avg: 82.5 }]);
	});

	it("Test 26k_2: POST /api/v2/search should respond with status OK and empty array", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						NOT: {
							IS: {
								code: "*0",
							},
						},
					},
					OPTIONS: {
						COLUMNS: ["avg"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", []);
	});

	it("Test 26k_3: POST /api/v2/search should respond with status OK and correct filtered array sorted by seats", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						NOT: {
							EQ: {
								seats: 124,
							},
						},
					},
					OPTIONS: {
						COLUMNS: ["seats"],
						ORDER: "seats",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [{ seats: 120 }, { seats: 160 }]);
	});

	it("Test 26l: POST /api/v2/search should respond with status OK and correct filtered array sorted by fail", async () => {
		await addTestSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {
						OR: [
							{
								NOT: {
									LT: {
										fail: 1,
									},
								},
							},
							{
								AND: [
									{
										OR: [
											{
												IS: {
													code: "3*",
												},
											},
											{
												EQ: {
													audit: 1,
												},
											},
										],
									},
									{
										GT: {
											avg: 80,
										},
									},
									{
										IS: {
											instructor: "*ine",
										},
									},
								],
							},
							{
								IS: {
									title: "Software",
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["audit", "avg", "code", "dept", "fail", "instructor", "pass", "title", "year"],
						ORDER: "fail",
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [
			{
				audit: 0,
				avg: 82.5,
				code: "310",
				dept: "Computer Science",
				fail: 0,
				instructor: "kerr, katharine",
				pass: 137,
				title: "Introduction to Software Engineering",
				year: 2024,
			},
			{
				audit: 1,
				avg: 79.5,
				code: "210",
				dept: "Computer Science",
				fail: 11,
				pass: 150,
				instructor: "osveisi-fordoei, mehrdad",
				title: "Software Construction",
				year: 2025,
			},
		]);
	});

	it("Test 26l_1: POST /api/v2/search should respond with status OK and correct filtered array sorted by address", async () => {
		await addTestRooms();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {
						OR: [
							{
								NOT: {
									LT: {
										seats: 125,
									},
								},
							},
							{
								AND: [
									{
										OR: [
											{
												IS: {
													address: "*Agronomy Road*",
												},
											},
											{
												EQ: {
													seats: 124,
												},
											},
										],
									},
									{
										GT: {
											lon: -123.249,
										},
									},
									{
										IS: {
											name: "Hector J. MacLeod Building",
										},
									},
								],
							},
							{
								IS: {
									href: "*d-*",
								},
							},
						],
					},
					OPTIONS: {
						COLUMNS: ["address", "building", "furniture", "href", "lat", "lon", "name", "number", "seats", "type"],
						ORDER: {
							dir: "DOWN",
							keys: ["address"],
						},
					},
				},
			});
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", [
			{
				address: "6245 Agronomy Road V6T 1Z4",
				building: "DMP",
				furniture: "Fixed Tables",
				href: "https://learningspaces.ubc.ca/classrooms/dmp-310",
				lat: 49.26117,
				lon: -123.24814,
				name: "Hugh Dempster Pavilion",
				number: "310",
				seats: 160,
				type: "General Purpose",
			},
			{
				address: "2356 Main Mall V6T 1Z4",
				building: "MCLD",
				furniture: "Fixed Tables",
				href: "https://learningspaces.ubc.ca/classrooms/mcld-2018",
				lat: 49.26161,
				lon: -123.24941,
				name: "Hector J. MacLeod Building",
				number: "2018",
				seats: 124,
				type: "Open Design General Purpose",
			},
		]);
	});

	it("Test 26n: POST /api/v2/search should respond with status REQUEST_TOO_LONG and error message 'Query would return more than 5000 results' and the limit of 5000", async () => {
		const datasetBuffer = await fs.readFile(path.resolve(__dirname, "test_data", "pair.zip"));
		const initialResponse = await request(app)
			.post("/api/v1/datasets")
			.field("kind", "course_offerings")
			.attach("archive", datasetBuffer, "pair.zip");
		await waitForUploadToFinish(app, initialResponse);
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: {
						COLUMNS: ["avg", "pass", "fail"],
						ORDER: "avg",
					},
				},
			});
		expect(res).to.have.property("status", REQUEST_TOO_LONG);
		expect(res).to.have.deep.property("body", {
			error: "Too many results",
			message: "Query would return more than 5000 results",
			limit: 5000,
		});
	});

	//----------------------------------------------------------------------------------------------------//
	//                                                                                                    //
	//                                        COURSES (PLURAL)                                            //
	//                                                                                                    //
	//----------------------------------------------------------------------------------------------------//

	it("Test 7b: GET /api/v1/courses?limit=5000&offset=0 should respond with status OK, 0 total count, limit 5000, offset 0, and an empty items array", async () => {
		const res = await request(app).get("/api/v1/courses?limit=5000&offset=0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 0,
			limit: 5000,
			offset: 0,
			items: [],
		});
	});

	it("Test 7d: GET /api/v1/courses?limit=500&offset=0 should respond with status OK, 1 total count, limit 500, offset 0, and an items array with one course", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).get("/api/v1/courses?limit=500&offset=0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 1,
			limit: 500,
			offset: 0,
			items: [
				{
					id: "cpsc310",
					title: "Introduction to Software Engineering",
					dept: "Computer Science",
					code: "310",
					links: {
						self: "/api/v1/courses/cpsc310",
						sections: "/api/v1/courses/cpsc310/sections",
					},
				},
			],
		});
	});

	it("Test 7d_1: GET /api/v1/courses?limit=500&offset=1 should respond with status OK, 1 total count, limit 500, offset 1, and an empty items array", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).get("/api/v1/courses?limit=500&offset=1");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 1,
			limit: 500,
			offset: 1,
			items: [],
		});
	});

	it("Test 7d_2: GET /api/v1/courses?limit=500&offset=2 should respond with status OK, 1 total count, limit 500, offset 2, and an empty items array", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).get("/api/v1/courses?limit=500&offset=2");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 1,
			limit: 500,
			offset: 2,
			items: [],
		});
	});

	it("Test 7e: GET /api/v1/courses?limit=10&offset=0 should respond with status OK, 0 total count, limit 10, offset 0, and an empty items array", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).delete("/api/v1/courses/cpsc310");
		const res = await request(app).get("/api/v1/courses?limit=10&offset=0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 0,
			limit: 10,
			offset: 0,
			items: [],
		});
	});

	it("Test 7f: GET /api/v1/courses?limit=10&offset=0 should respond with status OK, 1 total count, limit 10, offset 0, and an items array with 1 course", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Software Engineering",
			dept: "CPSC",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).get("/api/v1/courses?limit=10&offset=0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 1,
			limit: 10,
			offset: 0,
			items: [
				{
					id: "cpsc310",
					title: "Introduction to Software Engineering",
					dept: "Computer Science",
					code: "310",
					links: {
						self: "/api/v1/courses/cpsc310",
						sections: "/api/v1/courses/cpsc310/sections",
					},
				},
			],
		});
	});

	it("Test 7g: GET /api/v1/courses?limit=10&offset=0 should respond with status OK, 3 total count, limit 10, offset 0, and an items array with 3 courses", async () => {
		await request(app).put("/api/v1/courses/cpsc110").send({
			title: "Computation, Programs, and Programming",
			dept: "Computer Science",
			code: "110",
		});
		await request(app).put("/api/v1/courses/cpsc210").send({
			title: "Software Construction",
			dept: "Computer Science",
			code: "210",
		});
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).get("/api/v1/courses?limit=10&offset=0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 3,
			limit: 10,
			offset: 0,
			items: [
				{
					id: "cpsc110",
					title: "Computation, Programs, and Programming",
					dept: "Computer Science",
					code: "110",
					links: {
						self: "/api/v1/courses/cpsc110",
						sections: "/api/v1/courses/cpsc110/sections",
					},
				},
				{
					id: "cpsc210",
					title: "Software Construction",
					dept: "Computer Science",
					code: "210",
					links: {
						self: "/api/v1/courses/cpsc210",
						sections: "/api/v1/courses/cpsc210/sections",
					},
				},
				{
					id: "cpsc310",
					title: "Introduction to Software Engineering",
					dept: "Computer Science",
					code: "310",
					links: {
						self: "/api/v1/courses/cpsc310",
						sections: "/api/v1/courses/cpsc310/sections",
					},
				},
			],
		});
	});

	it("Test 7g_1: GET /api/v1/courses?limit=2offset=0 should respond with status OK, 3 total count, limit 2, offset 0, and an items array with 2 courses", async () => {
		await request(app).put("/api/v1/courses/cpsc110").send({
			title: "Computation, Programs, and Programming",
			dept: "Computer Science",
			code: "110",
		});
		await request(app).put("/api/v1/courses/cpsc210").send({
			title: "Software Construction",
			dept: "Computer Science",
			code: "210",
		});
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).get("/api/v1/courses?limit=2&offset=0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 3,
			limit: 2,
			offset: 0,
			items: [
				{
					id: "cpsc110",
					title: "Computation, Programs, and Programming",
					dept: "Computer Science",
					code: "110",
					links: {
						self: "/api/v1/courses/cpsc110",
						sections: "/api/v1/courses/cpsc110/sections",
					},
				},
				{
					id: "cpsc210",
					title: "Software Construction",
					dept: "Computer Science",
					code: "210",
					links: {
						self: "/api/v1/courses/cpsc210",
						sections: "/api/v1/courses/cpsc210/sections",
					},
				},
			],
		});
	});

	it("Test 7g_2: GET /api/v1/courses?limit=10&offset=1 should respond with status OK, 3 total count, limit 10, offset 1, and an items array with 2 courses", async () => {
		await request(app).put("/api/v1/courses/cpsc110").send({
			title: "Computation, Programs, and Programming",
			dept: "Computer Science",
			code: "110",
		});
		await request(app).put("/api/v1/courses/cpsc210").send({
			title: "Software Construction",
			dept: "Computer Science",
			code: "210",
		});
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).get("/api/v1/courses?limit=10&offset=1");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 3,
			limit: 10,
			offset: 1,
			items: [
				{
					id: "cpsc210",
					title: "Software Construction",
					dept: "Computer Science",
					code: "210",
					links: {
						self: "/api/v1/courses/cpsc210",
						sections: "/api/v1/courses/cpsc210/sections",
					},
				},
				{
					id: "cpsc310",
					title: "Introduction to Software Engineering",
					dept: "Computer Science",
					code: "310",
					links: {
						self: "/api/v1/courses/cpsc310",
						sections: "/api/v1/courses/cpsc310/sections",
					},
				},
			],
		});
	});

	it("Test 7g_3: GET /api/v1/courses?limit=1offset=1 should respond with status OK, 3 total count, limit 1, offset 1, and an items array with 1 course", async () => {
		await request(app).put("/api/v1/courses/cpsc110").send({
			title: "Computation, Programs, and Programming",
			dept: "Computer Science",
			code: "110",
		});
		await request(app).put("/api/v1/courses/cpsc210").send({
			title: "Software Construction",
			dept: "Computer Science",
			code: "210",
		});
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).get("/api/v1/courses?limit=1&offset=1");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 3,
			limit: 1,
			offset: 1,
			items: [
				{
					id: "cpsc210",
					title: "Software Construction",
					dept: "Computer Science",
					code: "210",
					links: {
						self: "/api/v1/courses/cpsc210",
						sections: "/api/v1/courses/cpsc210/sections",
					},
				},
			],
		});
	});

	it("Test 7h: GET /api/v1/courses?limit=10&offset=0 should respond with status OK, total count 3, limit 10, offset 0, and an items array with 3 items", async () => {
		await request(app).put("/api/v1/courses/cpsc110").send({
			title: "Computation, Programs, and Programming",
			dept: "Computer Science",
			code: "110",
		});
		await request(app).put("/api/v1/courses/cpsc210").send({
			title: "Software Construction",
			dept: "Computer Science",
			code: "210",
		});
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc210/sections/2024w201").send({
			instructor: "osveisi-fordoei, mehrdad",
			year: 2024,
			avg: 79.5,
			pass: 150,
			fail: 11,
			audit: 0,
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w202").send({
			instructor: "kerr, katharine",
			year: 2024,
			avg: 82.5,
			pass: 137,
			fail: 0,
			audit: 0,
		});
		const res = await request(app).get("/api/v1/courses?limit=10&offset=0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 3,
			limit: 10,
			offset: 0,
			items: [
				{
					id: "cpsc110",
					title: "Computation, Programs, and Programming",
					dept: "Computer Science",
					code: "110",
					links: {
						self: "/api/v1/courses/cpsc110",
						sections: "/api/v1/courses/cpsc110/sections",
					},
				},
				{
					id: "cpsc210",
					title: "Software Construction",
					dept: "Computer Science",
					code: "210",
					links: {
						self: "/api/v1/courses/cpsc210",
						sections: "/api/v1/courses/cpsc210/sections",
					},
				},
				{
					id: "cpsc310",
					title: "Introduction to Software Engineering",
					dept: "Computer Science",
					code: "310",
					links: {
						self: "/api/v1/courses/cpsc310",
						sections: "/api/v1/courses/cpsc310/sections",
					},
				},
			],
		});
	});

	it("Test 7i: GET /api/v1/courses?limit=a&offset=b should respond with status BAD_REQUEST, and errors with both limit and offset params", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).get("/api/v1/courses?limit=a&offset=b");
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid request parameters",
			params: {
				limit: "expected an integer between 1 and 5000",
				offset: "expected an integer >= 0",
			},
		});
	});

	it("Test 7i_1: GET /api/v1/courses?limit=5001&offset=-1 should respond with status BAD_REQUEST, and errors with both limit and offset params", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).get("/api/v1/courses?limit=5001&offset=-1");
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid request parameters",
			params: {
				limit: "expected an integer between 1 and 5000",
				offset: "expected an integer >= 0",
			},
		});
	});

	it("Test 7i_2: GET /api/v1/courses?limit=0&offset=0 should respond with status BAD_REQUEST, and errors with limit param", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).get("/api/v1/courses?limit=0&offset=0");
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid request parameters",
			params: {
				limit: "expected an integer between 1 and 5000",
			},
		});
	});

	it("Test 7i_3: GET /api/v1/courses?limit=5000&offset=1.5 should respond with status BAD_REQUEST, and errors with offset param", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).get("/api/v1/courses?limit=5000&offset=1.5");
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid request parameters",
			params: {
				offset: "expected an integer >= 0",
			},
		});
	});

	it("Test 7i_4: GET /api/v1/courses?limit=1.5&offset=0 should respond with status BAD_REQUEST, and errors with limit param", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).get("/api/v1/courses?limit=1.5&offset=0");
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid request parameters",
			params: {
				limit: "expected an integer between 1 and 5000",
			},
		});
	});

	it("Test 7j: GET /api/v1/courses should respond with status OK, 0 total count, limit 100, offset 0, and an empty items array", async () => {
		const res = await request(app).get("/api/v1/courses");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 0,
			limit: 100,
			offset: 0,
			items: [],
		});
	});

	it("Test 7j_1: GET /api/v1/courses?offset=10 should respond with status OK, 0 total count, limit 100, offset 10, and an empty items array", async () => {
		const res = await request(app).get("/api/v1/courses?offset=10");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 0,
			limit: 100,
			offset: 10,
			items: [],
		});
	});

	it("Test 7j_2: GET /api/v1/courses?limit=5000 should respond with status OK, 0 total count, limit 5000, offset 0, and an empty items array", async () => {
		const res = await request(app).get("/api/v1/courses?limit=5000");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 0,
			limit: 5000,
			offset: 0,
			items: [],
		});
	});

	//----------------------------------------------------------------------------------------------------//
	//                                                                                                    //
	//                                              COURSE                                                //
	//                                                                                                    //
	//----------------------------------------------------------------------------------------------------//
	//-----------------------------------------------GET--------------------------------------------------//

	it("Test 8b: GET /api/v1/courses/{course} should respond with status NOT_FOUND, error 'Not found', and message 'no course with id '{course}''", async () => {
		const res = await request(app).get("/api/v1/courses/cpsc310");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no course with id 'cpsc310'",
		});
	});

	it("Test 8c: GET /api/v1/courses/{courses} should respond with status OK and body course data", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).get("/api/v1/courses/cpsc310");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "cpsc310",
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
			links: {
				self: "/api/v1/courses/cpsc310",
				sections: "/api/v1/courses/cpsc310/sections",
			},
		});
	});

	it("Test 8d: GET /api/v1/courses/{courses} should respond with status NOT_FOUND, error 'Not found', and message 'no course with id '{course}''", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).get("/api/v1/courses/cpsc110");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no course with id 'cpsc110'",
		});
	});

	it("Test 8e: GET /api/v1/courses/{courses} should respond with status NOT_FOUND, error 'Not found', and message 'no course with id '{course}''", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).delete("/api/v1/courses/cpsc310");
		const res = await request(app).get("/api/v1/courses/cpsc310");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no course with id 'cpsc310'",
		});
	});

	it("Test 8g: GET /api/v1/courses/{courses} should respond with status OK and body course data", async () => {
		await request(app).put("/api/v1/courses/cpsc110").send({
			title: "Computation, Programs, and Programming",
			dept: "Computer Science",
			code: "110",
		});
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).get("/api/v1/courses/cpsc310");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "cpsc310",
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
			links: {
				self: "/api/v1/courses/cpsc310",
				sections: "/api/v1/courses/cpsc310/sections",
			},
		});
	});

	it("Test 8h: GET /api/v1/courses/{courses} should respond with status OK and body course data", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w202").send({
			instructor: "kerr, katharine",
			year: 2024,
			avg: 82.5,
			pass: 137,
			fail: 0,
			audit: 0,
		});
		const res = await request(app).get("/api/v1/courses/cpsc310");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "cpsc310",
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
			links: {
				self: "/api/v1/courses/cpsc310",
				sections: "/api/v1/courses/cpsc310/sections",
			},
		});
	});

	//-----------------------------------------------PUT--------------------------------------------------//

	it("Test 5a: PUT /api/v1/courses/{course} should respond with status CREATED and body course data", async () => {
		const res = await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		expect(res).to.have.property("status", CREATED);
		expect(res).to.have.deep.property("body", {
			id: "cpsc310",
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
			links: {
				self: "/api/v1/courses/cpsc310",
				sections: "/api/v1/courses/cpsc310/sections",
			},
		});
	});

	it("Test 5b: PUT /api/v1/courses/{course} should respond with status NO_CONTENT", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Software Engineering",
			dept: "CPSC",
			code: "310",
		});
		const res = await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		expect(res).to.have.property("status", NO_CONTENT);
	});

	it("Test 5d: PUT /api/v1/courses/{course} should respond with status UNPROCESSABLE_ENTITY, error 'Validation failed', and fields with title 'required but missing' and code 'expected a string'", async () => {
		const res = await request(app).put("/api/v1/courses/cpsc310").send({
			dept: "Computer Science",
			code: 310,
		});
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				title: "required but missing",
				code: "expected a string",
			},
		});
	});

	it("Test 5e: PUT /api/v1/courses/{course} should respond with status UNPROCESSABLE_ENTITY, error 'Validation failed', and fields with title 'required but missing' and code 'expected a string'", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "CPSC",
			code: "310",
		});
		const res = await request(app).put("/api/v1/courses/cpsc310").send({
			dept: "Computer Science",
			code: 310,
		});
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				title: "required but missing",
				code: "expected a string",
			},
		});
	});

	it("Test 5f: PUT /api/v1/courses/{course} should respond with status UNPROCESSABLE_ENTITY, error 'Validation failed', and all fields 'required but missing'", async () => {
		const res = await request(app).put("/api/v1/courses/cpsc310").send({});
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				title: "required but missing",
				dept: "required but missing",
				code: "required but missing",
			},
		});
	});

	it("Test 5g: PUT /api/v1/courses/{course} should respond with status UNPROCESSABLE_ENTITY, error 'Validation failed', and all fields 'expected a string'", async () => {
		const res = await request(app).put("/api/v1/courses/cpsc310").send({
			title: 310,
			dept: 310,
			code: 310,
		});
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				title: "expected a string",
				dept: "expected a string",
				code: "expected a string",
			},
		});
	});

	it("Test 5h: PUT /api/v1/courses/{course} should respond with status CREATED and body course data", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Software Engineering",
			dept: "CPSC",
			code: "310",
		});
		await request(app).delete("/api/v1/courses/cpsc310");
		const res = await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		expect(res).to.have.property("status", CREATED);
		expect(res).to.have.deep.property("body", {
			id: "cpsc310",
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
			links: {
				self: "/api/v1/courses/cpsc310",
				sections: "/api/v1/courses/cpsc310/sections",
			},
		});
	});

	//----------------------------------------------DELETE------------------------------------------------//

	it("Test 6b: DELETE /api/v1/courses/{courses} should respond with status NOT_FOUND, error 'Not found', and message 'no course with id '{course}''", async () => {
		const res = await request(app).delete("/api/v1/courses/cpsc310");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no course with id 'cpsc310'",
		});
	});

	it("Test 6c: DELETE /api/v1/courses/{courses} should respond with status OK and body course data", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).delete("/api/v1/courses/cpsc310");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "cpsc310",
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
			sections: 0,
		});
	});

	it("Test 6d: DELETE /api/v1/courses/{courses} should respond with status NOT_FOUND, error 'Not found', and message 'no course with id '{course}''", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).delete("/api/v1/courses/cpsc110");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no course with id 'cpsc110'",
		});
	});

	it("Test 6e: DELETE /api/v1/courses/{courses} should respond with status NOT_FOUND, error 'Not found', and message 'no course with id '{course}''", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).delete("/api/v1/courses/cpsc310");
		const res = await request(app).delete("/api/v1/courses/cpsc310");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no course with id 'cpsc310'",
		});
	});

	it("Test 6g: DELETE /api/v1/courses/{courses} should respond with status OK and body course data", async () => {
		await request(app).put("/api/v1/courses/cpsc110").send({
			title: "Computation, Programs, and Programming",
			dept: "Computer Science",
			code: "110",
		});
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).delete("/api/v1/courses/cpsc310");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "cpsc310",
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
			sections: 0,
		});
	});

	it("Test 6h: DELETE /api/v1/courses/{courses} should respond with status OK and body course data", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w202").send({
			instructor: "kerr, katharine",
			year: 2024,
			avg: 82.5,
			pass: 137,
			fail: 0,
			audit: 0,
		});
		const res = await request(app).delete("/api/v1/courses/cpsc310");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "cpsc310",
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
			sections: 2,
		});
	});

	//----------------------------------------------------------------------------------------------------//
	//                                                                                                    //
	//                                        SECTIONS (PLURAL)                                           //
	//                                                                                                    //
	//----------------------------------------------------------------------------------------------------//

	it("Test 11b: GET /api/v1/courses/{course}/sections?limit=500&offset=0 should respond with status NOT_FOUND and error 'Not found' and message 'no course with id '{course}'", async () => {
		const res = await request(app).get("/api/v1/courses/cpsc310/sections?limit=500offset=0");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no course with id 'cpsc310'",
		});
	});

	it("Test 11c: GET /api/v1/courses/{course}/sections should respond with status OK, total 0, limit 10, offset 0, and an empty list of items", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).get("/api/v1/courses/cpsc310/sections?limit=10&offset=0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 0,
			limit: 10,
			offset: 0,
			items: [],
		});
	});

	it("Test 11e: GET /api/v1/courses/{course}/sections?limit=500&offset=0 should respond with status NOT_FOUND and error 'Not found' and message 'no course with id '{course}'", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).get("/api/v1/courses/cpsc210/sections?limit=500&offset=0");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no course with id 'cpsc210'",
		});
	});

	it("Test 11f: GET /api/v1/courses/{course}/sections?limit=10&offset=0 should respond with status OK, total 1, limit 10, offset 0, and an items array with one item", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		const res = await request(app).get("/api/v1/courses/cpsc310/sections?limit=10&offset=0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 1,
			limit: 10,
			offset: 0,
			items: [
				{
					id: "2024w201",
					instructor: "bradley, nicholas",
					year: 2024,
					avg: 80.4,
					pass: 124,
					fail: 0,
					audit: 0,
					links: {
						self: "/api/v1/courses/cpsc310/sections/2024w201",
						course: "/api/v1/courses/cpsc310",
					},
				},
			],
		});
	});

	it("Test 11f_1: GET /api/v1/courses/{course}/sections?limit=10&offset=0 should respond with status OK, total 0, limit 10, offset 1, and an empty list of items", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		const res = await request(app).get("/api/v1/courses/cpsc310/sections?limit=10&offset=1");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 1,
			limit: 10,
			offset: 1,
			items: [],
		});
	});

	it("Test 11f_2: GET /api/v1/courses/{course}/sections?limit=10&offset=2 should respond with status OK, total 0, limit 10, offset 2, and an empty list of items", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		const res = await request(app).get("/api/v1/courses/cpsc310/sections?limit=10&offset=2");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 1,
			limit: 10,
			offset: 2,
			items: [],
		});
	});

	it("Test 11g: GET /api/v1/courses/{course}/sections?limit=10&offset=0 should respond with status OK, total 0, limit 10, offset 0, and an empty list of items", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		await request(app).delete("/api/v1/courses/cpsc310/sections/2024w201");
		const res = await request(app).get("/api/v1/courses/cpsc310/sections?limit=10&offset=0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 0,
			limit: 10,
			offset: 0,
			items: [],
		});
	});

	it("Test 11h: GET /api/v1/courses/{course}/sections?limit=10&offset=0 should respond with status OK, total 1, limit 10, offset 0, and an items array of one item", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "",
			year: 2024,
			avg: 80,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		const res = await request(app).get("/api/v1/courses/cpsc310/sections?limit=10&offset=0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 1,
			limit: 10,
			offset: 0,
			items: [
				{
					id: "2024w201",
					instructor: "bradley, nicholas",
					year: 2024,
					avg: 80.4,
					pass: 124,
					fail: 0,
					audit: 0,
					links: {
						self: "/api/v1/courses/cpsc310/sections/2024w201",
						course: "/api/v1/courses/cpsc310",
					},
				},
			],
		});
	});

	it("Test 11i: GET /api/v1/courses/{course}/sections?limit=10&offset=0 should respond with status OK, total 2, limit 10, offset 0, and an item array of two items", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w202").send({
			instructor: "kerr, katharine",
			year: 2024,
			avg: 82.5,
			pass: 137,
			fail: 0,
			audit: 0,
		});
		const res = await request(app).get("/api/v1/courses/cpsc310/sections?limit=10&offset=0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 2,
			limit: 10,
			offset: 0,
			items: [
				{
					id: "2024w201",
					instructor: "bradley, nicholas",
					year: 2024,
					avg: 80.4,
					pass: 124,
					fail: 0,
					audit: 0,
					links: {
						self: "/api/v1/courses/cpsc310/sections/2024w201",
						course: "/api/v1/courses/cpsc310",
					},
				},
				{
					id: "2024w202",
					instructor: "kerr, katharine",
					year: 2024,
					avg: 82.5,
					pass: 137,
					fail: 0,
					audit: 0,
					links: {
						self: "/api/v1/courses/cpsc310/sections/2024w202",
						course: "/api/v1/courses/cpsc310",
					},
				},
			],
		});
	});

	it("Test 11i_1: GET /api/v1/courses/{course}/sections?limit=10&offset=1 should respond with status OK, total 2, limit 10, offset 1, and an item array of one item", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w202").send({
			instructor: "kerr, katharine",
			year: 2024,
			avg: 82.5,
			pass: 137,
			fail: 0,
			audit: 0,
		});
		const res = await request(app).get("/api/v1/courses/cpsc310/sections?limit=10&offset=1");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 2,
			limit: 10,
			offset: 1,
			items: [
				{
					id: "2024w202",
					instructor: "kerr, katharine",
					year: 2024,
					avg: 82.5,
					pass: 137,
					fail: 0,
					audit: 0,
					links: {
						self: "/api/v1/courses/cpsc310/sections/2024w202",
						course: "/api/v1/courses/cpsc310",
					},
				},
			],
		});
	});

	it("Test 11i_2: GET /api/v1/courses/{course}/sections?limit=1&offset=0 should respond with status OK, total 2, limit 1, offset 0, and an item array of one item", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w202").send({
			instructor: "kerr, katharine",
			year: 2024,
			avg: 82.5,
			pass: 137,
			fail: 0,
			audit: 0,
		});
		const res = await request(app).get("/api/v1/courses/cpsc310/sections?limit=1&offset=0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 2,
			limit: 1,
			offset: 0,
			items: [
				{
					id: "2024w201",
					instructor: "bradley, nicholas",
					year: 2024,
					avg: 80.4,
					pass: 124,
					fail: 0,
					audit: 0,
					links: {
						self: "/api/v1/courses/cpsc310/sections/2024w201",
						course: "/api/v1/courses/cpsc310",
					},
				},
			],
		});
	});

	it("Test 11i_3: GET /api/v1/courses/{course}/sections?limit=1&offset=1 should respond with status OK, total 3, limit 1, offset 1, and an item array with 1 item", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w202").send({
			instructor: "kerr, katharine",
			year: 2024,
			avg: 82.5,
			pass: 137,
			fail: 0,
			audit: 0,
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w202").send({
			instructor: "doe, john",
			year: 2010,
			avg: 79.2,
			pass: 12,
			fail: 1,
			audit: 4,
		});
		const res = await request(app).get("/api/v1/courses/cpsc310/sections?limit=1&offset=1");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 2,
			limit: 1,
			offset: 1,
			items: [
				{
					id: "2024w202",
					instructor: "doe, john",
					year: 2010,
					avg: 79.2,
					pass: 12,
					fail: 1,
					audit: 4,
					links: {
						self: "/api/v1/courses/cpsc310/sections/2024w202",
						course: "/api/v1/courses/cpsc310",
					},
				},
			],
		});
	});

	it("Test 11j: GET /api/v1/courses/{course}/sections?limit=a&offset=b should respond with status BAD_REQUEST, and errors with both limit and offset params", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		const res = await request(app).get("/api/v1/courses/cpsc310/sections?limit=a&offset=b");
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid request parameters",
			params: {
				limit: "expected an integer between 1 and 5000",
				offset: "expected an integer >= 0",
			},
		});
	});

	it("Test 11j_1: GET /api/v1/courses/{course}/sections?limit=5001&offset=-1 should respond with status BAD_REQUEST, and errors with both limit and offset params", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		const res = await request(app).get("/api/v1/courses/cpsc310/sections?limit=5001&offset=-1");
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid request parameters",
			params: {
				limit: "expected an integer between 1 and 5000",
				offset: "expected an integer >= 0",
			},
		});
	});

	it("Test 11j_2: GET /api/v1/courses/{course}/sections?limit=0&offset=0 should respond with status BAD_REQUEST, and errors with limit param", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		const res = await request(app).get("/api/v1/courses/cpsc310/sections?limit=0&offset=0");
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid request parameters",
			params: {
				limit: "expected an integer between 1 and 5000",
			},
		});
	});

	it("Test 11j_3: GET /api/v1/courses/{course}/sections?limit=5000&offset=1.5 should respond with status BAD_REQUEST, and errors with offset param", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		const res = await request(app).get("/api/v1/courses/cpsc310/sections?limit=5000&offset=1.5");
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid request parameters",
			params: {
				offset: "expected an integer >= 0",
			},
		});
	});

	it("Test 11j_4: GET /api/v1/courses/{course}/sections?limit=1.5&offset=0 should respond with status BAD_REQUEST, and errors with limit param", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		const res = await request(app).get("/api/v1/courses/cpsc310/sections?limit=1.5&offset=0");
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid request parameters",
			params: {
				limit: "expected an integer between 1 and 5000",
			},
		});
	});

	it("Test 11k: GET /api/v1/courses/{course}/sections should respond with status OK, total 0, limit 100, offset 0, and an empty list of items", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).get("/api/v1/courses/cpsc310/sections");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 0,
			limit: 100,
			offset: 0,
			items: [],
		});
	});

	it("Test 11k_1: GET /api/v1/courses/{course}/sections?limit=5000 should respond with status OK, total 0, limit 5000, offset 0, and an empty list of items", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).get("/api/v1/courses/cpsc310/sections?limit=5000");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 0,
			limit: 5000,
			offset: 0,
			items: [],
		});
	});

	it("Test 11k_2: GET /api/v1/courses/{course}/sections?offset=10 should respond with status OK, total 0, limit 100, offset 10, and an empty list of items", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).get("/api/v1/courses/cpsc310/sections?offset=10");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 0,
			limit: 100,
			offset: 10,
			items: [],
		});
	});

	//----------------------------------------------------------------------------------------------------//
	//                                                                                                    //
	//                                              SECTION                                               //
	//                                                                                                    //
	//----------------------------------------------------------------------------------------------------//

	//-----------------------------------------------GET--------------------------------------------------//

	it("Test 12b: GET /api/v1/courses/{courses}/sections/{section} should respond with status NOT_FOUND, error 'Not found', and message 'no course with id '{course}''", async () => {
		const res = await request(app).get("/api/v1/courses/cpsc310/sections/2024w201");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no course with id 'cpsc310'",
		});
	});

	it("Test 12c: GET /api/v1/courses/{courses}/sections/{section} should respond with status NOT_FOUND, error 'Not found', and message 'no section with id '{section}''", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).get("/api/v1/courses/cpsc310/sections/2024w201");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no section with id '2024w201'",
		});
	});

	it("Test 12d: GET /api/v1/courses/{courses}/sections/{section} should respond with status OK and body section data", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		const res = await request(app).get("/api/v1/courses/cpsc310/sections/2024w201");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "2024w201",
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
			links: {
				self: "/api/v1/courses/cpsc310/sections/2024w201",
				course: "/api/v1/courses/cpsc310",
			},
		});
	});

	it("Test 12e: GET /api/v1/courses/{courses}/sections/{section} should respond with status NOT_FOUND, error 'Not found', and message 'no section with id '{section}''", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		const res = await request(app).get("/api/v1/courses/cpsc310/sections/2024w202");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no section with id '2024w202'",
		});
	});

	it("Test 12f: GET /api/v1/courses/{courses}/sections/{section} should respond with status NOT_FOUND, error 'Not found', and message 'no section with id '{section}''", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		await request(app).delete("/api/v1/courses/cpsc310/sections/2024w201");
		const res = await request(app).get("/api/v1/courses/cpsc310/sections/2024w201");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no section with id '2024w201'",
		});
	});

	it("Test 12g: GET /api/v1/courses/{courses}/sections/{section} should respond with status NOT_FOUND, error 'Not found', and message 'no section with id '{section}''", async () => {
		await request(app).put("/api/v1/courses/cpsc210").send({
			title: "Software Construction",
			dept: "Computer Science",
			code: "210",
		});
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		const res = await request(app).get("/api/v1/courses/cpsc210/sections/2024w201");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no section with id '2024w201'",
		});
	});

	it("Test 12h: GET /api/v1/courses/{courses}/sections/{section} should respond with status OK and body section data", async () => {
		await request(app).put("/api/v1/courses/cpsc210").send({
			title: "Software Construction",
			dept: "Computer Science",
			code: "210",
		});
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc210/sections/2024w201").send({
			instructor: "osveisi-fordoei, mehrdad",
			year: 2024,
			avg: 79.5,
			pass: 150,
			fail: 11,
			audit: 0,
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w202").send({
			instructor: "kerr, katharine",
			year: 2024,
			avg: 82.5,
			pass: 137,
			fail: 0,
			audit: 0,
		});
		const res = await request(app).get("/api/v1/courses/cpsc310/sections/2024w201");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "2024w201",
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
			links: {
				self: "/api/v1/courses/cpsc310/sections/2024w201",
				course: "/api/v1/courses/cpsc310",
			},
		});
	});

	//-----------------------------------------------PUT--------------------------------------------------//

	it("Test 9b: PUT /api/v1/courses/{course}/sections/{section} should respond with status NOT_FOUND, error 'Not found', and message 'no course with id '{course}''", async () => {
		const res = await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no course with id 'cpsc310'",
		});
	});

	it("Test 9c: PUT /api/v1/courses/{course}/sections/{section} should respond with status CREATED and body section data", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		expect(res).to.have.property("status", CREATED);
		expect(res).to.have.deep.property("body", {
			id: "2024w201",
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
			links: {
				self: "/api/v1/courses/cpsc310/sections/2024w201",
				course: "/api/v1/courses/cpsc310",
			},
		});
	});

	it("Test 9d: PUT /api/v1/courses/{course}/sections/{section} should respond with status NO_CONTENT", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "",
			year: 2024,
			avg: 80,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		const res = await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		expect(res).to.have.property("status", NO_CONTENT);
	});

	it("Test 9e: PUT /api/v1/courses/{course}/sections/{section} should respond with status UNPROCESSABLE_ENTITY, error 'Validation failed', and various appropriate fields", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: 201,
			year: "2024",
			avg: 80.4,
			pass: -124,
		});
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				instructor: "expected a string",
				year: "expected a number between 1900 and 2099",
				pass: "expected a number >= 0",
				fail: "required but missing",
				audit: "required but missing",
			},
		});
	});

	it("Test 9f: PUT /api/v1/courses/{course}/sections/{section} should respond with status UNPROCESSABLE_ENTITY, error 'Validation failed', and various appropriate fields", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		const res = await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: 201,
			year: "2024",
			avg: 80.4,
			pass: -124,
		});
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				instructor: "expected a string",
				year: "expected a number between 1900 and 2099",
				pass: "expected a number >= 0",
				fail: "required but missing",
				audit: "required but missing",
			},
		});
	});

	it("Test 9g: PUT /api/v1/courses/{course}/sections/{section} should respond with status UNPROCESSABLE_ENTITY, error 'Validation failed', and various 'required but missing' fields", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({});
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				instructor: "required but missing",
				year: "required but missing",
				avg: "required but missing",
				pass: "required but missing",
				fail: "required but missing",
				audit: "required but missing",
			},
		});
	});

	it("Test 9h: PUT /api/v1/courses/{course}/sections/{section} should respond with status UNPROCESSABLE_ENTITY, error 'Validation failed', and various 'expected...' fields", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app)
			.put("/api/v1/courses/cpsc310/sections/2024w201")
			.send({
				instructor: 201,
				year: "2024",
				avg: "80.4",
				pass: "124",
				fail: [0, 1, 2],
				audit: false,
			});
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				instructor: "expected a string",
				year: "expected a number between 1900 and 2099",
				avg: "expected a number between 0 and 100",
				pass: "expected a number >= 0",
				fail: "expected a number >= 0",
				audit: "expected a number >= 0",
			},
		});
	});

	it("Test 9i: PUT /api/v1/courses/{course}/sections/{section} should respond with status UNPROCESSABLE_ENTITY, error 'Validation failed', and various 'expected...' fields", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: 201,
			year: 1899,
			avg: -1,
			pass: -1,
			fail: -1,
			audit: -1,
		});
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				instructor: "expected a string",
				year: "expected a number between 1900 and 2099",
				avg: "expected a number between 0 and 100",
				pass: "expected a number >= 0",
				fail: "expected a number >= 0",
				audit: "expected a number >= 0",
			},
		});
	});

	it("Test 9j: PUT /api/v1/courses/{course}/sections/{section} should respond with status UNPROCESSABLE_ENTITY, error 'Validation failed', and various 'expected...' fields", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: 201,
			year: 2100,
			avg: 101,
			pass: -1,
			fail: -1,
			audit: -1,
		});
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				instructor: "expected a string",
				year: "expected a number between 1900 and 2099",
				avg: "expected a number between 0 and 100",
				pass: "expected a number >= 0",
				fail: "expected a number >= 0",
				audit: "expected a number >= 0",
			},
		});
	});

	it("Test 9k: PUT /api/v1/courses/{course}/sections/{section} should respond with status CREATED and body section data", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "minimus, numerus",
			year: 1900,
			avg: 0,
			pass: 0,
			fail: 0,
			audit: 0,
		});
		expect(res).to.have.property("status", CREATED);
		expect(res).to.have.deep.property("body", {
			id: "2024w201",
			instructor: "minimus, numerus",
			year: 1900,
			avg: 0,
			pass: 0,
			fail: 0,
			audit: 0,
			links: {
				self: "/api/v1/courses/cpsc310/sections/2024w201",
				course: "/api/v1/courses/cpsc310",
			},
		});
	});

	it("Test 9l: PUT /api/v1/courses/{course}/sections/{section} should respond with status CREATED and body section data", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "maximus, numerus",
			year: 2099,
			avg: 100,
			pass: 1,
			fail: 1,
			audit: 1,
		});
		expect(res).to.have.property("status", CREATED);
		expect(res).to.have.deep.property("body", {
			id: "2024w201",
			instructor: "maximus, numerus",
			year: 2099,
			avg: 100,
			pass: 1,
			fail: 1,
			audit: 1,
			links: {
				self: "/api/v1/courses/cpsc310/sections/2024w201",
				course: "/api/v1/courses/cpsc310",
			},
		});
	});

	it("Test 9m: PUT /api/v1/courses/{course}/sections/{section} should respond with status OK and body section data", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "",
			year: 2024,
			avg: 80,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		await request(app).delete("/api/v1/courses/cpsc310/sections/2024w201");
		const res = await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		expect(res).to.have.property("status", CREATED);
		expect(res).to.have.deep.property("body", {
			id: "2024w201",
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
			links: {
				self: "/api/v1/courses/cpsc310/sections/2024w201",
				course: "/api/v1/courses/cpsc310",
			},
		});
	});

	//----------------------------------------------DELETE------------------------------------------------//

	it("Test 10b: DELETE /api/v1/courses/{courses}/sections/{section} should respond with status NOT_FOUND, error 'Not found', and message 'no course with id '{course}''", async () => {
		const res = await request(app).delete("/api/v1/courses/cpsc310/sections/2024w201");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no course with id 'cpsc310'",
		});
	});

	it("Test 10c: DELETE /api/v1/courses/{courses}/sections/{section} should respond with status NOT_FOUND, error 'Not found', and message 'no section with id '{section}''", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		const res = await request(app).delete("/api/v1/courses/cpsc310/sections/2024w201");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no section with id '2024w201'",
		});
	});

	it("Test 10d: DELETE /api/v1/courses/{courses}/sections/{section} should respond with status OK and body section data", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		const res = await request(app).delete("/api/v1/courses/cpsc310/sections/2024w201");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "2024w201",
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
	});

	it("Test 10e: DELETE /api/v1/courses/{courses}/sections/{section} should respond with status NOT_FOUND, error 'Not found', and message 'no section with id '{section}''", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		const res = await request(app).delete("/api/v1/courses/cpsc310/sections/2024w202");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no section with id '2024w202'",
		});
	});

	it("Test 10f: DELETE /api/v1/courses/{courses}/sections/{section} should respond with status NOT_FOUND, error 'Not found', and message 'no section with id '{section}''", async () => {
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		await request(app).delete("/api/v1/courses/cpsc310/sections/2024w201");
		const res = await request(app).delete("/api/v1/courses/cpsc310/sections/2024w201");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no section with id '2024w201'",
		});
	});

	it("Test 10g: DELETE /api/v1/courses/{courses}/sections/{section} should respond with status NOT_FOUND, error 'Not found', and message 'no section with id '{section}''", async () => {
		await request(app).put("/api/v1/courses/cpsc210").send({
			title: "Software Construction",
			dept: "Computer Science",
			code: "210",
		});
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		const res = await request(app).delete("/api/v1/courses/cpsc210/sections/2024w201");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no section with id '2024w201'",
		});
	});

	it("Test 10h: DELETE /api/v1/courses/{courses}/sections/{section} should respond with status OK and body section data", async () => {
		await request(app).put("/api/v1/courses/cpsc210").send({
			title: "Software Construction",
			dept: "Computer Science",
			code: "210",
		});
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "Computer Science",
			code: "310",
		});
		await request(app).put("/api/v1/courses/cpsc210/sections/2024w201").send({
			instructor: "osveisi-fordoei, mehrdad",
			year: 2024,
			avg: 79.5,
			pass: 150,
			fail: 11,
			audit: 0,
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w201").send({
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
		await request(app).put("/api/v1/courses/cpsc310/sections/2024w202").send({
			instructor: "kerr, katharine",
			year: 2024,
			avg: 82.5,
			pass: 137,
			fail: 0,
			audit: 0,
		});
		const res = await request(app).delete("/api/v1/courses/cpsc310/sections/2024w201");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "2024w201",
			instructor: "bradley, nicholas",
			year: 2024,
			avg: 80.4,
			pass: 124,
			fail: 0,
			audit: 0,
		});
	});

	//----------------------------------------------------------------------------------------------------//
	//                                                                                                    //
	//                                        BUILDINGS (PLURAL)                                          //
	//                                                                                                    //
	//----------------------------------------------------------------------------------------------------//

	it("Test 17a: GET /api/v2/buildings?limit=5000&offset=0 should respond with status OK, 0 total count, limit 5000, offset 0, and an empty items array", async () => {
		const res = await request(app).get("/api/v2/buildings?limit=5000&offset=0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 0,
			limit: 5000,
			offset: 0,
			items: [],
		});
	});

	it("Test 17b: GET /api/v2/buildings?limit=500&offset=0 should respond with status OK, 1 total count, limit 500, offset 0, and an items array with one course", async () => {
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		const res = await request(app).get("/api/v2/buildings?limit=500&offset=0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 1,
			limit: 500,
			offset: 0,
			items: [
				{
					id: "ICCS",
					name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
					address: "2366 Main Mall V6T 1Z4",
					lat: 49.26128,
					lon: -123.24893,
					links: {
						self: "/api/v2/buildings/ICCS",
						rooms: "/api/v2/buildings/ICCS/rooms",
					},
				},
			],
		});
	});

	it("Test 17b_1: GET /api/v2/buildings?limit=500&offset=1 should respond with status OK, 1 total count, limit 500, offset 1, and an empty items array", async () => {
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		const res = await request(app).get("/api/v2/buildings?limit=500&offset=1");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 1,
			limit: 500,
			offset: 1,
			items: [],
		});
	});

	it("Test 17b_2: GET /api/v2/buildings?limit=500&offset=2 should respond with status OK, 1 total count, limit 500, offset 2, and an empty items array", async () => {
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		const res = await request(app).get("/api/v2/buildings?limit=500&offset=2");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 1,
			limit: 500,
			offset: 2,
			items: [],
		});
	});

	it("Test 17c: GET /api/v2/buildings?limit=10&offset=0 should respond with status OK, 0 total count, limit 10, offset 0, and an empty items array", async () => {
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		await request(app).delete("/api/v2/buildings/ICCS");
		const res = await request(app).get("/api/v2/buildings?limit=10&offset=0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 0,
			limit: 10,
			offset: 0,
			items: [],
		});
	});

	it("Test 17d: GET /api/v2/buildings?limit=10&offset=0 should respond with status OK, 1 total count, limit 10, offset 0, and an items array with 1 course", async () => {
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "CS Building",
			address: "2366 Main Mall",
			lat: 49,
			lon: -123,
		});
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		const res = await request(app).get("/api/v2/buildings?limit=10&offset=0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 1,
			limit: 10,
			offset: 0,
			items: [
				{
					id: "ICCS",
					name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
					address: "2366 Main Mall V6T 1Z4",
					lat: 49.26128,
					lon: -123.24893,
					links: {
						self: "/api/v2/buildings/ICCS",
						rooms: "/api/v2/buildings/ICCS/rooms",
					},
				},
			],
		});
	});

	it("Test 17e: GET /api/v2/buildings?limit=10&offset=0 should respond with status OK, 3 total count, limit 10, offset 0, and an items array with 3 courses", async () => {
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/MCLD").send({
			name: "Hector J. MacLeod Building",
			address: "2356 Main Mall V6T 1Z4",
			lat: 49.26161,
			lon: -123.24941,
		});
		const res = await request(app).get("/api/v2/buildings?limit=10&offset=0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 3,
			limit: 10,
			offset: 0,
			items: [
				{
					id: "ICCS",
					name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
					address: "2366 Main Mall V6T 1Z4",
					lat: 49.26128,
					lon: -123.24893,
					links: {
						self: "/api/v2/buildings/ICCS",
						rooms: "/api/v2/buildings/ICCS/rooms",
					},
				},
				{
					id: "DMP",
					name: "hugh Dempster Pavilion",
					address: "6245 Agronomy Road V6T 1Z4",
					lat: 49.26117,
					lon: -123.24814,
					links: {
						self: "/api/v2/buildings/DMP",
						rooms: "/api/v2/buildings/DMP/rooms",
					},
				},
				{
					id: "MCLD",
					name: "Hector J. MacLeod Building",
					address: "2356 Main Mall V6T 1Z4",
					lat: 49.26161,
					lon: -123.24941,
					links: {
						self: "/api/v2/buildings/MCLD",
						rooms: "/api/v2/buildings/MCLD/rooms",
					},
				},
			],
		});
	});

	it("Test 17e_1: GET /api/v2/buildings?limit=2offset=0 should respond with status OK, 3 total count, limit 2, offset 0, and an items array with 2 courses", async () => {
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/MCLD").send({
			name: "Hector J. MacLeod Building",
			address: "2356 Main Mall V6T 1Z4",
			lat: 49.26161,
			lon: -123.24941,
		});
		const res = await request(app).get("/api/v2/buildings?limit=2&offset=0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 3,
			limit: 2,
			offset: 0,
			items: [
				{
					id: "ICCS",
					name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
					address: "2366 Main Mall V6T 1Z4",
					lat: 49.26128,
					lon: -123.24893,
					links: {
						self: "/api/v2/buildings/ICCS",
						rooms: "/api/v2/buildings/ICCS/rooms",
					},
				},
				{
					id: "DMP",
					name: "hugh Dempster Pavilion",
					address: "6245 Agronomy Road V6T 1Z4",
					lat: 49.26117,
					lon: -123.24814,
					links: {
						self: "/api/v2/buildings/DMP",
						rooms: "/api/v2/buildings/DMP/rooms",
					},
				},
			],
		});
	});

	it("Test 17e_2: GET /api/v2/buildings?limit=10&offset=1 should respond with status OK, 3 total count, limit 10, offset 1, and an items array with 2 courses", async () => {
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/MCLD").send({
			name: "Hector J. MacLeod Building",
			address: "2356 Main Mall V6T 1Z4",
			lat: 49.26161,
			lon: -123.24941,
		});
		const res = await request(app).get("/api/v2/buildings?limit=10&offset=1");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 3,
			limit: 10,
			offset: 1,
			items: [
				{
					id: "DMP",
					name: "hugh Dempster Pavilion",
					address: "6245 Agronomy Road V6T 1Z4",
					lat: 49.26117,
					lon: -123.24814,
					links: {
						self: "/api/v2/buildings/DMP",
						rooms: "/api/v2/buildings/DMP/rooms",
					},
				},
				{
					id: "MCLD",
					name: "Hector J. MacLeod Building",
					address: "2356 Main Mall V6T 1Z4",
					lat: 49.26161,
					lon: -123.24941,
					links: {
						self: "/api/v2/buildings/MCLD",
						rooms: "/api/v2/buildings/MCLD/rooms",
					},
				},
			],
		});
	});

	it("Test 17e_3: GET /api/v2/buildings?limit=1offset=1 should respond with status OK, 3 total count, limit 1, offset 1, and an items array with 1 course", async () => {
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/MCLD").send({
			name: "Hector J. MacLeod Building",
			address: "2356 Main Mall V6T 1Z4",
			lat: 49.26161,
			lon: -123.24941,
		});
		const res = await request(app).get("/api/v2/buildings?limit=1&offset=1");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 3,
			limit: 1,
			offset: 1,
			items: [
				{
					id: "DMP",
					name: "hugh Dempster Pavilion",
					address: "6245 Agronomy Road V6T 1Z4",
					lat: 49.26117,
					lon: -123.24814,
					links: {
						self: "/api/v2/buildings/DMP",
						rooms: "/api/v2/buildings/DMP/rooms",
					},
				},
			],
		});
	});

	it("Test 17f: GET /api/v2/buildings?limit=10&offset=0 should respond with status OK, total count 3, limit 10, offset 0, and an items array with 3 items", async () => {
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/MCLD").send({
			name: "Hector J. MacLeod Building",
			address: "2356 Main Mall V6T 1Z4",
			lat: 49.26161,
			lon: -123.24941,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_310").send({
			building: "DMP",
			number: "310",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-310",
			seats: 160,
		});
		await request(app).put("/api/v2/buildings/MCLD/rooms/MCLD_2018").send({
			building: "MCLD",
			number: "2018",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/mcld-2018",
			seats: 124,
		});
		const res = await request(app).get("/api/v2/buildings?limit=10&offset=0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 3,
			limit: 10,
			offset: 0,
			items: [
				{
					id: "ICCS",
					name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
					address: "2366 Main Mall V6T 1Z4",
					lat: 49.26128,
					lon: -123.24893,
					links: {
						self: "/api/v2/buildings/ICCS",
						rooms: "/api/v2/buildings/ICCS/rooms",
					},
				},
				{
					id: "DMP",
					name: "hugh Dempster Pavilion",
					address: "6245 Agronomy Road V6T 1Z4",
					lat: 49.26117,
					lon: -123.24814,
					links: {
						self: "/api/v2/buildings/DMP",
						rooms: "/api/v2/buildings/DMP/rooms",
					},
				},
				{
					id: "MCLD",
					name: "Hector J. MacLeod Building",
					address: "2356 Main Mall V6T 1Z4",
					lat: 49.26161,
					lon: -123.24941,
					links: {
						self: "/api/v2/buildings/MCLD",
						rooms: "/api/v2/buildings/MCLD/rooms",
					},
				},
			],
		});
	});

	it("Test 17g: GET /api/v2/buildings?limit=a&offset=b should respond with status BAD_REQUEST, and errors with both limit and offset params", async () => {
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		const res = await request(app).get("/api/v2/buildings?limit=a&offset=b");
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid request parameters",
			params: {
				limit: "expected an integer between 1 and 5000",
				offset: "expected an integer >= 0",
			},
		});
	});

	it("Test 17g_1: GET /api/v2/buildings?limit=5001&offset=-1 should respond with status BAD_REQUEST, and errors with both limit and offset params", async () => {
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		const res = await request(app).get("/api/v2/buildings?limit=5001&offset=-1");
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid request parameters",
			params: {
				limit: "expected an integer between 1 and 5000",
				offset: "expected an integer >= 0",
			},
		});
	});

	it("Test 17g_2: GET /api/v2/buildings?limit=0&offset=0 should respond with status BAD_REQUEST, and errors with limit param", async () => {
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		const res = await request(app).get("/api/v2/buildings?limit=0&offset=0");
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid request parameters",
			params: {
				limit: "expected an integer between 1 and 5000",
			},
		});
	});

	it("Test 17g_3: GET /api/v2/buildings?limit=5000&offset=1.5 should respond with status BAD_REQUEST, and errors with offset param", async () => {
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		const res = await request(app).get("/api/v2/buildings?limit=5000&offset=1.5");
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid request parameters",
			params: {
				offset: "expected an integer >= 0",
			},
		});
	});

	it("Test 17g_4: GET /api/v2/buildings?limit=1.5&offset=0 should respond with status BAD_REQUEST, and errors with limit param", async () => {
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		const res = await request(app).get("/api/v2/buildings?limit=1.5&offset=0");
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid request parameters",
			params: {
				limit: "expected an integer between 1 and 5000",
			},
		});
	});

	it("Test 17h: GET /api/v2/buildings should respond with status OK, 0 total count, limit 100, offset 0, and an empty items array", async () => {
		const res = await request(app).get("/api/v2/buildings");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 0,
			limit: 100,
			offset: 0,
			items: [],
		});
	});

	it("Test 17h_1: GET /api/v2/buildings?offset=10 should respond with status OK, 0 total count, limit 100, offset 10, and an empty items array", async () => {
		const res = await request(app).get("/api/v2/buildings?offset=10");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 0,
			limit: 100,
			offset: 10,
			items: [],
		});
	});

	it("Test 17h_2: GET /api/v2/buildings?limit=5000 should respond with status OK, 0 total count, limit 5000, offset 0, and an empty items array", async () => {
		const res = await request(app).get("/api/v2/buildings?limit=5000");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 0,
			limit: 5000,
			offset: 0,
			items: [],
		});
	});

	//----------------------------------------------------------------------------------------------------//
	//                                                                                                    //
	//                                             BUILDING                                               //
	//                                                                                                    //
	//----------------------------------------------------------------------------------------------------//
	//-----------------------------------------------GET--------------------------------------------------//

	it("Test 18a: GET /api/v2/buildings/{building} should respond with status NOT_FOUND, error 'Not found', and message 'no building with id '{building}''", async () => {
		const res = await request(app).get("/api/v2/buildings/ICCS");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no building with id 'ICCS'",
		});
	});

	it("Test 18b: GET /api/v2/buildings/{building} should respond with status OK and body building data", async () => {
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		const res = await request(app).get("/api/v2/buildings/ICCS");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "ICCS",
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
			links: {
				self: "/api/v2/buildings/ICCS",
				rooms: "/api/v2/buildings/ICCS/rooms",
			},
		});
	});

	it("Test 18c: GET /api/v2/buildings/{building} should respond with status NOT_FOUND, error 'Not found', and message 'no building with id '{building}''", async () => {
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		const res = await request(app).get("/api/v2/buildings/DMP");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no building with id 'DMP'",
		});
	});

	it("Test 18d: GET /api/v2/buildings/{building} should respond with status NOT_FOUND, error 'Not found', and message 'no building with id '{building}''", async () => {
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		await request(app).delete("/api/v2/buildings/ICCS");
		const res = await request(app).get("/api/v2/buildings/ICCS");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no building with id 'ICCS'",
		});
	});

	it("Test 18e: GET /api/v2/buildings/{building} should respond with status OK and body building data", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		const res = await request(app).get("/api/v2/buildings/ICCS");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "ICCS",
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
			links: {
				self: "/api/v2/buildings/ICCS",
				rooms: "/api/v2/buildings/ICCS/rooms",
			},
		});
	});

	it("Test 18f: GET /api/v2/buildings/{building} should respond with status OK and body building data", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_310").send({
			building: "DMP",
			number: "310",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-310",
			seats: 160,
		});
		const res = await request(app).get("/api/v2/buildings/DMP");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "DMP",
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
			links: {
				self: "/api/v2/buildings/DMP",
				rooms: "/api/v2/buildings/DMP/rooms",
			},
		});
	});

	//-----------------------------------------------PUT--------------------------------------------------//

	it("Test 19a: PUT /api/v2/buildings/{building} should respond with status CREATED and body building data", async () => {
		const res = await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		expect(res).to.have.property("status", CREATED);
		expect(res).to.have.deep.property("body", {
			id: "ICCS",
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
			links: {
				self: "/api/v2/buildings/ICCS",
				rooms: "/api/v2/buildings/ICCS/rooms",
			},
		});
	});

	it("Test 19b: PUT /api/v2/buildings/{building} should respond with status NO_CONTENT", async () => {
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "CS Building",
			address: "2366 Main",
			lat: 49,
			lon: -123,
		});
		const res = await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		expect(res).to.have.property("status", NO_CONTENT);
	});

	it("Test 19c: PUT /api/v2/buildings/{building} should respond with status UNPROCESSABLE_ENTITY, error 'Validation failed', and fields with name, lat 'required but missing' and lon 'expected a number'", async () => {
		const res = await request(app).put("/api/v2/buildings/ICCS").send({
			address: "2366 Main Mall V6T 1Z4",
			lon: "-123.24893",
		});
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				name: "required but missing",
				lat: "required but missing",
				lon: "expected a number",
			},
		});
	});

	it("Test 19c_1: PUT /api/v2/buildings/{building} should respond with status UNPROCESSABLE_ENTITY, error 'Validation failed', and fields with lon 'required but missing', address 'expected a string', and lat 'expected a number'", async () => {
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "CS Building",
			address: "2366 Main",
			lat: 49,
			lon: -123,
		});
		const res = await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: 2366,
			lat: "49.26128",
		});
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				address: "expected a string",
				lat: "expected a number",
				lon: "required but missing",
			},
		});
	});

	it("Test 19c_2: PUT /api/v2/buildings/{building} should respond with status UNPROCESSABLE_ENTITY, error 'Validation failed', and all fields 'required but missing'", async () => {
		const res = await request(app).put("/api/v2/buildings/ICCS").send({});
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				name: "required but missing",
				address: "required but missing",
				lat: "required but missing",
				lon: "required but missing",
			},
		});
	});

	it("Test 19c_3: PUT /api/v2/buildings/{building} should respond with status UNPROCESSABLE_ENTITY, error 'Validation failed', and fields name, address 'expected a string' and lat, lon 'expected a number", async () => {
		const res = await request(app)
			.put("/api/v2/buildings/ICCS")
			.send({
				name: false,
				address: 0,
				lat: [49.26128, -123.24893],
				lon: [49.26128, -123.24893],
			});
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				name: "expected a string",
				address: "expected a string",
				lat: "expected a number",
				lon: "expected a number",
			},
		});
	});

	it("Test 19d: PUT /api/v2/buildings/{building} should respond with status CREATED and body building data", async () => {
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "CS Building",
			address: "2366 Main",
			lat: 49,
			lon: -123,
		});
		await request(app).delete("/api/v2/buildings/ICCS");
		const res = await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		expect(res).to.have.property("status", CREATED);
		expect(res).to.have.deep.property("body", {
			id: "ICCS",
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
			links: {
				self: "/api/v2/buildings/ICCS",
				rooms: "/api/v2/buildings/ICCS/rooms",
			},
		});
	});

	//----------------------------------------------DELETE------------------------------------------------//

	it("Test 20a: DELETE /api/v2/buildings/{building} should respond with status NOT_FOUND, error 'Not found', and message 'no building with id '{building}''", async () => {
		const res = await request(app).delete("/api/v2/buildings/ICCS");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no building with id 'ICCS'",
		});
	});

	it("Test 20b: DELETE /api/v2/buildings/{building} should respond with status OK and body building data", async () => {
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		const res = await request(app).delete("/api/v2/buildings/ICCS");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "ICCS",
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
			rooms: 0,
		});
	});

	it("Test 20c: DELETE /api/v2/buildings/{building} should respond with status NOT_FOUND, error 'Not found', and message 'no building with id '{building}''", async () => {
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		const res = await request(app).delete("/api/v2/buildings/DMP");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no building with id 'DMP'",
		});
	});

	it("Test 20d: DELETE /api/v2/buildings/{building} should respond with status NOT_FOUND, error 'Not found', and message 'no building with id '{building}''", async () => {
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		await request(app).delete("/api/v2/buildings/ICCS");
		const res = await request(app).delete("/api/v2/buildings/ICCS");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no building with id 'ICCS'",
		});
	});

	it("Test 20e: DELETE /api/v2/buildings/{building} should respond with status OK and body building data", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		const res = await request(app).delete("/api/v2/buildings/ICCS");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "ICCS",
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
			rooms: 0,
		});
	});

	it("Test 20f: DELETE /api/v2/buildings/{building} should respond with status OK and body building data", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_310").send({
			building: "DMP",
			number: "310",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-310",
			seats: 160,
		});
		const res = await request(app).delete("/api/v2/buildings/DMP");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "DMP",
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
			rooms: 2,
		});
	});

	//----------------------------------------------------------------------------------------------------//
	//                                                                                                    //
	//                                          ROOMS (PLURAL)                                            //
	//                                                                                                    //
	//----------------------------------------------------------------------------------------------------//

	it("Test 21a: GET /api/v2/buildings/{building}/rooms?limit=500&offset=0 should respond with status NOT_FOUND and error 'Not found' and message 'no building with id '{building}'", async () => {
		const res = await request(app).get("/api/v2/buildings/ICCS/rooms?limit=500offset=0");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no building with id 'ICCS'",
		});
	});

	it("Test 21b: GET /api/v2/buildings/{building}/rooms should respond with status OK, total 0, limit 10, offset 0, and an empty list of items", async () => {
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		const res = await request(app).get("/api/v2/buildings/ICCS/rooms?limit=10&offset=0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 0,
			limit: 10,
			offset: 0,
			items: [],
		});
	});

	it("Test 21c: GET /api/v2/buildings/{building}/rooms?limit=500&offset=0 should respond with status NOT_FOUND and error 'Not found' and message 'no building with id '{building}'", async () => {
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		const res = await request(app).get("/api/v2/buildings/DMP/rooms?limit=500&offset=0");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no building with id 'DMP'",
		});
	});

	it("Test 21d: GET /api/v2/buildings/{building}/rooms?limit=10&offset=0 should respond with status OK, total 1, limit 10, offset 0, and an items array with one item", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		const res = await request(app).get("/api/v2/buildings/DMP/rooms?limit=10&offset=0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 1,
			limit: 10,
			offset: 0,
			items: [
				{
					id: "DMP_110",
					building: "DMP",
					number: "110",
					type: "Open Design General Purpose",
					furniture: "Fixed Tables",
					href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
					seats: 120,
					links: {
						self: "/api/v2/buildings/DMP/rooms/DMP_110",
						building: "/api/v2/buildings/DMP",
					},
				},
			],
		});
	});

	it("Test 21d_1: GET /api/v2/buildings/{building}/rooms?limit=10&offset=0 should respond with status OK, total 0, limit 10, offset 1, and an empty list of items", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		const res = await request(app).get("/api/v2/buildings/DMP/rooms?limit=10&offset=1");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 1,
			limit: 10,
			offset: 1,
			items: [],
		});
	});

	it("Test 21d_2: GET /api/v2/buildings/{building}/rooms?limit=10&offset=2 should respond with status OK, total 0, limit 10, offset 2, and an empty list of items", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		const res = await request(app).get("/api/v2/buildings/DMP/rooms?limit=10&offset=2");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 1,
			limit: 10,
			offset: 2,
			items: [],
		});
	});

	it("Test 21e: GET /api/v2/buildings/{building}/rooms?limit=10&offset=0 should respond with status OK, total 0, limit 10, offset 0, and an empty list of items", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		await request(app).delete("/api/v2/buildings/DMP/rooms/DMP_110");
		const res = await request(app).get("/api/v2/buildings/DMP/rooms?limit=10&offset=0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 0,
			limit: 10,
			offset: 0,
			items: [],
		});
	});

	it("Test 21f: GET /api/v2/buildings/{building}/rooms?limit=10&offset=0 should respond with status OK, total 1, limit 10, offset 0, and an items array of one item", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "ODGP",
			furniture: "Fixed",
			href: "https://learningspaces.ubc.ca",
			seats: 12,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		const res = await request(app).get("/api/v2/buildings/DMP/rooms?limit=10&offset=0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 1,
			limit: 10,
			offset: 0,
			items: [
				{
					id: "DMP_110",
					building: "DMP",
					number: "110",
					type: "Open Design General Purpose",
					furniture: "Fixed Tables",
					href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
					seats: 120,
					links: {
						self: "/api/v2/buildings/DMP/rooms/DMP_110",
						building: "/api/v2/buildings/DMP",
					},
				},
			],
		});
	});

	it("Test 21g: GET /api/v2/buildings/{building}/rooms?limit=10&offset=0 should respond with status OK, total 2, limit 10, offset 0, and an item array of two items", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_310").send({
			building: "DMP",
			number: "310",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-310",
			seats: 160,
		});
		const res = await request(app).get("/api/v2/buildings/DMP/rooms?limit=10&offset=0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 2,
			limit: 10,
			offset: 0,
			items: [
				{
					id: "DMP_110",
					building: "DMP",
					number: "110",
					type: "Open Design General Purpose",
					furniture: "Fixed Tables",
					href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
					seats: 120,
					links: {
						self: "/api/v2/buildings/DMP/rooms/DMP_110",
						building: "/api/v2/buildings/DMP",
					},
				},
				{
					id: "DMP_310",
					building: "DMP",
					number: "310",
					type: "Open Design General Purpose",
					furniture: "Fixed Tables",
					href: "https://learningspaces.ubc.ca/classrooms/dmp-310",
					seats: 160,
					links: {
						self: "/api/v2/buildings/DMP/rooms/DMP_310",
						building: "/api/v2/buildings/DMP",
					},
				},
			],
		});
	});

	it("Test 21g_1: GET /api/v2/buildings/{building}/rooms?limit=10&offset=1 should respond with status OK, total 2, limit 10, offset 1, and an item array of one item", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_310").send({
			building: "DMP",
			number: "310",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-310",
			seats: 160,
		});
		const res = await request(app).get("/api/v2/buildings/DMP/rooms?limit=10&offset=1");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 2,
			limit: 10,
			offset: 1,
			items: [
				{
					id: "DMP_310",
					building: "DMP",
					number: "310",
					type: "Open Design General Purpose",
					furniture: "Fixed Tables",
					href: "https://learningspaces.ubc.ca/classrooms/dmp-310",
					seats: 160,
					links: {
						self: "/api/v2/buildings/DMP/rooms/DMP_310",
						building: "/api/v2/buildings/DMP",
					},
				},
			],
		});
	});

	it("Test 21g_2: GET /api/v2/buildings/{building}/rooms?limit=1&offset=0 should respond with status OK, total 2, limit 1, offset 0, and an item array of one item", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_310").send({
			building: "DMP",
			number: "310",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-310",
			seats: 160,
		});
		const res = await request(app).get("/api/v2/buildings/DMP/rooms?limit=1&offset=0");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 2,
			limit: 1,
			offset: 0,
			items: [
				{
					id: "DMP_110",
					building: "DMP",
					number: "110",
					type: "Open Design General Purpose",
					furniture: "Fixed Tables",
					href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
					seats: 120,
					links: {
						self: "/api/v2/buildings/DMP/rooms/DMP_110",
						building: "/api/v2/buildings/DMP",
					},
				},
			],
		});
	});

	it("Test 21g_3: GET /api/v2/buildings/{building}/rooms?limit=1&offset=1 should respond with status OK, total 3, limit 1, offset 1, and an item array with 1 item", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_310").send({
			building: "DMP",
			number: "31",
			type: "General Purpose",
			furniture: "Fixed",
			href: "https://learningspaces.ubc.ca",
			seats: 60,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_310").send({
			building: "DMP",
			number: "310",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-310",
			seats: 160,
		});
		const res = await request(app).get("/api/v2/buildings/DMP/rooms?limit=1&offset=1");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 2,
			limit: 1,
			offset: 1,
			items: [
				{
					id: "DMP_310",
					building: "DMP",
					number: "310",
					type: "Open Design General Purpose",
					furniture: "Fixed Tables",
					href: "https://learningspaces.ubc.ca/classrooms/dmp-310",
					seats: 160,
					links: {
						self: "/api/v2/buildings/DMP/rooms/DMP_310",
						building: "/api/v2/buildings/DMP",
					},
				},
			],
		});
	});

	it("Test 21h: GET /api/v2/buildings/{building}/roomss?limit=a&offset=b should respond with status BAD_REQUEST, and errors with both limit and offset params", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		const res = await request(app).get("/api/v2/buildings/DMP/rooms?limit=a&offset=b");
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid request parameters",
			params: {
				limit: "expected an integer between 1 and 5000",
				offset: "expected an integer >= 0",
			},
		});
	});

	it("Test 21h_1: GET /api/v2/buildings/{building}/rooms?limit=5001&offset=-1 should respond with status BAD_REQUEST, and errors with both limit and offset params", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		const res = await request(app).get("/api/v2/buildings/DMP/rooms?limit=5001&offset=-1");
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid request parameters",
			params: {
				limit: "expected an integer between 1 and 5000",
				offset: "expected an integer >= 0",
			},
		});
	});

	it("Test 21h_2: GET /api/v2/buildings/{building}/rooms?limit=0&offset=0 should respond with status BAD_REQUEST, and errors with limit param", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		const res = await request(app).get("/api/v2/buildings/DMP/rooms?limit=0&offset=0");
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid request parameters",
			params: {
				limit: "expected an integer between 1 and 5000",
			},
		});
	});

	it("Test 21h_3: GET /api/v2/buildings/{building}/rooms?limit=5000&offset=1.5 should respond with status BAD_REQUEST, and errors with offset param", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		const res = await request(app).get("/api/v2/buildings/DMP/rooms?limit=5000&offset=1.5");
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid request parameters",
			params: {
				offset: "expected an integer >= 0",
			},
		});
	});

	it("Test 21h_4: GET /api/v2/buildings/{building}/rooms?limit=1.5&offset=0 should respond with status BAD_REQUEST, and errors with limit param", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		const res = await request(app).get("/api/v2/buildings/DMP/rooms?limit=1.5&offset=0");
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res).to.have.deep.property("body", {
			error: "Invalid request parameters",
			params: {
				limit: "expected an integer between 1 and 5000",
			},
		});
	});

	it("Test 21i: GET /api/v2/buildings/{building}/rooms should respond with status OK, total 0, limit 100, offset 0, and an empty list of items", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		const res = await request(app).get("/api/v2/buildings/DMP/rooms");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 0,
			limit: 100,
			offset: 0,
			items: [],
		});
	});

	it("Test 21h_1: GET /api/v2/buildings/{building}/rooms?limit=5000 should respond with status OK, total 0, limit 5000, offset 0, and an empty list of items", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		const res = await request(app).get("/api/v2/buildings/DMP/rooms?limit=5000");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 0,
			limit: 5000,
			offset: 0,
			items: [],
		});
	});

	it("Test 21h_2: GET /api/v2/buildings/{building}/rooms?offset=10 should respond with status OK, total 0, limit 100, offset 10, and an empty list of items", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		const res = await request(app).get("/api/v2/buildings/DMP/rooms?offset=10");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			total: 0,
			limit: 100,
			offset: 10,
			items: [],
		});
	});

	//----------------------------------------------------------------------------------------------------//
	//                                                                                                    //
	//                                              ROOM                                                  //
	//                                                                                                    //
	//----------------------------------------------------------------------------------------------------//

	//-----------------------------------------------GET--------------------------------------------------//

	it("Test 22a: GET /api/v2/buildings/{building}/rooms/{room} should respond with status NOT_FOUND, error 'Not found', and message 'no building with id '{building}''", async () => {
		const res = await request(app).get("/api/v2/buildings/DMP/rooms/DMP_110");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no building with id 'DMP'",
		});
	});

	it("Test 22b: GET /api/v2/buildings/{building}/rooms/{room} should respond with status NOT_FOUND, error 'Not found', and message 'no room with id '{room}''", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		const res = await request(app).get("/api/v2/buildings/DMP/rooms/DMP_110");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no room with id 'DMP_110'",
		});
	});

	it("Test 22c: GET /api/v2/buildings/{building}/rooms/{room} should respond with status OK and body room data", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		const res = await request(app).get("/api/v2/buildings/DMP/rooms/DMP_110");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "DMP_110",
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
			links: {
				self: "/api/v2/buildings/DMP/rooms/DMP_110",
				building: "/api/v2/buildings/DMP",
			},
		});
	});

	it("Test 22d: GET /api/v2/buildings/{building}/rooms/{room} should respond with status NOT_FOUND, error 'Not found', and message 'no room with id '{room}''", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		const res = await request(app).get("/api/v2/buildings/DMP/rooms/DMP_310");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no room with id 'DMP_310'",
		});
	});

	it("Test 22e: GET /api/v2/buildings/{building}/rooms/{room} should respond with status NOT_FOUND, error 'Not found', and message 'no room with id '{room}''", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		await request(app).delete("/api/v2/buildings/DMP/rooms/DMP_110");
		const res = await request(app).get("/api/v2/buildings/DMP/rooms/DMP_110");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no room with id 'DMP_110'",
		});
	});

	it("Test 22f: GET /api/v2/buildings/{building}/rooms/{room} should respond with status NOT_FOUND, error 'Not found', and message 'no room with id '{room}''", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		const res = await request(app).get("/api/v2/buildings/ICCS/rooms/DMP_110");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no room with id 'DMP_110'",
		});
	});

	it("Test 22g: GET /api/v2/buildings/{building}/rooms/{room} should respond with status OK and body room data", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_310").send({
			building: "DMP",
			number: "310",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-310",
			seats: 160,
		});
		await request(app).put("/api/v2/buildings/MCLD/rooms/MCLD_2018").send({
			building: "MCLD",
			number: "2018",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/mcld-2018",
			seats: 124,
		});
		const res = await request(app).get("/api/v2/buildings/DMP/rooms/DMP_310");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "DMP_310",
			building: "DMP",
			number: "310",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-310",
			seats: 160,
			links: {
				self: "/api/v2/buildings/DMP/rooms/DMP_310",
				building: "/api/v2/buildings/DMP",
			},
		});
	});

	//-----------------------------------------------PUT--------------------------------------------------//

	it("Test 23a: PUT /api/v2/buildings/{building}/rooms/{room} should respond with status NOT_FOUND, error 'Not found', and message 'no building with id '{building}''", async () => {
		const res = await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no building with id 'DMP'",
		});
	});

	it("Test 23b: PUT /api/v2/buildings/{building}/rooms/{room} should respond with status CREATED and body room data", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		const res = await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		expect(res).to.have.property("status", CREATED);
		expect(res).to.have.deep.property("body", {
			id: "DMP_110",
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
			links: {
				self: "/api/v2/buildings/DMP/rooms/DMP_110",
				building: "/api/v2/buildings/DMP",
			},
		});
	});

	it("Test 23c: PUT /api/v2/buildings/{building}/rooms/{room} should respond with status NO_CONTENT", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "10",
			type: "Open Design",
			furniture: "Tables",
			href: "https://learningspaces.ubc.ca/classrooms",
			seats: 20,
		});
		const res = await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		expect(res).to.have.property("status", NO_CONTENT);
	});

	it("Test 23d: PUT /api/v2/buildings/{building}/rooms/{room} should respond with status UNPROCESSABLE_ENTITY, error 'Validation failed', and various appropriate fields", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		const res = await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "Hugh Dempster Pavilion",
			number: 110,
			furniture: true,
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: -1,
		});
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				building: "must match parent building in path",
				number: "expected a string",
				type: "required but missing",
				furniture: "expected a string",
				seats: "expected a number >= 0",
			},
		});
	});

	it("Test 23e: PUT /api/v2/buildings/{building}/rooms/{room} should respond with status UNPROCESSABLE_ENTITY, error 'Validation failed', and various appropriate fields", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		const res = await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: 42,
			type: false,
			furniture: "Fixed Tables",
			href: {},
			seats: 0,
		});
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				building: "expected a string",
				number: "required but missing",
				type: "expected a string",
				href: "expected a string",
			},
		});
	});

	it("Test 23f: PUT /api/v2/buildings/{building}/rooms/{room} should respond with status UNPROCESSABLE_ENTITY, error 'Validation failed', and various 'required but missing' fields", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		const res = await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({});
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				building: "required but missing",
				number: "required but missing",
				type: "required but missing",
				furniture: "required but missing",
				href: "required but missing",
				seats: "required but missing",
			},
		});
	});

	it("Test 23g: PUT /api/v2/buildings/{building}/rooms/{room} should respond with status UNPROCESSABLE_ENTITY, error 'Validation failed', and various 'expected...' fields", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		const res = await request(app)
			.put("/api/v2/buildings/DMP/rooms/DMP_110")
			.send({
				building: 123,
				number: 110,
				type: false,
				furniture: { Tables: "fixed" },
				href: ["https://learningspaces.ubc.ca/classrooms/dmp-110"],
				seats: "120",
			});
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: {
				building: "expected a string",
				number: "expected a string",
				type: "expected a string",
				furniture: "expected a string",
				href: "expected a string",
				seats: "expected a number >= 0",
			},
		});
	});

	it("Test 23h: PUT /api/v2/buildings/{building}/rooms/{room} should respond with status UNPROCESSABLE_ENTITY, error 'Validation failed', and various 'expected...' fields", async () => {
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		const res = await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "ICCS",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res).to.have.deep.property("body", {
			error: "Validation failed",
			fields: { building: "must match parent building in path" },
		});
	});

	it("Test 23i: PUT /api/v2/buildings/{building}/rooms/{room} should respond with status OK and body room data", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "10",
			type: "Open Design",
			furniture: "Tables",
			href: "https://learningspaces.ubc.ca/classrooms",
			seats: 20,
		});
		await request(app).delete("/api/v2/buildings/DMP/rooms/DMP_110");
		const res = await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		expect(res).to.have.property("status", CREATED);
		expect(res).to.have.deep.property("body", {
			id: "DMP_110",
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
			links: {
				self: "/api/v2/buildings/DMP/rooms/DMP_110",
				building: "/api/v2/buildings/DMP",
			},
		});
	});

	//----------------------------------------------DELETE------------------------------------------------//

	it("Test 24a: DELETE /api/v2/buildings/{building}/rooms/{room} should respond with status NOT_FOUND, error 'Not found', and message 'no building with id '{building}''", async () => {
		const res = await request(app).delete("/api/v2/buildings/DMP/rooms/DMP_110");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no building with id 'DMP'",
		});
	});

	it("Test 24b: DELETE /api/v2/buildings/{building}/rooms/{room} should respond with status NOT_FOUND, error 'Not found', and message 'no room with id '{room}''", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		const res = await request(app).delete("/api/v2/buildings/DMP/rooms/DMP_110");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no room with id 'DMP_110'",
		});
	});

	it("Test 24c: DELETE /api/v2/buildings/{building}/rooms/{room} should respond with status OK and body room data", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		const res = await request(app).delete("/api/v2/buildings/DMP/rooms/DMP_110");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "DMP_110",
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
	});

	it("Test 24d: DELETE /api/v2/buildings/{building}/rooms/{room} should respond with status NOT_FOUND, error 'Not found', and message 'no room with id '{room}''", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		const res = await request(app).delete("/api/v2/buildings/DMP/rooms/DMP_310");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no room with id 'DMP_310'",
		});
	});

	it("Test 24e: DELETE /api/v2/buildings/{building}/rooms/{room} should respond with status NOT_FOUND, error 'Not found', and message 'no room with id '{room}''", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		await request(app).delete("/api/v2/buildings/DMP/rooms/DMP_110");
		const res = await request(app).delete("/api/v2/buildings/DMP/rooms/DMP_110");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no room with id 'DMP_110'",
		});
	});

	it("Test 24f: DELETE /api/v2/buildings/{building}/rooms/{room} should respond with status NOT_FOUND, error 'Not found', and message 'no room with id '{room}''", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		const res = await request(app).delete("/api/v2/buildings/ICCS/rooms/DMP_110");
		expect(res).to.have.property("status", NOT_FOUND);
		expect(res).to.have.deep.property("body", {
			error: "Not found",
			message: "no room with id 'DMP_110'",
		});
	});

	it("Test 24g: DELETE /api/v2/buildings/{building}/rooms/{room} should respond with status OK and body room data", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
		});
		await request(app).put("/api/v2/buildings/ICCS").send({
			name: "Institute for Computing Information and Cognitive Systems / Computer Science Building",
			address: "2366 Main Mall V6T 1Z4",
			lat: 49.26128,
			lon: -123.24893,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_310").send({
			building: "DMP",
			number: "310",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-310",
			seats: 160,
		});
		await request(app).put("/api/v2/buildings/MCLD/rooms/MCLD_2018").send({
			building: "MCLD",
			number: "2018",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/mcld-2018",
			seats: 124,
		});
		const res = await request(app).delete("/api/v2/buildings/DMP/rooms/DMP_310");
		expect(res).to.have.property("status", OK);
		expect(res).to.have.deep.property("body", {
			id: "DMP_310",
			building: "DMP",
			number: "310",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-310",
			seats: 160,
		});
	});
});

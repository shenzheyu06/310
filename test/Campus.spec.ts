import fs from "fs/promises";
import path from "path";
import { expect } from "chai";
import request from "supertest";
import { createApp } from "../src/App";
import { createReusableServer } from "./TestServer";

describe("Optional building campus", () => {
	const testServer = createReusableServer();
	const app = testServer.server;
	let datadir: string;

	beforeEach(async () => {
		datadir = await fs.mkdtemp(path.resolve("campus-test-"));
		testServer.setHandler(await createApp({ datadir }));
	});

	afterEach(async () => {
		await fs.rm(datadir, { recursive: true, force: true });
	});

	after(async () => {
		await testServer.close();
	});

	it("saves the campus when creating a building", async () => {
		const created = await request(app).put("/api/v2/buildings/TEST").send({
			name: "Test Building",
			address: "123 Main St",
			lat: 49,
			lon: -123,
			campus: "vancouver campus",
		});
		expect(created.status).to.equal(201);

		const res = await request(app).get("/api/v2/buildings/TEST");
		expect(res.status).to.equal(200);
		expect(res.body.campus).to.equal("vancouver campus");
	});

	it("updates the campus of an existing building", async () => {
		await request(app)
			.put("/api/v2/buildings/TEST")
			.send({
				name: "Test Building",
				address: "123 Main St",
				lat: 49,
				lon: -123,
				campus: "vancouver campus",
			})
			.expect(201);

		const updated = await request(app).put("/api/v2/buildings/TEST").send({
			name: "Test Building",
			address: "123 Main St",
			lat: 49,
			lon: -123,
			campus: "okanagan campus",
		});
		expect(updated.status).to.equal(204);

		const res = await request(app).get("/api/v2/buildings/TEST");
		expect(res.status).to.equal(200);
		expect(res.body.campus).to.equal("okanagan campus");
	});

	it("allows a replacement building without a campus", async () => {
		await request(app)
			.put("/api/v2/buildings/TEST")
			.send({
				name: "Test Building",
				address: "123 Main St",
				lat: 49,
				lon: -123,
				campus: "vancouver campus",
			})
			.expect(201);

		const updated = await request(app).put("/api/v2/buildings/TEST").send({
			name: "Test Building",
			address: "123 Main St",
			lat: 49,
			lon: -123,
		});
		expect(updated.status).to.equal(204);

		const res = await request(app).get("/api/v2/buildings/TEST");
		expect(res.status).to.equal(200);
		expect(res.body.campus).to.equal(undefined);
	});

	it("rejects null as a campus", async () => {
		const res = await request(app).put("/api/v2/buildings/TEST").send({
			name: "Test Building",
			address: "123 Main St",
			lat: 49,
			lon: -123,
			campus: null,
		});
		expect(res.status).to.equal(422);
		expect(res.body.fields.campus).to.equal("expected a string");
	});

	it("rejects a number as a campus", async () => {
		const res = await request(app).put("/api/v2/buildings/TEST").send({
			name: "Test Building",
			address: "123 Main St",
			lat: 49,
			lon: -123,
			campus: 42,
		});
		expect(res.status).to.equal(422);
		expect(res.body.fields.campus).to.equal("expected a string");
	});

	it("rejects a boolean as a campus", async () => {
		const res = await request(app).put("/api/v2/buildings/TEST").send({
			name: "Test Building",
			address: "123 Main St",
			lat: 49,
			lon: -123,
			campus: true,
		});
		expect(res.status).to.equal(422);
		expect(res.body.fields.campus).to.equal("expected a string");
	});

	it("rejects an array as a campus", async () => {
		const res = await request(app).put("/api/v2/buildings/TEST").send({
			name: "Test Building",
			address: "123 Main St",
			lat: 49,
			lon: -123,
			campus: [],
		});
		expect(res.status).to.equal(422);
		expect(res.body.fields.campus).to.equal("expected a string");
	});

	it("rejects an object as a campus", async () => {
		const res = await request(app).put("/api/v2/buildings/TEST").send({
			name: "Test Building",
			address: "123 Main St",
			lat: 49,
			lon: -123,
			campus: {},
		});
		expect(res.status).to.equal(422);
		expect(res.body.fields.campus).to.equal("expected a string");
	});

	it("searches and sorts by campus, including buildings without a campus", async () => {
		await request(app)
			.put("/api/v2/buildings/A")
			.send({ name: "Test Building", address: "123 Main St", lat: 49, lon: -123, campus: "vancouver campus" })
			.expect(201);
		await request(app)
			.put("/api/v2/buildings/A/rooms/101")
			.send({
				building: "A",
				number: "101",
				type: "Classroom",
				furniture: "Tables",
				href: "https://example.com",
				seats: 20,
			})
			.expect(201);
		await request(app)
			.put("/api/v2/buildings/B")
			.send({ name: "Test Building", address: "123 Main St", lat: 49, lon: -123 })
			.expect(201);
		await request(app)
			.put("/api/v2/buildings/B/rooms/101")
			.send({
				building: "B",
				number: "101",
				type: "Classroom",
				furniture: "Tables",
				href: "https://example.com",
				seats: 20,
			})
			.expect(201);
		await request(app)
			.put("/api/v2/buildings/C")
			.send({ name: "Test Building", address: "123 Main St", lat: 49, lon: -123, campus: "okanagan campus" })
			.expect(201);
		await request(app)
			.put("/api/v2/buildings/C/rooms/101")
			.send({
				building: "C",
				number: "101",
				type: "Classroom",
				furniture: "Tables",
				href: "https://example.com",
				seats: 20,
			})
			.expect(201);

		const filtered = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: { IS: { campus: "*couver*" } },
					OPTIONS: { COLUMNS: ["building", "campus"], ORDER: "campus" },
				},
			});
		expect(filtered.status).to.equal(200);
		expect(filtered.body).to.deep.equal([{ building: "A", campus: "vancouver campus" }]);

		const sorted = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {},
					OPTIONS: { COLUMNS: ["building", "campus"], ORDER: "campus" },
				},
			});
		expect(sorted.status).to.equal(200);
		expect(sorted.body).to.deep.equal([
			{ building: "B" },
			{ building: "C", campus: "okanagan campus" },
			{ building: "A", campus: "vancouver campus" },
		]);
	});
});

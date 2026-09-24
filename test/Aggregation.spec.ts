import fs from "fs/promises";
import path from "path";
import { expect } from "chai";
import request from "supertest";
import { createApp } from "../src/App";
import { Course } from "../src/services/course";
import { Section } from "../src/services/section";
import { createReusableServer } from "./TestServer";

describe("Search aggregation", () => {
	const testServer = createReusableServer();
	const app = testServer.server;
	const datadir = "./data";
	let courses: Course[];
	beforeEach(async () => {
		testServer.setHandler(await createApp({ datadir }));
		courses = [];
		{
			const course = new Course("cpsc" + "310", "Course", "cpsc", "310");
			course.sections.push(new Section("0", "A", 2025, 80, 10, 0, 0, course));
			course.sections.push(new Section("1", "A", 2025, 90, 10, 0, 0, course));
			course.sections.push(new Section("2", "B", 2024, 70, 10, 0, 0, course));
			courses.push(course);
		}
		{
			const course = new Course("math" + "200", "Course", "math", "200");
			course.sections.push(new Section("0", "C", 2025, 60, 10, 0, 0, course));
			courses.push(course);
		}
		await Course.writeCourses(courses);
	});

	it("MAX works on avg", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					TRANSFORMATIONS: { GROUP: ["dept"], APPLY: [{ result: { MAX: "avg" } }] },
					OPTIONS: { COLUMNS: ["dept", "result"], ORDER: "dept" },
				},
			});
		expect(res.status).to.equal(200);
		expect(res.body).to.deep.equal([
			{ dept: "cpsc", result: 90 },
			{ dept: "math", result: 60 },
		]);
	});
	it("MIN works on avg", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					TRANSFORMATIONS: { GROUP: ["dept"], APPLY: [{ result: { MIN: "avg" } }] },
					OPTIONS: { COLUMNS: ["dept", "result"], ORDER: "dept" },
				},
			});
		expect(res.status).to.equal(200);
		expect(res.body).to.deep.equal([
			{ dept: "cpsc", result: 70 },
			{ dept: "math", result: 60 },
		]);
	});
	it("AVG works on avg", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					TRANSFORMATIONS: { GROUP: ["dept"], APPLY: [{ result: { AVG: "avg" } }] },
					OPTIONS: { COLUMNS: ["dept", "result"], ORDER: "dept" },
				},
			});
		expect(res.status).to.equal(200);
		expect(res.body).to.deep.equal([
			{ dept: "cpsc", result: 80 },
			{ dept: "math", result: 60 },
		]);
	});
	it("SUM works on avg", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					TRANSFORMATIONS: { GROUP: ["dept"], APPLY: [{ result: { SUM: "avg" } }] },
					OPTIONS: { COLUMNS: ["dept", "result"], ORDER: "dept" },
				},
			});
		expect(res.status).to.equal(200);
		expect(res.body).to.deep.equal([
			{ dept: "cpsc", result: 240 },
			{ dept: "math", result: 60 },
		]);
	});
	it("COUNT works on instructor", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					TRANSFORMATIONS: { GROUP: ["dept"], APPLY: [{ result: { COUNT: "instructor" } }] },
					OPTIONS: { COLUMNS: ["dept", "result"], ORDER: "dept" },
				},
			});
		expect(res.status).to.equal(200);
		expect(res.body).to.deep.equal([
			{ dept: "cpsc", result: 2 },
			{ dept: "math", result: 1 },
		]);
	});
	it("COUNT works on year", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					TRANSFORMATIONS: { GROUP: ["dept"], APPLY: [{ result: { COUNT: "year" } }] },
					OPTIONS: { COLUMNS: ["dept", "result"], ORDER: "dept" },
				},
			});
		expect(res.status).to.equal(200);
		expect(res.body).to.deep.equal([
			{ dept: "cpsc", result: 2 },
			{ dept: "math", result: 1 },
		]);
	});

	afterEach(async () => {
		await fs.rm(datadir, { recursive: true, force: true });
	});
	after(async () => {
		await testServer.close();
	});

	it("filters rows before grouping by department and year", async () => {
		await Course.writeCourses(courses);
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: { GT: { avg: 65 } },
					TRANSFORMATIONS: {
						GROUP: ["dept", "year"],
						APPLY: [{ total: { SUM: "avg" } }, { unused: { COUNT: "instructor" } }],
					},
					OPTIONS: { COLUMNS: ["dept", "total"], ORDER: { dir: "DOWN", keys: ["total", "dept"] } },
				},
			});
		expect(res.status).to.equal(200);
		expect(res.body).to.deep.equal([
			{ dept: "cpsc", total: 170 },
			{ dept: "cpsc", total: 70 },
		]);
	});

	it("supports grouping without APPLY and resolves ordering ties", async () => {
		await Course.writeCourses(courses);
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					TRANSFORMATIONS: { GROUP: ["dept", "year"], APPLY: [] },
					OPTIONS: { COLUMNS: ["dept", "year"], ORDER: { dir: "DOWN", keys: ["dept", "year"] } },
				},
			});
		expect(res.body).to.deep.equal([
			{ dept: "math", year: 2025 },
			{ dept: "cpsc", year: 2025 },
			{ dept: "cpsc", year: 2024 },
		]);
	});

	it("sorts numeric aggregates whose alias matches a string field", async () => {
		await Course.writeCourses(courses);
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					TRANSFORMATIONS: { GROUP: ["code"], APPLY: [{ dept: { SUM: "avg" } }] },
					OPTIONS: { COLUMNS: ["code", "dept"], ORDER: "dept" },
				},
			});
		expect(res.status).to.equal(200);
		expect(res.body).to.deep.equal([
			{ code: "200", dept: 60 },
			{ code: "310", dept: 240 },
		]);
	});

	it("returns no groups when the filter matches nothing", async () => {
		await Course.writeCourses(courses);
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: { GT: { avg: 100 } },
					TRANSFORMATIONS: { GROUP: ["dept"], APPLY: [{ total: { SUM: "avg" } }] },
					OPTIONS: { COLUMNS: ["dept", "total"] },
				},
			});
		expect(res.status).to.equal(200);
		expect(res.body).to.deep.equal([]);
	});

	it("rounds decimal sums and averages only after aggregation", async () => {
		courses = [];
		{
			const course = new Course("a" + "1", "Course", "a", "1");
			course.sections.push(new Section("0", "A", 2025, 1.005, 10, 0, 0, course));
			courses.push(course);
		}
		{
			const course = new Course("b" + "1", "Course", "b", "1");
			course.sections.push(new Section("0", "A", 2025, 0.104, 10, 0, 0, course));
			course.sections.push(new Section("1", "A", 2025, 0.104, 10, 0, 0, course));
			course.sections.push(new Section("2", "A", 2025, 0.104, 10, 0, 0, course));
			courses.push(course);
		}
		await Course.writeCourses(courses);
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					TRANSFORMATIONS: { GROUP: ["dept"], APPLY: [{ total: { SUM: "avg" } }, { mean: { AVG: "avg" } }] },
					OPTIONS: { COLUMNS: ["dept", "total", "mean"], ORDER: "dept" },
				},
			});
		expect(res.body).to.deep.equal([
			{ dept: "a", total: 1.01, mean: 1.01 },
			{ dept: "b", total: 0.31, mean: 0.1 },
		]);
	});

	it("keeps different groups separate when values contain commas", async () => {
		courses = [];
		{
			const course = new Course("a,b" + "c", "Course", "a,b", "c");
			course.sections.push(new Section("0", "A", 2025, 1, 10, 0, 0, course));
			courses.push(course);
		}
		{
			const course = new Course("a" + "b,c", "Course", "a", "b,c");
			course.sections.push(new Section("0", "A", 2025, 2, 10, 0, 0, course));
			courses.push(course);
		}
		await Course.writeCourses(courses);
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					TRANSFORMATIONS: { GROUP: ["dept", "code"], APPLY: [] },
					OPTIONS: { COLUMNS: ["dept", "code"] },
				},
			});
		expect(res.body).to.have.deep.members([
			{ dept: "a,b", code: "c" },
			{ dept: "a", code: "b,c" },
		]);
	});

	it("applies the result limit to groups instead of input rows", async () => {
		courses = [];
		const sections = [];
		for (let i = 0; i < 5001; i++) {
			sections.push({ avg: 1, instructor: String(i) });
		}
		{
			const course = new Course("cpsc" + "310", "Course", "cpsc", "310");
			for (let i = 0; i < sections.length; i++) {
				course.sections.push(new Section(String(i), sections[i].instructor, 2025, sections[i].avg, 10, 0, 0, course));
			}
			courses.push(course);
		}
		await Course.writeCourses(courses);
		expect(
			(
				await request(app)
					.post("/api/v2/search")
					.send({
						kind: "course_offerings",
						query: {
							WHERE: {},
							TRANSFORMATIONS: { GROUP: ["dept"], APPLY: [{ total: { SUM: "avg" } }] },
							OPTIONS: { COLUMNS: ["dept", "total"] },
						},
					})
			).body
		).to.deep.equal([{ dept: "cpsc", total: 5001 }]);
		const tooManyGroups = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					TRANSFORMATIONS: { GROUP: ["instructor"], APPLY: [] },
					OPTIONS: { COLUMNS: ["instructor"] },
				},
			});
		expect(tooManyGroups.status).to.equal(413);
		const withoutAggregation = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: { WHERE: {}, OPTIONS: { COLUMNS: ["instructor"] } },
			});
		expect(withoutAggregation.status).to.equal(413);

		courses[0].sections.pop();
		await Course.writeCourses(courses);
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					TRANSFORMATIONS: { GROUP: ["instructor"], APPLY: [] },
					OPTIONS: { COLUMNS: ["instructor"] },
				},
			});
		expect(res.status).to.equal(200);
		expect(res.body).to.have.length(5000);
	});
});

describe("Facilities aggregation endpoint", () => {
	const server = createReusableServer();
	const datadir = "./data";
	before(async () => {
		server.setHandler(await createApp({ datadir }));
		await fs.writeFile(
			path.join(datadir, "buildings.json"),
			JSON.stringify([
				{
					id: "A",
					name: "A",
					address: "123 Main St",
					lat: 49,
					lon: -123.125,
					campus: "vancouver campus",
					rooms: [
						{
							id: "0",
							building: "A",
							number: "0",
							type: "Classroom",
							furniture: "Tables",
							href: "https://example.com",
							seats: 10,
						},
						{
							id: "1",
							building: "A",
							number: "1",
							type: "Classroom",
							furniture: "Tables",
							href: "https://example.com",
							seats: 20,
						},
						{
							id: "2",
							building: "A",
							number: "2",
							type: "Classroom",
							furniture: "Tables",
							href: "https://example.com",
							seats: 20,
						},
					],
				},
				{
					id: "B",
					name: "B",
					address: "123 Main St",
					lat: 49,
					lon: -120.375,
					campus: "okanagan campus",
					rooms: [
						{
							id: "0",
							building: "B",
							number: "0",
							type: "Classroom",
							furniture: "Tables",
							href: "https://example.com",
							seats: 40,
						},
					],
				},
			])
		);
	});
	after(async () => {
		await server.close();
		await fs.rm(datadir, { recursive: true, force: true });
	});
	it("aggregates room and building fields, including campus, through POST search", async () => {
		const res = await request(server.server)
			.post("/api/v2/search")
			.send({
				kind: "facilities",
				query: {
					WHERE: {},
					TRANSFORMATIONS: {
						GROUP: ["campus"],
						APPLY: [
							{ max: { MAX: "seats" } },
							{ min: { MIN: "lon" } },
							{ mean: { AVG: "seats" } },
							{ total: { SUM: "seats" } },
							{ sizes: { COUNT: "seats" } },
						],
					},
					OPTIONS: {
						COLUMNS: ["campus", "max", "min", "mean", "total", "sizes"],
						ORDER: { dir: "DOWN", keys: ["total"] },
					},
				},
			})
			.expect(200);
		expect(res.body).to.deep.equal([
			{ campus: "vancouver campus", max: 20, min: -123.125, mean: 16.67, total: 50, sizes: 2 },
			{ campus: "okanagan campus", max: 40, min: -120.375, mean: 40, total: 40, sizes: 1 },
		]);
	});
});

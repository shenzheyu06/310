import fs from "fs/promises";
import { expect } from "chai";
import request from "supertest";
import { createApp } from "../src/App";
import { createReusableServer } from "./TestServer";

describe("IN search operator", () => {
	const datadir = "./data";
	let testServer: ReturnType<typeof createReusableServer>;
	const invalidMessage = "IN must be an object with one sfield and a non-empty array of strings";
	const mixedMessage = "Cannot mix course_offerings and facilities fields in one query";
	const values = ["Alpha", "Beta", "A*lpha", "", "alpha"];

	before(() => {
		testServer = createReusableServer();
	});
	beforeEach(async () => {
		testServer.setHandler(await createApp({ datadir }));
	});
	afterEach(async () => {
		await fs.rm(datadir, { recursive: true, force: true });
	});
	after(async () => {
		await testServer.close();
	});

	for (const kind of ["course_offerings", "facilities"]) {
		const isCourse = kind === "course_offerings";
		const field = isCourse ? "instructor" : "type";
		const column = isCourse ? "avg" : "seats";
		const stringFields = isCourse
			? ["title", "dept", "code", "instructor"]
			: ["building", "name", "address", "campus", "number", "type", "furniture", "href"];

		function search(where: object) {
			return request(testServer.server)
				.post("/api/v2/search")
				.send({
					kind,
					query: { WHERE: where, OPTIONS: { COLUMNS: [column], ORDER: column } },
				});
		}

		async function expectMatches(where: object, indices: number[]) {
			const res = await search(where);
			expect(res.status).to.equal(200);
			expect(res.body).to.deep.equal(indices.map((index) => ({ [column]: index + 1 })));
		}

		describe(`${kind} matching`, () => {
			beforeEach(async () => {
				for (const [index, value] of values.entries()) {
					const id = `R${index}`;
					if (isCourse) {
						await request(testServer.server)
							.put(`/api/v1/courses/${id}`)
							.send({ title: value, dept: value, code: value })
							.expect(201);
						await request(testServer.server)
							.put(`/api/v1/courses/${id}/sections/1`)
							.send({ instructor: value, year: 2025, avg: index + 1, pass: 10, fail: 0, audit: 0 })
							.expect(201);
					} else {
						await request(testServer.server)
							.put(`/api/v2/buildings/${id}`)
							.send({ name: value, address: value, campus: value, lat: 49, lon: -123 })
							.expect(201);
						await request(testServer.server)
							.put(`/api/v2/buildings/${id}/rooms/1`)
							.send({ building: id, number: value, type: value, furniture: value, href: value, seats: index + 1 })
							.expect(201);
					}
				}
			});

			for (const key of stringFields) {
				it(`matches multiple values on ${key}`, async () => {
					await expectMatches({ IN: { [key]: key === "building" ? ["R0", "R1"] : ["Alpha", "Beta"] } }, [0, 1]);
				});
			}
			const cases = [
				{ name: "single value", list: ["Beta"], expected: [1] },
				{ name: "case-sensitive matching", list: ["alpha"], expected: [4] },
				{ name: "no substring matching", list: ["Al"], expected: [] },
				{ name: "no matches", list: ["missing"], expected: [] },
				{ name: "duplicate strings do not duplicate results", list: ["Alpha", "Alpha"], expected: [0] },
				{ name: "literal interior asterisk", list: ["A*lpha"], expected: [2] },
				{ name: "asterisk is not a wildcard", list: ["*"], expected: [] },
				{ name: "leading wildcard is not expanded", list: ["*lpha"], expected: [] },
				{ name: "trailing wildcard is not expanded", list: ["Al*"], expected: [] },
				{ name: "empty string is valid", list: [""], expected: [3] },
			];
			for (const { name, list, expected } of cases) {
				it(name, async () => {
					await expectMatches({ IN: { [field]: list } }, expected);
				});
			}
			it("works inside AND with a numeric comparison", async () => {
				await expectMatches({ AND: [{ IN: { [field]: ["Alpha", "Beta"] } }, { GT: { [column]: 1 } }] }, [1]);
			});
			it("matches literal leading and trailing asterisks", async () => {
				if (isCourse) {
					await request(testServer.server)
						.put("/api/v1/courses/R0/sections/1")
						.send({ instructor: "*Alpha*", year: 2025, avg: 1, pass: 10, fail: 0, audit: 0 })
						.expect(204);
				} else {
					await request(testServer.server)
						.put("/api/v2/buildings/R0/rooms/1")
						.send({ building: "R0", number: "1", type: "*Alpha*", furniture: "Tables", href: "link", seats: 1 })
						.expect(204);
				}
				await expectMatches({ IN: { [field]: ["*Alpha*"] } }, [0]);
			});
			if (!isCourse) {
				it("does not match missing optional campus values", async () => {
					await request(testServer.server)
						.put("/api/v2/buildings/R0")
						.send({ name: "Alpha", address: "Alpha", lat: 49, lon: -123 })
						.expect(204);
					await expectMatches({ IN: { campus: ["", "undefined", "Alpha"] } }, [3]);
				});
			}
			it("works inside OR without duplicate records", async () => {
				await expectMatches({ OR: [{ IN: { [field]: ["Alpha", "Beta"] } }, { IS: { [field]: "Alpha" } }] }, [0, 1]);
			});
			it("works inside NOT", async () => {
				await expectMatches({ NOT: { IN: { [field]: ["Alpha", "Beta"] } } }, [2, 3, 4]);
			});
			it("works with multiple levels of nesting", async () => {
				await expectMatches(
					{
						AND: [
							{ OR: [{ IN: { [field]: ["Alpha", "Beta"] } }, { IN: { [field]: ["alpha"] } }] },
							{ NOT: { IN: { [field]: ["Beta"] } } },
						],
					},
					[0, 4]
				);
			});
		});

		describe(`${kind} validation with no records`, () => {
			const invalidOperands: unknown[] = [
				null,
				false,
				42,
				"Alpha",
				[],
				[{ [field]: ["Alpha"] }],
				{},
				{ [field]: ["Alpha"], [column]: ["Beta"] },
				{ unknown: ["Alpha"] },
				{ [column]: ["1"] },
				{ [field]: "Alpha" },
				{ [field]: null },
				{ [field]: {} },
				{ [field]: 1 },
				{ [field]: [] },
				{ [field]: [1] },
				{ [field]: ["Alpha", 1] },
				{ [field]: ["Alpha", null] },
				{ [field]: [true] },
				{ [field]: [{}] },
				{ [field]: [["Alpha"]] },
			];
			for (const operand of invalidOperands) {
				it(`rejects ${JSON.stringify(operand)}`, async () => {
					const res = await search({ IN: operand });
					expect(res.status).to.equal(400);
					expect(res.body).to.deep.equal({ error: "Invalid query", message: invalidMessage });
				});
			}
			for (const key of isCourse ? ["name", "building", "type"] : ["dept", "instructor", "title"]) {
				it(`rejects the other dataset's ${key} field`, async () => {
					const res = await search({ IN: { [key]: ["Alpha"] } });
					expect(res.status).to.equal(400);
					expect(res.body).to.deep.equal({ error: "Invalid query", message: mixedMessage });
				});
			}
			it("rejects numeric fields from the other dataset with the IN error", async () => {
				const res = await search({ IN: { [isCourse ? "seats" : "avg"]: ["1"] } });
				expect(res.status).to.equal(400);
				expect(res.body).to.deep.equal({ error: "Invalid query", message: invalidMessage });
			});
			it("preserves IN validation errors inside logical filters", async () => {
				const res = await search({ NOT: { OR: [{ IN: { [field]: [] } }] } });
				expect(res.status).to.equal(400);
				expect(res.body).to.deep.equal({ error: "Invalid query", message: invalidMessage });
			});
			it("accepts a valid IN filter with no records", async () => {
				await expectMatches({ IN: { [field]: ["Alpha"] } }, []);
			});
		});
	}
});

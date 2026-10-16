import fs from "fs/promises";
//import * as parse5 from "parse5";
import express from "express";
import cors from "cors";
import multer from "multer";
import JSZip from "jszip";
import parse5 from "parse5";
import Decimal from "decimal.js";
import { StatusCodes } from "http-status-codes";

import coursesRouter from "./routers/coursesRouter";
import sectionsRouter from "./routers/sectionsRouter";
import { validateGetParams } from "./validation/coursesValidation";
import { DataDirectory } from "./repositories/dataDirectory";
import { Course } from "./services/course";
import { Section } from "./services/section";
import { Filterable } from "./services/Filterable";

const datasets: Dataset[] = [];
const RESULT_LIMIT = 5000;
const OVERALL_SECTION_YEAR = 1900;

// Dataset processing happens asynchronously (see postDataset/postUpdatedDataset), but jobs are chained onto this
// queue so that at most one runs at a time. Requests still receive their 202 response immediately either way;
// this only affects the order background work executes in.
let backgroundQueue: Promise<void> = Promise.resolve();

/**
 * Express application.
 */
export type Application = ReturnType<typeof express>;

/**
 * Configuration options for the application.
 */
export type AppConfig = {
	/**
	 * The directory where application data will be stored enabling the application to persist data between restarts.
	 *
	 * @internal
	 * During autograding, the directory will be deleted as a means to reset the application data between tests.
	 */
	readonly datadir: string;
};

/**
 * Initializes the application.
 */
export async function createApp(config: AppConfig): Promise<Application> {
	const app = express();

	const { datadir } = config;

	// initialize datadir singleton
	DataDirectory.getInstance(datadir);
	await DataDirectory.getInstance().makeDirectory();

	// Configure multer to store file contents in memory
	const upload = multer({ storage: multer.memoryStorage() });

	// Make files in ../frontend/public accessible at http://localhost:<port>/
	app.use(express.static("frontend/public"));

	// Register middleware to parse request before passing them to request handlers
	// Note: JSON parser must be place before raw parser because of wildcard matching done by raw parser below
	app.use(express.json());
	app.use(express.raw({ type: "application/*", limit: "10mb" }));
	app.use(cors());

	app.use(coursesRouter);
	app.use(sectionsRouter);

	datasets.splice(0);

	// Basic message to verify REST API is available
	// You can see the message by going to http://localhost:<port>/api
	app.get("/api", (_req, res) => {
		res.send("App is running!");
	});

	app.post("/api/v2/datasets", upload.single("archive"), async (req, res) => {
		const model = new Model(datadir);
		const output = await model.postUpdatedDataset(req.body, req.file);
		res.status(output.status).json(output.body);
	});

	app.post("/api/v1/datasets", upload.single("archive"), async (req, res) => {
		const model = new Model(datadir);
		const output = await model.postDataset(req.body, req.file);
		res.status(output.status).json(output.body);
	});

	app.get("/api/v1/datasets/:id", async (req, res) => {
		const model = new Model(datadir);
		const output = model.getDataset(req.params.id);
		res.status(output.status).json(output.body);
	});

	app.get("/api/v2/datasets/:id", async (req, res) => {
		const model = new Model(datadir);
		const output = model.getDataset(req.params.id);
		res.status(output.status).json(output.body);
	});

	app.post("/api/v1/search", async (req, res) => {
		const model = new Model(datadir);
		const output = await model.searchSectionsV1(req.body);
		res.status(output.status).json(output.body);
	});

	app.post("/api/v2/search", async (req, res) => {
		const model = new Model(datadir);
		const output = await model.searchV2(req.body);
		res.status(output.status).json(output.body);
	});

	app.get("/api/v2/buildings", async (req, res) => {
		const model = new Model(datadir);
		const output = await model.getBuildings(req.query.limit, req.query.offset);
		res.status(output.status).json(output.body);
	});

	app.get("/api/v2/buildings/:buildingId", async (req, res) => {
		const model = new Model(datadir);
		const output = await model.getBuildingById(req.params.buildingId);
		res.status(output.status).send(output.body);
	});

	app.put("/api/v2/buildings/:buildingId", async (req, res) => {
		const model = new Model(datadir);
		const output = await model.setBuilding(
			req.params.buildingId,
			req.body.name,
			req.body.address,
			req.body.lat,
			req.body.lon,
			req.body.campus
		);
		res.status(output.status).send(output.body);
	});

	app.delete("/api/v2/buildings/:buildingId", async (req, res) => {
		const model = new Model(datadir);
		const output = await model.deleteBuilding(req.params.buildingId);
		res.status(output.status).send(output.body);
	});

	app.get("/api/v2/buildings/:buildingId/rooms", async (req, res) => {
		const model = new Model(datadir);
		const output = await model.getRooms(req.params.buildingId, req.query.limit, req.query.offset);
		res.status(output.status).send(output.body);
	});

	app.get("/api/v2/buildings/:buildingId/rooms/:roomId", async (req, res) => {
		const model = new Model(datadir);
		const output = await model.getRoomById(req.params.buildingId, req.params.roomId);
		res.status(output.status).send(output.body);
	});

	app.put("/api/v2/buildings/:buildingId/rooms/:roomId", async (req, res) => {
		const model = new Model(datadir);
		const output = await model.setRoom(req.params.buildingId, req.params.roomId, req.body);
		res.status(output.status).send(output.body);
	});

	app.delete("/api/v2/buildings/:buildingId/rooms/:roomId", async (req, res) => {
		const model = new Model(datadir);
		const output = await model.deleteRoom(req.params.buildingId, req.params.roomId);
		res.status(output.status).send(output.body);
	});

	return app;
}

const prefixBuildings = "/api/v2/buildings";
const SECTIONS_MKEY = ["avg", "pass", "fail", "audit", "year"];
const SECTIONS_SKEY = ["title", "dept", "code", "instructor"];
const ROOMS_MKEY = ["lat", "lon", "seats"];
const ROOMS_SKEY = ["campus", "address", "building", "furniture", "href", "name", "number", "type"];
const SECTIONS_KEY = [...SECTIONS_MKEY, ...SECTIONS_SKEY];
const ROOMS_KEY = [...ROOMS_MKEY, ...ROOMS_SKEY];
const MKEY = [...SECTIONS_MKEY, ...ROOMS_MKEY];
const SKEY = [...SECTIONS_SKEY, ...ROOMS_SKEY];
const KEY = [...MKEY, ...SKEY];

type ApiOutput = { status: number; body?: any };

export class Model {
	constructor(private datadir: string) {}
	public data: {
		courses: Course[];
		buildings: Building[];
	} = { courses: [], buildings: [] };

	public async readCourses(): Promise<void> {
		this.data.courses = await Course.getCourses();
	}

	public async writeCourses(): Promise<void> {
		await Course.writeCourses(this.data.courses);
	}

	public async readBuildings(): Promise<void> {
		try {
			const read = await fs.readFile(`${this.datadir}/buildings.json`, "utf-8");
			this.data.buildings = JSON.parse(read).map((building: Building) => Building.buildBuilding(building));
		} catch {
			this.data.buildings = [];
		}
	}

	public async writeBuildings(): Promise<void> {
		await fs.writeFile(
			`${this.datadir}/buildings.json`,
			JSON.stringify(this.data.buildings.map((building) => building.getJSONFull()))
		);
	}

	public async postDataset(body: any, file: any): Promise<ApiOutput> {
		const valid = await validateDatasetParams(body, file);
		if (!valid.valid) {
			return {
				status: 422,
				body: {
					error: "Validation failed",
					fields: valid.fields,
				},
			};
		}
		const id = datasets.length;
		const coursesDataset = new CoursesDataset(id, valid.zip, this.datadir, valid.is_valid_zip);
		backgroundQueue = backgroundQueue
			.then(() => coursesDataset.startProcess())
			.catch(() => {
				coursesDataset.status = "failed";
				coursesDataset.message = "Unexpected error during processing";
			});
		datasets.push(coursesDataset);
		return {
			status: 202,
			body: {
				id: String(id),
				status: "processing",
				kind: "course_offerings",
				message: "Dataset accepted for processing",
			},
		};
	}

	public async postUpdatedDataset(body: any, file: any): Promise<ApiOutput> {
		const valid = await validateNewDatasetParams(body, file);
		if (!valid.valid) {
			return {
				status: 422,
				body: {
					error: "Validation failed",
					fields: valid.fields,
				},
			};
		}
		const id = datasets.length;

		if (valid.file_type === "facilities") {
			const buildingsDataset = new BuildingsDataset(id, valid.zip, this.datadir, valid.is_valid_zip);
			backgroundQueue = backgroundQueue
				.then(() => buildingsDataset.startProcess())
				.catch(() => {
					buildingsDataset.setFailMessage("Unexpected error during processing");
				});
			datasets.push(buildingsDataset);
		} else {
			const coursesDataset = new CoursesDataset(id, valid.zip, this.datadir, valid.is_valid_zip);
			backgroundQueue = backgroundQueue
				.then(() => coursesDataset.startProcess())
				.catch(() => {
					coursesDataset.status = "failed";
					coursesDataset.message = "Unexpected error during processing";
				});
			datasets.push(coursesDataset);
		}

		return {
			status: 202,
			body: {
				id: String(id),
				status: "processing",
				kind: valid.file_type,
				message: "Dataset accepted for processing",
			},
		};
	}

	public getDataset(id: string): ApiOutput {
		if (Number.isNaN(Number(id)) || Number(id) < 0 || Number(id) >= datasets.length) {
			return {
				status: 404,
				body: {
					error: "Not found",
					message: `no dataset with id '${id}'`,
				},
			};
		} else {
			return {
				status: 200,
				body: datasets[Number(id)].report(),
			};
		}
	}

	public async searchSectionsV1(body: any): Promise<ApiOutput> {
		const valid = validateSearchParamsV1(body);
		if (!valid.valid) {
			return {
				status: 422,
				body: {
					error: "Validation failed",
					fields: valid.fields,
				},
			};
		}
		await this.readCourses();
		if (body.query.WHERE === undefined) return errorBadRequest("Missing WHERE");
		else if (body.query.OPTIONS === undefined) return errorBadRequest("Missing OPTIONS");
		else if (body.query.OPTIONS.COLUMNS === undefined) return errorBadRequest("Missing COLUMNS");
		else if (!body.query.OPTIONS.COLUMNS.every((column: string) => SECTIONS_KEY.includes(column)))
			return errorBadRequest("Unknown key in COLUMNS");
		else if (body.query.OPTIONS.ORDER && !body.query.OPTIONS.COLUMNS.includes(body.query.OPTIONS.ORDER))
			return errorBadRequest("ORDER must be a key in COLUMNS");
		else if (
			!Object.keys(body.query.OPTIONS).includes("COLUMNS") ||
			Object.keys(body.query.OPTIONS).some((key) => key !== "COLUMNS" && key !== "ORDER")
		)
			return errorBadRequest("OPTIONS must be an object with COLUMNS and optional ORDER");

		const sections: Section[] = [];
		for (const course of this.data.courses) course.sections.map((section) => sections.push(section));
		const filtered = filterRecords(body.query.WHERE, sections, SECTIONS_KEY);
		if (filtered.error && filtered.error !== "no filter") {
			if (filtered.error === "not filter") filtered.error = "WHERE must be an object with at most one FILTER";
			return errorBadRequest(filtered.error);
		} else if (filtered.list.length > RESULT_LIMIT) {
			return {
				status: 413,
				body: {
					error: "Too many results",
					message: "Query would return more than 5000 results",
					limit: RESULT_LIMIT,
				},
			};
		}
		// select the right COLUMNS and sort them in the correct ORDER here
		const infoArr = [];
		for (const section of filtered.list) {
			const info: any = {};
			for (const column of body.query.OPTIONS.COLUMNS)
				if (SECTIONS_KEY.includes(column)) info[column] = section.getValue(column);
			infoArr.push(info);
		}
		infoArr.sort((a, b) => ordering(a, b, [body.query.OPTIONS.ORDER]));
		return {
			status: 200,
			body: infoArr,
		};
	}

	public async searchV2(body: any): Promise<ApiOutput> {
		const valid = validateSearchParamsV2(body);
		if (!valid.valid) {
			return {
				status: 422,
				body: {
					error: "Validation failed",
					fields: valid.fields,
				},
			};
		}
		if (body.kind === "course_offerings") await this.readCourses();
		else if (body.kind === "facilities") await this.readBuildings();

		let allKeys = structuredClone(KEY);
		if (body.query.WHERE === undefined) return errorBadRequest("Missing WHERE");
		if (body.query.OPTIONS === undefined) return errorBadRequest("Missing OPTIONS");
		if (body.query.OPTIONS.COLUMNS === undefined) return errorBadRequest("Missing COLUMNS");

		if (body.query.TRANSFORMATIONS !== undefined && body.query.TRANSFORMATIONS !== null) {
			if (body.query.TRANSFORMATIONS.GROUP === undefined) return errorBadRequest("Missing GROUP in TRANSFORMATIONS");
			if (body.query.TRANSFORMATIONS.APPLY === undefined) return errorBadRequest("Missing APPLY in TRANSFORMATIONS");
			if (!Array.isArray(body.query.TRANSFORMATIONS.GROUP) || body.query.TRANSFORMATIONS.GROUP.length < 1)
				return errorBadRequest("GROUP must be a non-empty array");
			if (!body.query.TRANSFORMATIONS.GROUP.every((key: string) => KEY.includes(key)))
				return errorBadRequest("GROUP must only contain valid keys");
			if (!Array.isArray(body.query.TRANSFORMATIONS.APPLY)) return errorBadRequest("APPLY must be an array");

			const applyKeys: string[] = body.query.TRANSFORMATIONS.APPLY.map(
				(applyRule: Object) => Object.keys(applyRule)[0]
			);
			if (
				!body.query.OPTIONS.COLUMNS.every(
					(column: string) => body.query.TRANSFORMATIONS.GROUP.includes(column) || applyKeys.includes(column)
				)
			)
				return errorBadRequest("When TRANSFORMATIONS is present, all COLUMNS must be in GROUP or APPLY");
			if (applyKeys.some((applyKey, index) => applyKeys.indexOf(applyKey) !== index))
				return errorBadRequest("Duplicate applykey in APPLY");
			if (applyKeys.some((applyKey) => !applyKey || includeString(applyKey, "_", false, false)))
				return errorBadRequest("applykey cannot be empty or contain underscore");

			const apply = body.query.TRANSFORMATIONS.APPLY;
			const applyTokens = apply.map((applyRule: Object) => Object.values(applyRule)[0]);
			if (
				!applyTokens.every((applyToken: Object) =>
					["MAX", "MIN", "SUM", "AVG", "COUNT"].includes(Object.keys(applyToken)[0])
				)
			)
				return errorBadRequest("Invalid APPLYTOKEN (must be MAX, MIN, AVG, COUNT, or SUM)");

			const appliedKeys = applyTokens.map((applyToken: Object) => Object.values(applyToken)[0]);
			if (
				!appliedKeys.every((key: any) => KEY.includes(key)) ||
				applyTokens.some((applyToken: Object) => Object.keys(applyToken).length !== 1)
			)
				return errorBadRequest("APPLYRULE must apply aggregation to a valid KEY");
			if (body.kind === "course_offerings" && appliedKeys.some((key: any) => ROOMS_KEY.includes(key)))
				return errorBadRequest("Cannot mix course_offerings and facilities fields in one query");
			if (body.kind === "facilities" && appliedKeys.some((key: any) => SECTIONS_KEY.includes(key)))
				return errorBadRequest("Cannot mix course_offerings and facilities fields in one query");

			if (
				!applyTokens.every(
					(applyToken: Object) => Object.keys(applyToken)[0] === "COUNT" || MKEY.includes(Object.values(applyToken)[0])
				)
			)
				return errorBadRequest("MAX/MIN/AVG/SUM can only be applied to mfields");

			allKeys = [...allKeys, ...applyKeys];
		}
		if (!body.query.OPTIONS.COLUMNS.every((column: string) => allKeys.includes(column)))
			return errorBadRequest("Unknown key in COLUMNS");
		if (Object.keys(body.query.OPTIONS).some((key) => key !== "COLUMNS" && key !== "ORDER"))
			return errorBadRequest("OPTIONS must be an object with COLUMNS and optional ORDER");
		if (body.query.OPTIONS.ORDER !== undefined && body.query.OPTIONS.ORDER !== null) {
			if (typeof body.query.OPTIONS.ORDER === "string") {
				if (!body.query.OPTIONS.COLUMNS.includes(body.query.OPTIONS.ORDER))
					return errorBadRequest("ORDER must be a key in COLUMNS");
			} else {
				if (
					!Array.isArray(body.query.OPTIONS.ORDER.keys) ||
					body.query.OPTIONS.ORDER.keys.length < 1 ||
					body.query.OPTIONS.ORDER.keys.some((key: any) => !body.query.OPTIONS.COLUMNS.includes(key))
				)
					return errorBadRequest("All ORDER keys must be in COLUMNS");
				if (!["UP", "DOWN"].includes(body.query.OPTIONS.ORDER.dir))
					return errorBadRequest("Invalid sort direction (must be UP or DOWN)");
			}
		}
		let filtered: { error: string; list: Section[] | Room[] } = {
			error: "",
			list: [],
		};
		if (body.kind === "course_offerings") {
			if (body.query.OPTIONS.COLUMNS.some((column: string) => ROOMS_KEY.includes(column)))
				return errorBadRequest("Cannot mix course_offerings and facilities fields in one query");
			const sections: Section[] = [];
			for (const course of this.data.courses) course.sections.map((section) => sections.push(section));
			filtered = filterRecords(body.query.WHERE, sections, SECTIONS_KEY);
		} else if (body.kind === "facilities") {
			if (body.query.OPTIONS.COLUMNS.some((column: string) => SECTIONS_KEY.includes(column)))
				return errorBadRequest("Cannot mix course_offerings and facilities fields in one query");
			const rooms: Room[] = [];
			for (const building of this.data.buildings) building.rooms.map((room) => rooms.push(room));
			filtered = filterRecords(body.query.WHERE, rooms, ROOMS_KEY);
		}
		if (filtered.error && filtered.error !== "no filter") {
			if (filtered.error === "not filter") filtered.error = "WHERE must be an object with at most one FILTER";
			return errorBadRequest(filtered.error);
		}
		const infoArr = [];
		if (body.query.TRANSFORMATIONS === undefined) {
			for (const entry of filtered.list) {
				const info: any = {};
				for (const column of body.query.OPTIONS.COLUMNS) {
					if (KEY.includes(column)) info[column] = entry.getValue(column);
				}
				infoArr.push(info);
			}
		} else {
			const transformed = transformList(filtered.list, body.query.TRANSFORMATIONS);
			for (const entry of transformed) {
				const info: any = {};
				for (const column of body.query.OPTIONS.COLUMNS) {
					info[column] = entry[column];
				}
				infoArr.push(info);
			}
		}

		if (infoArr.length > RESULT_LIMIT) {
			return {
				status: 413,
				body: {
					error: "Too many results",
					message: "Query would return more than 5000 results",
					limit: RESULT_LIMIT,
				},
			};
		}

		let multiplier = 1;
		let order: string[] = [];
		if (typeof body.query.OPTIONS.ORDER === "string") order = [body.query.OPTIONS.ORDER];
		else if (body.query.OPTIONS.ORDER !== undefined && body.query.OPTIONS.ORDER !== null) {
			multiplier = ["DOWN", "UP"].indexOf(body.query.OPTIONS.ORDER.dir) * 2 - 1; // 1 for UP, -1 for DOWN
			order = body.query.OPTIONS.ORDER.keys;
		}
		infoArr.sort((a, b) => ordering(a, b, order) * multiplier);
		return {
			status: 200,
			body: infoArr,
		};
	}

	public async getBuildings(buildingsLimit: any, buildingsOffset: any): Promise<ApiOutput> {
		await this.readBuildings();
		let limit = 100;
		let offset = 0;
		if (buildingsLimit !== undefined) limit = Number(buildingsLimit);
		if (buildingsOffset !== undefined) offset = Number(buildingsOffset);

		const valid = validateGetParams(limit, offset);
		if (!valid.valid) {
			return {
				status: 400,
				body: {
					error: "Invalid request parameters",
					params: valid.fields,
				},
			};
		}

		const buildings = this.data.buildings.map((building) => building.getJSONLinks());
		const buildingsLength = buildings.length;
		buildings.splice(0, offset);
		if (buildings.length > limit) buildings.splice(limit);

		return {
			status: 200,
			body: {
				total: buildingsLength,
				limit: limit,
				offset: offset,
				items: buildings,
			},
		};
	}

	public async getBuildingById(buildingId: string): Promise<ApiOutput> {
		await this.readBuildings();
		const building = this.data.buildings.find((b) => b.id === buildingId);
		if (building === undefined || building === null) {
			return {
				status: 404,
				body: {
					error: "Not found",
					message: `no building with id '${buildingId}'`,
				},
			};
		}
		return {
			status: 200,
			body: building.getJSONLinks(),
		};
	}

	public async setBuilding(
		buildingId: string,
		name: any,
		address: any,
		lat: any,
		lon: any,
		campus?: any
	): Promise<ApiOutput> {
		await this.readBuildings();
		const valid = validateBuildingParams(name, address, lat, lon, campus);
		if (!valid.valid) {
			return {
				status: 422,
				body: {
					error: "Validation failed",
					fields: valid.fields,
				},
			};
		}
		let exist = false;
		if (this.data.buildings.find((building) => building.id === buildingId)) {
			exist = true;
			await this.deleteBuilding(buildingId);
		}
		const building = new Building(buildingId, name, address, lat, lon, campus);
		this.data.buildings.push(building);
		await this.writeBuildings();
		if (exist) {
			return { status: 204 };
		} else {
			return {
				status: 201,
				body: building.getJSONLinks(),
			};
		}
	}

	public async deleteBuilding(buildingId: string): Promise<ApiOutput> {
		await this.readBuildings();
		const index = this.data.buildings.findIndex((building) => building.id === buildingId);
		if (index >= 0) {
			const body = this.data.buildings[index].getJSONForDelete();
			this.data.buildings.splice(index, 1);
			await this.writeBuildings();
			return {
				status: 200,
				body: body,
			};
		} else {
			return {
				status: 404,
				body: {
					error: "Not found",
					message: `no building with id '${buildingId}'`,
				},
			};
		}
	}

	public async getRooms(buildingId: string, roomsLimit: any, roomsOffset: any): Promise<ApiOutput> {
		await this.readBuildings();
		const building = this.data.buildings.find((b) => b.id === buildingId);
		if (building === undefined || building === null) {
			return {
				status: 404,
				body: {
					error: "Not found",
					message: `no building with id '${buildingId}'`,
				},
			};
		}

		let limit = 100;
		let offset = 0;

		if (roomsLimit !== undefined) limit = Number(roomsLimit);
		if (roomsOffset !== undefined) offset = Number(roomsOffset);

		const valid = validateGetParams(limit, offset);
		if (!valid.valid) {
			return {
				status: 400,
				body: {
					error: "Invalid request parameters",
					params: valid.fields,
				},
			};
		}

		const rooms = building.getRooms().map((room) => room.getJSONLinks());
		const roomsLength = rooms.length;

		rooms.splice(0, offset);
		if (rooms.length > limit) rooms.splice(limit);

		return {
			status: 200,
			body: {
				total: roomsLength,
				limit: limit,
				offset: offset,
				items: rooms,
			},
		};
	}

	public async getRoomById(buildingId: string, roomId: string): Promise<ApiOutput> {
		await this.readBuildings();
		const building = this.data.buildings.find((b) => b.id === buildingId);
		if (building === undefined || building === null) {
			return {
				status: 404,
				body: {
					error: "Not found",
					message: `no building with id '${buildingId}'`,
				},
			};
		}
		const room = building.getRoomById(roomId);
		if (!room) {
			return {
				status: 404,
				body: {
					error: "Not found",
					message: `no room with id '${roomId}'`,
				},
			};
		} else {
			return {
				status: 200,
				body: room.getJSONLinks(),
			};
		}
	}

	public async setRoom(buildingId: string, roomId: string, params: any): Promise<ApiOutput> {
		await this.readBuildings();
		const building = this.data.buildings.find((b) => b.id === buildingId);
		if (building === undefined || building === null) {
			return {
				status: 404,
				body: {
					error: "Not found",
					message: `no building with id '${buildingId}'`,
				},
			};
		}
		const valid = validateRoomParams(params, buildingId);
		if (!valid.valid) {
			return {
				status: 422,
				body: {
					error: "Validation failed",
					fields: valid.fields,
				},
			};
		}
		const { number, type, furniture, href, seats } = params;
		const output = building.setRoom(roomId, number, type, furniture, href, seats);
		await this.writeBuildings();
		if (output.replace) {
			return {
				status: 204,
			};
		} else {
			return {
				status: 201,
				body: output.body,
			};
		}
	}

	public async deleteRoom(buildingId: string, roomId: string): Promise<ApiOutput> {
		await this.readBuildings();
		const building = this.data.buildings.find((b) => b.id === buildingId);
		if (!building) {
			return {
				status: 404,
				body: {
					error: "Not found",
					message: `no building with id '${buildingId}'`,
				},
			};
		}
		const output = building.deleteRoom(roomId);
		if (!output.success) {
			return {
				status: 404,
				body: {
					error: "Not found",
					message: `no room with id '${roomId}'`,
				},
			};
		} else {
			await this.writeBuildings();
			return {
				status: 200,
				body: output.body,
			};
		}
	}
}

abstract class Dataset {
	constructor(public id: number) {}

	public abstract report(): Object;
	public abstract startProcess(): Promise<void>;
}

type ParseNode = parse5.DefaultTreeAdapterTypes.ChildNode;
type ParseElement = parse5.DefaultTreeAdapterTypes.Element;

type BuildingStatus = {
	status: string;
	buildings_added: number;
	buildings_modified: number;
	rooms_added: number;
	rooms_modified: number;
	message: string;
};

type BuildingInfo = {
	fullname: string;
	shortname: string;
	address: string;
	link: string | undefined;
};

type CoordResponseFormat = {
	lat?: number;
	lon?: number;
	error?: string;
};

const geoServiceUrl = "http://cs310.students.cs.ubc.ca:11316/api/v1/geolocation/";
const GEO_SERVICE_TIMEOUT_MS = 5000;

class BuildingsDataset extends Dataset {
	constructor(
		public id: number,
		private dir: JSZip, // Some .htm file?
		private datadir: string,
		private isValidZip: Boolean
	) {
		super(id);
		// try {
		// 	this.parse5 = require("parse5");
		// } catch (err) {
		// 	console.log("parse 5 import failed!!!");
		// 	throw err;
		// }
		this.valid_zip = isValidZip;
		this.htmlFileDir = dir;
		try {
			this.model = new Model(datadir);
		} catch (err) {
			// console.log("failed to create a new model in BuildingsDataset");
			throw err;
		}
	}

	//private parse5;
	private model;
	private valid_zip;
	private htmlFileDir;

	private buildings_status: BuildingStatus = {
		status: "processing",
		buildings_added: 0,
		buildings_modified: 0,
		rooms_added: 0,
		rooms_modified: 0,
		message: "Processing in progress",
	};

	public report(): Object {
		if (this.buildings_status.status === "completed") {
			return {
				id: String(this.id),
				status: this.buildings_status.status,
				kind: "facilities",
				stats: {
					buildings_added: this.buildings_status.buildings_added,
					buildings_modified: this.buildings_status.buildings_modified,
					rooms_added: this.buildings_status.rooms_added,
					rooms_modified: this.buildings_status.rooms_modified,
				},
				message: this.buildings_status.message,
			};
		} else {
			return {
				id: String(this.id),
				status: this.buildings_status.status,
				kind: "facilities",
				stats: {
					buildings_added: 0,
					buildings_modified: 0,
					rooms_added: 0,
					rooms_modified: 0,
				},
				message: this.buildings_status.message,
			};
		}
	}

	public setFailMessage(message: string): void {
		this.buildings_status = {
			status: "failed",
			buildings_added: 0,
			buildings_modified: 0,
			rooms_added: 0,
			rooms_modified: 0,
			message: message,
		};
	}

	// THIS FUNCTION WAS WRITTEN BY AI //
	private getTextFromNode(node: any): string {
		let text = "";
		if (node.nodeName === "#text" && node.value) {
			text += node.value.trim();
		}
		if (node.childNodes) {
			for (const child of node.childNodes) {
				text += this.getTextFromNode(child);
			}
		}
		return text.trim();
	}

	// THIS FUNCTION WAS WRITTEN BY AI //
	private getHrefFromNode(node: any): string | undefined {
		if (node.nodeName === "a") {
			for (const attr of node.attrs) {
				if (attr.name === "href") {
					return attr.value;
				}
			}
		}
		if (node.childNodes) {
			for (const child of node.childNodes) {
				const href = this.getHrefFromNode(child);
				if (href) return href;
			}
		}
		return undefined;
	}

	private searchChildForElement(node: ParseNode, className: string): ParseElement | undefined {
		let result: ParseElement | undefined = undefined;

		const elem: any = node;
		if (!("childNodes" in elem)) {
			// base case 1
			return undefined;
		}

		if (this.hasClass(elem, className)) {
			const element: ParseElement = elem;
			return element; // base case 2
		} else {
			elem.childNodes.forEach((child: ParseNode) => {
				const res = this.searchChildForElement(child, className);
				if (res !== undefined && res !== null) {
					result = res;
				}
			});
		}

		return result;
	}

	private findTable(document: parse5.DefaultTreeAdapterTypes.Document): ParseElement | undefined {
		let result: ParseElement | undefined = undefined;
		document.childNodes.forEach((child) => {
			const tableNode: ParseElement | undefined = this.searchChildForElement(child, "views-table");

			if (tableNode !== undefined && tableNode !== null) {
				result = tableNode;
			}
		});

		return result;
	}

	private async extractIndex(): Promise<parse5.DefaultTreeAdapterTypes.Document | undefined> {
		if (!this.valid_zip) {
			this.setFailMessage("Data is not in a valid zip format");
			return undefined;
		}

		try {
			const file = this.htmlFileDir.file("index.htm");

			if (!file) {
				this.setFailMessage("Missing index.htm file");
				return undefined;
			}

			try {
				const fileAsString = await file.async("string");

				try {
					return parse5.parse(fileAsString);
				} catch {
					this.setFailMessage("index.htm could not be parsed");
				}
			} catch {
				this.setFailMessage("Data is not in a valid zip format");
			}
		} catch {
			this.setFailMessage("Failed to fetch any file from directory");
		}

		return undefined;
	}

	private allBuildingFieldsPresent(
		a: ParseElement | undefined,
		b: ParseElement | undefined,
		c: ParseElement | undefined,
		d: ParseElement | undefined
	): boolean {
		return (
			a !== undefined &&
			a !== null &&
			b !== undefined &&
			b !== null &&
			c !== undefined &&
			c !== null &&
			d !== undefined &&
			d !== null
		);
	}

	private allRoomFieldsPresent(
		a: ParseElement | undefined,
		b: ParseElement | undefined,
		c: ParseElement | undefined,
		d: ParseElement | undefined,
		e: ParseElement | undefined
	): boolean {
		return (
			a !== undefined &&
			a !== null &&
			b !== undefined &&
			b !== null &&
			c !== undefined &&
			c !== null &&
			d !== undefined &&
			d !== null &&
			e !== undefined &&
			e !== null
		);
	}

	private hasClass(elem: ParseElement, str: string): boolean {
		for (const attr of elem.attrs) {
			if (attr.name === "class" && attr.value.split(" ").includes(str)) {
				return true;
			}
		}

		return false;
	}

	private findFullname(row: ParseNode): ParseElement | undefined {
		return this.searchChildForElement(row, "views-field-title");
	}

	private findShortname(row: ParseNode): ParseElement | undefined {
		return this.searchChildForElement(row, "views-field-field-building-code");
	}

	private findAddress(row: ParseNode): ParseElement | undefined {
		return this.searchChildForElement(row, "views-field-field-building-address");
	}

	private findLink(row: ParseNode): ParseElement | undefined {
		return this.searchChildForElement(row, "views-field-title");
	}

	private findRoomNumber(row: ParseNode): ParseElement | undefined {
		return this.searchChildForElement(row, "views-field-field-room-number");
	}

	private findSeats(row: ParseNode): ParseElement | undefined {
		return this.searchChildForElement(row, "views-field-field-room-capacity");
	}

	private findFurniture(row: ParseNode): ParseElement | undefined {
		return this.searchChildForElement(row, "views-field-field-room-furniture");
	}

	private findRoomType(row: ParseNode): ParseElement | undefined {
		return this.searchChildForElement(row, "views-field-field-room-type");
	}

	private findHREF(row: ParseNode): ParseElement | undefined {
		return this.searchChildForElement(row, "views-field-nothing");
	}

	private async extractBuildings(table: ParseElement): Promise<Pair<Building, string>[]> {
		const rows: ParseNode[] = this.extractRowsFromTable(table);
		const buildingsInfo: BuildingInfo[] = [];
		const buildings: Pair<Building, string>[] = [];

		rows.forEach((row: ParseNode) => {
			const fullnameNode = this.findFullname(row);
			const shortnameNode = this.findShortname(row);
			const addressNode = this.findAddress(row);
			const linkNode = this.findLink(row);

			if (this.allBuildingFieldsPresent(fullnameNode, shortnameNode, addressNode, linkNode)) {
				const fullname = this.getTextFromNode(fullnameNode);
				const shortname = this.getTextFromNode(shortnameNode);
				const address = this.getTextFromNode(addressNode);
				const link = this.getHrefFromNode(linkNode);

				if (link) {
					const building: BuildingInfo = {
						fullname: fullname,
						shortname: shortname,
						address: address,
						link: link,
					};

					buildingsInfo.push(building);
				}
			}
		});

		// console.log("buildings info: ", buildingsInfo, "\n");

		await Promise.all(
			buildingsInfo.map(async (building: BuildingInfo, index: number) => {
				const url = geoServiceUrl + encodeURIComponent(building.address);
				let res: Response;
				let body: CoordResponseFormat | null;
				try {
					res = await fetch(url, { signal: AbortSignal.timeout(GEO_SERVICE_TIMEOUT_MS) });
					body = (await res.json()) as any;
				} catch {
					// geolocation service unreachable, too slow, or returned a non-JSON response; skip this building
					return;
				}

				// console.log("fetch response: ", res.status, "\n");

				if (
					body !== undefined &&
					body !== null &&
					res.status === StatusCodes.OK &&
					!body.error &&
					body.lat &&
					body.lon &&
					building.link !== undefined &&
					building.link !== null &&
					validateBuildingParams(building.fullname, building.address, body.lat, body.lon)
				) {
					// console.log("building validated\n");
					const { shortname, fullname, address } = building;
					const bldng = new Building(shortname, fullname, address, body.lat, body.lon);
					const pair: Pair<Building, string> = { first: bldng, second: building.link };
					buildings.push(pair);
				}
			})
		);

		return buildings;
	}

	private async traverseDirectory(fileDir: JSZip, path: string): Promise<string | undefined> {
		const normalizedPath = path.startsWith("./") ? path.slice(2) : path;
		return await this.htmlFileDir.file(normalizedPath)?.async("string");
	}

	// THE FUNCTION BELOW WAS GENERATED BY AI
	private extractRowsFromTable(table: ParseElement): ParseElement[] {
		const rows: ParseElement[] = [];

		for (const child of table.childNodes) {
			const section = child as ParseElement;
			if (section.nodeName === "tbody") {
				for (const row of section.childNodes) {
					const tr = row as ParseElement;
					if (tr.nodeName === "tr") {
						rows.push(tr);
					}
				}
			}
		}

		return rows;
	}

	private async extractRooms(buildings: Pair<Building, string>[]): Promise<Building[]> {
		await Promise.all(
			buildings.map(async (building: Pair<Building, string>) => {
				const link = building.second;

				const htmlString = await this.traverseDirectory(this.htmlFileDir, link);
				if (htmlString !== undefined && htmlString !== null) {
					try {
						const buildingJSON: parse5.DefaultTreeAdapterTypes.Document = parse5.parse(htmlString);

						for (const child of buildingJSON.childNodes) {
							const campusNode = this.searchChildForElement(child, "ubc7-campus");
							if (campusNode !== undefined) {
								building.first.campus = this.getTextFromNode(campusNode);
							}
						}

						const roomsTable: ParseElement | undefined = this.findTable(buildingJSON);

						if (roomsTable !== undefined && roomsTable !== null) {
							const rows = this.extractRowsFromTable(roomsTable);

							for (const row of rows) {
								const roomNumberNode = this.findRoomNumber(row);
								const seatsNode = this.findSeats(row);
								const furnitureNode = this.findFurniture(row);
								const roomTypeNode = this.findRoomType(row);
								const hrefNode = this.findHREF(row);

								const allPresent = this.allRoomFieldsPresent(
									roomNumberNode,
									seatsNode,
									furnitureNode,
									roomTypeNode,
									hrefNode
								);
								if (allPresent) {
									const roomNumber = this.getTextFromNode(roomNumberNode);
									const seats = Number(this.getTextFromNode(seatsNode).trim());
									const furniture = this.getTextFromNode(furnitureNode);
									const roomType = this.getTextFromNode(roomTypeNode);
									const href = this.getHrefFromNode(hrefNode);

									if (
										href !== undefined &&
										href !== null &&
										validateRoomParams(
											{
												building: building.first.id,
												number: roomNumber,
												type: roomType,
												furniture: furniture,
												href: href,
												seats: seats,
											},
											building.first.id
										).valid
									) {
										const room: Room = new Room(
											building.first.id + roomNumber,
											building.first.id,
											roomNumber,
											roomType,
											furniture,
											href,
											seats,
											building.first
										);
										building.first.rooms.push(room);
									}
								}
							}
						}
					} catch {
						// console.log("incorrect html format, unable to parse\n");
					}
				} else {
					// console.log("no file found at location %s\n", link);
				}
			})
		);

		const loadedBuildings: Building[] = buildings.map((building) => {
			return building.first;
		});

		return loadedBuildings;
	}

	private buildingParamsMatch(b1: Building, b2: Building): boolean {
		return (
			b1.lat === b2.lat &&
			b1.lon === b2.lon &&
			b1.name === b2.name &&
			b1.address === b2.address &&
			b1.campus === b2.campus
		);
	}

	private roomParamsMatch(r1: Room, r2: Room): boolean {
		return (
			r1.building === r2.building &&
			r1.number === r2.number &&
			r1.seats === r2.seats &&
			r1.type === r2.type &&
			r1.furniture === r2.furniture &&
			r1.href === r2.href
		);
	}

	private pairifyBuildings(buildings: Building[], bool: boolean): BuildingChangePair[] {
		const originalPair: BuildingChangePair[] = buildings.map((building) => {
			const roomsPair = this.pairifyRooms(building.rooms, bool);

			return { first: { first: building, second: roomsPair }, second: bool };
		});

		return originalPair;
	}

	private pairifyRooms(rooms: Room[], bool: boolean): Pair<Room, boolean>[] {
		const roomsPair = rooms.map((room: Room) => {
			return { first: room, second: bool };
		});

		return roomsPair;
	}

	private unPairifyBuildings(building_pairs: BuildingChangePair[]): Building[] {
		const buildings: Building[] = building_pairs.map((building_pair: BuildingChangePair) => {
			const rooms: Room[] = building_pair.first.second.map((room_pair) => {
				return room_pair.first;
			});

			building_pair.first.first.rooms = rooms;
			return building_pair.first.first;
		});

		return buildings;
	}

	private combineRooms(match: BuildingChangePair, building: Building): BuildingChangePair {
		building.rooms.forEach((room: Room) => {
			const roomMatch: Pair<Room, boolean> | undefined = match.first.second.find((og: Pair<Room, boolean>) => {
				return og.first.id === room.id;
			});

			if (roomMatch === undefined || roomMatch === null) {
				match.first.second.push({ first: room, second: false });
				this.buildings_status.rooms_added++;
			} else if (!this.roomParamsMatch(room, roomMatch.first)) {
				roomMatch.first.building = room.building;
				roomMatch.first.number = room.number;
				roomMatch.first.seats = room.seats;
				roomMatch.first.type = room.type;
				roomMatch.first.furniture = room.furniture;
				roomMatch.first.href = room.href;

				if (roomMatch.second) {
					this.buildings_status.rooms_modified++;
					// console.log("modifying room\n");
					roomMatch.second = false;
				}
			}
		});

		return match;
	}

	private combineBuildings(buildings: Building[], original: Building[]): Building[] {
		const originalPair: BuildingChangePair[] = this.pairifyBuildings(original, true);

		buildings.forEach((building: Building) => {
			let match: BuildingChangePair | undefined = originalPair.find(
				(og: BuildingChangePair) => og.first.first.id === building.id
			);
			if (match === undefined || match === null) {
				this.buildings_status.buildings_added++;
				// console.log("adding building\n");
				building.rooms.forEach(() => this.buildings_status.rooms_added++);
				// console.log("adding rooms\n");
				originalPair.push({
					first: { first: building, second: this.pairifyRooms(building.rooms, false) },
					second: false,
				});
			} else if (!this.buildingParamsMatch(building, match.first.first)) {
				match.first.first.name = building.name;
				match.first.first.address = building.address;
				match.first.first.lat = building.lat;
				match.first.first.lon = building.lon;
				match.first.first.campus = building.campus;

				match = this.combineRooms(match, building);

				if (match.second) {
					// console.log("modifying building\n");
					this.buildings_status.buildings_modified++;
					match.second = false;
				}
			} else {
				match = this.combineRooms(match, building);
			}
		});

		const result: Building[] = this.unPairifyBuildings(originalPair);

		return result;
	}

	private async uploadBuildingsData(buildings: Building[]): Promise<void> {
		await this.model.readBuildings();

		const original: Building[] = this.model.data.buildings;

		const newBuildings: Building[] = this.combineBuildings(buildings, original);

		this.model.data.buildings = newBuildings;

		await this.model.writeBuildings();

		this.buildings_status.status = "completed";
		this.buildings_status.message = "Dataset processing complete";
	}

	public async startProcess(): Promise<void> {
		const parsedDocument: parse5.DefaultTreeAdapterTypes.Document | undefined = await this.extractIndex();

		// console.log("starting process\n");
		if (parsedDocument) {
			const table: ParseElement | undefined = this.findTable(parsedDocument);

			// console.log("table ", table, "\n");
			if (table !== undefined && table !== null) {
				await this.processTable(table);
			} else {
				this.setFailMessage("No building table found in index.htm");
			}
		}
	}

	private async processTable(table: ParseElement): Promise<void> {
		const emptyBuildings: Pair<Building, string>[] = await this.extractBuildings(table);
		// console.log("buildings: ", emptyBuildings);
		const buildings: Building[] = await this.extractRooms(emptyBuildings);
		// console.log("buildings with rooms: ", buildings);

		// console.log("uploading data");
		await this.uploadBuildingsData(buildings);
	}
}

type Pair<T1, T2> = {
	first: T1;
	second: T2;
};

type BuildingChangePair = Pair<Pair<Building, Pair<Room, boolean>[]>, boolean>;

class CoursesDataset extends Dataset {
	constructor(
		public id: number,
		private dir: JSZip,
		private datadir: string,
		private isValidZip: Boolean
	) {
		super(id);
	}

	public status: string = "processing";
	public files: number[] = [0, 0, 0]; // total, processed, skipped
	public courses: number[] = [0, 0, 0]; // seen, added, modified
	public sections: number[] = [0, 0, 0]; // seen, added, modified
	public message: string = "Processing in progress";
	private all_courses_map: Map<string, Pair<Pair<Course, Array<Pair<Section, Boolean>>>, Boolean>> = new Map<
		string,
		Pair<Pair<Course, Array<Pair<Section, Boolean>>>, Boolean>
	>();
	private all_courses_list: Array<string> = [];
	private title: string = "";
	private list_of_keys: Array<[string, string]> = [
		["id", "string"],
		["Course", "string"],
		["Title", "string"],
		["Professor", "string"],
		["Subject", "string"],
		["Section", "string"],
		["Year", "string"],
		["Avg", "number"],
		["Pass", "number"],
		["Fail", "number"],
		["Audit", "number"],
	];
	private fileCount = 0;

	public report(): Object {
		if (this.status === "completed") {
			return {
				id: String(this.id),
				status: this.status,
				kind: "course_offerings",
				stats: {
					files_total: this.files[0],
					files_processed: this.files[1],
					files_skipped: this.files[2],
					courses_seen: this.courses[0],
					courses_added: this.courses[1],
					courses_modified: this.courses[2],
					sections_seen: this.sections[0],
					sections_added: this.sections[1],
					sections_modified: this.sections[2],
				},
				message: this.message,
			};
		} else {
			return {
				id: String(this.id),
				status: this.status,
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
				message: this.message,
			};
		}
	}

	public async startProcess(): Promise<void> {
		// convert courses into a map, store all courseIds in a list
		const model = new Model(this.datadir);
		await model.readCourses();
		const rawCourses = model.data.courses;
		rawCourses.forEach((course: Course) => {
			const sectionPairs = course.sections.map((section) => {
				const newsection: Pair<Section, Boolean> = { first: section, second: true };
				return newsection;
			});

			const newCourse: Pair<Course, Array<Pair<Section, Boolean>>> = { first: course, second: sectionPairs };
			this.all_courses_map.set(course.id, { first: newCourse, second: true });
			this.all_courses_list.push(course.id);
		});

		if (!this.isValidZip) {
			this.status = "failed";
			this.message = "Data is not in a valid zip format";
			return;
		}

		const coursesExist = this.dir.folder(/courses/).length > 0;
		if (!coursesExist) {
			this.status = "failed";
			this.message = "Missing root courses directory";
			return;
		}

		const courses = this.dir.folder("courses");
		if (!courses) {
			return;
		}

		await Promise.all(
			Object.values(courses.files)
				.filter((file) => !file.dir && file.name.startsWith("courses/"))
				.map(async (file) => {
					try {
						await this.processFile(file);
					} catch {
						this.files[2]++; // skip file
					}
				})
		);

		this.courses[0] = this.courses[1] + this.courses[2];
		this.sections[0] = this.sections[1] + this.sections[2];

		const updatedCourses: Array<Course> = [];
		this.all_courses_list.map((courseId) => {
			if (this.all_courses_map.has(courseId)) {
				const pushCourse: Course | undefined = this.all_courses_map.get(courseId)?.first.first;
				if (pushCourse) {
					updatedCourses.push(pushCourse);
				}
			}
		});

		model.data.courses = updatedCourses;
		await model.writeCourses();

		this.status = "completed";
		this.message = "Dataset processing complete";
	}

	private async processFile(file: JSZip.JSZipObject): Promise<void> {
		this.files[0]++;

		const text = await file.async("string");
		const data = JSON.parse(text);

		if (!("result" in data) || !Array.isArray(data.result)) {
			this.files[2]++; // skipped
			return;
		}

		if (data.result.length === 0) {
			this.files[1]++;
			return;
		}

		for (const entry of data.result) {
			// Validate required fields exist
			const hasAllFields = this.list_of_keys.every((key) => key[0] in entry);
			if (!hasAllFields) {
				this.files[2]++;
				continue; // skip bad entries silently
			}

			// ---- Normalize values ----
			const courseId = `${entry.Subject}${entry.Course}`;
			const title = String(entry.Title);
			const dept = String(entry.Subject);
			const code = String(entry.Course);

			const year = entry.Section === "overall" ? OVERALL_SECTION_YEAR : Number(entry.Year);

			const avg = Number(entry.Avg);
			const pass = Number(entry.Pass);
			const fail = Number(entry.Fail);
			const audit = Number(entry.Audit);

			// ---- COURSE HANDLING ----
			let coursePair = this.all_courses_map.get(courseId);
			//const courseExisted = !!course;

			if (coursePair === undefined || coursePair === null) {
				const newCourse = new Course(courseId, title, dept, code);
				coursePair = { first: { first: newCourse, second: [] }, second: false };
				this.all_courses_map.set(courseId, coursePair);
				this.all_courses_list.push(courseId);
				this.courses[1]++; // courses_added
			} else {
				const course = coursePair.first.first;
				// Check if metadata changed
				const notChanged = course.title === title && course.dept === dept && course.code === code;

				if (!notChanged) {
					course.title = title;
					course.dept = dept;
					course.code = code;

					if (coursePair.second) {
						this.courses[2]++; // courses_modified
						coursePair.second = false;
					}
				}
			}

			// ---- SECTION HANDLING ----
			const course = coursePair.first;
			const existingSectionPair = course.second.find((section_pair) => section_pair.first.id === entry.id);

			if (existingSectionPair === undefined || existingSectionPair === null) {
				const newSection = new Section(
					String(entry.id),
					String(entry.Professor),
					year,
					avg,
					pass,
					fail,
					audit,
					course.first
				);
				course.second.push({ first: newSection, second: false });
				course.first.sections.push(newSection);
				this.sections[1]++; // sections_added
			} else {
				const section: Section = existingSectionPair.first;
				const sectionInCourse: Section | undefined = course.first.sections.find((sec) => section.id === sec.id);

				const changed =
					section.instructor !== String(entry.Professor) ||
					section.year !== year ||
					section.avg !== avg ||
					section.pass !== pass ||
					section.fail !== fail ||
					section.audit !== audit;

				if (changed && sectionInCourse !== undefined && sectionInCourse !== null) {
					section.instructor = String(entry.Professor);
					sectionInCourse.instructor = String(entry.Professor);
					section.year = year;
					sectionInCourse.year = year;
					section.avg = avg;
					sectionInCourse.avg = avg;
					section.pass = pass;
					sectionInCourse.pass = pass;
					section.fail = fail;
					sectionInCourse.fail = fail;
					section.audit = audit;
					sectionInCourse.audit = audit;

					if (existingSectionPair.second) {
						this.sections[2]++; // sections_modified
						existingSectionPair.second = false;
					}
				}
			}
		}

		this.files[1]++; // files_processed
	}
}

type RoomJSONLinks = {
	id: string;
	building: string;
	number: string;
	type: string;
	furniture: string;
	href: string;
	seats: number;
	links: { self: string; building: string };
};

type RoomJSONFull = {
	id: string;
	building: string;
	number: string;
	type: string;
	furniture: string;
	href: string;
	seats: number;
};

type BuildingJSONLinks = {
	id: string;
	name: string;
	address: string;
	lat: number;
	lon: number;
	campus?: string;
	links: { self: string; rooms: string };
};

type BuildingJSONFull = {
	id: string;
	name: string;
	address: string;
	lat: number;
	lon: number;
	campus?: string;
	rooms: RoomJSONFull[];
};

type BuildingJSONForDelete = {
	id: string;
	name: string;
	address: string;
	lat: number;
	lon: number;
	campus?: string;
	rooms: number;
};

class Building {
	constructor(
		public id: string,
		public name: string,
		public address: string,
		public lat: number,
		public lon: number,
		public campus?: string
	) {}

	public rooms: Room[] = [];

	public getJSONLinks(): BuildingJSONLinks {
		return {
			id: this.id,
			name: this.name,
			address: this.address,
			lat: this.lat,
			lon: this.lon,
			campus: this.campus,
			links: {
				self: `${prefixBuildings}/${this.id}`,
				rooms: `${prefixBuildings}/${this.id}/rooms`,
			},
		};
	}

	public getJSONFull(): BuildingJSONFull {
		return {
			id: this.id,
			name: this.name,
			address: this.address,
			lat: this.lat,
			lon: this.lon,
			campus: this.campus,
			rooms: this.rooms.map((room) => room.getJSONFull()),
		};
	}

	public getJSONForDelete(): BuildingJSONForDelete {
		return {
			id: this.id,
			name: this.name,
			address: this.address,
			lat: this.lat,
			lon: this.lon,
			campus: this.campus,
			rooms: this.rooms.length,
		};
	}

	public static buildBuilding(data: Building): Building {
		const newBuilding = new Building(data.id, data.name, data.address, data.lat, data.lon, data.campus);
		newBuilding.rooms = data.rooms.map((room: Room) => Room.buildRoom(room, newBuilding));
		return newBuilding;
	}

	public getRooms(): Room[] {
		return this.rooms;
	}

	public getRoomById(id: string): Room | undefined {
		return this.rooms.find((room) => room.id === id);
	}

	public setRoom(
		id: string,
		number: string,
		type: string,
		furniture: string,
		href: string,
		seats: number
	): { replace: boolean; body: RoomJSONLinks } {
		let exist = false;
		if (this.getRoomById(id)) {
			exist = true;
			this.deleteRoom(id);
		}
		const room = new Room(id, this.id, number, type, furniture, href, seats, this);
		this.rooms.push(room);
		return {
			replace: exist,
			body: room.getJSONLinks(),
		};
	}

	public deleteRoom(id: string): { success: boolean; body: RoomJSONFull | {} } {
		const index = this.rooms.findIndex((room) => room.id === id);
		if (index >= 0) {
			const body = this.rooms[index].getJSONFull();
			this.rooms.splice(index, 1);
			return {
				success: true,
				body: body,
			};
		} else {
			return {
				success: false,
				body: {},
			};
		}
	}
}

class Room implements Filterable {
	constructor(
		public id: string,
		public building: string,
		public number: string,
		public type: string,
		public furniture: string,
		public href: string,
		public seats: number,
		public building_obj: Building
	) {}

	public getJSONLinks(): RoomJSONLinks {
		return {
			id: this.id,
			building: this.building,
			number: this.number,
			type: this.type,
			furniture: this.furniture,
			href: this.href,
			seats: this.seats,
			links: {
				self: `${prefixBuildings}/${this.building}/rooms/${this.id}`,
				building: `${prefixBuildings}/${this.building}`,
			},
		};
	}

	public getJSONFull(): RoomJSONFull {
		return {
			id: this.id,
			building: this.building,
			number: this.number,
			type: this.type,
			furniture: this.furniture,
			href: this.href,
			seats: this.seats,
		};
	}

	public static buildRoom(data: Room, building: Building): Room {
		const { id, number, type, furniture, href, seats } = data;
		return new Room(id, data.building, number, type, furniture, href, seats, building);
	}

	public getIdentity(): string {
		return JSON.stringify(["room", this.building, this.id]);
	}

	public getValue(key: string): any {
		if (["name", "address", "lat", "lon", "campus"].includes(key)) return (this.building_obj.getJSONFull() as any)[key];
		else return (this.getJSONFull() as any)[key];
	}
}

function filterRecords<T extends Filterable>(
	query: any,
	records: T[],
	allowedFields: readonly string[]
): { error: string; list: T[] } {
	if (typeof query !== "object" || Object.keys(query).length > 1) {
		return {
			error: "not filter",
			list: [],
		};
	} else if (query.AND !== undefined && query.AND !== null) {
		if (
			!Array.isArray(query.AND) ||
			query.AND.length < 1 ||
			!query.AND.every((filter: any) => typeof filter === "object")
		) {
			return {
				error: "AND must be a non-empty array of FILTER objects",
				list: [],
			};
		}
		let newList = [...records];
		for (const filter of query.AND) {
			const filtered = filterRecords(filter, records, allowedFields);
			if (filtered.error) {
				if (filtered.error === "no filter" || filtered.error === "not filter") {
					return {
						error: "AND must be a non-empty array of FILTER objects",
						list: [],
					};
				} else return filtered;
			}
			newList = newList.filter((record) => filtered.list.some((other) => other.getIdentity() === record.getIdentity()));
		}
		return {
			error: "",
			list: [...newList],
		};
	} else if (query.OR !== undefined && query.OR !== null) {
		if (
			!Array.isArray(query.OR) ||
			query.OR.length < 1 ||
			!query.OR.every((filter: any) => typeof filter === "object")
		) {
			return {
				error: "OR must be a non-empty array of FILTER objects",
				list: [],
			};
		}
		let newList: T[] = [];
		for (const filter of query.OR) {
			const filtered = filterRecords(filter, records, allowedFields);
			if (filtered.error) {
				if (filtered.error === "no filter" || filtered.error === "not filter") {
					return {
						error: "OR must be a non-empty array of FILTER objects",
						list: [],
					};
				} else return filtered;
			}
			newList = [
				...newList,
				...filtered.list.filter((other) => newList.every((record) => record.getIdentity() !== other.getIdentity())),
			];
		}
		return {
			error: "",
			list: newList,
		};
	} else if (query.NOT !== undefined && query.NOT !== null) {
		if (typeof query.NOT !== "object") {
			return {
				error: "NOT must be a FILTER object",
				list: [],
			};
		}
		const filtered = filterRecords(query.NOT, records, allowedFields);
		if (filtered.error) {
			if (filtered.error === "no filter" || filtered.error === "not filter") {
				return {
					error: "NOT must be a FILTER object",
					list: [],
				};
			} else return filtered;
		}
		return {
			error: "",
			list: records.filter((record) => filtered.list.every((other) => other.getIdentity() !== record.getIdentity())),
		};
	} else if (query.LT !== undefined && query.LT !== null) {
		if (
			typeof query.LT !== "object" ||
			Object.keys(query.LT).length !== 1 ||
			typeof Object.values(query.LT)[0] !== "number"
		) {
			return {
				error: "LT must be an object with one mfield of type number",
				list: [],
			};
		}
		const mkey = Object.keys(query.LT)[0];
		const output = {
			error: "",
			list: [] as T[],
		};
		if (!MKEY.includes(mkey)) output.error = "LT must be an object with one mfield of type number";
		else if (!allowedFields.includes(mkey))
			output.error = "Cannot mix course_offerings and facilities fields in one query";
		else output.list = records.filter((record) => (record.getValue(mkey) as number) < query.LT[mkey]);
		return output;
	} else if (query.GT !== undefined && query.GT !== null) {
		if (
			typeof query.GT !== "object" ||
			Object.keys(query.GT).length !== 1 ||
			typeof Object.values(query.GT)[0] !== "number"
		) {
			return {
				error: "GT must be an object with one mfield of type number",
				list: [],
			};
		}
		const mkey = Object.keys(query.GT)[0];
		const output = {
			error: "",
			list: [] as T[],
		};
		if (!MKEY.includes(mkey)) output.error = "GT must be an object with one mfield of type number";
		else if (!allowedFields.includes(mkey))
			output.error = "Cannot mix course_offerings and facilities fields in one query";
		else output.list = records.filter((record) => (record.getValue(mkey) as number) > query.GT[mkey]);
		return output;
	} else if (query.EQ !== undefined && query.EQ !== null) {
		if (
			typeof query.EQ !== "object" ||
			Object.keys(query.EQ).length !== 1 ||
			typeof Object.values(query.EQ)[0] !== "number"
		) {
			return {
				error: "EQ must be an object with one mfield of type number",
				list: [],
			};
		}
		const mkey = Object.keys(query.EQ)[0];
		const output = {
			error: "",
			list: [] as T[],
		};
		if (!MKEY.includes(mkey)) output.error = "EQ must be an object with one mfield of type number";
		else if (!allowedFields.includes(mkey))
			output.error = "Cannot mix course_offerings and facilities fields in one query";
		else output.list = records.filter((record) => record.getValue(mkey) === query.EQ[mkey]);
		return output;
	} else if (Object.prototype.hasOwnProperty.call(query, "IN")) {
		const error = "IN must be an object with one sfield and a non-empty array of strings";
		const operand = query.IN;
		if (
			operand === null ||
			typeof operand !== "object" ||
			Array.isArray(operand) ||
			Object.keys(operand).length !== 1
		) {
			return { error, list: [] };
		}
		const key = Object.keys(operand)[0];
		const values = operand[key];
		if (
			!SKEY.includes(key) ||
			!Array.isArray(values) ||
			values.length === 0 ||
			!values.every((value) => typeof value === "string")
		) {
			return { error, list: [] };
		}
		if (!allowedFields.includes(key)) {
			return { error: "Cannot mix course_offerings and facilities fields in one query", list: [] };
		}
		return {
			error: "",
			list: records.filter((record) => {
				const value = record.getValue(key);
				return typeof value === "string" && values.includes(value);
			}),
		};
	} else if (query.IS !== undefined && query.IS !== null) {
		if (
			typeof query.IS !== "object" ||
			Object.keys(query.IS).length !== 1 ||
			typeof Object.values(query.IS)[0] !== "string"
		) {
			return {
				error: "IS must be an object with one sfield of type string",
				list: [],
			};
		}
		const skey = Object.keys(query.IS)[0];
		let str: string = String(Object.values(query.IS)[0]);
		let suffix = true; // str has to be at the end
		let prefix = true; // str has to be at the beginning
		if (str.slice(-1) === "*") {
			suffix = false;
			str = str.slice(0, -1);
		}
		if (str.charAt(0) === "*") {
			prefix = false;
			str = str.slice(1);
		}
		if (str.includes("*")) {
			return {
				error: "IS asterisks can only be first or last character",
				list: [],
			};
		}
		const output = {
			error: "",
			list: [] as T[],
		};
		if (!SKEY.includes(skey)) output.error = "IS must be an object with one sfield of type string";
		else if (!allowedFields.includes(skey))
			output.error = "Cannot mix course_offerings and facilities fields in one query";
		else
			output.list = records.filter((record) =>
				includeString(record.getValue(skey) as string | undefined, str, prefix, suffix)
			);
		return output;
	} else if (Object.keys(query).length > 0) {
		return {
			error: "not filter",
			list: [],
		};
	} else {
		return {
			error: "no filter",
			list: records,
		};
	}
}

function includeString(str1: string | undefined, str2: string, prefix: boolean, suffix: boolean): boolean {
	if (str1 === undefined) return false;
	let includes: boolean = str1.includes(str2);
	if (prefix) includes = includes && str1.slice(0, str2.length) === str2;
	if (suffix) includes = includes && str1.slice(-str2.length) === str2;
	return includes;
}

function ordering(a: any, b: any, fields: string[]): number {
	for (const field of fields) {
		let first = a[field];
		let second = b[field];
		let difference = 0;

		if (typeof first === "string" || typeof second === "string") {
			// Buildings without a campus are sorted like an empty string.
			if (first === undefined || first === null) {
				first = "";
			}
			if (second === undefined || second === null) {
				second = "";
			}
			difference = first.localeCompare(second);
		} else {
			if (first === undefined || first === null) {
				first = 0;
			}
			if (second === undefined || second === null) {
				second = 0;
			}
			difference = first - second;
		}

		if (difference !== 0) {
			return difference;
		}
	}
	return 0;
}

function transformList(list: Section[] | Room[], transformation: { GROUP: string[]; APPLY: any[] }): any[] {
	// A Map stores each group under a key made from its GROUP values.
	const groups = new Map<string, (Section | Room)[]>();
	for (const entry of list) {
		const groupValues = [];
		for (const field of transformation.GROUP) {
			groupValues.push(entry.getValue(field));
		}

		const groupKey = JSON.stringify(groupValues);
		const group = groups.get(groupKey);
		if (group === undefined) {
			groups.set(groupKey, [entry]);
		} else {
			group.push(entry);
		}
	}

	const results = [];
	for (const group of groups.values()) {
		const result: any = {};
		for (const field of transformation.GROUP) {
			result[field] = group[0].getValue(field);
		}

		for (const rule of transformation.APPLY) {
			const resultName = Object.keys(rule)[0];
			const operation = Object.keys(rule[resultName])[0];
			const field = rule[resultName][operation];
			let answer = 0;

			if (operation === "COUNT") {
				const uniqueValues: any[] = [];
				for (const entry of group) {
					const value = entry.getValue(field);
					if (!uniqueValues.includes(value)) {
						uniqueValues.push(value);
					}
				}
				answer = uniqueValues.length;
			} else if (operation === "MAX") {
				answer = group[0].getValue(field);
				for (const entry of group) {
					const value = entry.getValue(field);
					if (value > answer) {
						answer = value;
					}
				}
			} else if (operation === "MIN") {
				answer = group[0].getValue(field);
				for (const entry of group) {
					const value = entry.getValue(field);
					if (value < answer) {
						answer = value;
					}
				}
			} else if (operation === "SUM" || operation === "AVG") {
				let total = new Decimal(0);
				for (const entry of group) {
					total = total.plus(entry.getValue(field));
				}
				if (operation === "AVG") {
					total = total.dividedBy(group.length);
				}
				answer = Number(total.toFixed(2));
			}

			result[resultName] = answer;
		}
		results.push(result);
	}
	return results;
}

async function validateDatasetParams(
	body: any,
	file: any
): Promise<{ valid: boolean; fields: any; zip: JSZip; is_valid_zip: Boolean }> {
	let valid = true;
	let zip: JSZip = JSZip();
	const error: any = {};
	let isValidZip: Boolean = true;

	if (body.kind === undefined) {
		error.kind = "required but missing";
		valid = false;
	} else if (typeof body.kind !== "string" || body.kind !== "course_offerings") {
		error.kind = "expected to be course_offerings";
		valid = false;
	}
	if (file === undefined) {
		if (body.archive === undefined) {
			error.archive = "required but missing";
			valid = false;
		} else {
			error.archive = "expected non-empty file";
			valid = false;
		}
	} else {
		try {
			zip = await JSZip.loadAsync(file.buffer);
			if (!Object.values(zip.files).length) {
				error.archive = "expected non-empty file";
				valid = false;
			}
		} catch {
			isValidZip = false;
		}
	}
	return {
		valid: valid,
		fields: error,
		zip: zip,
		is_valid_zip: isValidZip,
	};
}

async function validateNewDatasetParams(
	body: any,
	file: any
): Promise<{ valid: boolean; file_type: String; fields: any; zip: JSZip; is_valid_zip: Boolean }> {
	let valid = true;
	let zip: JSZip = JSZip();
	const error: any = {};
	let isValidZip: Boolean = true;
	let fileType: String = "error";

	if (body.kind === undefined) {
		error.kind = "required but missing";
		valid = false;
	} else if (typeof body.kind !== "string" || !(body.kind === "course_offerings" || body.kind === "facilities")) {
		error.kind = "expected to be course_offerings or facilities";
		valid = false;
	}

	fileType = body.kind;

	if (file === undefined) {
		if (body.archive === undefined) {
			error.archive = "required but missing";
			valid = false;
		} else {
			error.archive = "expected non-empty file";
			valid = false;
		}
	} else if (!file.buffer || file.buffer.length === 0) {
		error.archive = "expected non-empty file";
		valid = false;
	} else {
		try {
			zip = await JSZip.loadAsync(file.buffer);
			if (!Object.values(zip.files).length) {
				error.archive = "expected non-empty file";
				valid = false;
			}
		} catch {
			isValidZip = false;
		}
	}
	return {
		valid: valid,
		file_type: fileType,
		fields: error,
		zip: zip,
		is_valid_zip: isValidZip,
	};
}

function validateSearchParamsV1(body: any): { valid: boolean; fields: any } {
	let valid = true;
	const error: any = {};
	if (body === undefined || body.kind === undefined) {
		error.kind = "required but missing";
		valid = false;
	} else if (typeof body.kind !== "string" || body.kind !== "course_offerings") {
		error.kind = "expected to be course_offerings";
		valid = false;
	}
	if (body === undefined || body.query === undefined) {
		error.query = "required but missing";
		valid = false;
	} else if (typeof body.query !== "object") {
		error.query = "expected an object";
		valid = false;
	}
	return {
		valid: valid,
		fields: error,
	};
}

function validateSearchParamsV2(body: any): { valid: boolean; fields: any } {
	let valid = true;
	const error: any = {};
	if (body === undefined || body.kind === undefined) {
		error.kind = "required but missing";
		valid = false;
	} else if (typeof body.kind !== "string" || !["course_offerings", "facilities"].includes(body.kind)) {
		error.kind = "expected to be course_offerings or facilities";
		valid = false;
	}
	if (body === undefined || body.query === undefined) {
		error.query = "required but missing";
		valid = false;
	} else if (typeof body.query !== "object" || body.query === null) {
		error.query = "expected an object";
		valid = false;
	}
	return {
		valid: valid,
		fields: error,
	};
}

function validateBuildingParams(
	name: any,
	address: any,
	lat: any,
	lon: any,
	campus?: any
): { valid: boolean; fields: any } {
	let valid = true;
	const error: any = {};
	if (campus !== undefined && typeof campus !== "string") {
		error.campus = "expected a string";
		valid = false;
	}
	if (name === undefined) {
		error.name = "required but missing";
		valid = false;
	} else if (typeof name !== "string") {
		error.name = "expected a string";
		valid = false;
	}
	if (address === undefined) {
		error.address = "required but missing";
		valid = false;
	} else if (typeof address !== "string") {
		error.address = "expected a string";
		valid = false;
	}
	if (lat === undefined) {
		error.lat = "required but missing";
		valid = false;
	} else if (typeof lat !== "number") {
		error.lat = "expected a number";
		valid = false;
	}
	if (lon === undefined) {
		error.lon = "required but missing";
		valid = false;
	} else if (typeof lon !== "number") {
		error.lon = "expected a number";
		valid = false;
	}
	return {
		valid: valid,
		fields: error,
	};
}

function validateRoomParams(params: any, buildingId: string): { valid: boolean; fields: any } {
	let valid = true;
	const error: any = {};
	if (params.building === undefined) {
		error.building = "required but missing";
		valid = false;
	} else if (typeof params.building !== "string") {
		error.building = "expected a string";
		valid = false;
	} else if (params.building !== buildingId) {
		error.building = "must match parent building in path";
		valid = false;
	}
	if (params.number === undefined) {
		error.number = "required but missing";
		valid = false;
	} else if (typeof params.number !== "string") {
		error.number = "expected a string";
		valid = false;
	}
	if (params.type === undefined) {
		error.type = "required but missing";
		valid = false;
	} else if (typeof params.type !== "string") {
		error.type = "expected a string";
		valid = false;
	}
	if (params.furniture === undefined) {
		error.furniture = "required but missing";
		valid = false;
	} else if (typeof params.furniture !== "string") {
		error.furniture = "expected a string";
		valid = false;
	}
	if (params.href === undefined) {
		error.href = "required but missing";
		valid = false;
	} else if (typeof params.href !== "string") {
		error.href = "expected a string";
		valid = false;
	}
	if (params.seats === undefined || params.seats === null) {
		error.seats = "required but missing";
		valid = false;
	} else if (typeof params.seats !== "number" || params.seats < 0 || !Number.isInteger(params.seats)) {
		error.seats = "expected a number >= 0";
		valid = false;
	}
	return {
		valid: valid,
		fields: error,
	};
}

function errorBadRequest(error_message: string): ApiOutput {
	return {
		status: 400,
		body: {
			error: "Invalid query",
			message: error_message,
		},
	};
}

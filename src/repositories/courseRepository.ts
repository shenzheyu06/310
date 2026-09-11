import fs from "fs/promises";
import { DataDirectory } from "./dataDirectory";

export class CoursesReader {
	public static async readCourses(): Promise<CourseJSONFull[]> {
		try {
			const read = JSON.parse(
				await fs.readFile(`${DataDirectory.getInstance().getDataDirectory()}/courses.json`, "utf-8")
			);
			if (!Array.isArray(read)) return [];
			else return read.filter((json) => TypeGuard.checkCourseJSON(json));
		} catch {
			return [];
		}
	}
}

export class CoursesWriter {
	public static async writeCourses(coursesJSON: CourseJSONFull[]): Promise<void> {
		const path = `${DataDirectory.getInstance().getDataDirectory()}/courses.json`;
		await fs.writeFile(path, JSON.stringify(coursesJSON));
	}
}

export type CourseJSONFull = {
	id: string;
	title: string;
	dept: string;
	code: string;
	sections: SectionJSONFull[];
};

export type SectionJSONFull = {
	id: string;
	instructor: string;
	year: number;
	avg: number;
	pass: number;
	fail: number;
	audit: number;
};

class TypeGuard {
	public static checkCourseJSON(json: any): boolean {
		return (
			typeof json === "object" &&
			json !== null &&
			typeof json.id === "string" &&
			typeof json.title === "string" &&
			typeof json.dept === "string" &&
			typeof json.code === "string" &&
			Array.isArray(json.sections) &&
			(json.sections as any[]).every((sectionJSON) => this.checkSectionJSON(sectionJSON))
		);
	}

	public static checkSectionJSON(json: any): boolean {
		return (
			typeof json === "object" &&
			json !== null &&
			typeof json.id === "string" &&
			typeof json.instructor === "string" &&
			typeof json.year === "number" &&
			typeof json.avg === "number" &&
			typeof json.pass === "number" &&
			typeof json.fail === "number" &&
			typeof json.audit === "number"
		);
	}
}

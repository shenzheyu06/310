import { SectionJSONFull } from "../repositories/courseRepository";
import { Course } from "./course";

export class Section {
	constructor(
		public id: string,
		public instructor: string,
		public year: number,
		public avg: number,
		public pass: number,
		public fail: number,
		public audit: number,
		public course: Course
	) {}

	public static async getSections(courseId: string): Promise<Section[] | undefined> {
		const course = await Course.getCourseById(courseId);
		return course === undefined ? undefined : course.getSections();
	}

	public static async getSectionById(courseId: string, sectionId: string): Promise<Section | SectionError> {
		const sections = await this.getSections(courseId);
		if (sections === undefined) return SectionError.COURSEDNE;

		const section: Section | undefined = sections.find((sec) => sec.id === sectionId);
		return section === undefined ? SectionError.SECTIONDNE : section;
	}

	public static async setSection(
		courseId: string,
		sectionId: string,
		params: any
	): Promise<Section | SectionError.COURSEDNE | undefined> {
		const courses = await Course.getCourses();
		const course = courses.find((c) => c.id === courseId);
		if (course === undefined) return SectionError.COURSEDNE;

		let sections = course.getSections();
		let exist = false;
		if (sections.find((section) => section.id === sectionId)) {
			exist = true;
			sections = sections.filter((section) => section.id !== sectionId);
		}

		const section = new Section(
			sectionId,
			params.instructor,
			params.year,
			params.avg,
			params.pass,
			params.fail,
			params.audit,
			course
		);
		sections.push(section);

		course.setSections(sections);
		await Course.writeCourses(courses);

		if (exist) {
			return undefined;
		} else {
			return section;
		}
	}

	public static async deleteSection(courseId: string, sectionId: string): Promise<Section | SectionError> {
		const courses = await Course.getCourses();
		const course = courses.find((c) => c.id === courseId);
		if (course === undefined || course === null) return SectionError.COURSEDNE;
		const sections = course.getSections();

		const index = sections.findIndex((section) => section.id === sectionId);
		if (index >= 0) {
			const body = sections[index];
			sections.splice(index, 1);
			await Course.writeCourses(courses);
			return body;
		} else {
			return SectionError.SECTIONDNE;
		}
	}

	public static buildSection(data: SectionJSONFull, course: Course): Section {
		return new Section(data.id, data.instructor, data.year, data.avg, data.pass, data.fail, data.audit, course);
	}

	public getJSONFull(): SectionJSONFull {
		return {
			id: this.id,
			instructor: this.instructor,
			year: this.year,
			avg: this.avg,
			pass: this.pass,
			fail: this.fail,
			audit: this.audit,
		};
	}

	public getValue(key: string): any {
		if (["title", "dept", "code"].includes(key)) return (this.course.getJSONFull() as any)[key];
		else return (this.getJSONFull() as any)[key];
	}
}

export enum SectionError {
	COURSEDNE = "course not found",
	SECTIONDNE = "section not found",
}

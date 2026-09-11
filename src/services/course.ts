import { CoursesReader, CoursesWriter, CourseJSONFull, SectionJSONFull } from "../repositories/courseRepository";
import { Section } from "./section";

export class Course {
	constructor(
		public id: string,
		public title: string,
		public dept: string,
		public code: string
	) {}

	public sections: Section[] = [];

	public static async getCourses(): Promise<Course[]> {
		return (await CoursesReader.readCourses()).map((course: CourseJSONFull) => Course.buildCourse(course));
	}

	public static async writeCourses(courses: Course[]): Promise<void> {
		await CoursesWriter.writeCourses(courses.map((course) => course.getJSONFull()));
	}

	public static buildCourse(data: CourseJSONFull): Course {
		const newCourse = new Course(data.id, data.title, data.dept, data.code);

		newCourse.sections = data.sections.map((section: SectionJSONFull) => Section.buildSection(section, newCourse));
		newCourse.sections.map((section) => {
			section.course = newCourse;
		});
		return newCourse;
	}

	public static async getCourseById(courseId: string): Promise<Course | undefined> {
		return (await this.getCourses()).find((course) => course.id === courseId);
	}

	public static async setCourse(courseId: string, title: any, dept: any, code: any): Promise<Course | undefined> {
		let courses = await this.getCourses();
		let exist = false;
		if (courses.find((course) => course.id === courseId)) {
			exist = true;
			courses = courses.filter((course) => course.id !== courseId);
		}
		const course = new Course(courseId, title, dept, code);
		courses.push(course);
		await this.writeCourses(courses);
		if (exist) {
			return undefined;
		} else {
			return course;
		}
	}

	public static async deleteCourse(courseId: string): Promise<Course | undefined> {
		const courses = await this.getCourses();
		const index = courses.findIndex((course) => course.id === courseId);
		if (index >= 0) {
			const body = courses[index];
			courses.splice(index, 1);
			await this.writeCourses(courses);
			return body;
		} else return undefined;
	}

	public getJSONFull(): CourseJSONFull {
		return {
			id: this.id,
			title: this.title,
			dept: this.dept,
			code: this.code,
			sections: this.sections.map((section) => section.getJSONFull()),
		};
	}

	public getSections(): Section[] {
		return this.sections;
	}

	public setSections(sections: Section[]): void {
		this.sections = sections;
	}
}

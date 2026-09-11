import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { validateGetParams, validateCourseParams, GetValidationObject } from "../validation/coursesValidation";
import { Course } from "../services/course";

type CourseJSON = {
	id: string;
	title: string;
	dept: string;
	code: string;
	links: {
		self: string;
		sections: string;
	};
};

type CourseJSONForDelete = {
	id: string;
	title: string;
	dept: string;
	code: string;
	sections: number;
};

function getJSONForDelete(course: Course): CourseJSONForDelete {
	return {
		id: course.id,
		title: course.title,
		dept: course.dept,
		code: course.code,
		sections: course.sections.length,
	};
}

function getCourseJSONFull(path: string, course: Course): CourseJSON {
	return {
		id: course.id,
		title: course.title,
		dept: course.dept,
		code: course.code,
		links: {
			self: `${path}/${course.id}`,
			sections: `${path}/${course.id}/sections`,
		},
	};
}

function getCoursesOutput(courses: Course[], coursesLimit: number, coursesOffset: number, path: string): CourseJSON[] {
	const coursesJSON: CourseJSON[] = courses.map((course) => getCourseJSONFull(path, course));

	if (coursesOffset > 0) coursesJSON.splice(0, coursesOffset);
	if (courses.length > coursesLimit) coursesJSON.splice(coursesLimit);

	return coursesJSON;
}

export async function getCourses(req: Request, res: Response): Promise<void> {
	const limit: number | undefined =
		req.query.limit !== undefined && req.query.limit !== null ? Number(req.query.limit) : 100;
	const offset: number | undefined =
		req.query.offset !== undefined && req.query.offset !== null ? Number(req.query.offset) : 0;

	const valid: GetValidationObject = validateGetParams(limit, offset);

	if (!valid.valid) {
		res.status(StatusCodes.BAD_REQUEST).json({
			error: "Invalid request parameters",
			params: valid.fields,
		});
	} else {
		const courses = await Course.getCourses();
		const output = getCoursesOutput(courses, limit, offset, req.path);

		res.status(StatusCodes.OK).json({
			total: courses.length,
			limit: limit,
			offset: offset,
			items: output,
		});
	}
}

export async function getCourse(req: Request, res: Response): Promise<void> {
	const course = await Course.getCourseById(req.params.courseId);

	// need a way to detect if no course found?? Thought I did already though.
	if (course === undefined || course === null) {
		res.status(StatusCodes.NOT_FOUND).json({
			error: "Not found",
			message: `no course with id '${req.params.courseId}'`,
		});
	} else {
		const courseJSON: CourseJSON = getCourseJSONFull(req.path.slice(0, -1 * (course.id.length + 1)), course);
		res.status(StatusCodes.OK).json(courseJSON);
	}
}

export async function putCourse(req: Request, res: Response): Promise<void> {
	const valid = validateCourseParams(req.body.title, req.body.dept, req.body.code);

	if (!valid.valid) {
		res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({
			error: "Validation failed",
			fields: valid.fields,
		});
	} else {
		const course = await Course.setCourse(req.params.courseId, req.body.title, req.body.dept, req.body.code);

		if (course === undefined || course === null) {
			res.status(StatusCodes.NO_CONTENT).send();
		} else {
			const courseJSON = getCourseJSONFull(req.path.slice(0, -1 * (course.id.length + 1)), course);
			res.status(StatusCodes.CREATED).json(courseJSON);
		}
	}
}
export async function deleteCourse(req: Request, res: Response): Promise<void> {
	const deletedCourse: Course | undefined = await Course.deleteCourse(req.params.courseId);

	if (deletedCourse === undefined || deletedCourse === null) {
		res.status(StatusCodes.NOT_FOUND).json({
			error: "Not found",
			message: `no course with id '${req.params.courseId}'`,
		});
	} else {
		const deletedCourseJSON: CourseJSONForDelete = getJSONForDelete(deletedCourse);
		res.status(StatusCodes.OK).json(deletedCourseJSON);
	}
}

import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import {
	validateGetParams,
	validateSectionParams,
	GetValidationObject,
	SectionValidationObject,
} from "../validation/coursesValidation";
import { Section, SectionError } from "../services/section";

const NOT_FOUND_SUFFIX_LENGTH = " not found".length;

type SectionJSON = {
	id: string;
	instructor: string;
	year: number;
	avg: number;
	pass: number;
	fail: number;
	audit: number;
	links: {
		self: string;
		course: string;
	};
};

type SectionJSONForDelete = {
	id: string;
	instructor: string;
	year: number;
	avg: number;
	pass: number;
	fail: number;
	audit: number;
};

function getJSONForDelete(section: Section): SectionJSONForDelete {
	return {
		id: section.id,
		instructor: section.instructor,
		year: section.year,
		avg: section.avg,
		pass: section.pass,
		fail: section.fail,
		audit: section.audit,
	};
}

export function getSectionJSONLink(courseLink: string, sectionId: string): string {
	return `${courseLink}/sections/${sectionId}`;
}

function getJSONFull(pathToSections: string, section: Section): SectionJSON {
	return {
		id: section.id,
		instructor: section.instructor,
		year: section.year,
		avg: section.avg,
		pass: section.pass,
		fail: section.fail,
		audit: section.audit,
		links: {
			self: `${pathToSections}/${section.id}`,
			course: `${pathToSections.replace("/sections", "")}`,
		},
	};
}

function getSectionsOutput(path: string, sections: Section[], limit: number, offset: number): SectionJSON[] {
	if (offset > 0) sections.splice(0, offset);
	if (sections.length > limit) sections.splice(limit);

	const sectionsJSON: SectionJSON[] = sections.map((section) => getJSONFull(path, section));

	return sectionsJSON;
}

export async function getSections(req: Request, res: Response): Promise<void> {
	const sections: Section[] | undefined = await Section.getSections(req.params.courseId);

	if (sections !== undefined && sections !== null) {
		const sectionsLength: number = sections.length;
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
			const output = getSectionsOutput(req.path, sections, limit, offset);

			res.status(StatusCodes.OK).json({
				total: sectionsLength,
				limit: limit,
				offset: offset,
				items: output,
			});
		}
	} else {
		res.status(StatusCodes.NOT_FOUND).json({
			error: "Not found",
			message: `no course with id '${req.params.courseId}'`,
		});
	}
}

export async function getSection(req: Request, res: Response): Promise<void> {
	const section: Section | string = await Section.getSectionById(req.params.courseId, req.params.sectionId);

	if (typeof section === "string") {
		const missingType: string = section.slice(0, -NOT_FOUND_SUFFIX_LENGTH);
		const missingId = missingType === "section" ? req.params.sectionId : req.params.courseId;
		res.status(StatusCodes.NOT_FOUND).json({
			error: "Not found",
			message: `no ${missingType} with id '${missingId}'`,
		});
	} else {
		const path = req.path.slice(0, -1 * (req.params.sectionId.length + 1));
		const sectionJSON: SectionJSON = getJSONFull(path, section);
		res.status(StatusCodes.OK).json(sectionJSON);
	}
}

export async function putSection(req: Request, res: Response): Promise<void> {
	const valid: SectionValidationObject = validateSectionParams(req.body);

	if (!valid.valid) {
		res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({
			error: "Validation failed",
			fields: valid.fields,
		});
	} else {
		const section: Section | SectionError.COURSEDNE | undefined = await Section.setSection(
			req.params.courseId,
			req.params.sectionId,
			req.body
		);

		if (section === undefined || section === null) {
			res.status(StatusCodes.NO_CONTENT).send();
		} else if (section === SectionError.COURSEDNE) {
			res.status(StatusCodes.NOT_FOUND).json({
				error: "Not found",
				message: `no course with id '${req.params.courseId}'`,
			});
		} else {
			const path = req.path.slice(0, -1 * (req.params.sectionId.length + 1));
			const sectionJSON: SectionJSON = getJSONFull(path, section);
			res.status(StatusCodes.CREATED).json(sectionJSON);
		}
	}
}

export async function deleteSection(req: Request, res: Response): Promise<void> {
	const courseId = req.params.courseId;
	const sectionId = req.params.sectionId;
	const deletedSection: Section | SectionError = await Section.deleteSection(courseId, sectionId);

	if (deletedSection === SectionError.COURSEDNE || deletedSection === SectionError.SECTIONDNE) {
		const missingId = deletedSection === SectionError.COURSEDNE ? courseId : sectionId;
		res.status(StatusCodes.NOT_FOUND).json({
			error: "Not found",
			message: `no ${deletedSection.slice(0, -NOT_FOUND_SUFFIX_LENGTH)} with id '${missingId}'`,
		});
	} else {
		const sectionJSON: SectionJSONForDelete = getJSONForDelete(deletedSection);
		res.status(StatusCodes.OK).json(sectionJSON);
	}
}

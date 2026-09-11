const MAX_LIMIT = 5000;
const MIN_YEAR = 1900;
const MAX_YEAR = 2099;

export type GetValidationObject = {
	valid: boolean;
	fields: {
		limit?: "expected an integer between 1 and 5000";
		offset?: "expected an integer >= 0";
	};
};

export type CourseValidationObject = {
	valid: boolean;
	fields: {
		title?: "required but missing" | "expected a string";
		dept?: "required but missing" | "expected a string";
		code?: "required but missing" | "expected a string";
	};
};

export type SectionValidationObject = {
	valid: boolean;
	fields: {
		instructor?: "required but missing" | "expected a string";
		year?: "required but missing" | "expected a number between 1900 and 2099";
		avg?: "required but missing" | "expected a number between 0 and 100";
		pass?: "required but missing" | "expected a number >= 0";
		fail?: "required but missing" | "expected a number >= 0";
		audit?: "required but missing" | "expected a number >= 0";
	};
};

export function validateGetParams(limit: number | undefined, offset: number | undefined): GetValidationObject {
	const validation: GetValidationObject = {
		valid: true,
		fields: {},
	};

	if (
		limit === undefined ||
		limit === null ||
		Number.isNaN(limit) ||
		!Number.isInteger(limit) ||
		limit < 1 ||
		limit > MAX_LIMIT
	) {
		validation.fields.limit = "expected an integer between 1 and 5000";
		validation.valid = false;
	}
	if (offset === undefined || offset === null || Number.isNaN(offset) || !Number.isInteger(offset) || offset < 0) {
		validation.fields.offset = "expected an integer >= 0";
		validation.valid = false;
	}
	return validation;
}

export function validateCourseParams(title: any, dept: any, code: any): CourseValidationObject {
	let valid = true;
	const error: CourseValidationObject["fields"] = {};
	if (title === undefined) {
		error.title = "required but missing";
		valid = false;
	} else if (typeof title !== "string") {
		error.title = "expected a string";
		valid = false;
	}
	if (dept === undefined) {
		error.dept = "required but missing";
		valid = false;
	} else if (typeof dept !== "string") {
		error.dept = "expected a string";
		valid = false;
	}
	if (code === undefined) {
		error.code = "required but missing";
		valid = false;
	} else if (typeof code !== "string") {
		error.code = "expected a string";
		valid = false;
	}
	return {
		valid: valid,
		fields: error,
	};
}

function validateInstructorAndYear(params: any, error: SectionValidationObject["fields"]): boolean {
	let valid = true;
	if (params.instructor === undefined) {
		error.instructor = "required but missing";
		valid = false;
	} else if (typeof params.instructor !== "string") {
		error.instructor = "expected a string";
		valid = false;
	}
	if (params.year === undefined || params.year === null) {
		error.year = "required but missing";
		valid = false;
	} else if (typeof params.year !== "number" || params.year < MIN_YEAR || params.year > MAX_YEAR) {
		error.year = "expected a number between 1900 and 2099";
		valid = false;
	}
	return valid;
}

function validateSectionCounts(params: any, error: SectionValidationObject["fields"]): boolean {
	let valid = true;
	if (params.avg === undefined || params.avg === null) {
		error.avg = "required but missing";
		valid = false;
	} else if (typeof params.avg !== "number" || params.avg < 0 || params.avg > 100) {
		error.avg = "expected a number between 0 and 100";
		valid = false;
	}
	if (params.pass === undefined || params.pass === null) {
		error.pass = "required but missing";
		valid = false;
	} else if (typeof params.pass !== "number" || params.pass < 0) {
		error.pass = "expected a number >= 0";
		valid = false;
	}
	if (params.fail === undefined || params.fail === null) {
		error.fail = "required but missing";
		valid = false;
	} else if (typeof params.fail !== "number" || params.fail < 0) {
		error.fail = "expected a number >= 0";
		valid = false;
	}
	if (params.audit === undefined || params.audit === null) {
		error.audit = "required but missing";
		valid = false;
	} else if (typeof params.audit !== "number" || params.audit < 0) {
		error.audit = "expected a number >= 0";
		valid = false;
	}
	return valid;
}

export function validateSectionParams(params: any): SectionValidationObject {
	const error: SectionValidationObject["fields"] = {};
	const instructorAndYearValid = validateInstructorAndYear(params, error);
	const countsValid = validateSectionCounts(params, error);
	return {
		valid: instructorAndYearValid && countsValid,
		fields: error,
	};
}

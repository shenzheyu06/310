import { Router } from "express";
import { getCourses, getCourse, putCourse, deleteCourse } from "../controllers/courseController";

const coursesRouter = Router();

coursesRouter.get("/api/v1/courses", getCourses);

coursesRouter.get("/api/v1/courses/:courseId", getCourse);

coursesRouter.put("/api/v1/courses/:courseId", putCourse);

coursesRouter.delete("/api/v1/courses/:courseId", deleteCourse);

export default coursesRouter;

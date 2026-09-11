import { Router } from "express";
import { getSections, getSection, putSection, deleteSection } from "../controllers/sectionController";

const sectionsRouter = Router();

sectionsRouter.get("/api/v1/courses/:courseId/sections", getSections);

sectionsRouter.get("/api/v1/courses/:courseId/sections/:sectionId", getSection);

sectionsRouter.put("/api/v1/courses/:courseId/sections/:sectionId", putSection);

sectionsRouter.delete("/api/v1/courses/:courseId/sections/:sectionId", deleteSection);

export default sectionsRouter;

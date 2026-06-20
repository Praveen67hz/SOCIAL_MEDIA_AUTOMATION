import express from "express";
import { getActivity } from "../controllers/activityController.js";
import { protect } from "../Middleware/authMiddleware.js";

const activityRouter = express.Router();


activityRouter.get('/', protect , getActivity)

export default activityRouter;
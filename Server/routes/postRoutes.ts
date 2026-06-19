import express from "express";
import { protect } from "../Middleware/authMiddleware.js";
import { generatePost, getGenerations, getPosts, schedulePost } from "../controllers/postController.js";
import { upload } from "../config/multer.js";
import { defaultMaxListeners } from "node:events";


const postRouter = express.Router();

postRouter.get('/',protect, getPosts)
postRouter.get('/generations',protect, getGenerations);
postRouter.post('/',protect, upload.single("media"), schedulePost);
postRouter.post('/generate',protect, generatePost);


export default postRouter;
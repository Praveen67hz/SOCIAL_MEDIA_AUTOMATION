import { Response } from "express";
import { GoogleGenAI } from "@google/genai";
import axios from "axios";
import { cloudinary } from "../config/cloudinary.js";
import { Generation } from "../models/generation.js";
import { Post } from "../models/post.js";
import { AuthRequest } from "../Middleware/authMiddleware.js";

// Generate post
// POST /api/posts/generate
export const generatePost = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { prompt, tone, generateImage } = req.body;

        // 1. Check Gemini API Key
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            res.status(400).json({ 
                message: "Gemini API Key is missing. Please add it to your server/.env file." 
            });
            return;
        }

        const ai = new GoogleGenAI({ apiKey });

        // 2. Generate Text with Gemini
        const textResponse = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `Generate a social media post based on this prompt: "${prompt}".
            Tone: ${tone}.
            Include relevant hashtags.
            Format the response as JSON with "content" and "imagePrompt" fields.
            The "imagePrompt" should be a highly descriptive prompt for an image generator that complements the post.`,
        });

        let content = "";
        let imagePrompt = prompt;

        try {
            const rawText = textResponse.text || "";
            const jsonMatch = rawText.match(/\{[\s\S]*\}/);
            const data = jsonMatch ? JSON.parse(jsonMatch[0]) : { content: rawText, imagePrompt: prompt };
            content = data.content;
            imagePrompt = data.imagePrompt;
        } catch (e) {
            content = textResponse.text || "";
        }

        let mediaUrl = "";
        let mediaType: "image" | "video" | undefined = undefined;

        // 3. Generate Image if toggle is ON (Hugging Face)
        if (generateImage) {
            try {
                const huggingFaceKey = process.env.HUGGINGFACE_API_KEY;
                if (!huggingFaceKey) {
                    console.warn("Hugging Face API Key is missing. Skipping image generation.");
                } else {
                    // Call Hugging Face API 
                    const hfResponse = await axios.post(
                        "https://api-inference.huggingface.co/models/runwayml/stable-diffusion-v1-5",
                        {
                            inputs: imagePrompt,
                            parameters: {
                                negative_prompt: "blurry, ugly, low quality, deformed",
                                num_inference_steps: 30,
                                guidance_scale: 7.5,
                            }
                        },
                        {
                            headers: {
                                Authorization: `Bearer ${huggingFaceKey}`,
                                "Content-Type": "application/json",
                            },
                            responseType: "arraybuffer",
                        }
                    );

                    // Convert image buffer to base64 for Cloudinary upload
                    const imageBuffer = Buffer.from(hfResponse.data);
                    const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;

                    // Upload to Cloudinary for persistence
                    const uploadResult = await cloudinary.uploader.upload(base64Image, {
                        folder: "ai-generations",
                        resource_type: "image",
                    });

                    mediaUrl = uploadResult.secure_url;
                    mediaType = "image";
                }
            } catch (err: any) {
                console.error("Image generation failed:", err?.response?.data || err.message);
                // Continue without image (don't fail the whole request)
            }
        }

        // 4. Save generation to DB
        const generation = await Generation.create({
            user: req.user._id,
            prompt,
            content,
            mediaUrl,
            mediaType: mediaUrl ? mediaType : undefined,
            tone: tone || "neutral",
        });

        res.status(201).json(generation);

    } catch (error: any) {
        console.error("Generate Post Error:", error);
        res.status(500).json({ message: error?.message || "Server error" });
    }
};

// Get generations
// GET /api/posts/generations
export const getGenerations = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const generations = await Generation.find({ user: req.user._id })
            .sort({ createdAt: -1 })
            .limit(20);
        res.json(generations);
    } catch (error: any) {
        res.status(500).json({ message: error?.message || "Server error" });
    }
};

// Get posts
// GET /api/posts
export const getPosts = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { status } = req.query;
        const filter: any = { user: req.user._id };
        if (status) filter.status = status;

        const posts = await Post.find(filter)
            .sort({ scheduledFor: 1 });
        res.json(posts);
    } catch (error: any) {
        res.status(500).json({ message: error?.message || "Server error" });
    }
};

// Schedule post
// POST /api/posts
export const schedulePost = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { content, platforms, scheduledFor, status } = req.body;

        // Parse platforms if it comes as a stringified array from FormData
        let parsedPlatforms = platforms;
        if (typeof platforms === "string") {
            try {
                parsedPlatforms = JSON.parse(platforms);
            } catch (e) {
                parsedPlatforms = platforms.split(",");
            }
        }

        let mediaUrl: string | undefined = req.body.mediaUrl;
        let mediaType: "image" | "video" | undefined = req.body.mediaType;

        // Handle file upload via Multer
        if (req.file) {
            const result = await new Promise<any>((resolve, reject) => {
                const stream = cloudinary.uploader.upload_stream(
                    { resource_type: "auto", folder: "social-scheduler" },
                    (error: any, result: any) => {
                        if (error) reject(error);
                        else resolve(result);
                    }
                );
                stream.end(req.file!.buffer);
            });
            mediaUrl = result.secure_url;
            mediaType = result.resource_type === "video" ? "video" : "image";
        }

        const post = await Post.create({
            user: req.user._id,
            content,
            platforms: parsedPlatforms,
            mediaUrl,
            mediaType,
            scheduledFor: new Date(scheduledFor),
            status: status || "scheduled",
        });

        res.status(201).json(post);

    } catch (error: any) {
        console.error("Schedule Post Error:", error);
        res.status(500).json({ message: error?.message || "Server error" });
    }
};
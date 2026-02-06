import type { APIRoute } from 'astro';
import fs from 'fs/promises';
import path from 'path';
import { resolveInRoot, resolveMetaPath } from '../../lib/server/paths';
import { parseJsonl, serializeJsonl } from '../../lib/server/jsonl';

type GenerateCaptionRequest = {
	videoPath: string;
	metaPath?: string;
	index: number;
};

export const POST: APIRoute = async ({ request }) => {
	try {
		const body = (await request.json()) as GenerateCaptionRequest;
		const videoPath = body.videoPath?.trim();
		if (!videoPath) {
			throw new Error('Missing videoPath');
		}

		const resolvedPath = resolveInRoot(videoPath);
		
		// Check if file exists
		await fs.access(resolvedPath);

		// Read video file as base64
		const videoBuffer = await fs.readFile(resolvedPath);
		const videoBase64 = videoBuffer.toString('base64');
		const mimeType = videoPath.endsWith('.webm') ? 'video/webm' : 'video/mp4';

		// Call Replicate API
		const replicateApiToken = import.meta.env.REPLICATE_API_TOKEN;
		if (!replicateApiToken) {
			throw new Error('REPLICATE_API_TOKEN not configured');
		}

		// Create prediction
		const createResponse = await fetch('https://api.replicate.com/v1/models/google/gemini-2.5-flash/predictions', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${replicateApiToken}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				input: {
					prompt: `Describe this video (include audio) overview. For example: An old man is feeding pigeons in a park. He's wearing a blue coat and a hat and looks very happy. A little girl in a red dress is playing nearby. The background is a sunny day with lush trees and birds singing. The old man says in a trembling voice, "Come on, have something to eat." Suddenly, a pigeon speaks, saying in a sharp voice, "You liar!" The old man is startled, takes a step back, raises his eyebrows in horror, and says, "Huh? You can talk?"`,
					videos: [`data:${mimeType};base64,${videoBase64}`],
				},
			}),
		});

		if (!createResponse.ok) {
			const errorData = await createResponse.json();
			throw new Error(`Replicate API error: ${JSON.stringify(errorData)}`);
		}

		// console.log("Created prediction, polling for result...", createResponse);

		const prediction = await createResponse.json();
		
		// Poll for completion
		let result = prediction;
		while (result.status !== 'succeeded' && result.status !== 'failed') {
			await new Promise(resolve => setTimeout(resolve, 2500));
			const pollResponse = await fetch(result.urls.get, {
				headers: {
					'Authorization': `Bearer ${replicateApiToken}`,
				},
			});
			result = await pollResponse.json();
		}

		if (result.status === 'failed') {
			throw new Error(`Prediction failed: ${result.error}`);
		}

		const caption = Array.isArray(result.output) ? result.output.join('') : result.output;

		console.log("Generated caption:", caption);

		// Save caption to dataset_meta.jsonl and dataset.jsonl
		const metaPath = resolveMetaPath(body.metaPath);
		const metaText = await fs.readFile(metaPath, 'utf-8');
		const metaEntries = parseJsonl<Record<string, unknown>>(metaText);

		if (body.index >= 0 && body.index < metaEntries.length) {
			// Update dataset_meta.jsonl
			metaEntries[body.index] = {
				...metaEntries[body.index],
				caption,
			};
			await fs.writeFile(metaPath, serializeJsonl(metaEntries), 'utf-8');

			// Update dataset.jsonl if entry exists
			const baseDir = path.dirname(metaPath);
			const datasetPath = path.join(baseDir, 'dataset.jsonl');
			try {
				const datasetText = await fs.readFile(datasetPath, 'utf-8');
				const datasetEntries = parseJsonl<Record<string, unknown>>(datasetText);
				const existingIndex = datasetEntries.findIndex(
					(e) => e.meta_index === body.index
				);
				if (existingIndex >= 0) {
					datasetEntries[existingIndex] = {
						...datasetEntries[existingIndex],
						caption,
						captionCaptureType: 'ai',
					};
					await fs.writeFile(datasetPath, serializeJsonl(datasetEntries), 'utf-8');
				}
			} catch {
				// dataset.jsonl doesn't exist yet, skip
			}
		}

		return new Response(
			JSON.stringify({ caption }),
			{ headers: { 'Content-Type': 'application/json' } }
		);
	} catch (error) {
		console.error("Error in generate-caption:", error);
		const message = error instanceof Error ? error.message : 'Unknown error';
		return new Response(JSON.stringify({ error: message }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};

import type { APIRoute } from 'astro';
import fs from 'fs/promises';
import { resolveInRoot } from '../../lib/server/paths';

type GenerateCaptionRequest = {
	videoPath: string;
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
					prompt: 'Describe this video in detail, includes what the characters in the video said and what are the background music and background noise like?',
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

		return new Response(
			JSON.stringify({ caption }),
			{ headers: { 'Content-Type': 'application/json' } }
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return new Response(JSON.stringify({ error: message }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};

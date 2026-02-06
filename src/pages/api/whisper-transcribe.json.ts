import type { APIRoute } from 'astro';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { resolveInRoot, resolveMetaPath } from '../../lib/server/paths';
import { parseJsonl, serializeJsonl } from '../../lib/server/jsonl';

const execFileAsync = promisify(execFile);

type WhisperTranscribeRequest = {
	videoPath: string;
	metaPath?: string;
	index: number;
};

export const POST: APIRoute = async ({ request }) => {
	try {
		const body = (await request.json()) as WhisperTranscribeRequest;
		const videoPath = body.videoPath?.trim();
		if (!videoPath) {
			throw new Error('Missing videoPath');
		}

		const resolvedPath = resolveInRoot(videoPath);
		
		// Check if file exists
		await fs.access(resolvedPath);

		// Extract audio from video using ffmpeg
		const tempAudioPath = resolvedPath.replace(/\.[^.]+$/, '_temp_audio.mp3');
		await execFileAsync('ffmpeg', [
			'-y',
			'-i', resolvedPath,
			'-vn',
			'-acodec', 'libmp3lame',
			'-q:a', '2',
			tempAudioPath,
		], { windowsHide: true });

		// Read audio file as base64
		const audioBuffer = await fs.readFile(tempAudioPath);
		const audioBase64 = audioBuffer.toString('base64');

		// Clean up temp audio file
		await fs.unlink(tempAudioPath);

		// Call Replicate Whisper API
		const replicateApiToken = import.meta.env.REPLICATE_API_TOKEN;
		if (!replicateApiToken) {
			throw new Error('REPLICATE_API_TOKEN not configured');
		}

		// Create prediction
		const createResponse = await fetch('https://api.replicate.com/v1/predictions', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${replicateApiToken}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				version: "openai/whisper:8099696689d249cf8b122d833c36ac3f75505c666a395ca40ef26f68e7d3d16e",
				input: {
					audio: `data:audio/mp3;base64,${audioBase64}`,
					language: "auto",
					translate: false,
					temperature: 0,
					transcription: "plain text",
					suppress_tokens: "-1",
					logprob_threshold: -1,
					no_speech_threshold: 0.6,
					condition_on_previous_text: true,
					compression_ratio_threshold: 2.4,
					temperature_increment_on_fallback: 0.2
				},
			}),
		});

		if (!createResponse.ok) {
			const errorData = await createResponse.json();
			throw new Error(`Replicate API error: ${JSON.stringify(errorData)}`);
		}

		const prediction = await createResponse.json();
		
		// Poll for completion
		let result = prediction;
		while (result.status !== 'succeeded' && result.status !== 'failed') {
			await new Promise(resolve => setTimeout(resolve, 2000));
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

		// Extract transcription text
		const transcription = result.output?.transcription || result.output?.text || 
			(typeof result.output === 'string' ? result.output : JSON.stringify(result.output));

		// Save speech to dataset_meta.jsonl and dataset.jsonl
		if (typeof body.index === 'number') {
			const metaPath = resolveMetaPath(body.metaPath);
			const metaText = await fs.readFile(metaPath, 'utf-8');
			const metaEntries = parseJsonl<Record<string, unknown>>(metaText);

			if (body.index >= 0 && body.index < metaEntries.length) {
				// Update dataset_meta.jsonl
				metaEntries[body.index] = {
					...metaEntries[body.index],
					speech: transcription,
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
							speech: transcription,
						};
						await fs.writeFile(datasetPath, serializeJsonl(datasetEntries), 'utf-8');
					}
				} catch {
					// dataset.jsonl doesn't exist yet, skip
				}
			}
		}

		return new Response(
			JSON.stringify({ transcription }),
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

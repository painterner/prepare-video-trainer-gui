import type { APIRoute } from 'astro';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { parseJsonl, serializeJsonl } from '../../lib/server/jsonl';
import { resolveInRoot } from '../../lib/server/paths';

const execFileAsync = promisify(execFile);

type DatasetEntry = {
	meta_index?: number;
	reference_audio_column?: string;
	reference_waveform_image_column?: string;
	[Key: string]: unknown;
};

export const POST: APIRoute = async ({ request }) => {
	try {
		const body = await request.json();
		const { index } = body;

		const baseDir = process.env.LTX_ROOT || '../data';
		const datasetPath = path.join(baseDir, 'dataset.jsonl');
		console.log("batch waveform path", datasetPath)

		// Read dataset.jsonl
		let entries: DatasetEntry[] = [];
		try {
			const datasetText = await fs.readFile(datasetPath, 'utf-8');
			entries = parseJsonl<DatasetEntry>(datasetText);
		} catch {
			return new Response(JSON.stringify({ error: 'dataset.jsonl not found' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// Find the entry by meta_index
		const entryIndex = entries.findIndex((e) => e.meta_index === index);
		if (entryIndex === -1) {
			return new Response(JSON.stringify({ error: `Entry with meta_index ${index} not found` }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		const entry = entries[entryIndex];
		if (!entry.reference_audio_column) {
			return new Response(JSON.stringify({ error: 'No reference audio for this entry', skipped: true }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// Skip if already has waveform
		if (entry.reference_waveform_image_column) {
			const existingPath = path.join(baseDir, entry.reference_waveform_image_column);
			try {
				await fs.access(existingPath);
				return new Response(JSON.stringify({ success: true, skipped: true, path: entry.reference_waveform_image_column }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});
			} catch {
				// File doesn't exist, regenerate
			}
		}

		const audioPath = path.join(baseDir, entry.reference_audio_column);
		const audioStem = path.basename(audioPath, path.extname(audioPath));

		// Create waveform directory
		const waveformDir = path.join(baseDir, 'dataset_processed', 'waveform');
		await fs.mkdir(waveformDir, { recursive: true });

		// Generate waveform using Python script
		const scriptPath = path.join('scripts', 'test_audio_to_image.py');
		const waveformImagePath = path.join(waveformDir, `${audioStem}_waveform.png`);
		console.log(`Generating waveform for audio: ${audioPath}, output: ${waveformImagePath}`);

		try {
			await execFileAsync('python3', [scriptPath, audioPath, '--size', '512', '--sr', '16000'], { windowsHide: true });

			// Move the generated waveform to the correct location
			const audioDir = path.dirname(audioPath);
			const generatedWaveform = path.join(audioDir, `${audioStem}_waveform.png`);
			try {
				await fs.rename(generatedWaveform, waveformImagePath);
			} catch {
				// Try alternative naming pattern
				const altGeneratedWaveform = path.join(audioDir, `${audioStem}_ref_waveform.png`);
				try {
					await fs.rename(altGeneratedWaveform, waveformImagePath);
				} catch {
					// File might already be in place or not exist
				}
			}
		} catch (waveformError) {
			console.error('Waveform generation failed:', waveformError);
			return new Response(JSON.stringify({ error: 'Waveform generation failed' }), {
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// Update dataset.jsonl with waveform path
		const relativePath = path.relative(baseDir, waveformImagePath);
		entries[entryIndex].reference_waveform_image_column = relativePath;
		await fs.writeFile(datasetPath, serializeJsonl(entries), 'utf-8');

		console.log(`Generated waveform for meta_index ${index}: ${relativePath}`);

		return new Response(JSON.stringify({ success: true, path: relativePath }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error: any) {
		console.error('Batch waveform error:', error);
		return new Response(JSON.stringify({ error: error.message || 'Unknown error' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};

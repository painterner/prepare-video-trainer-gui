import type { APIRoute } from 'astro';
import fs from 'fs/promises';
import path from 'path';
import { parseJsonl, serializeJsonl } from '../../lib/server/jsonl';
import { resolveMetaPath, ALLOWED_ROOT } from '../../lib/server/paths';

type CaptionRequest = {
	metaPath?: string;
	index: number;
	caption: string;
	speech?: string;
};

type MetaEntry = {
	media_path?: string;
	caption?: string;
	speech?: string;
	[key: string]: unknown;
};

export const POST: APIRoute = async ({ request }) => {
	try {
		const body = (await request.json()) as CaptionRequest;
		const metaPath = resolveMetaPath(body.metaPath);
		const metaText = await fs.readFile(metaPath, 'utf-8');
		const metaEntries = parseJsonl<MetaEntry>(metaText);

		if (body.index < 0 || body.index >= metaEntries.length) {
			throw new Error('Index out of range');
		}

		// Update caption and speech in dataset_meta.jsonl
		metaEntries[body.index] = {
			...metaEntries[body.index],
			caption: body.caption,
			speech: body.speech,
		};
		await fs.writeFile(metaPath, serializeJsonl(metaEntries), 'utf-8');

		// Also update dataset.jsonl if entry exists
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
					caption: body.caption,
					speech: body.speech,
					captionCaptureType: 'manual',
				};
				await fs.writeFile(datasetPath, serializeJsonl(datasetEntries), 'utf-8');
			}
		} catch {
			// dataset.jsonl doesn't exist yet, skip
		}

		return new Response(
			JSON.stringify({ success: true }),
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

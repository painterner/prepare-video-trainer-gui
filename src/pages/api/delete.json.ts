import type { APIRoute } from 'astro';
import fs from 'fs/promises';
import path from 'path';
import { parseJsonl, serializeJsonl } from '../../lib/server/jsonl';
import { resolveMetaPath } from '../../lib/server/paths';

type DeleteRequest = {
	metaPath?: string;
	index: number;
};

type MetaEntry = {
	media_path?: string;
	caption?: string;
	[key: string]: unknown;
};

export const POST: APIRoute = async ({ request }) => {
	try {
		const body = (await request.json()) as DeleteRequest;
		const metaPath = resolveMetaPath(body.metaPath);
		const metaText = await fs.readFile(metaPath, 'utf-8');
		const metaEntries = parseJsonl<MetaEntry>(metaText);

		if (body.index < 0 || body.index >= metaEntries.length) {
			throw new Error('Index out of range');
		}

		// Remove entry from dataset_meta.jsonl
		metaEntries.splice(body.index, 1);
		await fs.writeFile(metaPath, serializeJsonl(metaEntries), 'utf-8');

		// Also remove from dataset.jsonl if entry exists
		const baseDir = path.dirname(metaPath);
		const datasetPath = path.join(baseDir, 'dataset.jsonl');
		try {
			const datasetText = await fs.readFile(datasetPath, 'utf-8');
			const datasetEntries = parseJsonl<Record<string, unknown>>(datasetText);
			// Remove entry with matching meta_index
			const filteredEntries = datasetEntries.filter(
				(e) => e.meta_index !== body.index
			);
			// Update meta_index for entries after the deleted one
			const updatedEntries = filteredEntries.map((e) => {
				if (typeof e.meta_index === 'number' && e.meta_index > body.index) {
					return { ...e, meta_index: e.meta_index - 1 };
				}
				return e;
			});
			await fs.writeFile(datasetPath, serializeJsonl(updatedEntries), 'utf-8');
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

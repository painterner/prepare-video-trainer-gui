import type { APIRoute } from 'astro';
import fs from 'fs/promises';
import path from 'path';
import { parseJsonl, serializeJsonl } from '../../lib/server/jsonl';
import { resolveMetaPath } from '../../lib/server/paths';

type CopyRequest = {
	metaPath?: string;
	index: number;
};

type MetaEntry = {
	media_path?: string;
	caption?: string;
	source_url?: string;
	processed?: boolean;
	copied_from?: number;
	[key: string]: unknown;
};

export const POST: APIRoute = async ({ request }) => {
	try {
		const body = (await request.json()) as CopyRequest;
		const metaPath = resolveMetaPath(body.metaPath);
		const metaText = await fs.readFile(metaPath, 'utf-8');
		const metaEntries = parseJsonl<MetaEntry>(metaText);

		if (body.index < 0 || body.index >= metaEntries.length) {
			throw new Error('Index out of range');
		}

		const originalEntry = metaEntries[body.index];

		// Create new entry with copied_from reference
		const newEntry: MetaEntry = {
			media_path: originalEntry.media_path,
			caption: originalEntry.caption || '',
			source_url: originalEntry.source_url,
			processed: false,
			copied_from: body.index,
		};

		// Insert after the original entry
		const newIndex = body.index + 1;
		metaEntries.splice(newIndex, 0, newEntry);
		await fs.writeFile(metaPath, serializeJsonl(metaEntries), 'utf-8');

		// Update meta_index in dataset.jsonl for entries after the insertion point
		const baseDir = path.dirname(metaPath);
		const datasetPath = path.join(baseDir, 'dataset.jsonl');
		try {
			const datasetText = await fs.readFile(datasetPath, 'utf-8');
			const datasetEntries = parseJsonl<Record<string, unknown>>(datasetText);
			const updatedEntries = datasetEntries.map((e) => {
				if (typeof e.meta_index === 'number' && e.meta_index >= newIndex) {
					return { ...e, meta_index: e.meta_index + 1 };
				}
				return e;
			});
			await fs.writeFile(datasetPath, serializeJsonl(updatedEntries), 'utf-8');
		} catch {
			// dataset.jsonl doesn't exist yet, skip
		}

		return new Response(
			JSON.stringify({ success: true, newIndex }),
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

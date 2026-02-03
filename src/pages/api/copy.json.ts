import type { APIRoute } from 'astro';
import fs from 'fs/promises';
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

		// Append to the end of dataset_meta.jsonl
		metaEntries.push(newEntry);
		await fs.writeFile(metaPath, serializeJsonl(metaEntries), 'utf-8');

		const newIndex = metaEntries.length - 1;

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

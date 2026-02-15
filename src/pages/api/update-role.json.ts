import type { APIRoute } from 'astro';
import fs from 'fs/promises';
import path from 'path';
import { parseJsonl, serializeJsonl } from '../../lib/server/jsonl';
import { resolveMetaPath } from '../../lib/server/paths';

type UpdateRoleRequest = {
	metaPath: string;
	index: number;
	role: string;
};

type DatasetEntry = {
	meta_index?: number;
	role?: string;
	[key: string]: unknown;
};

export const POST: APIRoute = async ({ request }) => {
	try {
		const body = (await request.json()) as UpdateRoleRequest;
		const metaPath = resolveMetaPath(body.metaPath);
		const baseDir = path.dirname(metaPath);
		const datasetPath = path.join(baseDir, 'dataset.jsonl');

		// Load existing dataset.jsonl
		let entries: DatasetEntry[] = [];
		try {
			const text = await fs.readFile(datasetPath, 'utf-8');
			entries = parseJsonl<DatasetEntry>(text);
		} catch {
			return new Response(
				JSON.stringify({ error: 'dataset.jsonl not found' }),
				{ status: 400, headers: { 'Content-Type': 'application/json' } }
			);
		}

		// Find entry with matching meta_index
		const entryIndex = entries.findIndex((e) => e.meta_index === body.index);
		if (entryIndex < 0) {
			return new Response(
				JSON.stringify({ error: `No entry found with meta_index ${body.index}` }),
				{ status: 400, headers: { 'Content-Type': 'application/json' } }
			);
		}

		// Update role
		entries[entryIndex] = {
			...entries[entryIndex],
			role: body.role || undefined,
		};

		// Write back
		await fs.writeFile(datasetPath, serializeJsonl(entries), 'utf-8');

		return new Response(
			JSON.stringify({ success: true, role: body.role }),
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

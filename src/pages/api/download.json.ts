import type { APIRoute } from 'astro';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { parseJsonl, serializeJsonl } from '../../lib/server/jsonl';
import { ALLOWED_ROOT } from '../../lib/server/paths';

const execFileAsync = promisify(execFile);

type DownloadRequest = {
	url: string;
};

type DatasetEntry = {
	media_path: string;
	caption: string;
	[key: string]: unknown;
};

export const POST: APIRoute = async ({ request }) => {
	try {
		const body = (await request.json()) as DownloadRequest;
		const url = body.url?.trim();
		if (!url) {
			throw new Error('Missing URL');
		}

		const downloadDir = path.join(ALLOWED_ROOT, 'data', 'downloads');
		await fs.mkdir(downloadDir, { recursive: true });

		// Use yt-dlp to download video
		const outputTemplate = path.join(downloadDir, '%(title)s.%(ext)s');
		const { stdout } = await execFileAsync('yt-dlp', [
			'--print', 'filename',
			'-o', outputTemplate,
			'--no-playlist',
			url,
		], { windowsHide: true });

		const expectedPath = stdout.trim();
		const filename = path.basename(expectedPath);

		// Download the actual file
		await execFileAsync('yt-dlp', [
			'-o', outputTemplate,
			'--no-playlist',
			url,
		], { windowsHide: true });

		// Add to dataset.jsonl
		const datasetPath = path.join(ALLOWED_ROOT, 'data', 'dataset.jsonl');
		let entries: DatasetEntry[] = [];
		try {
			const text = await fs.readFile(datasetPath, 'utf-8');
			entries = parseJsonl<DatasetEntry>(text);
		} catch {
			// File doesn't exist yet
		}

		const relativePath = path.relative(path.join(ALLOWED_ROOT, 'data'), expectedPath);
		const newEntry: DatasetEntry = {
			media_path: relativePath,
			caption: '',
		};

		entries.push(newEntry);
		await fs.writeFile(datasetPath, serializeJsonl(entries), 'utf-8');

		return new Response(
			JSON.stringify({
				filename,
				path: relativePath,
				datasetPath,
			}),
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

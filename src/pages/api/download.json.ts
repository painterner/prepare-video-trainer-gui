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

const YTDLP_HOSTS = [
	'youtube.com', 'youtu.be', 'bilibili.com', 'b23.tv',
	'twitter.com', 'x.com', 'tiktok.com', 'vimeo.com',
];

function isYtdlpUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return YTDLP_HOSTS.some(host => parsed.hostname.endsWith(host));
	} catch {
		return false;
	}
}

async function downloadWithYtdlp(url: string, downloadDir: string): Promise<string> {
	const outputTemplate = path.join(downloadDir, '%(title)s.%(ext)s');
	const { stdout } = await execFileAsync('yt-dlp', [
		'--print', 'filename',
		'-o', outputTemplate,
		'--no-playlist',
		url,
	], { windowsHide: true });

	const expectedPath = stdout.trim();

	await execFileAsync('yt-dlp', [
		'-o', outputTemplate,
		'--no-playlist',
		url,
	], { windowsHide: true });

	return expectedPath;
}

async function downloadWithFetch(url: string, downloadDir: string): Promise<string> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
	}

	const parsed = new URL(url);
	let filename = path.basename(parsed.pathname) || 'download';
	if (!path.extname(filename)) {
		const contentType = response.headers.get('content-type') || '';
		if (contentType.includes('video/mp4')) filename += '.mp4';
		else if (contentType.includes('video/webm')) filename += '.webm';
		else if (contentType.includes('audio/mpeg')) filename += '.mp3';
		else filename += '.bin';
	}

	const filePath = path.join(downloadDir, filename);
	const buffer = Buffer.from(await response.arrayBuffer());
	await fs.writeFile(filePath, buffer);

	return filePath;
}

export const POST: APIRoute = async ({ request }) => {
	try {
		const body = (await request.json()) as DownloadRequest;
		const url = body.url?.trim();
		if (!url) {
			throw new Error('Missing URL');
		}

		const downloadDir = path.join(ALLOWED_ROOT, 'data', 'downloads');
		await fs.mkdir(downloadDir, { recursive: true });

		const filePath = isYtdlpUrl(url)
			? await downloadWithYtdlp(url, downloadDir)
			: await downloadWithFetch(url, downloadDir);

		const filename = path.basename(filePath);

		// Add to dataset.jsonl
		const datasetPath = path.join(ALLOWED_ROOT, 'data', 'dataset_meta.jsonl');
		let entries: DatasetEntry[] = [];
		try {
			const text = await fs.readFile(datasetPath, 'utf-8');
			entries = parseJsonl<DatasetEntry>(text);
		} catch {
			// File doesn't exist yet
		}

		const relativePath = path.relative(path.join(ALLOWED_ROOT, 'data'), filePath);
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

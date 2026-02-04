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
	startTime?: string;
	endTime?: string;
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

// Parse time string like "1:30" or "90" to seconds
function parseTimeToSeconds(time: string): number {
	const parts = time.split(':').map(Number);
	if (parts.length === 1) return parts[0];
	if (parts.length === 2) return parts[0] * 60 + parts[1];
	if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
	return 0;
}

async function downloadWithYtdlp(url: string, downloadDir: string, startTime?: string, endTime?: string): Promise<string> {
	const outputTemplate = path.join(downloadDir, '%(title)s.%(ext)s');
	
	const baseArgs = [
		'--print', 'filename',
		'-o', outputTemplate,
		'--no-playlist',
	];
	
	// Add time range if specified
	if (startTime || endTime) {
		const start = startTime || '0';
		const end = endTime || 'inf';
		baseArgs.push('--download-sections', `*${start}-${end}`);
	}
	
	const { stdout } = await execFileAsync('python3', ['scripts/yt-dlp.py', ...baseArgs, url], { windowsHide: true });
	const expectedPath = stdout.trim();

	const downloadArgs = [
		'-o', outputTemplate,
		'--no-playlist',
	];
	if (startTime || endTime) {
		const start = startTime || '0';
		const end = endTime || 'inf';
		downloadArgs.push('--download-sections', `*${start}-${end}`);
	}
	
	await execFileAsync('python3', ['scripts/yt-dlp.py', ...downloadArgs, url], { windowsHide: true });

	return expectedPath;
}

async function downloadWithFetch(url: string, downloadDir: string, startTime?: string, endTime?: string): Promise<string> {
	const refer: Record<string, string> = {};
	if(url.includes('https://v3-web.douyinvod.com/')){
		refer['Referer'] = 'https://www.douyin.com/';
	}
	const response = await fetch(url, { headers: refer });
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

	// If time range specified, use ffmpeg to trim
	if (startTime || endTime) {
		const startSec = startTime ? parseTimeToSeconds(startTime) : 0;
		const endSec = endTime ? parseTimeToSeconds(endTime) : undefined;
		
		const trimmedFilename = filename.replace(/(\.[^.]+)$/, '_trimmed$1');
		const trimmedPath = path.join(downloadDir, trimmedFilename);
		
		const ffmpegArgs = ['-y', '-i', filePath];
		if (startSec > 0) {
			ffmpegArgs.push('-ss', `${startSec}`);
		}
		if (endSec !== undefined) {
			ffmpegArgs.push('-to', `${endSec}`);
		}
		ffmpegArgs.push('-c', 'copy', trimmedPath);
		
		await execFileAsync('ffmpeg', ffmpegArgs, { windowsHide: true });
		
		// Remove original and return trimmed path
		await fs.unlink(filePath);
		return trimmedPath;
	}

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

		const isytdlp = isYtdlpUrl(url);
		const downloadMethod = isytdlp ? 'yt-dlp' : 'fetch';
		console.log(`Downloading using method: ${downloadMethod}, startTime: ${body.startTime}, endTime: ${body.endTime}`);
		const filePath = isytdlp
			? await downloadWithYtdlp(url, downloadDir, body.startTime, body.endTime)
			: await downloadWithFetch(url, downloadDir, body.startTime, body.endTime);

		const filename = path.basename(filePath);

		// Add to dataset_meta.jsonl
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
			source_url: url,
			download_range: (body.startTime || body.endTime) ? { start: body.startTime || '0', end: body.endTime || 'end' } : undefined,
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

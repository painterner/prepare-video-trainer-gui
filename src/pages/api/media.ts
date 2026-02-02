import type { APIRoute } from 'astro';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import { resolveInRoot } from '../../lib/server/paths';

const MIME_BY_EXT: Record<string, string> = {
	'.mp4': 'video/mp4',
	'.mov': 'video/quicktime',
	'.webm': 'video/webm',
	'.mkv': 'video/x-matroska',
	'.mp3': 'audio/mpeg',
	'.wav': 'audio/wav',
	'.m4a': 'audio/mp4',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
};

export const GET: APIRoute = async ({ request, url }) => {
	try {
		const inputPath = url.searchParams.get('path');
		if (!inputPath) {
			return new Response('Missing path', { status: 400 });
		}
		const filePath = resolveInRoot(inputPath);
		const stat = await fs.stat(filePath);
		const range = request.headers.get('range');
		const ext = path.extname(filePath).toLowerCase();
		const contentType = MIME_BY_EXT[ext] ?? 'application/octet-stream';

		if (range) {
			const match = /bytes=(\d+)-(\d*)/.exec(range);
			if (!match) {
				return new Response('Invalid range', { status: 416 });
			}
			const start = Number.parseInt(match[1], 10);
			const end = match[2] ? Number.parseInt(match[2], 10) : stat.size - 1;
			const chunkSize = end - start + 1;
			const stream = createReadStream(filePath, { start, end });
			return new Response(stream as unknown as BodyInit, {
				status: 206,
				headers: {
					'Content-Range': `bytes ${start}-${end}/${stat.size}`,
					'Accept-Ranges': 'bytes',
					'Content-Length': `${chunkSize}`,
					'Content-Type': contentType,
				},
			});
		}

		const stream = createReadStream(filePath);
		return new Response(stream as unknown as BodyInit, {
			status: 200,
			headers: {
				'Content-Length': `${stat.size}`,
				'Content-Type': contentType,
			},
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return new Response(message, { status: 400 });
	}
};

import type { APIRoute } from 'astro';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { parseJsonl, serializeJsonl } from '../../lib/server/jsonl';
import { resolveMediaPath, resolveMetaPath, resolveInRoot } from '../../lib/server/paths';

const execFileAsync = promisify(execFile);

type MetaEntry = {
	media_path?: string;
	caption?: string;
	[Key: string]: unknown;
};

type TrimRequest = {
	metaPath?: string;
	index: number;
	refStart: number;
	refEnd: number;
	videoStart?: number;
	videoEnd?: number;
	outputDir?: string;
};

function toNumber(value: unknown): number {
	if (typeof value === 'number') {
		return value;
	}
	if (typeof value === 'string' && value.trim()) {
		return Number.parseFloat(value);
	}
	return Number.NaN;
}

async function runFfmpeg(args: string[]): Promise<void> {
	await execFileAsync('ffmpeg', args, { windowsHide: true });
}

export const POST: APIRoute = async ({ request }) => {
	try {
		const body = (await request.json()) as TrimRequest;
		const metaPath = resolveMetaPath(body.metaPath);
		const metaText = await fs.readFile(metaPath, 'utf-8');
		const metaEntries = parseJsonl<MetaEntry>(metaText);
		if (body.index < 0 || body.index >= metaEntries.length) {
			throw new Error('Index out of range for dataset_meta.jsonl');
		}

		const entry = metaEntries[body.index];
		if (!entry.media_path || typeof entry.media_path !== 'string') {
			throw new Error('Missing media_path in dataset_meta entry');
		}

		const refStart = toNumber(body.refStart);
		const refEnd = toNumber(body.refEnd);
		if (!Number.isFinite(refStart) || !Number.isFinite(refEnd) || refEnd <= refStart) {
			throw new Error('Invalid reference audio start/end');
		}

		const videoStart = Number.isFinite(toNumber(body.videoStart))
			? toNumber(body.videoStart)
			: 0;
		const videoEnd = Number.isFinite(toNumber(body.videoEnd))
			? toNumber(body.videoEnd)
			: undefined;

		const baseDir = path.dirname(metaPath);
		const outputRoot = body.outputDir ? resolveInRoot(body.outputDir) : path.join(baseDir, 'dataset_processed');
		const audioDir = path.join(outputRoot, 'audio');
		const videoDir = path.join(outputRoot, 'video');
		await fs.mkdir(audioDir, { recursive: true });
		await fs.mkdir(videoDir, { recursive: true });

		const sourcePath = resolveMediaPath(metaPath, entry.media_path);
		const sourceStem = path.parse(sourcePath).name;
		const audioOutPath = path.join(audioDir, `${sourceStem}_ref.mp3`);

		const audioArgs = [
			'-y',
			'-ss',
			`${refStart}`,
			'-to',
			`${refEnd}`,
			'-i',
			sourcePath,
			'-vn',
			'-ac',
			'1',
			'-ar',
			'44100',
			'-b:a',
			'192k',
			audioOutPath,
		];
		await runFfmpeg(audioArgs);

		let videoOutPath: string | null = null;
		if (typeof videoEnd === 'number') {
			const videoOutput = path.join(videoDir, `${sourceStem}_trim.mp4`);
			videoOutPath = videoOutput;
			const videoArgs = [
				'-y',
				'-ss',
				`${videoStart}`,
				'-to',
				`${videoEnd}`,
				'-i',
				sourcePath,
				'-c:v',
				'libx264',
				'-preset',
				'veryfast',
				'-crf',
				'20',
				'-c:a',
				'aac',
				'-b:a',
				'192k',
				videoOutput,
			];
            console.log("cutting video with args:", videoArgs.join(' '));
			await runFfmpeg(videoArgs);
		}

		const datasetPath = path.join(baseDir, 'dataset.jsonl');
		let existingEntries: Array<Record<string, unknown>> = [];
		try {
			const datasetText = await fs.readFile(datasetPath, 'utf-8');
			existingEntries = parseJsonl<Record<string, unknown>>(datasetText);
		} catch {
			// ignore missing dataset.jsonl
		}

		const outputEntry = {
			media_path: videoOutPath
				? path.relative(baseDir, videoOutPath)
				: path.relative(baseDir, sourcePath),
			caption: typeof entry.caption === 'string' ? entry.caption : '',
			reference_audio_column: path.relative(baseDir, audioOutPath),
			reference_audio_pos: [Number(refStart.toFixed(3)), Number(refEnd.toFixed(3))],
		};

		existingEntries.push(outputEntry);
		const newText = serializeJsonl(existingEntries as unknown[]);
		await fs.writeFile(datasetPath, newText, 'utf-8');

		// 更新 dataset_meta.jsonl 中的 processed 标记
		metaEntries[body.index] = {
			...metaEntries[body.index],
			processed: true,
		};
		const updatedMetaText = serializeJsonl(metaEntries as unknown[]);
		await fs.writeFile(metaPath, updatedMetaText, 'utf-8');

		return new Response(
			JSON.stringify({
				audio: path.relative(baseDir, audioOutPath),
				video: videoOutPath ? path.relative(baseDir, videoOutPath) : null,
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

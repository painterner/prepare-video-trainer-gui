import type { APIRoute } from 'astro';
import fs from 'fs/promises';
import path from 'path';
import { parseJsonl } from '../../lib/server/jsonl';
import { resolveMediaPath, resolveMetaPath } from '../../lib/server/paths';

type MetaEntry = {
	media_path?: string;
	caption?: string;
	processed?: boolean;
	[Key: string]: unknown;
};

type DatasetEntry = {
	media_path?: string;
	reference_audio_column?: string;
	reference_audio_pos?: [number, number];
	[Key: string]: unknown;
};

export const GET: APIRoute = async ({ url }) => {
	try {
		const metaPath = resolveMetaPath(url.searchParams.get('path'));
		const metaText = await fs.readFile(metaPath, 'utf-8');
		const baseDir = path.dirname(metaPath);
		
		// 加载 dataset.jsonl 获取处理后的媒体路径
		const datasetPath = path.join(baseDir, 'dataset.jsonl');
		const processedMap = new Map<number, DatasetEntry>();
		try {
			const datasetText = await fs.readFile(datasetPath, 'utf-8');
			const datasetEntries = parseJsonl<DatasetEntry>(datasetText);
			datasetEntries.forEach((entry, index) => {
				processedMap.set(index, entry);
			});
		} catch {
			// ignore missing dataset.jsonl
		}

		const metaEntries = parseJsonl<MetaEntry>(metaText).map((entry, index) => {
			const processedData = processedMap.get(index);
			const isProcessed = entry.processed === true;
			
			return {
				...entry,
				meta_index: index,
				_meta_path: metaPath,
				resolved_media_path:
					entry.media_path && typeof entry.media_path === 'string'
						? resolveMediaPath(metaPath, entry.media_path)
						: null,
				processed: isProcessed,
				// 如果已处理，添加处理后的媒体路径
				processed_video_path: isProcessed && processedData?.media_path
					? resolveMediaPath(metaPath, processedData.media_path)
					: null,
				processed_audio_path: isProcessed && processedData?.reference_audio_column
					? resolveMediaPath(metaPath, processedData.reference_audio_column)
					: null,
				processed_audio_pos: isProcessed && processedData?.reference_audio_pos
					? processedData.reference_audio_pos
					: null,
			};
		});

		const data = metaEntries;

		return new Response(JSON.stringify({ metaPath, items: data }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return new Response(JSON.stringify({ error: message }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};

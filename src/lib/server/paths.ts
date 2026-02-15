import path from 'path';

const DEFAULT_ROOT = '/home/ka/all-ref/MY_LTX-2';

export const ALLOWED_ROOT = path.resolve(process.env.LTX_ROOT ?? DEFAULT_ROOT);

export function resolveInRoot(inputPath: string): string {
	// Allow absolute paths without restriction
	return path.resolve(inputPath);
}

export function resolveMediaPath(metaPath: string, mediaPath: string): string {
	// If absolute path, use it directly; otherwise resolve relative to meta file
	if (path.isAbsolute(mediaPath)) {
		return mediaPath;
	}
	const metaDir = path.dirname(metaPath);
	return path.resolve(metaDir, mediaPath);
}

export function resolveMetaPath(inputPath?: string | null): string {
	const envPath = process.env.DATASET_META_PATH;
	const target = inputPath?.trim() || envPath;
	if (!target) {
		throw new Error('Missing dataset meta path. Provide a path or set DATASET_META_PATH.');
	}
	return path.resolve(target);
}

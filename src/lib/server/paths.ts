import path from 'path';

const DEFAULT_ROOT = '/home/ka/all-ref/MY_LTX-2';

export const ALLOWED_ROOT = path.resolve(process.env.LTX_ROOT ?? DEFAULT_ROOT);

export function resolveInRoot(inputPath: string): string {
	const resolved = path.resolve(inputPath);
	if (!resolved.startsWith(ALLOWED_ROOT + path.sep) && resolved !== ALLOWED_ROOT) {
		throw new Error(`Path outside allowed root: ${resolved}`);
	}
	return resolved;
}

export function resolveMediaPath(metaPath: string, mediaPath: string): string {
	const metaDir = path.dirname(metaPath);
	const candidate = path.isAbsolute(mediaPath) ? mediaPath : path.resolve(metaDir, mediaPath);
	return resolveInRoot(candidate);
}

export function resolveMetaPath(inputPath?: string | null): string {
	const envPath = process.env.DATASET_META_PATH;
	const target = inputPath?.trim() || envPath;
	if (!target) {
		throw new Error('Missing dataset meta path. Provide a path or set DATASET_META_PATH.');
	}
	return resolveInRoot(target);
}

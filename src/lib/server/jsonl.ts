export function parseJsonl<T = unknown>(text: string): T[] {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => JSON.parse(line) as T);
}

export function serializeJsonl(entries: unknown[]): string {
	return entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
}

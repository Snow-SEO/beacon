import type { MarkdownResolver } from "./beacon.js";
import { toMarkdownPath } from "./paths.js";

interface FsModule {
	readFileSync: (path: string, encoding: "utf8") => string;
	statSync: (path: string) => {
		mtimeMs: number;
	};
}

interface PathModule {
	join: (...parts: string[]) => string;
	resolve: (...parts: string[]) => string;
	sep: string;
}

const LEADING_SLASHES = /^\/+/;

let modules: Promise<{
	fs: FsModule;
	path: PathModule;
}> | null = null;

function loadModules(): Promise<{
	fs: FsModule;
	path: PathModule;
}> {
	if (!modules) {
		modules = Promise.all([import("node:fs"), import("node:path")]).then(
			([fs, path]) => ({
				fs: fs as unknown as FsModule,
				path: path as unknown as PathModule,
			}),
		);
	}
	return modules;
}

interface CacheEntry {
	mtimeMs: number;
	markdown: string;
}

const cache = new Map<string, CacheEntry>();

export interface DirResolverOptions {
	dir: string;
	cacheControl?: string;
}

export function createDirResolver(
	options: DirResolverOptions | string,
): MarkdownResolver {
	const { dir, cacheControl } =
		typeof options === "string"
			? { dir: options, cacheControl: undefined }
			: options;
	return async (pathname: string) => {
		const relative = toMarkdownPath(pathname).replace(LEADING_SLASHES, "");
		if (relative.includes("\0")) {
			return null;
		}
		const { fs, path } = await loadModules();
		const root = path.resolve(dir);
		const file = path.resolve(root, relative);
		if (!(file === root || file.startsWith(root + path.sep))) {
			return null;
		}
		let markdown: string;
		try {
			const { mtimeMs } = fs.statSync(file);
			const hit = cache.get(file);
			if (hit && hit.mtimeMs === mtimeMs) {
				markdown = hit.markdown;
			} else {
				markdown = fs.readFileSync(file, "utf8");
				cache.set(file, { mtimeMs, markdown });
			}
		} catch {
			return null;
		}
		return cacheControl ? { markdown, cacheControl } : { markdown };
	};
}

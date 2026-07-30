import { defineConfig } from "tsup";
export default defineConfig([
	{
		entry: {
			index: "src/index.ts",
			next: "src/adapters/next.ts",
			node: "src/adapters/node.ts",
		},
		format: ["esm", "cjs"],
		dts: true,
		sourcemap: true,
		clean: true,
		treeshake: true,
		splitting: false,
		target: "es2022",
		platform: "neutral",
		noExternal: [/.*/],
		external: ["node:fs", "node:fs/promises", "node:path"],
	},
	{
		entry: { cli: "src/cli.ts" },
		format: ["esm"],
		dts: false,
		sourcemap: true,
		clean: false,
		treeshake: true,
		splitting: false,
		target: "es2022",
		platform: "node",
	},
]);

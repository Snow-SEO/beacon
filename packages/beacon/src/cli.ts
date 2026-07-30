#!/usr/bin/env node
import { type GenerateResult, generateTwins } from "./generate.js";

const USAGE = `beacon build <dir> --site-url <url> [options]

  <dir>                    Build output to scan and write into (e.g. dist)

Options
  --site-url <url>         Public origin. Required.
  --check                  Write nothing; exit 1 if any twin is out of date.
  --exclude <prefix>       Route prefix to skip. Repeatable.
  --name <name>            Site name for llms.txt. Defaults to the hostname.
  --summary <text>         One-line summary for llms.txt.
  --min-content-chars <n>  Below this, a page counts as having no content (24).
  --no-llms-txt            Do not write llms.txt.
  --no-sitemap             Do not write sitemap-md.xml.
  --no-extract-main        Convert the whole body, not just <article>/<main>.
  -h, --help               Show this message.
`;

interface Args {
	dir: string | null;
	siteUrl: string | null;
	check: boolean;
	exclude: string[];
	name?: string;
	summary?: string;
	minContentChars?: number;
	llmsTxt: boolean;
	sitemap: boolean;
	extractMain: boolean;
	help: boolean;
}

function parseArgs(argv: readonly string[]): Args {
	const args: Args = {
		dir: null,
		siteUrl: null,
		check: false,
		exclude: [],
		llmsTxt: true,
		sitemap: true,
		extractMain: true,
		help: false,
	};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		switch (arg) {
			case "-h":
			case "--help":
				args.help = true;
				break;
			case "--check":
				args.check = true;
				break;
			case "--no-llms-txt":
				args.llmsTxt = false;
				break;
			case "--no-sitemap":
				args.sitemap = false;
				break;
			case "--no-extract-main":
				args.extractMain = false;
				break;
			case "--site-url":
				i += 1;
				args.siteUrl = argv[i] ?? null;
				break;
			case "--exclude":
				i += 1;
				if (argv[i]) {
					args.exclude.push(argv[i] as string);
				}
				break;
			case "--name":
				i += 1;
				args.name = argv[i];
				break;
			case "--summary":
				i += 1;
				args.summary = argv[i];
				break;
			case "--min-content-chars": {
				i += 1;
				const value = Number.parseInt(argv[i] ?? "", 10);
				if (!Number.isNaN(value)) {
					args.minContentChars = value;
				}
				break;
			}
			default:
				if (arg && !arg.startsWith("-") && !args.dir) {
					args.dir = arg;
				}
				break;
		}
	}
	return args;
}

function report(result: GenerateResult, check: boolean): void {
	const empty = result.skipped.filter((s) => s.reason === "empty");
	const excluded = result.skipped.filter((s) => s.reason === "excluded");
	for (const twin of result.twins) {
		let state = "wrote";
		if (check) {
			state = twin.unchanged ? "ok" : "stale";
		}
		console.log(
			`  ${state.padEnd(5)} ${twin.mdFile.padEnd(32)} ${twin.tokens} tokens`,
		);
	}
	if (result.llmsTxtFile) {
		console.log(
			`  ${(check ? "ok" : "wrote").padEnd(5)} ${result.llmsTxtFile}`,
		);
	}
	if (result.sitemapFile) {
		console.log(
			`  ${(check ? "ok" : "wrote").padEnd(5)} ${result.sitemapFile}`,
		);
	}
	console.log(
		`\n${result.twins.length} twin(s), ${empty.length} page(s) with no content, ${excluded.length} excluded`,
	);
	if (result.allEmpty) {
		console.error(
			"\nEvery page converted to nothing.\n" +
				"  This build ships an empty HTML body, so AI crawlers and search engines\n" +
				"  see nothing either - the twin is not the problem to fix first.\n" +
				"  Prerender or server-render your routes, then run this again.",
		);
		return;
	}
	if (empty.length > 0) {
		console.warn("\nNo content extracted from:");
		for (const page of empty) {
			console.warn(`  ${page.route}  (${page.htmlFile}, ${page.chars} chars)`);
		}
	}
}

async function main(): Promise<number> {
	const [command, ...rest] = process.argv.slice(2);
	if (!command || command === "-h" || command === "--help") {
		console.log(USAGE);
		return command ? 0 : 1;
	}
	if (command !== "build") {
		console.error(`Unknown command "${command}".\n\n${USAGE}`);
		return 1;
	}
	const args = parseArgs(rest);
	if (args.help) {
		console.log(USAGE);
		return 0;
	}
	if (!args.dir) {
		console.error(`Missing <dir>.\n\n${USAGE}`);
		return 1;
	}
	if (!args.siteUrl) {
		console.error(`Missing --site-url.\n\n${USAGE}`);
		return 1;
	}
	try {
		new URL(args.siteUrl);
	} catch {
		console.error(`--site-url must be an absolute URL, got "${args.siteUrl}".`);
		return 1;
	}
	console.log(
		`beacon build ${args.dir} -> ${args.siteUrl}${args.check ? " (check)" : ""}\n`,
	);
	const result = await generateTwins({
		dir: args.dir,
		siteUrl: args.siteUrl,
		exclude: args.exclude,
		extractMain: args.extractMain,
		dryRun: args.check,
		llmsTxt: args.llmsTxt
			? {
					...(args.name ? { name: args.name } : {}),
					...(args.summary ? { summary: args.summary } : {}),
				}
			: false,
		sitemap: args.sitemap,
		...(args.minContentChars === undefined
			? {}
			: { minContentChars: args.minContentChars }),
	});
	report(result, args.check);
	if (result.allEmpty) {
		return 1;
	}
	if (args.check && result.twins.some((twin) => !twin.unchanged)) {
		console.error("\nTwins are out of date. Run `beacon build` and commit.");
		return 1;
	}
	return 0;
}
main()
	.then((code) => {
		process.exitCode = code;
	})
	.catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});

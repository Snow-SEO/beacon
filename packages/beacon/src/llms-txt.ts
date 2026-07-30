export interface LlmsTxtLink {
	title: string;
	url: string;
	description?: string;
}

export interface LlmsTxtSection {
	title: string;
	links: LlmsTxtLink[];
}

export interface LlmsTxtOptions {
	name: string;
	summary?: string;
	details?: string | string[];
	sections: LlmsTxtSection[];
}

function renderLink(link: LlmsTxtLink): string {
	const base = `- [${link.title}](${link.url})`;
	return link.description ? `${base}: ${link.description}` : base;
}

export function renderLlmsTxt(options: LlmsTxtOptions): string {
	const blocks: string[] = [`# ${options.name}`];
	if (options.summary) {
		blocks.push(`> ${options.summary}`);
	}
	if (options.details) {
		const details = Array.isArray(options.details)
			? options.details
			: [options.details];
		for (const paragraph of details) {
			if (paragraph.trim()) {
				blocks.push(paragraph.trim());
			}
		}
	}
	for (const section of options.sections) {
		if (section.links.length === 0) {
			continue;
		}
		blocks.push(
			`## ${section.title}\n${section.links.map(renderLink).join("\n")}`,
		);
	}
	return `${blocks.join("\n\n")}\n`;
}

export function renderLlmsFullTxt(
	options: LlmsTxtOptions,
	documents: readonly {
		url: string;
		markdown: string;
	}[],
): string {
	const index = renderLlmsTxt(options);
	const bodies = documents
		.map((doc) => `---\n\n<!-- ${doc.url} -->\n\n${doc.markdown.trim()}`)
		.join("\n\n");
	return documents.length > 0 ? `${index}\n${bodies}\n` : index;
}

export interface Doc {
	path: string;
	title: string;
	description: string;
	markdown: string;
}

export const DOCS: readonly Doc[] = [
	{
		path: "/",
		title: "Widgets that fit",
		description: "A demo site for the beacon Next.js example.",
		markdown: [
			"# Widgets that fit",
			"",
			"Ask for this page as Markdown and you get this file instead of the",
			"rendered HTML. Same URL, different representation.",
			"",
			"## Why twins",
			"",
			"An AI client reading HTML spends most of its context on markup it will",
			"throw away. The twin is the same content without the chrome.",
		].join("\n"),
	},
	{
		path: "/pricing",
		title: "Pricing",
		description: "What the widgets cost.",
		markdown: [
			"# Pricing",
			"",
			"One widget costs one currency unit. Bulk discounts are imaginary.",
		].join("\n"),
	},
];

export function findDoc(path: string): Doc | undefined {
	const normalized =
		path !== "/" && path.endsWith("/") ? path.slice(0, -1) : path;
	return DOCS.find((doc) => doc.path === normalized);
}

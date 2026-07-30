import { beacon } from "@/lib/beacon";
import { DOCS } from "@/lib/content";

export function GET() {
	return beacon.llmsTxt({
		name: "Widgets that fit",
		summary: "A demo site for the beacon Next.js example.",
		sections: [
			{
				title: "Pages",
				links: DOCS.map((doc) => ({
					title: doc.title,
					url: doc.path,
					description: doc.description,
				})),
			},
		],
	});
}

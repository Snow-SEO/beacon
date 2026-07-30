import { findDoc } from "@/lib/content";

export default function Pricing() {
	const doc = findDoc("/pricing");
	return (
		<main>
			<h1>{doc?.title}</h1>
			<p>One widget costs one currency unit. Bulk discounts are imaginary.</p>
		</main>
	);
}

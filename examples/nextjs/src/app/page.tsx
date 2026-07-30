import { findDoc } from "@/lib/content";

export default function Home() {
	const doc = findDoc("/");
	return (
		<main>
			<h1>{doc?.title}</h1>
			<p>
				Ask for this page with <code>Accept: text/markdown</code> and the proxy
				serves the twin instead. The response also carries a{" "}
				<code>Link: rel=&quot;alternate&quot;</code> header pointing at{" "}
				<code>/index.md</code>.
			</p>
		</main>
	);
}

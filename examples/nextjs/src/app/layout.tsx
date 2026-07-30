export const metadata = {
	title: "Widgets that fit",
	description: "A demo site for the beacon Next.js example.",
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en">
			<body>{children}</body>
		</html>
	);
}

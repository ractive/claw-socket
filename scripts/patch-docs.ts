// Patches public/index.html after @asyncapi/html-template generation.
//
// Bug: the inner fixed sidebar div renders wider than its w-64 (256px) container,
// bleeding ~66px over the main content area. Inject a one-line CSS fix.
const HTML_PATH = "public/index.html";

const html = await Bun.file(HTML_PATH)
	.text()
	.catch(() => {
		// biome-ignore lint/suspicious/noConsole: CLI script output
		console.error(
			`${HTML_PATH} not found — run the html-template generator first.`,
		);
		process.exit(1);
	});

const FIX = `<style>/* patch: constrain fixed sidebar to its w-64 container */
.sidebar > div[class*="fixed"] { width: 256px !important; }</style>`;

if (html.includes("patch: constrain fixed sidebar")) {
	// biome-ignore lint/suspicious/noConsole: CLI script output
	console.log(`${HTML_PATH} already patched, skipping.`);
	process.exit(0);
}

const patched = html.replace("</head>", `${FIX}\n</head>`);
await Bun.write(HTML_PATH, patched);
// biome-ignore lint/suspicious/noConsole: CLI script output
console.log(`Patched ${HTML_PATH}`);

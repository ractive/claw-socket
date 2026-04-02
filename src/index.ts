import { createServer } from "./server.ts";

const port = parseInt(process.env["CLAW_SOCKET_PORT"] ?? "3838", 10);
const hostname = process.env["CLAW_SOCKET_HOST"] ?? "localhost";

const app = createServer({ port, hostname });
await app.start();

// Graceful shutdown
process.on("SIGINT", () => {
	console.log("\nShutting down...");
	app.stop();
	process.exit(0);
});

process.on("SIGTERM", () => {
	app.stop();
	process.exit(0);
});

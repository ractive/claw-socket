import { installHook, uninstallHook } from "./hook-installer.ts";
import { createLogger, setLogger } from "./logger.ts";
import { createServer } from "./server.ts";

const VERSION = "0.1.0";

const HELP = `Usage: claw-socket [options]

Options:
  --port <number>      WebSocket server port (default: 3838, env: CLAW_SOCKET_PORT)
  --host <string>      Hostname to bind (default: localhost, env: CLAW_SOCKET_HOST)
  --verbose            Enable verbose logging
  --no-hooks           Skip hook installation
  --install-hooks      Install hooks and exit
  --uninstall-hooks    Remove claw-socket hooks from Claude settings and exit
  --help               Show help
  --version            Show version
`;

export interface CliOptions {
	port: number;
	host: string;
	verbose: boolean;
	noHooks: boolean;
	installHooksOnly: boolean;
	uninstallHooksOnly: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
	const args = argv.slice(2); // strip node/bun + script path

	let port = Number.parseInt(process.env["CLAW_SOCKET_PORT"] ?? "3838", 10);
	if (Number.isNaN(port)) port = 3838;
	let host = process.env["CLAW_SOCKET_HOST"] ?? "localhost";
	let verbose = false;
	let noHooks = false;
	let installHooksOnly = false;
	let uninstallHooksOnly = false;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		switch (arg) {
			case "--port": {
				const val = args[++i];
				const n = parseInt(val ?? "", 10);
				if (Number.isNaN(n) || n <= 0 || n > 65535) {
					// biome-ignore lint/suspicious/noConsole: CLI error output before logger is initialised
					console.error(`Invalid port: ${val}`);
					process.exit(1);
				}
				port = n;
				break;
			}
			case "--host": {
				const val = args[++i];
				if (!val) {
					// biome-ignore lint/suspicious/noConsole: CLI error output before logger is initialised
					console.error("--host requires a value");
					process.exit(1);
				}
				host = val;
				break;
			}
			case "--verbose":
				verbose = true;
				break;
			case "--no-hooks":
				noHooks = true;
				break;
			case "--install-hooks":
				installHooksOnly = true;
				break;
			case "--uninstall-hooks":
				uninstallHooksOnly = true;
				break;
			case "--help":
				process.stdout.write(HELP);
				process.exit(0);
				break;
			case "--version":
				// biome-ignore lint/suspicious/noConsole: CLI version output before logger is initialised
				console.log(VERSION);
				process.exit(0);
				break;
			default:
				// biome-ignore lint/suspicious/noConsole: CLI error output before logger is initialised
				console.error(`Unknown option: ${arg}`);
				process.stderr.write(HELP);
				process.exit(1);
		}
	}

	return { port, host, verbose, noHooks, installHooksOnly, uninstallHooksOnly };
}

export async function runCli(argv: string[]): Promise<void> {
	const opts = parseArgs(argv);

	// Configure logger
	const log = createLogger({
		level: opts.verbose ? "debug" : "info",
		structured: false,
	});
	setLogger(log);

	// --install-hooks mode: install and exit
	if (opts.installHooksOnly) {
		try {
			const result = await installHook(opts.port);
			if (result.previouslyInstalled) {
				log.info("hooks updated", {
					settingsPath: result.settingsPath,
					hookUrl: result.hookUrl,
				});
			} else {
				log.info("hooks installed", {
					settingsPath: result.settingsPath,
					hookUrl: result.hookUrl,
					events: result.events.length,
				});
			}
		} catch (err) {
			log.error("failed to install hooks", { error: String(err) });
			process.exit(1);
		}
		return;
	}

	if (opts.uninstallHooksOnly) {
		try {
			const removed = await uninstallHook();
			if (removed) {
				log.info("hooks uninstalled");
			} else {
				log.info("no claw-socket hooks found");
			}
		} catch (err) {
			log.error("failed to uninstall hooks", { error: String(err) });
			process.exit(1);
		}
		return;
	}

	// Warn when binding to a non-loopback address — the server becomes network-accessible
	const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);
	if (!loopbackHosts.has(opts.host)) {
		log.warn(
			"WARNING: claw-socket is binding to a non-loopback address and will be reachable from the network",
			{ host: opts.host },
		);
	}

	const app = createServer({ port: opts.port, hostname: opts.host });
	await app.start();

	// Install hooks by default unless --no-hooks
	if (!opts.noHooks) {
		try {
			const result = await installHook(app.server.port ?? opts.port);
			if (result.previouslyInstalled) {
				log.debug("hooks already configured", { hookUrl: result.hookUrl });
			} else {
				log.info("hooks installed", { hookUrl: result.hookUrl });
			}
		} catch (err) {
			log.warn("could not install hooks (non-fatal)", { error: String(err) });
		}
	}

	let shuttingDown = false;
	async function shutdown(): Promise<void> {
		if (shuttingDown) return;
		shuttingDown = true;
		log.info("shutting down...");
		await app.stop();
		process.exit(0);
	}

	process.on("SIGINT", () => {
		void shutdown();
	});

	process.on("SIGTERM", () => {
		void shutdown();
	});
}

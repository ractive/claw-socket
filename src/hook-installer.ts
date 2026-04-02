import {
	mkdir,
	open,
	readFile,
	rename,
	unlink,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { HookEventTypeSchema } from "./schemas/hook.ts";
import { isRecord } from "./utils.ts";

const DEFAULT_SETTINGS_PATH = join(homedir(), ".claude", "settings.json");
const HOOK_NAME = "claw-socket";

/** Derived from the Zod schema so they stay in sync */
const HOOK_EVENTS = HookEventTypeSchema.options;

export interface InstallResult {
	settingsPath: string;
	hookUrl: string;
	events: readonly string[];
	previouslyInstalled: boolean;
}

// ---------------------------------------------------------------------------
// Advisory lock helpers
// ---------------------------------------------------------------------------

const LOCK_RETRY_COUNT = 10;
const LOCK_RETRY_DELAY_MS = 50;

function lockPath(settingsPath: string): string {
	return `${settingsPath}.lock`;
}

/**
 * Acquire an advisory lockfile. Creates the lock exclusively (O_EXCL) so that
 * concurrent processes will fail and retry rather than clobber each other.
 * Retries up to LOCK_RETRY_COUNT times with exponential backoff.
 */
async function acquireLock(settingsPath: string): Promise<void> {
	const lp = lockPath(settingsPath);
	let lastErr: unknown;
	for (let attempt = 0; attempt < LOCK_RETRY_COUNT; attempt++) {
		try {
			// O_CREAT | O_EXCL — fails atomically if the file already exists
			const fh = await open(lp, "wx");
			await fh.close();
			return; // lock acquired
		} catch (err: unknown) {
			lastErr = err;
			if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
			// Lock is held by another process — wait with backoff before retrying
			const delay = LOCK_RETRY_DELAY_MS * 2 ** attempt;
			await new Promise<void>((resolve) => setTimeout(resolve, delay));
		}
	}
	throw new Error(
		`Could not acquire settings lock at ${lp} after ${LOCK_RETRY_COUNT} attempts: ${String(lastErr)}`,
	);
}

async function releaseLock(settingsPath: string): Promise<void> {
	try {
		await unlink(lockPath(settingsPath));
	} catch {
		// Best-effort — if the file is already gone that is fine
	}
}

// ---------------------------------------------------------------------------
// Settings read/write helpers
// ---------------------------------------------------------------------------

async function readSettings(
	settingsPath: string,
): Promise<Record<string, unknown>> {
	let content: string;
	try {
		content = await readFile(settingsPath, "utf-8");
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw err;
	}
	return JSON.parse(content) as Record<string, unknown>;
}

async function writeSettings(
	settingsPath: string,
	settings: Record<string, unknown>,
): Promise<void> {
	await mkdir(dirname(settingsPath), { recursive: true });
	const tmpPath = join(
		dirname(settingsPath),
		`.claude-settings-${Date.now()}.tmp`,
	);
	await writeFile(tmpPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
	await rename(tmpPath, settingsPath);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Install the claw-socket hook into Claude Code settings.
 * Returns the installation result. Pass dryRun=true to preview without writing.
 */
export async function installHook(
	port: number,
	options: { dryRun?: boolean; settingsPath?: string } = {},
): Promise<InstallResult> {
	const settingsPath = options.settingsPath ?? DEFAULT_SETTINGS_PATH;
	const hookUrl = `http://localhost:${port}/hook`;

	if (!options.dryRun) await acquireLock(settingsPath);
	try {
		const settings = await readSettings(settingsPath);

		const existing = settings["hooks"];
		const hooks = isRecord(existing) ? existing : {};
		const previouslyInstalled = HOOK_NAME in hooks;

		// Build hook config: each event type maps to a command array
		const hookConfig: Record<string, unknown> = {};
		for (const event of HOOK_EVENTS) {
			hookConfig[event] = [
				{
					type: "http",
					url: hookUrl,
				},
			];
		}

		hooks[HOOK_NAME] = hookConfig;
		settings["hooks"] = hooks;

		if (!options.dryRun) {
			await writeSettings(settingsPath, settings);
		}

		return {
			settingsPath,
			hookUrl,
			events: HOOK_EVENTS,
			previouslyInstalled,
		};
	} finally {
		if (!options.dryRun) await releaseLock(settingsPath);
	}
}

/**
 * Remove the claw-socket hook from Claude Code settings.
 * Returns true if the hook was found and removed.
 */
export async function uninstallHook(
	options: { dryRun?: boolean; settingsPath?: string } = {},
): Promise<boolean> {
	const settingsPath = options.settingsPath ?? DEFAULT_SETTINGS_PATH;

	if (!options.dryRun) await acquireLock(settingsPath);
	try {
		const settings = await readSettings(settingsPath);
		const existing = settings["hooks"];

		if (!isRecord(existing) || !(HOOK_NAME in existing)) {
			return false;
		}

		delete existing[HOOK_NAME];
		settings["hooks"] = existing;

		if (!options.dryRun) {
			await writeSettings(settingsPath, settings);
		}

		return true;
	} finally {
		if (!options.dryRun) await releaseLock(settingsPath);
	}
}

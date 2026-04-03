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
const HOOK_TAG = "claw-socket";

/** Events that Claude Code does not support as hook registration keys */
const EXCLUDED_FROM_INSTALL = new Set([
	"CwdChanged",
	"FileChanged",
	"PermissionDenied",
	"TaskCreated",
]);

/** Events claw-socket registers hooks for (subset of HookEventTypeSchema) */
const INSTALL_EVENTS = HookEventTypeSchema.options.filter(
	(e) => !EXCLUDED_FROM_INSTALL.has(e),
);

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
const LOCK_MAX_DELAY_MS = 2_000;
const LOCK_STALE_MS = 30_000;

function lockPath(settingsPath: string): string {
	return `${settingsPath}.lock`;
}

/**
 * Remove a stale lockfile if it's older than LOCK_STALE_MS.
 * Handles crashed processes that left a lockfile behind.
 */
async function removeIfStale(lp: string): Promise<void> {
	try {
		const stat = await Bun.file(lp).exists();
		if (!stat) return;
		const file = Bun.file(lp);
		const { mtimeMs } = await file.stat();
		if (Date.now() - mtimeMs > LOCK_STALE_MS) {
			await unlink(lp);
		}
	} catch {
		// Ignore — file may have been removed by another process
	}
}

/**
 * Acquire an advisory lockfile. Creates the lock exclusively (O_EXCL) so that
 * concurrent processes will fail and retry rather than clobber each other.
 * Retries up to LOCK_RETRY_COUNT times with exponential backoff (capped).
 * Stale locks older than 30s are automatically removed.
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
			// Check for stale lock on first retry
			if (attempt === 0) await removeIfStale(lp);
			const delay = Math.min(
				LOCK_RETRY_DELAY_MS * 2 ** attempt,
				LOCK_MAX_DELAY_MS,
			);
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

/** Path to the token file, used for dynamic reads in curl commands */
const TOKEN_FILE = join(homedir(), ".claw-socket", "token");

function makeHookEntry(hookUrl: string): Record<string, unknown> {
	return {
		matcher: "",
		hooks: [
			{
				type: "command",
				command: `curl -sf --max-time 2 -X POST ${hookUrl} -H 'Content-Type: application/json' -H "Authorization: Bearer $(cat '${TOKEN_FILE}')" -d @- >/dev/null 2>&1`,
				async: true,
			},
		],
		_tag: HOOK_TAG,
	};
}

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
		const existingHooks = settings["hooks"];
		const hooks = isRecord(existingHooks) ? { ...existingHooks } : {};
		// Clean up legacy namespaced structure from older versions
		delete hooks[HOOK_TAG];

		// Check if already installed (any event has _tag: "claw-socket")
		let previouslyInstalled = false;
		for (const eventEntries of Object.values(hooks)) {
			if (Array.isArray(eventEntries)) {
				if (eventEntries.some((e) => isRecord(e) && e["_tag"] === HOOK_TAG)) {
					previouslyInstalled = true;
					break;
				}
			}
		}

		const entry = makeHookEntry(hookUrl);

		for (const event of INSTALL_EVENTS) {
			const existing = hooks[event];
			const arr: unknown[] = Array.isArray(existing) ? [...existing] : [];
			const idx = arr.findIndex((e) => isRecord(e) && e["_tag"] === HOOK_TAG);
			if (idx >= 0) {
				arr[idx] = entry;
			} else {
				arr.push(entry);
			}
			hooks[event] = arr;
		}

		settings["hooks"] = hooks;

		if (!options.dryRun) {
			await writeSettings(settingsPath, settings);
		}

		return {
			settingsPath,
			hookUrl,
			events: INSTALL_EVENTS,
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
		const existingHooks = settings["hooks"];

		if (!isRecord(existingHooks)) return false;

		let found = false;
		const hooks = { ...existingHooks };

		// Clean up legacy namespaced structure from older versions
		if (HOOK_TAG in hooks) {
			delete hooks[HOOK_TAG];
			found = true;
		}

		for (const [event, entries] of Object.entries(hooks)) {
			if (!Array.isArray(entries)) continue;
			const filtered = entries.filter(
				(e) => !(isRecord(e) && e["_tag"] === HOOK_TAG),
			);
			if (filtered.length < entries.length) {
				found = true;
				if (filtered.length === 0) {
					delete hooks[event];
				} else {
					hooks[event] = filtered;
				}
			}
		}

		if (!found) return false;

		if (Object.keys(hooks).length === 0) {
			delete settings["hooks"];
		} else {
			settings["hooks"] = hooks;
		}

		if (!options.dryRun) {
			await writeSettings(settingsPath, settings);
		}

		return true;
	} finally {
		if (!options.dryRun) await releaseLock(settingsPath);
	}
}

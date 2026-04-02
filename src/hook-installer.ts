import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { HookEventTypeSchema } from "./schemas/hook.ts";

const SETTINGS_PATH = join(homedir(), ".claude", "settings.json");
const HOOK_NAME = "claw-socket";

/** Derived from the Zod schema so they stay in sync */
const HOOK_EVENTS = HookEventTypeSchema.options;

export interface InstallResult {
	settingsPath: string;
	hookUrl: string;
	events: readonly string[];
	previouslyInstalled: boolean;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function readSettings(): Promise<Record<string, unknown>> {
	let content: string;
	try {
		content = await readFile(SETTINGS_PATH, "utf-8");
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw err;
	}
	return JSON.parse(content) as Record<string, unknown>;
}

async function writeSettings(settings: Record<string, unknown>): Promise<void> {
	await mkdir(dirname(SETTINGS_PATH), { recursive: true });
	const tmpPath = join(tmpdir(), `claude-settings-${Date.now()}.tmp`);
	await writeFile(tmpPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
	await rename(tmpPath, SETTINGS_PATH);
}

/**
 * Install the claw-socket hook into Claude Code settings.
 * Returns the installation result. Pass dryRun=true to preview without writing.
 */
export async function installHook(
	port: number,
	options: { dryRun?: boolean } = {},
): Promise<InstallResult> {
	const hookUrl = `http://localhost:${port}/hook`;
	const settings = await readSettings();

	const existing = settings["hooks"];
	const hooks = isPlainObject(existing) ? existing : {};
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
		await writeSettings(settings);
	}

	return {
		settingsPath: SETTINGS_PATH,
		hookUrl,
		events: HOOK_EVENTS,
		previouslyInstalled,
	};
}

/**
 * Remove the claw-socket hook from Claude Code settings.
 * Returns true if the hook was found and removed.
 */
export async function uninstallHook(
	options: { dryRun?: boolean } = {},
): Promise<boolean> {
	const settings = await readSettings();
	const existing = settings["hooks"];

	if (!isPlainObject(existing) || !(HOOK_NAME in existing)) {
		return false;
	}

	delete existing[HOOK_NAME];
	settings["hooks"] = existing;

	if (!options.dryRun) {
		await writeSettings(settings);
	}

	return true;
}

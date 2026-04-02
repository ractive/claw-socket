import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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
}

/**
 * Remove the claw-socket hook from Claude Code settings.
 * Returns true if the hook was found and removed.
 */
export async function uninstallHook(
	options: { dryRun?: boolean; settingsPath?: string } = {},
): Promise<boolean> {
	const settingsPath = options.settingsPath ?? DEFAULT_SETTINGS_PATH;
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
}

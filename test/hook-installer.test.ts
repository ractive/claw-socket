import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHook, uninstallHook } from "../src/hook-installer.ts";

let tmpDir: string;
let settingsPath: string;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "claw-socket-test-"));
	settingsPath = join(tmpDir, "settings.json");
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
});

async function readSettings(): Promise<Record<string, unknown>> {
	try {
		return JSON.parse(await readFile(settingsPath, "utf-8")) as Record<
			string,
			unknown
		>;
	} catch {
		return {};
	}
}

describe("installHook", () => {
	test("writes flat tagged entries under event keys", async () => {
		const result = await installHook(3838, { settingsPath });
		expect(result.previouslyInstalled).toBe(false);
		expect(result.hookUrl).toBe("http://localhost:3838/hook");

		const settings = await readSettings();
		const hooks = settings["hooks"] as Record<string, unknown[]>;
		expect(hooks).toBeDefined();

		// Should have entries for standard events (not excluded ones)
		expect(hooks["PreToolUse"]).toBeDefined();
		expect(hooks["CwdChanged"]).toBeUndefined();
		expect(hooks["FileChanged"]).toBeUndefined();
		expect(hooks["PermissionDenied"]).toBeUndefined();
		expect(hooks["TaskCreated"]).toBeUndefined();

		// Each entry should be a tagged curl command hook
		const preToolUse = hooks["PreToolUse"] as Record<string, unknown>[];
		expect(preToolUse[0]).toMatchObject({
			matcher: "",
			_tag: "claw-socket",
		});
		// biome-ignore lint/style/noNonNullAssertion: test assertions rely on defined values
		const hookCmd = (preToolUse[0]!["hooks"] as Record<string, unknown>[])![0]!;
		expect(hookCmd["type"]).toBe("command");
		expect(hookCmd["async"]).toBe(true);
		expect(String(hookCmd["command"])).toContain("localhost:3838/hook");
	});

	test("re-install updates existing entries in-place (no duplicates)", async () => {
		await installHook(3838, { settingsPath });
		const result = await installHook(3939, { settingsPath });

		expect(result.previouslyInstalled).toBe(true);

		const settings = await readSettings();
		const hooks = settings["hooks"] as Record<string, unknown[]>;
		const preToolUse = hooks["PreToolUse"] as Record<string, unknown>[];

		// Should still be exactly one entry
		const taggedEntries = preToolUse.filter(
			(e) => (e as Record<string, unknown>)["_tag"] === "claw-socket",
		);
		expect(taggedEntries).toHaveLength(1);

		// URL should be updated to new port
		// biome-ignore lint/style/noNonNullAssertion: test assertions rely on defined values
		const hookCmd = (taggedEntries[0]!["hooks"] as Record<
			string,
			unknown
		>[])![0]!;
		expect(String(hookCmd["command"])).toContain("localhost:3939/hook");
	});

	test("install preserves other hooks", async () => {
		// Write a settings file with an existing hook
		const existing = {
			hooks: {
				PreToolUse: [
					{
						matcher: "other",
						hooks: [{ type: "command", command: "echo hi" }],
					},
				],
			},
		};
		await Bun.write(settingsPath, JSON.stringify(existing));

		await installHook(3838, { settingsPath });

		const settings = await readSettings();
		const hooks = settings["hooks"] as Record<string, unknown[]>;
		const preToolUse = hooks["PreToolUse"] as Record<string, unknown>[];

		// Should have both the existing hook and our new one
		expect(preToolUse).toHaveLength(2);
		expect(preToolUse[0]).toMatchObject({ matcher: "other" });
		expect(preToolUse[1]).toMatchObject({ _tag: "claw-socket" });
	});
});

describe("uninstallHook", () => {
	test("removes only claw-socket entries, leaves others untouched", async () => {
		// Write settings with both our hook and another
		const existing = {
			hooks: {
				PreToolUse: [
					{
						matcher: "other",
						hooks: [{ type: "command", command: "echo hi" }],
					},
					{
						matcher: "",
						hooks: [{ type: "command", command: "curl ...", async: true }],
						_tag: "claw-socket",
					},
				],
			},
		};
		await Bun.write(settingsPath, JSON.stringify(existing));

		const removed = await uninstallHook({ settingsPath });
		expect(removed).toBe(true);

		const settings = await readSettings();
		const hooks = settings["hooks"] as Record<string, unknown[]>;
		const preToolUse = hooks["PreToolUse"] as Record<string, unknown>[];

		expect(preToolUse).toHaveLength(1);
		expect(preToolUse[0]).toMatchObject({ matcher: "other" });
	});

	test("returns false when no claw-socket hooks found", async () => {
		const removed = await uninstallHook({ settingsPath });
		expect(removed).toBe(false);
	});

	test("roundtrip: install → uninstall → settings cleaned", async () => {
		await installHook(3838, { settingsPath });
		const removed = await uninstallHook({ settingsPath });
		expect(removed).toBe(true);

		const settings = await readSettings();
		// hooks key should be absent (or empty)
		expect(settings["hooks"]).toBeUndefined();
	});
});

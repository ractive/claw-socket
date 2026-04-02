import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlWatcher } from "../src/jsonl-watcher.ts";

let tempDir: string;
beforeAll(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "claw-test-"));
});
afterAll(async () => {
	await rm(tempDir, { recursive: true });
});

function wait(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

describe("JsonlWatcher", () => {
	test("reads lines from a JSONL file and tracks byte offset", async () => {
		const filePath = join(tempDir, "offset-test.jsonl");
		await writeFile(filePath, '{"a":1}\n{"a":2}\n');

		const lines: Record<string, unknown>[] = [];
		const watcher = new JsonlWatcher(filePath, (line) => lines.push(line), {
			pollIntervalMs: 50,
		});

		watcher.start();
		await wait(150);

		expect(lines).toHaveLength(2);
		expect(lines[0]).toEqual({ a: 1 });
		expect(lines[1]).toEqual({ a: 2 });
		expect(watcher.byteOffset).toBeGreaterThan(0);

		// Append more data and verify incremental read
		const offsetBefore = watcher.byteOffset;
		await appendFile(filePath, '{"a":3}\n');
		await wait(150);

		expect(lines).toHaveLength(3);
		expect(lines[2]).toEqual({ a: 3 });
		expect(watcher.byteOffset).toBeGreaterThan(offsetBefore);

		watcher.stop();
	});

	test("buffers partial lines until completed", async () => {
		const filePath = join(tempDir, "partial-test.jsonl");
		// Write a partial line (no newline)
		await writeFile(filePath, '{"partial":');

		const lines: Record<string, unknown>[] = [];
		const watcher = new JsonlWatcher(filePath, (line) => lines.push(line), {
			pollIntervalMs: 50,
		});

		watcher.start();
		await wait(150);

		// Partial line should not be emitted
		expect(lines).toHaveLength(0);

		// Complete the line
		await appendFile(filePath, "true}\n");
		await wait(150);

		expect(lines).toHaveLength(1);
		expect(lines[0]).toEqual({ partial: true });

		watcher.stop();
	});

	test("skips malformed JSON lines", async () => {
		const filePath = join(tempDir, "malformed-test.jsonl");
		await writeFile(
			filePath,
			'not json\n{"valid":true}\n{broken\n{"also":true}\n',
		);

		const lines: Record<string, unknown>[] = [];
		const watcher = new JsonlWatcher(filePath, (line) => lines.push(line), {
			pollIntervalMs: 50,
		});

		watcher.start();
		await wait(150);

		expect(lines).toHaveLength(2);
		expect(lines[0]).toEqual({ valid: true });
		expect(lines[1]).toEqual({ also: true });

		watcher.stop();
	});

	test("does not crash when file disappears", async () => {
		const filePath = join(tempDir, "disappear-test.jsonl");
		await writeFile(filePath, '{"x":1}\n');

		const lines: Record<string, unknown>[] = [];
		const watcher = new JsonlWatcher(filePath, (line) => lines.push(line), {
			pollIntervalMs: 50,
		});

		watcher.start();
		await wait(150);
		expect(lines).toHaveLength(1);

		// Remove the file
		await rm(filePath);
		await wait(150);

		// Should not crash — just no new lines
		expect(lines).toHaveLength(1);

		watcher.stop();
	});

	test("start/stop lifecycle", async () => {
		const filePath = join(tempDir, "lifecycle-test.jsonl");
		await writeFile(filePath, '{"x":1}\n');

		const lines: Record<string, unknown>[] = [];
		const watcher = new JsonlWatcher(filePath, (line) => lines.push(line), {
			pollIntervalMs: 50,
		});

		// Start and collect
		watcher.start();
		await wait(150);
		expect(lines).toHaveLength(1);

		// Stop and add more data — should not be collected
		watcher.stop();
		await appendFile(filePath, '{"x":2}\n');
		await wait(150);
		expect(lines).toHaveLength(1);

		// Double start should not throw
		watcher.start();
		watcher.start(); // no-op
		await wait(150);

		watcher.stop();
	});

	test("handles file that does not exist initially", async () => {
		const filePath = join(tempDir, "nonexistent.jsonl");

		const lines: Record<string, unknown>[] = [];
		const watcher = new JsonlWatcher(filePath, (line) => lines.push(line), {
			pollIntervalMs: 50,
		});

		watcher.start();
		await wait(150);

		// No crash, no lines
		expect(lines).toHaveLength(0);

		// Create the file
		await writeFile(filePath, '{"late":true}\n');
		await wait(150);

		expect(lines).toHaveLength(1);
		expect(lines[0]).toEqual({ late: true });

		watcher.stop();
	});
});

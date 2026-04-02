import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { JsonlParser, type ParsedEvent } from "../src/jsonl-parser.ts";
import { createServer } from "../src/server.ts";
import { UsageTracker } from "../src/usage-tracker.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
	type: string,
	sessionId: string,
	data: Record<string, unknown>,
	agentId?: string,
): ParsedEvent {
	return { type, sessionId, data, ...(agentId ? { agentId } : {}) };
}

function createParser(sessionId = "test-session") {
	const events: ParsedEvent[] = [];
	const parser = new JsonlParser(sessionId, (e) => events.push(e));
	return { parser, events };
}

// ---------------------------------------------------------------------------
// UsageTracker unit tests
// ---------------------------------------------------------------------------

describe("UsageTracker", () => {
	test("accumulates input/output tokens from assistant message usage", () => {
		const tracker = new UsageTracker();

		tracker.handleEvent(
			makeEvent("message.assistant", "sess-1", {
				contentBlocks: [],
				model: "claude-opus-4",
				usage: {
					input_tokens: 1000,
					output_tokens: 500,
					cache_creation_input_tokens: 200,
					cache_read_input_tokens: 100,
				},
			}),
		);

		const usage = tracker.getSessionUsage("sess-1");
		expect(usage).toBeDefined();
		expect(usage?.inputTokens).toBe(1000);
		expect(usage?.outputTokens).toBe(500);
		expect(usage?.cacheCreationInputTokens).toBe(200);
		expect(usage?.cacheReadInputTokens).toBe(100);
	});

	test("accumulates running totals across multiple assistant messages", () => {
		const tracker = new UsageTracker();

		tracker.handleEvent(
			makeEvent("message.assistant", "sess-2", {
				contentBlocks: [],
				model: "claude-opus-4",
				usage: { input_tokens: 500, output_tokens: 200 },
			}),
		);
		tracker.handleEvent(
			makeEvent("message.assistant", "sess-2", {
				contentBlocks: [],
				model: "claude-opus-4",
				usage: { input_tokens: 300, output_tokens: 150 },
			}),
		);

		const usage = tracker.getSessionUsage("sess-2");
		expect(usage?.inputTokens).toBe(800);
		expect(usage?.outputTokens).toBe(350);
	});

	test("tracks per-model breakdown from assistant messages", () => {
		const tracker = new UsageTracker();

		tracker.handleEvent(
			makeEvent("message.assistant", "sess-3", {
				contentBlocks: [],
				model: "claude-opus-4",
				usage: { input_tokens: 400, output_tokens: 100 },
			}),
		);
		tracker.handleEvent(
			makeEvent("message.assistant", "sess-3", {
				contentBlocks: [],
				model: "claude-haiku-3",
				usage: { input_tokens: 200, output_tokens: 50 },
			}),
		);

		const usage = tracker.getSessionUsage("sess-3");
		expect(usage?.modelBreakdown.size).toBe(2);
		expect(usage?.modelBreakdown.get("claude-opus-4")?.inputTokens).toBe(400);
		expect(usage?.modelBreakdown.get("claude-opus-4")?.outputTokens).toBe(100);
		expect(usage?.modelBreakdown.get("claude-haiku-3")?.inputTokens).toBe(200);
	});

	test("extracts cost and timing from result message", () => {
		const tracker = new UsageTracker();

		tracker.handleEvent(
			makeEvent("message.result", "sess-4", {
				totalCostUsd: 0.05,
				durationMs: 5000,
				durationApiMs: 3000,
				numTurns: 3,
			}),
		);

		const usage = tracker.getSessionUsage("sess-4");
		expect(usage?.totalCostUsd).toBe(0.05);
		expect(usage?.durationMs).toBe(5000);
		expect(usage?.durationApiMs).toBe(3000);
		expect(usage?.numTurns).toBe(3);
	});

	test("result message overrides token counts with authoritative values", () => {
		const tracker = new UsageTracker();

		// First accumulate from assistant messages
		tracker.handleEvent(
			makeEvent("message.assistant", "sess-5", {
				contentBlocks: [],
				usage: { input_tokens: 100, output_tokens: 50 },
			}),
		);

		// Then result message provides authoritative totals
		tracker.handleEvent(
			makeEvent("message.result", "sess-5", {
				totalCostUsd: 0.02,
				usage: { input_tokens: 980, output_tokens: 480 },
			}),
		);

		const usage = tracker.getSessionUsage("sess-5");
		expect(usage?.inputTokens).toBe(980);
		expect(usage?.outputTokens).toBe(480);
	});

	test("result message processes per-model breakdown from models array", () => {
		const tracker = new UsageTracker();

		tracker.handleEvent(
			makeEvent("message.result", "sess-6", {
				totalCostUsd: 0.1,
				usage: {
					models: [
						{
							model: "claude-opus-4",
							usage: { input_tokens: 800, output_tokens: 400, cost_usd: 0.08 },
						},
						{
							model: "claude-haiku-3",
							usage: { input_tokens: 200, output_tokens: 100, cost_usd: 0.02 },
						},
					],
				},
			}),
		);

		const usage = tracker.getSessionUsage("sess-6");
		expect(usage?.modelBreakdown.get("claude-opus-4")?.costUsd).toBe(0.08);
		expect(usage?.modelBreakdown.get("claude-haiku-3")?.costUsd).toBe(0.02);
	});

	test("emits usage.update callback after assistant message", () => {
		const updates: Array<{ type: string; sessionId: string }> = [];
		const tracker = new UsageTracker((type, sessionId) => {
			updates.push({ type, sessionId });
		});

		tracker.handleEvent(
			makeEvent("message.assistant", "sess-7", {
				contentBlocks: [],
				usage: { input_tokens: 10, output_tokens: 5 },
			}),
		);

		expect(updates).toHaveLength(1);
		expect(updates[0]?.type).toBe("usage.update");
		expect(updates[0]?.sessionId).toBe("sess-7");
	});

	test("emits usage.update callback after result message", () => {
		const updates: Array<{ type: string; data: Record<string, unknown> }> = [];
		const tracker = new UsageTracker((type, _sessionId, data) => {
			updates.push({ type, data });
		});

		tracker.handleEvent(
			makeEvent("message.result", "sess-8", {
				totalCostUsd: 0.03,
				durationMs: 2000,
			}),
		);

		expect(updates).toHaveLength(1);
		expect(updates[0]?.type).toBe("usage.update");
		expect(updates[0]?.data["totalCostUsd"]).toBe(0.03);
	});

	test("getGlobalUsage aggregates across sessions", () => {
		const tracker = new UsageTracker();

		tracker.handleEvent(
			makeEvent("message.assistant", "sess-a", {
				contentBlocks: [],
				usage: { input_tokens: 500, output_tokens: 200 },
			}),
		);
		tracker.handleEvent(
			makeEvent("message.result", "sess-a", {
				totalCostUsd: 0.04,
			}),
		);
		tracker.handleEvent(
			makeEvent("message.assistant", "sess-b", {
				contentBlocks: [],
				usage: { input_tokens: 300, output_tokens: 150 },
			}),
		);
		tracker.handleEvent(
			makeEvent("message.result", "sess-b", {
				totalCostUsd: 0.02,
			}),
		);

		const global = tracker.getGlobalUsage();
		expect(global.sessionCount).toBe(2);
		expect(global.totalCostUsd).toBeCloseTo(0.06);
		expect(global.totalInputTokens).toBe(800);
		expect(global.totalOutputTokens).toBe(350);
	});

	test("getGlobalUsage merges per-model breakdown across sessions", () => {
		const tracker = new UsageTracker();

		tracker.handleEvent(
			makeEvent("message.assistant", "sess-x", {
				contentBlocks: [],
				model: "claude-opus-4",
				usage: { input_tokens: 400, output_tokens: 100 },
			}),
		);
		tracker.handleEvent(
			makeEvent("message.assistant", "sess-y", {
				contentBlocks: [],
				model: "claude-opus-4",
				usage: { input_tokens: 600, output_tokens: 200 },
			}),
		);

		const global = tracker.getGlobalUsage();
		expect(global.modelBreakdown["claude-opus-4"]?.inputTokens).toBe(1000);
		expect(global.modelBreakdown["claude-opus-4"]?.outputTokens).toBe(300);
	});

	test("getSessionUsage returns undefined for unknown session", () => {
		const tracker = new UsageTracker();
		expect(tracker.getSessionUsage("nonexistent")).toBeUndefined();
	});

	test("getGlobalUsage returns zero totals when no sessions", () => {
		const tracker = new UsageTracker();
		const global = tracker.getGlobalUsage();
		expect(global.sessionCount).toBe(0);
		expect(global.totalCostUsd).toBe(0);
		expect(global.totalInputTokens).toBe(0);
		expect(global.totalOutputTokens).toBe(0);
	});

	test("clear removes all session data", () => {
		const tracker = new UsageTracker();
		tracker.handleEvent(
			makeEvent("message.assistant", "sess-z", {
				contentBlocks: [],
				usage: { input_tokens: 100, output_tokens: 50 },
			}),
		);
		tracker.clear();
		expect(tracker.getGlobalUsage().sessionCount).toBe(0);
	});

	test("assistant message without usage field does not alter token counts", () => {
		const tracker = new UsageTracker();
		tracker.handleEvent(
			makeEvent("message.assistant", "sess-no-usage", {
				contentBlocks: [],
			}),
		);
		const usage = tracker.getSessionUsage("sess-no-usage");
		expect(usage?.inputTokens).toBe(0);
		expect(usage?.outputTokens).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Rate limit and context window events via JsonlParser
// ---------------------------------------------------------------------------

describe("JsonlParser - usage events", () => {
	test("emits usage.rate_limit for system rate_limit subtype", () => {
		const { parser, events } = createParser();

		parser.processLine({
			type: "system",
			subtype: "rate_limit",
			allowed: false,
			rate_limit_type: "token_limit",
			message: "Rate limit exceeded",
			retry_after: 30,
		});

		const rateLimitEvents = events.filter((e) => e.type === "usage.rate_limit");
		expect(rateLimitEvents).toHaveLength(1);
		expect(rateLimitEvents[0]?.data["allowed"]).toBe(false);
		expect(rateLimitEvents[0]?.data["type"]).toBe("token_limit");
		expect(rateLimitEvents[0]?.data["message"]).toBe("Rate limit exceeded");
		expect(rateLimitEvents[0]?.data["retryAfter"]).toBe(30);
	});

	test("emits usage.rate_limit when message contains 'rate limit'", () => {
		const { parser, events } = createParser();

		parser.processLine({
			type: "system",
			subtype: "warning",
			message: "Approaching rate limit threshold",
		});

		const rateLimitEvents = events.filter((e) => e.type === "usage.rate_limit");
		expect(rateLimitEvents).toHaveLength(1);
		expect(rateLimitEvents[0]?.data["message"]).toBe(
			"Approaching rate limit threshold",
		);
	});

	test("emits usage.rate_limit when retry_after field present", () => {
		const { parser, events } = createParser();

		parser.processLine({
			type: "system",
			subtype: "info",
			retry_after: 60,
			message: "Pausing requests",
		});

		const rateLimitEvents = events.filter((e) => e.type === "usage.rate_limit");
		expect(rateLimitEvents).toHaveLength(1);
		expect(rateLimitEvents[0]?.data["retryAfter"]).toBe(60);
	});

	test("rate_limit event has no retryAfter when field absent", () => {
		const { parser, events } = createParser();

		parser.processLine({
			type: "system",
			subtype: "rate_limit",
			allowed: true,
			message: "Allowed through",
		});

		const rateLimitEvents = events.filter((e) => e.type === "usage.rate_limit");
		expect(rateLimitEvents[0]?.data["retryAfter"]).toBeUndefined();
	});

	test("emits usage.context for system context_window subtype", () => {
		const { parser, events } = createParser();

		parser.processLine({
			type: "system",
			subtype: "context_window",
			context_window: {
				tokens_used: 50000,
				tokens_max: 200000,
				categories: { tools: 5000, conversation: 45000 },
			},
		});

		const ctxEvents = events.filter((e) => e.type === "usage.context");
		expect(ctxEvents).toHaveLength(1);
		expect(ctxEvents[0]?.data["tokensUsed"]).toBe(50000);
		expect(ctxEvents[0]?.data["tokensMax"]).toBe(200000);
		expect(ctxEvents[0]?.data["percentUsed"]).toBeCloseTo(25);
		expect(
			(ctxEvents[0]?.data["categories"] as Record<string, number>)["tools"],
		).toBe(5000);
	});

	test("emits usage.context for flat format with tokens_used/tokens_max", () => {
		const { parser, events } = createParser();

		parser.processLine({
			type: "system",
			subtype: "info",
			tokens_used: 100000,
			tokens_max: 200000,
		});

		const ctxEvents = events.filter((e) => e.type === "usage.context");
		expect(ctxEvents).toHaveLength(1);
		expect(ctxEvents[0]?.data["tokensUsed"]).toBe(100000);
		expect(ctxEvents[0]?.data["tokensMax"]).toBe(200000);
		expect(ctxEvents[0]?.data["percentUsed"]).toBeCloseTo(50);
	});

	test("context_window with zero tokensMax has 0% used", () => {
		const { parser, events } = createParser();

		parser.processLine({
			type: "system",
			subtype: "context_window",
			context_window: { tokens_used: 0, tokens_max: 0 },
		});

		const ctxEvents = events.filter((e) => e.type === "usage.context");
		expect(ctxEvents[0]?.data["percentUsed"]).toBe(0);
	});

	test("assistant message passes usage field through", () => {
		const { parser, events } = createParser();

		parser.processLine({
			type: "assistant",
			message: {
				uuid: "a1",
				model: "claude-opus-4",
				content: [{ type: "text", text: "Hello" }],
				usage: {
					input_tokens: 1000,
					output_tokens: 500,
					cache_creation_input_tokens: 200,
					cache_read_input_tokens: 100,
				},
			},
		});

		const assistantEvents = events.filter(
			(e) => e.type === "message.assistant",
		);
		expect(assistantEvents).toHaveLength(1);
		const usage = assistantEvents[0]?.data["usage"] as Record<string, unknown>;
		expect(usage["input_tokens"]).toBe(1000);
		expect(usage["output_tokens"]).toBe(500);
		expect(usage["cache_creation_input_tokens"]).toBe(200);
		expect(usage["cache_read_input_tokens"]).toBe(100);
	});
});

// ---------------------------------------------------------------------------
// get_usage integration test via WebSocket server
// ---------------------------------------------------------------------------

describe("Server get_usage", () => {
	let app: ReturnType<typeof createServer>;
	let port = 0;

	beforeAll(async () => {
		app = createServer({ port: 0 });
		await app.start();
		// biome-ignore lint: port is always assigned after Bun.serve
		port = app.server.port!;
	});

	afterAll(() => {
		app.stop();
	});

	function connectWs(): Promise<{ ws: WebSocket; messages: unknown[] }> {
		return new Promise((resolve, reject) => {
			const ws = new WebSocket(`ws://localhost:${port}`);
			const messages: unknown[] = [];
			ws.addEventListener("message", (e) => {
				messages.push(JSON.parse(e.data as string));
			});
			ws.onopen = () => resolve({ ws, messages });
			ws.onerror = (e) => reject(e);
		});
	}

	function waitForMessages(
		messages: unknown[],
		count: number,
		timeoutMs = 2000,
	): Promise<void> {
		if (messages.length >= count) return Promise.resolve();
		return new Promise((resolve, reject) => {
			const start = Date.now();
			const check = setInterval(() => {
				if (messages.length >= count) {
					clearInterval(check);
					resolve();
				} else if (Date.now() - start > timeoutMs) {
					clearInterval(check);
					reject(
						new Error(
							`Timed out waiting for ${count} messages, got ${messages.length}`,
						),
					);
				}
			}, 10);
		});
	}

	test("get_usage (global) returns usage response", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1); // snapshot

		ws.send(JSON.stringify({ type: "get_usage" }));
		await waitForMessages(messages, 2);

		const usageMsg = messages[1] as Record<string, unknown>;
		expect(usageMsg["type"]).toBe("usage");
		expect(typeof usageMsg["totalCostUsd"]).toBe("number");
		expect(typeof usageMsg["totalInputTokens"]).toBe("number");
		expect(typeof usageMsg["totalOutputTokens"]).toBe("number");
		expect(typeof usageMsg["sessionCount"]).toBe("number");
		ws.close();
	});

	test("get_usage with unknown sessionId returns zero values", async () => {
		const { ws, messages } = await connectWs();
		await waitForMessages(messages, 1); // snapshot

		ws.send(
			JSON.stringify({ type: "get_usage", sessionId: "nonexistent-session" }),
		);
		await waitForMessages(messages, 2);

		const usageMsg = messages[1] as Record<string, unknown>;
		expect(usageMsg["type"]).toBe("usage");
		expect(usageMsg["sessionId"]).toBe("nonexistent-session");
		expect(usageMsg["totalCostUsd"]).toBe(0);
		expect(usageMsg["inputTokens"]).toBe(0);
		ws.close();
	});
});

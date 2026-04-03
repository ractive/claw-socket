import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateAsyncApiSpec } from "../src/asyncapi-generator.ts";
import { createServer } from "../src/server.ts";

// Typed view of the spec so all access is via index signatures with bracket notation
interface AsyncApiSpecView {
	asyncapi: string;
	info: {
		title: string;
		version: string;
		description: string;
	};
	defaultContentType: string;
	servers: Record<
		string,
		{ host: string; protocol: string; description: string }
	>;
	channels: Record<string, unknown>;
	operations: Record<
		string,
		{ action: string; channel: unknown; messages: unknown[]; reply?: unknown }
	>;
	components: {
		messages: Record<
			string,
			{
				name: string;
				title: string;
				summary: string;
				contentType?: string;
				payload: unknown;
				traits?: unknown[];
				examples?: unknown[];
			}
		>;
		schemas: Record<string, unknown>;
		messageTraits: Record<string, unknown>;
	};
}

// ── Unit tests for the generator ─────────────────────────────────────────────

describe("generateAsyncApiSpec", () => {
	let spec: AsyncApiSpecView;

	beforeAll(() => {
		spec = generateAsyncApiSpec() as AsyncApiSpecView;
	});

	test("returns AsyncAPI 3.0.0 version", () => {
		expect(spec["asyncapi"]).toBe("3.0.0");
	});

	test("info block has title and version", () => {
		const info = spec["info"];
		expect(info["title"]).toBe("claw-socket");
		expect(typeof info["version"]).toBe("string");
		expect(info["version"].length).toBeGreaterThan(0);
	});

	test("sets defaultContentType to application/json", () => {
		expect(spec["defaultContentType"]).toBe("application/json");
	});

	test("info description explains how to connect", () => {
		const desc = spec["info"]["description"];
		expect(desc).toContain("ws://localhost");
		expect(desc).toContain("subscribe");
	});

	test("info description explains topic glob patterns", () => {
		const desc = spec["info"]["description"];
		expect(desc).toContain("session.*");
		expect(desc).toContain("tool.*");
		expect(desc).toContain("message.*");
		expect(desc).toContain("stream.*");
		expect(desc).toContain("hook.*");
		expect(desc).toContain("mcp.*");
		expect(desc).toContain("file.*");
		expect(desc).toContain("cwd.*");
		expect(desc).toContain("prompt.*");
		expect(desc).toContain("system.*");
	});

	test("info description lists request/response commands", () => {
		const desc = spec["info"]["description"];
		expect(desc).toContain("get_snapshot");
		expect(desc).toContain("get_session_list");
		expect(desc).toContain("get_session_history");
		expect(desc).toContain("get_usage");
		expect(desc).toContain("subscribe_agent_log");
		expect(desc).toContain("unsubscribe_agent_log");
		expect(desc).toContain("replay");
	});

	test("info description explains replay/reconnection", () => {
		const desc = spec["info"]["description"];
		expect(desc).toContain("seq");
		expect(desc).toContain("Replay");
	});

	test("has localhost WebSocket server defined", () => {
		const servers = spec["servers"];
		const localhost = servers["localhost"];
		expect(localhost).toBeDefined();
		expect(localhost?.["protocol"]).toBe("ws");
		expect(typeof localhost?.["host"]).toBe("string");
	});

	// ── Channel coverage ───────────────────────────────────────────────────

	const expectedChannels = [
		"session/events",
		"message/events",
		"tool/events",
		"stream/events",
		"agent/events",
		"usage/events",
		"hook/events",
		"mcp/events",
		"file/events",
		"cwd/events",
		"prompt/events",
		"system/events",
		"client/commands",
		"server/responses",
	];

	for (const channelKey of expectedChannels) {
		test(`channel "${channelKey}" is defined`, () => {
			const channels = spec["channels"];
			expect(channels[channelKey]).toBeDefined();
		});
	}

	// ── Message coverage ───────────────────────────────────────────────────

	const expectedMessageNames = [
		// session
		"session.discovered",
		"session.removed",
		"session.started",
		"session.state_changed",
		// message
		"message.user",
		"message.assistant",
		"message.result",
		// tool
		"tool.started",
		"tool.completed",
		"tool.failed",
		// stream
		"stream.delta",
		"stream.thinking_delta",
		"stream.tool_use_delta",
		// hook (core + summary + all Claude Code hook types)
		"hook.pre_tool_use",
		"hook.post_tool_use",
		"hook.post_tool_use_failure",
		"hook.started",
		"hook.completed",
		"hook.session_start",
		"hook.session_end",
		"hook.stop",
		"hook.subagent_start",
		"hook.subagent_stop",
		"hook.teammate_idle",
		"hook.permission_request",
		"hook.permission_denied",
		"hook.notification",
		"hook.user_prompt_submit",
		"hook.pre_compact",
		"hook.post_compact",
		"hook.elicitation",
		"hook.elicitation_result",
		"hook.config_change",
		"hook.instructions_loaded",
		"hook.cwd_changed",
		"hook.file_changed",
		"hook.task_created",
		"hook.task_completed",
		"hook.worktree_create",
		"hook.worktree_remove",
		// agent
		"agent.started",
		"agent.stopped",
		"agent.state_changed",
		// usage
		"usage.update",
		"usage.rate_limit",
		"usage.context",
		// mcp
		"mcp.server_status",
		"mcp.elicitation",
		"mcp.elicitation_result",
		// file / cwd / prompt / system
		"file.changed",
		"cwd.changed",
		"prompt.suggestion",
		"system.error",
		// server responses
		"snapshot",
		"subscribed",
		"unsubscribed",
		"session_list",
		"session_history",
		"usage",
		"subscribed_agent_log",
		"unsubscribed_agent_log",
		"agent_log",
		"error",
		// client commands
		"subscribe",
		"unsubscribe",
		"get_snapshot",
		"get_session_list",
		"get_session_history",
		"subscribe_agent_log",
		"unsubscribe_agent_log",
		"get_usage",
		"replay",
	];

	test("all expected event type messages are present in components", () => {
		const messages = spec["components"]["messages"];
		const allNames = Object.values(messages).map((m) => m["name"]);

		for (const name of expectedMessageNames) {
			expect(allNames).toContain(name);
		}
	});

	// ── Example payloads ───────────────────────────────────────────────────

	test("all component messages have at least one example", () => {
		const messages = spec["components"]["messages"];
		for (const [key, msg] of Object.entries(messages)) {
			const examples = msg["examples"];
			expect(
				examples !== undefined && examples.length > 0,
				`message "${key}" has no examples`,
			).toBe(true);
		}
	});

	test("server event example payloads have envelope shape", () => {
		const messages = spec["components"]["messages"];
		for (const [key, msg] of Object.entries(messages)) {
			// Skip non-enveloped messages (client commands and server responses)
			if (
				key.startsWith("client_commands__") ||
				key.startsWith("server_responses__")
			)
				continue;
			const examples = msg["examples"] as
				| Array<{ payload: Record<string, unknown> }>
				| undefined;
			if (!examples) continue;
			for (const ex of examples) {
				const p = ex["payload"];
				if ("timestamp" in p) {
					expect(
						typeof p["timestamp"],
						`${key} example timestamp should be number`,
					).toBe("number");
					expect(
						typeof p["sessionId"],
						`${key} example sessionId should be string`,
					).toBe("string");
				}
			}
		}
	});

	// ── Message traits ────────────────────────────────────────────────────

	test("eventEnvelope message trait is defined", () => {
		const traits = spec["components"]["messageTraits"];
		expect(traits["eventEnvelope"]).toBeDefined();
	});

	test("server event messages reference the envelope trait", () => {
		const messages = spec["components"]["messages"];
		// Pick a known server event
		const sessionDiscovered = Object.values(messages).find(
			(m) => m["name"] === "session.discovered",
		);
		expect(sessionDiscovered).toBeDefined();
		expect(sessionDiscovered?.["traits"]).toBeDefined();
		expect(sessionDiscovered?.["traits"]?.length).toBeGreaterThan(0);
	});

	test("client command messages do NOT reference the envelope trait", () => {
		const messages = spec["components"]["messages"];
		const subscribe = Object.values(messages).find(
			(m) => m["name"] === "subscribe",
		);
		expect(subscribe).toBeDefined();
		expect(subscribe?.["traits"]).toBeUndefined();
	});

	// ── Component schemas from Zod ─────────────────────────────────────────

	const expectedSchemas = [
		"EventEnvelope",
		"SessionInfo",
		"AgentState",
		"Snapshot",
		"SessionDiscovered",
		"SessionRemoved",
		"MessageUserEvent",
		"MessageAssistantEvent",
		"MessageResultEvent",
		"ToolStartedEvent",
		"ToolCompletedEvent",
		"ToolFailedEvent",
		"AgentStartedEvent",
		"AgentStoppedEvent",
		"ClientMessage",
		"SubscribeMessage",
		"UnsubscribeMessage",
		"UnsubscribeAgentLogMessage",
		"ReplayMessage",
	];

	for (const schemaName of expectedSchemas) {
		test(`component schema "${schemaName}" is present`, () => {
			const schemas = spec["components"]["schemas"];
			expect(schemas[schemaName]).toBeDefined();
		});
	}

	test("EventEnvelope schema is a JSON Schema object", () => {
		const schemas = spec["components"]["schemas"];
		const envSchema = schemas["EventEnvelope"] as Record<string, unknown>;
		expect(envSchema).toBeDefined();
		const hasType = "type" in envSchema;
		const hasSchemaRef = "$schema" in envSchema;
		expect(hasType || hasSchemaRef).toBe(true);
	});

	// ── Operations ─────────────────────────────────────────────────────────

	test("operations are defined", () => {
		const ops = spec["operations"];
		expect(Object.keys(ops).length).toBeGreaterThan(0);
	});

	test("client commands operation has action receive", () => {
		const ops = spec["operations"];
		const clientOp = ops["clientCommands"];
		expect(clientOp).toBeDefined();
		expect(clientOp?.["action"]).toBe("receive");
	});

	test("client commands operation has reply referencing server/responses", () => {
		const ops = spec["operations"];
		const clientOp = ops["clientCommands"];
		const reply = clientOp?.["reply"] as Record<string, unknown> | undefined;
		expect(reply).toBeDefined();
		const channel = reply?.["channel"] as Record<string, unknown>;
		expect(channel?.["$ref"]).toBe("#/channels/server~1responses");
	});

	test("server event operations have action send", () => {
		const ops = spec["operations"];
		for (const [key, op] of Object.entries(ops)) {
			if (key === "clientCommands") continue;
			expect(op["action"], `operation "${key}" should send`).toBe("send");
		}
	});

	test("every channel has a corresponding operation", () => {
		const ops = spec["operations"];
		const opChannelRefs = new Set(
			Object.values(ops).map(
				(op) => (op["channel"] as Record<string, string>)?.["$ref"],
			),
		);
		for (const channelKey of expectedChannels) {
			expect(
				opChannelRefs.has(
					`#/channels/${channelKey.replace(/~/g, "~0").replace(/\//g, "~1")}`,
				),
				`channel "${channelKey}" has no operation`,
			).toBe(true);
		}
	});

	// ── contentType ──────────────────────────────────────────────────────

	test("all component messages have contentType application/json", () => {
		const messages = spec["components"]["messages"];
		for (const [key, msg] of Object.entries(messages)) {
			expect(
				msg["contentType"],
				`message "${key}" should have contentType`,
			).toBe("application/json");
		}
	});

	// ── Serialization ─────────────────────────────────────────────────────

	test("spec serializes to valid JSON without throwing", () => {
		expect(() => JSON.stringify(spec)).not.toThrow();
		const serialized = JSON.stringify(spec);
		expect(JSON.parse(serialized)).toBeDefined();
	});
});

// ── HTTP endpoint tests ───────────────────────────────────────────────────────

describe("/asyncapi.json endpoint", () => {
	let app: ReturnType<typeof createServer>;
	let port: number;

	beforeAll(async () => {
		app = createServer({ port: 0 });
		await app.start();
		// biome-ignore lint: port is always assigned after Bun.serve
		port = app.server.port!;
	});

	afterAll(() => {
		app.stop();
	});

	test("returns 200 with JSON content-type", async () => {
		const res = await fetch(`http://localhost:${port}/asyncapi.json`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("application/json");
	});

	test("body is parseable JSON", async () => {
		const res = await fetch(`http://localhost:${port}/asyncapi.json`);
		const body: unknown = await res.json();
		expect(body).toBeDefined();
	});

	test("body is valid AsyncAPI 3.0.0 spec", async () => {
		const res = await fetch(`http://localhost:${port}/asyncapi.json`);
		const body = (await res.json()) as AsyncApiSpecView;
		expect(body["asyncapi"]).toBe("3.0.0");
		expect(body["info"]).toBeDefined();
		expect(body["channels"]).toBeDefined();
		expect(body["operations"]).toBeDefined();
	});

	test("spec contains all expected channel namespaces", async () => {
		const res = await fetch(`http://localhost:${port}/asyncapi.json`);
		const body = (await res.json()) as AsyncApiSpecView;
		const channels = body["channels"];
		for (const ch of [
			"session/events",
			"message/events",
			"tool/events",
			"stream/events",
			"hook/events",
			"agent/events",
			"usage/events",
			"mcp/events",
			"file/events",
			"cwd/events",
			"prompt/events",
			"system/events",
			"client/commands",
			"server/responses",
		]) {
			expect(
				channels[ch],
				`channel "${ch}" missing from HTTP response`,
			).toBeDefined();
		}
	});
});

describe("/docs endpoint", () => {
	let app: ReturnType<typeof createServer>;
	let port: number;

	beforeAll(async () => {
		app = createServer({ port: 0 });
		await app.start();
		// biome-ignore lint: port is always assigned after Bun.serve
		port = app.server.port!;
	});

	afterAll(() => {
		app.stop();
	});

	test("GET /docs returns HTML or 503 with helpful message", async () => {
		// public/index.html is generated offline by `bun run export-spec && asyncapi generate ...`
		// In CI without pre-generated docs the endpoint returns 503; with docs it returns 200.
		const res = await fetch(`http://localhost:${port}/docs`);
		if (res.status === 200) {
			expect(res.headers.get("content-type")).toContain("text/html");
		} else {
			expect(res.status).toBe(503);
			const body = await res.text();
			expect(body).toContain("bun run export-spec");
		}
	});
});

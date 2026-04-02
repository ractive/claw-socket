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
	servers: Record<
		string,
		{ host: string; protocol: string; description: string }
	>;
	channels: Record<string, unknown>;
	operations: Record<
		string,
		{ action: string; channel: unknown; messages: unknown[] }
	>;
	components: {
		messages: Record<
			string,
			{
				name: string;
				title: string;
				summary: string;
				payload: unknown;
				examples?: unknown[];
			}
		>;
		schemas: Record<string, unknown>;
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
	});

	test("info description lists request/response commands", () => {
		const desc = spec["info"]["description"];
		expect(desc).toContain("get_snapshot");
		expect(desc).toContain("get_session_list");
		expect(desc).toContain("get_session_history");
		expect(desc).toContain("get_usage");
		expect(desc).toContain("subscribe_agent_log");
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
		"hook/events",
		"agent/events",
		"usage/events",
		"client/commands",
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
		// hook
		"hook.pre_tool_use",
		"hook.post_tool_use",
		"hook.post_tool_use_failure",
		// agent
		"agent.started",
		"agent.stopped",
		"agent.state_changed",
		// usage
		"usage.update",
		"usage.rate_limit",
		"usage.context",
		// client commands
		"subscribe",
		"unsubscribe",
		"get_snapshot",
		"get_session_list",
		"get_session_history",
		"subscribe_agent_log",
		"get_usage",
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
			// Skip client command messages — they have no timestamp
			if (key.startsWith("client_commands_")) continue;
			const examples = msg["examples"] as
				| Array<{ payload: Record<string, unknown> }>
				| undefined;
			if (!examples) continue;
			for (const ex of examples) {
				const p = ex["payload"];
				// Server events always carry timestamp + sessionId
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
		// zodToJsonSchema produces either `type` or `$schema` at the top level
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

	test("server event operations have action send", () => {
		const ops = spec["operations"];
		for (const [key, op] of Object.entries(ops)) {
			if (key === "clientCommands") continue;
			expect(op["action"], `operation "${key}" should send`).toBe("send");
		}
	});

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
			"hook/events",
			"agent/events",
			"usage/events",
			"client/commands",
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

	test("returns 200 with HTML content-type", async () => {
		const res = await fetch(`http://localhost:${port}/docs`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/html");
	});

	test("body is an HTML document", async () => {
		const res = await fetch(`http://localhost:${port}/docs`);
		const html = await res.text();
		expect(html).toContain("<!DOCTYPE html>");
		expect(html).toContain("<html");
		expect(html).toContain("</html>");
	});

	test("page references AsyncAPI React component CDN", async () => {
		const res = await fetch(`http://localhost:${port}/docs`);
		const html = await res.text();
		expect(html).toContain("@asyncapi/react-component");
	});

	test("page loads spec from /asyncapi.json", async () => {
		const res = await fetch(`http://localhost:${port}/docs`);
		const html = await res.text();
		expect(html).toContain("/asyncapi.json");
	});

	test("page includes AsyncApiComponent.render call", async () => {
		const res = await fetch(`http://localhost:${port}/docs`);
		const html = await res.text();
		expect(html).toContain("AsyncApiComponent.render");
	});
});

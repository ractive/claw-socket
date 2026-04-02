import type { ParsedEvent } from "./jsonl-parser.ts";
import { type HookPayload, HookPayloadSchema } from "./schemas/hook.ts";
import { truncate } from "./utils.ts";

/** Convert PascalCase hook type to snake_case for our event namespace */
function toSnakeCase(s: string): string {
	return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

export type HookResult =
	| { ok: true; events: ParsedEvent[] }
	| { ok: false; error: string };

/**
 * Validate and process an incoming hook payload into ParsedEvents.
 * Returns one or more events per hook (some hooks produce side-effect events).
 */
export function processHookEvent(raw: unknown): HookResult {
	const result = HookPayloadSchema.safeParse(raw);
	if (!result.success) {
		return { ok: false, error: result.error.message };
	}

	const payload = result.data;
	const events = mapHookToEvents(payload);
	return { ok: true, events };
}

function makeEvent(
	type: string,
	payload: HookPayload,
	data: Record<string, unknown>,
): ParsedEvent {
	return {
		type,
		sessionId: payload.sessionId,
		data,
		...(payload.agentId ? { agentId: payload.agentId } : {}),
	};
}

function mapHookToEvents(payload: HookPayload): ParsedEvent[] {
	const { type, data } = payload;
	const events: ParsedEvent[] = [];

	// Always emit the hook.* event with full data
	const hookType = `hook.${toSnakeCase(type)}`;
	events.push(makeEvent(hookType, payload, { ...data }));

	// For certain hook types, also produce agent-tracker-compatible events
	switch (type) {
		case "PreToolUse": {
			const toolName =
				typeof data["tool_name"] === "string" ? data["tool_name"] : "unknown";
			const toolUseId =
				typeof data["tool_use_id"] === "string"
					? data["tool_use_id"]
					: undefined;
			let inputSummary = "";
			if (data["tool_input"] !== undefined) {
				try {
					inputSummary = truncate(JSON.stringify(data["tool_input"]), 500);
				} catch {
					inputSummary = "";
				}
			}
			events[0] = makeEvent(hookType, payload, {
				...data,
				toolName,
				toolUseId,
				inputSummary,
			});
			events.push(
				makeEvent("hook.started", payload, {
					hookType: "PreToolUse",
					toolName,
				}),
			);
			break;
		}

		case "PostToolUse": {
			const toolName =
				typeof data["tool_name"] === "string" ? data["tool_name"] : "unknown";
			const toolUseId =
				typeof data["tool_use_id"] === "string"
					? data["tool_use_id"]
					: undefined;
			let outputSummary = "";
			if (data["tool_response"] !== undefined) {
				try {
					outputSummary = truncate(
						typeof data["tool_response"] === "string"
							? data["tool_response"]
							: JSON.stringify(data["tool_response"]),
						500,
					);
				} catch {
					outputSummary = "";
				}
			}
			events[0] = makeEvent(hookType, payload, {
				...data,
				toolName,
				toolUseId,
				outputSummary,
			});
			events.push(
				makeEvent("hook.completed", payload, {
					hookType: "PostToolUse",
					toolName,
					success: true,
				}),
			);
			break;
		}

		case "PostToolUseFailure": {
			const toolName =
				typeof data["tool_name"] === "string" ? data["tool_name"] : "unknown";
			const error =
				typeof data["error"] === "string" ? data["error"] : "unknown error";
			const isInterrupt = Boolean(data["is_interrupt"]);
			events[0] = makeEvent(hookType, payload, {
				...data,
				toolName,
				error,
				isInterrupt,
			});
			events.push(
				makeEvent("hook.completed", payload, {
					hookType: "PostToolUseFailure",
					toolName,
					success: false,
				}),
			);
			break;
		}

		case "SessionStart": {
			// Extract MCP server status if present
			const mcpServers = data["mcp_servers"];
			if (Array.isArray(mcpServers)) {
				for (const server of mcpServers) {
					if (typeof server !== "object" || server === null) continue;
					const s = server as Record<string, unknown>;
					const serverName =
						typeof s["name"] === "string" ? s["name"] : undefined;
					if (!serverName) continue;
					const status =
						typeof s["status"] === "string" ? s["status"] : "unknown";
					const url = typeof s["url"] === "string" ? s["url"] : undefined;
					const tools = Array.isArray(s["tools"]) ? s["tools"] : undefined;
					events.push(
						makeEvent("mcp.server_status", payload, {
							serverName,
							status,
							...(url ? { url } : {}),
							...(tools ? { tools } : {}),
						}),
					);
				}
			}
			break;
		}

		case "SubagentStart": {
			const agentId =
				typeof data["agent_id"] === "string"
					? data["agent_id"]
					: payload.agentId;
			const agentType =
				typeof data["agent_type"] === "string"
					? data["agent_type"]
					: "subagent";
			const cwd = typeof data["cwd"] === "string" ? data["cwd"] : undefined;
			if (agentId) {
				events.push({
					type: "agent.started",
					sessionId: payload.sessionId,
					agentId,
					data: {
						agentId,
						agentType,
						...(cwd ? { cwd } : {}),
						source: "hook",
					},
				});
			}
			break;
		}

		case "SubagentStop": {
			const agentId =
				typeof data["agent_id"] === "string"
					? data["agent_id"]
					: payload.agentId;
			if (agentId) {
				events.push({
					type: "agent.stopped",
					sessionId: payload.sessionId,
					agentId,
					data: { agentId, source: "hook" },
				});
			}
			break;
		}

		case "SessionEnd": {
			// Mark the master agent as offline
			const masterAgentId = `master-${payload.sessionId}`;
			events.push({
				type: "agent.stopped",
				sessionId: payload.sessionId,
				agentId: masterAgentId,
				data: {
					agentId: masterAgentId,
					reason:
						typeof data["reason"] === "string" ? data["reason"] : "session_end",
					source: "hook",
				},
			});
			break;
		}

		case "Elicitation": {
			const question =
				typeof data["question"] === "string" ? data["question"] : "";
			const options = Array.isArray(data["options"])
				? data["options"]
				: undefined;
			const timeout =
				typeof data["timeout"] === "number" ? data["timeout"] : undefined;
			const source =
				typeof data["source"] === "string" ? data["source"] : undefined;
			events.push(
				makeEvent("mcp.elicitation", payload, {
					question,
					...(options ? { options } : {}),
					...(timeout !== undefined ? { timeout } : {}),
					...(source ? { source } : {}),
				}),
			);
			break;
		}

		case "ElicitationResult": {
			const answer =
				typeof data["answer"] === "string" ? data["answer"] : undefined;
			const source =
				typeof data["source"] === "string" ? data["source"] : undefined;
			events.push(
				makeEvent("mcp.elicitation_result", payload, {
					...(answer !== undefined ? { answer } : {}),
					...(source ? { source } : {}),
				}),
			);
			break;
		}

		case "FileChanged": {
			const path = typeof data["path"] === "string" ? data["path"] : "";
			const changeType =
				typeof data["change_type"] === "string"
					? data["change_type"]
					: undefined;
			events.push(
				makeEvent("file.changed", payload, {
					path,
					...(changeType ? { changeType } : {}),
				}),
			);
			break;
		}

		case "CwdChanged": {
			const newCwd =
				typeof data["cwd"] === "string"
					? data["cwd"]
					: typeof data["new_cwd"] === "string"
						? data["new_cwd"]
						: "";
			const oldCwd =
				typeof data["old_cwd"] === "string" ? data["old_cwd"] : undefined;
			events.push(
				makeEvent("cwd.changed", payload, {
					newCwd,
					...(oldCwd ? { oldCwd } : {}),
				}),
			);
			break;
		}
	}

	return events;
}

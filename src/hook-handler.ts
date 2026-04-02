import type { ParsedEvent } from "./jsonl-parser.ts";
import { type HookPayload, HookPayloadSchema } from "./schemas/hook.ts";

/** Convert PascalCase hook type to snake_case for our event namespace */
function toSnakeCase(s: string): string {
	return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function truncate(str: string, maxLen: number): string {
	if (str.length <= maxLen) return str;
	return str.slice(0, maxLen);
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
	}

	return events;
}

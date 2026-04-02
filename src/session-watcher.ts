import { homedir } from "node:os";
import { join } from "node:path";
import {
	type AgentState,
	AgentTracker,
	type AgentTrackerOptions,
} from "./agent-tracker.ts";
import { JsonlParser, type ParsedEvent } from "./jsonl-parser.ts";
import { JsonlWatcher, type JsonlWatcherOptions } from "./jsonl-watcher.ts";

export interface SessionWatcherOptions {
	onEvent: (event: ParsedEvent) => void;
	onAgentStateChange: (agents: AgentState[]) => void;
	onRawLine?: (sessionId: string, line: Record<string, unknown>) => void;
	watcherOptions?: JsonlWatcherOptions;
	trackerOptions?: AgentTrackerOptions;
}

interface WatchedSession {
	watcher: JsonlWatcher;
	parser: JsonlParser;
	jsonlPath: string;
}

export function deriveJsonlPath(sessionId: string, cwd: string): string {
	const projectKey = cwd.replace(/[\\/]/g, "-").replace(/^-/, "");
	return join(
		homedir(),
		".claude",
		"projects",
		projectKey,
		`${sessionId}.jsonl`,
	);
}

export class SessionWatcher {
	private readonly sessions = new Map<string, WatchedSession>();
	private readonly tracker: AgentTracker;
	private readonly onEvent: (event: ParsedEvent) => void;
	private readonly onAgentStateChange: (agents: AgentState[]) => void;
	private readonly onRawLine:
		| ((sessionId: string, line: Record<string, unknown>) => void)
		| undefined;
	private readonly watcherOptions: JsonlWatcherOptions | undefined;

	constructor(options: SessionWatcherOptions) {
		this.onEvent = options.onEvent;
		this.onAgentStateChange = options.onAgentStateChange;
		this.onRawLine = options.onRawLine;
		this.watcherOptions = options.watcherOptions;

		this.tracker = new AgentTracker(options.trackerOptions);
		this.tracker.onStalenessChange = () => {
			this.onAgentStateChange(this.tracker.getAgents());
		};
		this.tracker.startStalenessCheck();
	}

	watchSession(sessionId: string, cwd: string): void {
		if (this.sessions.has(sessionId)) return;

		const jsonlPath = deriveJsonlPath(sessionId, cwd);

		const parser = new JsonlParser(sessionId, (event: ParsedEvent) => {
			this.tracker.handleEvent(event);
			this.onEvent(event);
			this.onAgentStateChange(this.tracker.getAgents());
		});

		const watcher = new JsonlWatcher(
			jsonlPath,
			(line) => {
				parser.processLine(line);
				this.onRawLine?.(sessionId, line);
			},
			this.watcherOptions,
		);

		// Register master agent for this session
		const agentId = `master-${sessionId}`;
		this.tracker.registerAgent(agentId, sessionId, "master", cwd);

		this.sessions.set(sessionId, { watcher, parser, jsonlPath });
		watcher.start();
	}

	unwatchSession(sessionId: string): void {
		const session = this.sessions.get(sessionId);
		if (!session) return;

		session.watcher.stop();
		this.tracker.removeAgentsBySession(sessionId);
		this.sessions.delete(sessionId);
	}

	/** Event types that the agent tracker actually handles */
	private static readonly TRACKER_EVENTS = new Set([
		"agent.started",
		"agent.stopped",
		"tool.started",
		"tool.completed",
		"tool.failed",
		"hook.pre_tool_use",
		"hook.post_tool_use",
		"hook.post_tool_use_failure",
		"message.assistant",
		"message.result",
	]);

	/**
	 * Feed an external event (e.g. from HTTP hooks) into the agent tracker.
	 * Only broadcasts agent state changes for events the tracker handles.
	 */
	handleExternalEvent(event: ParsedEvent): void {
		if (!SessionWatcher.TRACKER_EVENTS.has(event.type)) return;
		this.tracker.handleEvent(event);
		this.onAgentStateChange(this.tracker.getAgents());
	}

	getAgents(): AgentState[] {
		return this.tracker.getAgents();
	}

	/** Returns the JSONL file path for a watched session, or null if not watched. */
	getJsonlPath(sessionId: string): string | null {
		return this.sessions.get(sessionId)?.jsonlPath ?? null;
	}

	stop(): void {
		for (const [_sessionId, session] of this.sessions) {
			session.watcher.stop();
		}
		this.sessions.clear();
		this.tracker.clear();
		this.tracker.stopStalenessCheck();
	}
}

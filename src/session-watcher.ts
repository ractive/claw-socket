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
	watcherOptions?: JsonlWatcherOptions;
	trackerOptions?: AgentTrackerOptions;
}

interface WatchedSession {
	watcher: JsonlWatcher;
	parser: JsonlParser;
}

function deriveJsonlPath(sessionId: string, cwd: string): string {
	const projectKey = cwd.replace(/\//g, "-").replace(/^-/, "");
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
	private readonly watcherOptions: JsonlWatcherOptions | undefined;

	constructor(options: SessionWatcherOptions) {
		this.onEvent = options.onEvent;
		this.onAgentStateChange = options.onAgentStateChange;
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
		});

		const watcher = new JsonlWatcher(
			jsonlPath,
			(line) => {
				parser.processLine(line);
			},
			this.watcherOptions,
		);

		// Register master agent for this session
		const agentId = `master-${sessionId}`;
		this.tracker.registerAgent(agentId, sessionId, "master", cwd);

		this.sessions.set(sessionId, { watcher, parser });
		watcher.start();
	}

	unwatchSession(sessionId: string): void {
		const session = this.sessions.get(sessionId);
		if (!session) return;

		session.watcher.stop();
		this.tracker.removeAgentsBySession(sessionId);
		this.sessions.delete(sessionId);
	}

	getAgents(): AgentState[] {
		return this.tracker.getAgents();
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

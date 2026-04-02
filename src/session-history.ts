import { JsonlParser, type ParsedEvent } from "./jsonl-parser.ts";
import type { SessionInfo } from "./schemas/index.ts";
import type { SessionDiscovery } from "./session-discovery.ts";
import { deriveJsonlPath, type SessionWatcher } from "./session-watcher.ts";

/** Maximum JSONL file size to read for session history (10 MB) */
const MAX_HISTORY_FILE_BYTES = 10 * 1_048_576;

export async function readSessionHistory(
	sessionId: string,
	limit: number,
	sessionWatcher: SessionWatcher,
	discovery: SessionDiscovery,
): Promise<ParsedEvent[]> {
	let jsonlPath = sessionWatcher.getJsonlPath(sessionId);

	if (!jsonlPath) {
		const sessions = discovery.getSessions();
		const found = sessions.find((s: SessionInfo) => s.sessionId === sessionId);
		if (found) {
			jsonlPath = deriveJsonlPath(sessionId, found.cwd);
		}
	}

	if (!jsonlPath) {
		return [];
	}

	const file = Bun.file(jsonlPath);
	let text: string;
	try {
		const size = file.size;
		if (size > MAX_HISTORY_FILE_BYTES) {
			return [];
		}
		text = await file.text();
	} catch {
		return [];
	}

	const events: ParsedEvent[] = [];
	const parser = new JsonlParser(sessionId, (event) => {
		events.push(event);
	});

	for (const rawLine of text.split("\n")) {
		const trimmed = rawLine.trim();
		if (!trimmed) continue;
		try {
			const parsed: unknown = JSON.parse(trimmed);
			if (
				typeof parsed === "object" &&
				parsed !== null &&
				!Array.isArray(parsed)
			) {
				parser.processLine(parsed as Record<string, unknown>);
			}
		} catch {
			// Skip malformed lines
		}
	}

	return limit > 0 ? events.slice(-limit) : events;
}

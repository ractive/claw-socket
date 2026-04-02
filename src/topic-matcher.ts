/**
 * Matches event types against glob-style topic patterns.
 *
 * Supported patterns:
 *   "*"           — matches everything
 *   "session.*"   — matches session.discovered, session.removed, etc.
 *   "tool.started" — exact match
 */
export function topicMatches(eventType: string, pattern: string): boolean {
	if (pattern === "*") return true;
	if (pattern === eventType) return true;

	// Glob: "session.*" matches "session.discovered"
	if (pattern.endsWith(".*")) {
		const prefix = pattern.slice(0, -2);
		return eventType.startsWith(`${prefix}.`);
	}

	return false;
}

/** Check if an event type matches any pattern in a set */
export function matchesAny(eventType: string, patterns: Set<string>): boolean {
	for (const pattern of patterns) {
		if (topicMatches(eventType, pattern)) return true;
	}
	return false;
}

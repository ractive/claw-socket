import type { ParsedEvent } from "./jsonl-parser.ts";

export interface ModelUsage {
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
}

export interface SessionUsage {
	sessionId: string;
	inputTokens: number;
	outputTokens: number;
	cacheCreationInputTokens: number;
	cacheReadInputTokens: number;
	totalCostUsd: number;
	durationMs: number;
	durationApiMs: number;
	numTurns: number;
	modelBreakdown: Map<string, ModelUsage>;
	lastUpdatedAt: number;
}

export interface GlobalUsage {
	totalCostUsd: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	sessionCount: number;
	modelBreakdown: Record<string, ModelUsage>;
}

type UsageEventCallback = (
	type: string,
	sessionId: string,
	data: Record<string, unknown>,
) => void;

function extractNumber(
	obj: Record<string, unknown>,
	key: string,
): number | undefined {
	const val = obj[key];
	return typeof val === "number" ? val : undefined;
}

export class UsageTracker {
	private readonly sessions = new Map<string, SessionUsage>();
	private onEvent: UsageEventCallback | null;

	constructor(onEvent?: UsageEventCallback) {
		this.onEvent = onEvent ?? null;
	}

	private getOrCreate(sessionId: string): SessionUsage {
		let session = this.sessions.get(sessionId);
		if (!session) {
			session = {
				sessionId,
				inputTokens: 0,
				outputTokens: 0,
				cacheCreationInputTokens: 0,
				cacheReadInputTokens: 0,
				totalCostUsd: 0,
				durationMs: 0,
				durationApiMs: 0,
				numTurns: 0,
				modelBreakdown: new Map(),
				lastUpdatedAt: Date.now(),
			};
			this.sessions.set(sessionId, session);
		}
		return session;
	}

	private emitUsageUpdate(session: SessionUsage): void {
		if (this.onEvent === null) return;
		const modelBreakdown: Record<string, ModelUsage> = {};
		for (const [model, usage] of session.modelBreakdown) {
			modelBreakdown[model] = { ...usage };
		}
		this.onEvent("usage.update", session.sessionId, {
			sessionId: session.sessionId,
			inputTokens: session.inputTokens,
			outputTokens: session.outputTokens,
			cacheCreationInputTokens: session.cacheCreationInputTokens,
			cacheReadInputTokens: session.cacheReadInputTokens,
			totalCostUsd: session.totalCostUsd,
			durationMs: session.durationMs,
			durationApiMs: session.durationApiMs,
			numTurns: session.numTurns,
			modelBreakdown,
			lastUpdatedAt: session.lastUpdatedAt,
		});
	}

	handleEvent(event: ParsedEvent): void {
		switch (event.type) {
			case "message.assistant":
				this.handleAssistantMessage(event);
				break;
			case "message.result":
				this.handleResultMessage(event);
				break;
			case "usage.rate_limit":
			case "usage.context":
				// These are emitted by processLine directly; pass them through
				break;
		}
	}

	private handleAssistantMessage(event: ParsedEvent): void {
		const session = this.getOrCreate(event.sessionId);
		session.lastUpdatedAt = Date.now();

		// Extract usage from the message's usage field (passed in data)
		const usage = event.data["usage"];
		const model =
			typeof event.data["model"] === "string" ? event.data["model"] : undefined;

		if (typeof usage === "object" && usage !== null) {
			const u = usage as Record<string, unknown>;
			const inputTokens = extractNumber(u, "input_tokens") ?? 0;
			const outputTokens = extractNumber(u, "output_tokens") ?? 0;
			const cacheCreation =
				extractNumber(u, "cache_creation_input_tokens") ?? 0;
			const cacheRead = extractNumber(u, "cache_read_input_tokens") ?? 0;

			session.inputTokens += inputTokens;
			session.outputTokens += outputTokens;
			session.cacheCreationInputTokens += cacheCreation;
			session.cacheReadInputTokens += cacheRead;

			// Per-model breakdown
			if (model) {
				const existing = session.modelBreakdown.get(model) ?? {
					inputTokens: 0,
					outputTokens: 0,
					costUsd: 0,
				};
				existing.inputTokens += inputTokens;
				existing.outputTokens += outputTokens;
				session.modelBreakdown.set(model, existing);
			}
		}

		this.emitUsageUpdate(session);
	}

	private handleResultMessage(event: ParsedEvent): void {
		const session = this.getOrCreate(event.sessionId);
		session.lastUpdatedAt = Date.now();

		const d = event.data as Record<string, unknown>;
		const totalCostUsd = extractNumber(d, "totalCostUsd");
		const durationMs = extractNumber(d, "durationMs");
		const durationApiMs = extractNumber(d, "durationApiMs");
		const numTurns = extractNumber(d, "numTurns");

		if (totalCostUsd !== undefined) session.totalCostUsd = totalCostUsd;
		if (durationMs !== undefined) session.durationMs = durationMs;
		if (durationApiMs !== undefined) session.durationApiMs = durationApiMs;
		if (numTurns !== undefined) session.numTurns = numTurns;

		// Process per-model usage from result's usage field
		const usage = d["usage"];
		if (typeof usage === "object" && usage !== null) {
			const u = usage as Record<string, unknown>;
			// Result usage may contain per-model breakdown as an array or nested object
			// Handle flat usage object
			const inputTokens = extractNumber(u, "input_tokens");
			const outputTokens = extractNumber(u, "output_tokens");
			const cacheCreation = extractNumber(u, "cache_creation_input_tokens");
			const cacheRead = extractNumber(u, "cache_read_input_tokens");

			// Only override if we got actual values (result is the authoritative source)
			if (inputTokens !== undefined) session.inputTokens = inputTokens;
			if (outputTokens !== undefined) session.outputTokens = outputTokens;
			if (cacheCreation !== undefined)
				session.cacheCreationInputTokens = cacheCreation;
			if (cacheRead !== undefined) session.cacheReadInputTokens = cacheRead;

			// Per-model breakdown from result: handle array of { model, usage } entries
			const models = u["models"];
			if (Array.isArray(models)) {
				for (const entry of models) {
					if (typeof entry !== "object" || entry === null) continue;
					const e = entry as Record<string, unknown>;
					const modelName =
						typeof e["model"] === "string" ? e["model"] : undefined;
					if (!modelName) continue;
					const mu = e["usage"];
					if (typeof mu !== "object" || mu === null) continue;
					const mUsage = mu as Record<string, unknown>;
					const mInput = extractNumber(mUsage, "input_tokens") ?? 0;
					const mOutput = extractNumber(mUsage, "output_tokens") ?? 0;
					const mCost = extractNumber(mUsage, "cost_usd") ?? 0;
					session.modelBreakdown.set(modelName, {
						inputTokens: mInput,
						outputTokens: mOutput,
						costUsd: mCost,
					});
				}
			}
		}

		this.emitUsageUpdate(session);
	}

	getSessionUsage(sessionId: string): SessionUsage | undefined {
		return this.sessions.get(sessionId);
	}

	getGlobalUsage(): GlobalUsage {
		let totalCostUsd = 0;
		let totalInputTokens = 0;
		let totalOutputTokens = 0;
		const modelBreakdown: Record<string, ModelUsage> = {};

		for (const session of this.sessions.values()) {
			totalCostUsd += session.totalCostUsd;
			totalInputTokens += session.inputTokens;
			totalOutputTokens += session.outputTokens;

			for (const [model, usage] of session.modelBreakdown) {
				const existing = modelBreakdown[model] ?? {
					inputTokens: 0,
					outputTokens: 0,
					costUsd: 0,
				};
				existing.inputTokens += usage.inputTokens;
				existing.outputTokens += usage.outputTokens;
				existing.costUsd += usage.costUsd;
				modelBreakdown[model] = existing;
			}
		}

		return {
			totalCostUsd,
			totalInputTokens,
			totalOutputTokens,
			sessionCount: this.sessions.size,
			modelBreakdown,
		};
	}

	clear(): void {
		this.sessions.clear();
	}
}

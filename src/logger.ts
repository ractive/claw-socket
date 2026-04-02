export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

export interface LoggerOptions {
	level?: LogLevel;
	/** Emit JSON lines when true, human-readable when false */
	structured?: boolean;
}

export interface Logger {
	debug(msg: string, fields?: Record<string, unknown>): void;
	info(msg: string, fields?: Record<string, unknown>): void;
	warn(msg: string, fields?: Record<string, unknown>): void;
	error(msg: string, fields?: Record<string, unknown>): void;
	child(fields: Record<string, unknown>): Logger;
}

/** Strip newlines and carriage returns to prevent log injection in plain-text output. */
function sanitize(s: string): string {
	return s.replace(/[\r\n]/g, " ");
}

/**
 * Sanitize all string values within a fields object for plain-text log output.
 * Non-string values are left as-is since they will be JSON-serialized.
 */
function sanitizeFields(
	fields: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(fields)) {
		out[k] = typeof v === "string" ? sanitize(v) : v;
	}
	return out;
}

function writeLog(
	level: LogLevel,
	msg: string,
	fields: Record<string, unknown>,
	structured: boolean,
): void {
	const ts = new Date().toISOString();
	if (structured) {
		// JSON output: JSON.stringify handles special characters safely.
		const line = JSON.stringify({ level, ts, msg, ...fields });
		if (level === "error" || level === "warn") {
			console.error(line);
		} else {
			console.log(line);
		}
	} else {
		// Human-readable output: strip newlines from message and field values to
		// prevent log injection (a crafted value could fake additional log lines).
		const safeMsg = sanitize(msg);
		const safeFields = sanitizeFields(fields);
		const extra =
			Object.keys(safeFields).length > 0
				? ` ${JSON.stringify(safeFields)}`
				: "";
		const line = `[${ts}] ${level.toUpperCase()} ${safeMsg}${extra}`;
		if (level === "error" || level === "warn") {
			console.error(line);
		} else {
			console.log(line);
		}
	}
}

export function createLogger(options: LoggerOptions = {}): Logger {
	const minLevel = options.level ?? "info";
	const structured = options.structured ?? false;
	const baseFields: Record<string, unknown> = {};

	function makeLogger(extraFields: Record<string, unknown>): Logger {
		const merged = { ...baseFields, ...extraFields };

		function log(
			level: LogLevel,
			msg: string,
			fields?: Record<string, unknown>,
		): void {
			if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return;
			writeLog(level, msg, { ...merged, ...(fields ?? {}) }, structured);
		}

		return {
			debug: (msg, fields) => log("debug", msg, fields),
			info: (msg, fields) => log("info", msg, fields),
			warn: (msg, fields) => log("warn", msg, fields),
			error: (msg, fields) => log("error", msg, fields),
			child: (fields) => makeLogger({ ...merged, ...fields }),
		};
	}

	return makeLogger({});
}

/** Module-level default logger; replaced by CLI setup */
export let logger: Logger = createLogger({ level: "info", structured: false });

export function setLogger(l: Logger): void {
	logger = l;
}

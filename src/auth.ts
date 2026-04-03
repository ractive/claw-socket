import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const TOKEN_DIR = join(homedir(), ".claw-socket");
const TOKEN_PATH = join(TOKEN_DIR, "token");

/** Length of the generated token in bytes (renders as 64 hex chars) */
const TOKEN_BYTES = 32;

/** Valid token format: exactly 64 lowercase hex characters */
const TOKEN_RE = /^[0-9a-f]{64}$/;

/**
 * Read an existing token from `~/.claw-socket/token`, or generate a new one.
 * Creates the directory (mode 700) and file (mode 600) if they don't exist.
 * Returns the hex-encoded token string.
 */
export async function ensureToken(): Promise<string> {
	try {
		const existing = await readFile(TOKEN_PATH, "utf-8");
		const trimmed = existing.trim();
		if (TOKEN_RE.test(trimmed)) return trimmed;
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
	}

	// Generate and persist a new token
	return writeNewToken();
}

/**
 * Force-regenerate the token, overwriting any existing one.
 * Returns the new hex-encoded token string.
 */
export function rotateToken(): Promise<string> {
	return writeNewToken();
}

/** Returns the path where the token is stored. */
export function tokenPath(): string {
	return TOKEN_PATH;
}

async function writeNewToken(): Promise<string> {
	const token = randomBytes(TOKEN_BYTES).toString("hex");
	await mkdir(TOKEN_DIR, { recursive: true, mode: 0o700 });
	// Ensure permissions even if the directory or file already existed
	// (mkdir/writeFile modes only apply when creating new filesystem entries)
	await chmod(TOKEN_DIR, 0o700);
	await writeFile(TOKEN_PATH, `${token}\n`, { encoding: "utf-8", mode: 0o600 });
	await chmod(TOKEN_PATH, 0o600);
	return token;
}

import { watch, type FSWatcher } from "fs";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { SessionFileSchema, type SessionInfo } from "./schemas/index.ts";

export type SessionEvent =
  | { type: "session.discovered"; session: SessionInfo }
  | { type: "session.removed"; sessionId: string; reason: "process_exited" | "file_removed" };

export type SessionEventHandler = (event: SessionEvent) => void;

const SESSIONS_DIR = join(homedir(), ".claude", "sessions");
const LIVENESS_INTERVAL_MS = 10_000;

export class SessionDiscovery {
  private sessions = new Map<string, SessionInfo>();
  private watcher: FSWatcher | null = null;
  private livenessTimer: ReturnType<typeof setInterval> | null = null;
  private handler: SessionEventHandler;

  constructor(handler: SessionEventHandler) {
    this.handler = handler;
  }

  /** Get all currently tracked sessions */
  getSessions(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  /** Start watching for sessions */
  async start(): Promise<void> {
    // Initial scan
    await this.scanSessions();

    // Watch for new/removed session files
    try {
      this.watcher = watch(SESSIONS_DIR, (eventType, filename) => {
        if (!filename?.endsWith(".json")) return;
        if (eventType === "rename") {
          // File added or removed — rescan the specific file
          this.handleFileChange(filename);
        }
      });
    } catch {
      // Sessions dir may not exist yet — that's fine
    }

    // Periodic liveness check
    this.livenessTimer = setInterval(() => this.checkLiveness(), LIVENESS_INTERVAL_MS);
  }

  /** Stop watching */
  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.livenessTimer) {
      clearInterval(this.livenessTimer);
      this.livenessTimer = null;
    }
  }

  private async scanSessions(): Promise<void> {
    let files: string[];
    try {
      files = await readdir(SESSIONS_DIR);
    } catch {
      return; // Dir doesn't exist yet
    }

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      await this.tryAddSession(file);
    }
  }

  private async handleFileChange(filename: string): Promise<void> {
    const added = await this.tryAddSession(filename);
    if (!added) {
      // File was removed — check if we were tracking a session from this file
      const pid = parseInt(filename.replace(".json", ""), 10);
      if (isNaN(pid)) return;
      for (const [id, session] of this.sessions) {
        if (session.pid === pid) {
          this.sessions.delete(id);
          this.handler({ type: "session.removed", sessionId: id, reason: "file_removed" });
          break;
        }
      }
    }
  }

  private async tryAddSession(filename: string): Promise<boolean> {
    const filePath = join(SESSIONS_DIR, filename);
    try {
      const content = await readFile(filePath, "utf-8");
      const parsed = SessionFileSchema.safeParse(JSON.parse(content));
      if (!parsed.success) return false;

      const { pid, sessionId, cwd, startedAt } = parsed.data;

      // Already tracking?
      if (this.sessions.has(sessionId)) return true;

      // Validate PID is alive
      if (!isProcessAlive(pid)) return false;

      const session: SessionInfo = { pid, sessionId, cwd, startedAt, discoveredAt: Date.now() };
      this.sessions.set(sessionId, session);
      this.handler({ type: "session.discovered", session });
      return true;
    } catch {
      return false;
    }
  }

  private checkLiveness(): void {
    for (const [id, session] of this.sessions) {
      if (!isProcessAlive(session.pid)) {
        this.sessions.delete(id);
        this.handler({ type: "session.removed", sessionId: id, reason: "process_exited" });
      }
    }
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

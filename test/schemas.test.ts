import { describe, expect, test } from "bun:test";
import {
  EventEnvelopeSchema,
  SessionFileSchema,
  ClientMessageSchema,
  SnapshotSchema,
  envelope,
} from "../src/schemas/index.ts";

describe("EventEnvelopeSchema", () => {
  test("validates a well-formed envelope", () => {
    const ev = envelope("session.discovered", "abc-123", { pid: 1234 });
    const result = EventEnvelopeSchema.safeParse(ev);
    expect(result.success).toBe(true);
  });

  test("includes optional agentId", () => {
    const ev = envelope("tool.started", "abc-123", { toolName: "Read" }, "agent-1");
    expect(ev.agentId).toBe("agent-1");
    expect(EventEnvelopeSchema.safeParse(ev).success).toBe(true);
  });

  test("rejects missing type", () => {
    const result = EventEnvelopeSchema.safeParse({ timestamp: 1, sessionId: "x", data: {} });
    expect(result.success).toBe(false);
  });
});

describe("SessionFileSchema", () => {
  test("validates real session file format", () => {
    const result = SessionFileSchema.safeParse({
      pid: 39377,
      sessionId: "1372b12d-85e8-4e1a-8cbf-461580f66201",
      cwd: "/Users/james/devel/hyalo",
      startedAt: 1775113108698,
    });
    expect(result.success).toBe(true);
  });

  test("rejects missing pid", () => {
    const result = SessionFileSchema.safeParse({
      sessionId: "abc",
      cwd: "/tmp",
      startedAt: 123,
    });
    expect(result.success).toBe(false);
  });
});

describe("ClientMessageSchema", () => {
  test("parses subscribe", () => {
    const result = ClientMessageSchema.safeParse({
      type: "subscribe",
      topics: ["session.*", "tool.*"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("subscribe");
    }
  });

  test("parses subscribe with sessionId filter", () => {
    const result = ClientMessageSchema.safeParse({
      type: "subscribe",
      topics: ["*"],
      sessionId: "abc-123",
    });
    expect(result.success).toBe(true);
  });

  test("parses unsubscribe", () => {
    const result = ClientMessageSchema.safeParse({
      type: "unsubscribe",
      topics: ["stream.*"],
    });
    expect(result.success).toBe(true);
  });

  test("parses get_snapshot", () => {
    const result = ClientMessageSchema.safeParse({ type: "get_snapshot" });
    expect(result.success).toBe(true);
  });

  test("rejects empty topics on subscribe", () => {
    const result = ClientMessageSchema.safeParse({
      type: "subscribe",
      topics: [],
    });
    expect(result.success).toBe(false);
  });

  test("rejects unknown message type", () => {
    const result = ClientMessageSchema.safeParse({ type: "nope" });
    expect(result.success).toBe(false);
  });
});

describe("SnapshotSchema", () => {
  test("validates snapshot with sessions", () => {
    const result = SnapshotSchema.safeParse({
      type: "snapshot",
      sessions: [
        { pid: 123, sessionId: "abc", cwd: "/tmp", startedAt: 100, discoveredAt: 200 },
      ],
    });
    expect(result.success).toBe(true);
  });

  test("validates empty snapshot", () => {
    const result = SnapshotSchema.safeParse({ type: "snapshot", sessions: [] });
    expect(result.success).toBe(true);
  });
});

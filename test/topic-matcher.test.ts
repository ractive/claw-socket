import { describe, expect, test } from "bun:test";
import { topicMatches, matchesAny } from "../src/topic-matcher.ts";

describe("topicMatches", () => {
  test("wildcard * matches everything", () => {
    expect(topicMatches("session.discovered", "*")).toBe(true);
    expect(topicMatches("tool.started", "*")).toBe(true);
  });

  test("exact match", () => {
    expect(topicMatches("session.discovered", "session.discovered")).toBe(true);
    expect(topicMatches("session.discovered", "session.removed")).toBe(false);
  });

  test("glob pattern session.*", () => {
    expect(topicMatches("session.discovered", "session.*")).toBe(true);
    expect(topicMatches("session.removed", "session.*")).toBe(true);
    expect(topicMatches("tool.started", "session.*")).toBe(false);
  });

  test("glob pattern tool.*", () => {
    expect(topicMatches("tool.started", "tool.*")).toBe(true);
    expect(topicMatches("tool.completed", "tool.*")).toBe(true);
    expect(topicMatches("session.discovered", "tool.*")).toBe(false);
  });

  test("no match for partial prefix without glob", () => {
    expect(topicMatches("session.discovered", "session")).toBe(false);
  });
});

describe("matchesAny", () => {
  test("matches if any pattern matches", () => {
    const patterns = new Set(["session.*", "tool.started"]);
    expect(matchesAny("session.discovered", patterns)).toBe(true);
    expect(matchesAny("tool.started", patterns)).toBe(true);
    expect(matchesAny("tool.completed", patterns)).toBe(false);
  });

  test("empty set matches nothing", () => {
    expect(matchesAny("session.discovered", new Set())).toBe(false);
  });
});

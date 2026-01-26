import { test, describe } from "node:test";
import assert from "node:assert";
import { parseCompactMeta, groom } from "./lib/commit-parser.js";

// Helper to create a mock commit object
function mockCommit(message) {
  return {
    sha: "abc123",
    commit: {
      message,
      author: { date: "2025-01-22T10:00:00Z" }
    },
    author: { login: "testuser" },
    html_url: "https://github.com/test/repo/commit/abc123"
  };
}

describe("parseCompactMeta", () => {
  test("parses hours and minutes with status", () => {
    const result = parseCompactMeta("2h30 done");
    assert.deepStrictEqual(result, { duration: 150, status: "done" });
  });

  test("parses hours and minutes without status", () => {
    const result = parseCompactMeta("2h30");
    assert.deepStrictEqual(result, { duration: 150, status: "" });
  });

  test("parses minutes only with status", () => {
    const result = parseCompactMeta("45m wip");
    assert.deepStrictEqual(result, { duration: 45, status: "wip" });
  });

  test("parses minutes only without status", () => {
    const result = parseCompactMeta("30m");
    assert.deepStrictEqual(result, { duration: 30, status: "" });
  });

  test("parses hours only", () => {
    const result = parseCompactMeta("1h");
    assert.deepStrictEqual(result, { duration: 60, status: "" });
  });

  test("parses with explicit m suffix after h", () => {
    const result = parseCompactMeta("2h30m done");
    assert.deepStrictEqual(result, { duration: 150, status: "done" });
  });

  test("is case insensitive", () => {
    const result = parseCompactMeta("2H30M DONE");
    assert.deepStrictEqual(result, { duration: 150, status: "DONE" });
  });

  test("returns null for invalid format", () => {
    assert.strictEqual(parseCompactMeta("invalid"), null);
    assert.strictEqual(parseCompactMeta("done"), null);
    assert.strictEqual(parseCompactMeta("2 30"), null);
  });

  test("parses implicit minutes [5 done]", () => {
    const result = parseCompactMeta("5 done");
    assert.deepStrictEqual(result, { duration: 5, status: "done" });
  });

  test("parses implicit minutes [30 wip]", () => {
    const result = parseCompactMeta("30 wip");
    assert.deepStrictEqual(result, { duration: 30, status: "wip" });
  });
});

describe("groom - compact format", () => {
  test("parses [2h30 done]", () => {
    const commit = mockCommit("Title\n[2h30 done]\nDescription");
    const result = groom(commit);
    assert.strictEqual(result.duration, 150);
    assert.strictEqual(result.status, "done");
    assert.strictEqual(result.name, "Title");
    assert.strictEqual(result.description, "Description");
  });

  test("parses [45m wip]", () => {
    const commit = mockCommit("Title\n[45m wip]");
    const result = groom(commit);
    assert.strictEqual(result.duration, 45);
    assert.strictEqual(result.status, "wip");
  });

  test("parses [1h] without status", () => {
    const commit = mockCommit("Title\n[1h]");
    const result = groom(commit);
    assert.strictEqual(result.duration, 60);
    assert.strictEqual(result.status, "");
  });

  test("parses [30m] without status", () => {
    const commit = mockCommit("Title\n[30m]");
    const result = groom(commit);
    assert.strictEqual(result.duration, 30);
    assert.strictEqual(result.status, "");
  });
});

describe("groom - classic format", () => {
  test("parses [2][30][done]", () => {
    const commit = mockCommit("Title\n[2][30][done]\nDescription");
    const result = groom(commit);
    assert.strictEqual(result.duration, 150);
    assert.strictEqual(result.status, "done");
  });

  test("parses [90] as 90 minutes", () => {
    const commit = mockCommit("Title\n[90]");
    const result = groom(commit);
    assert.strictEqual(result.duration, 90);
  });

  test("parses [done] status only", () => {
    const commit = mockCommit("Title\n[done]");
    const result = groom(commit);
    assert.strictEqual(result.duration, 0);
    assert.strictEqual(result.status, "done");
  });

  test("parses [2][done] as 2 minutes + status", () => {
    const commit = mockCommit("Title\n[2][done]");
    const result = groom(commit);
    assert.strictEqual(result.duration, 2);
    assert.strictEqual(result.status, "done");
  });
});

describe("groom - implicit minutes format", () => {
  test("parses [5 done] as 5 minutes", () => {
    const commit = mockCommit("Title\n[5 done]");
    const result = groom(commit);
    assert.strictEqual(result.duration, 5);
    assert.strictEqual(result.status, "done");
  });

  test("parses [30 wip] as 30 minutes", () => {
    const commit = mockCommit("Title\n[30 wip]");
    const result = groom(commit);
    assert.strictEqual(result.duration, 30);
    assert.strictEqual(result.status, "wip");
  });
});

describe("groom - metadata in title", () => {
  test("parses metadata in title and strips it", () => {
    const commit = mockCommit("feat: add login [30m done]");
    const result = groom(commit);
    assert.strictEqual(result.duration, 30);
    assert.strictEqual(result.status, "done");
    assert.strictEqual(result.name, "feat: add login");
  });

  test("parses implicit minutes in title [5 done]", () => {
    const commit = mockCommit("fix: bug [5 done]");
    const result = groom(commit);
    assert.strictEqual(result.duration, 5);
    assert.strictEqual(result.status, "done");
    assert.strictEqual(result.name, "fix: bug");
  });

  test("parses metadata at start of title", () => {
    const commit = mockCommit("[1h wip] refactor code");
    const result = groom(commit);
    assert.strictEqual(result.duration, 60);
    assert.strictEqual(result.status, "wip");
    assert.strictEqual(result.name, "refactor code");
  });
});

describe("groom - metadata on any line", () => {
  test("finds metadata on line 3", () => {
    const commit = mockCommit("Title\nSome description\n[45m done]");
    const result = groom(commit);
    assert.strictEqual(result.duration, 45);
    assert.strictEqual(result.status, "done");
    assert.strictEqual(result.name, "Title");
    assert.strictEqual(result.description, "Some description");
  });

  test("finds metadata on line 4", () => {
    const commit = mockCommit("Title\nLine 2\nLine 3\n[2h wip]");
    const result = groom(commit);
    assert.strictEqual(result.duration, 120);
    assert.strictEqual(result.status, "wip");
    assert.strictEqual(result.name, "Title");
    assert.strictEqual(result.description, "Line 2\nLine 3");
  });

  test("prefers first metadata found (title over body)", () => {
    const commit = mockCommit("Title [30m done]\n[1h wip]");
    const result = groom(commit);
    assert.strictEqual(result.duration, 30);
    assert.strictEqual(result.status, "done");
  });
});

describe("groom - edge cases", () => {
  test("handles single-line commit (no metadata)", () => {
    const commit = mockCommit("Title only");
    const result = groom(commit);
    assert.strictEqual(result.duration, 0);
    assert.strictEqual(result.status, "");
    assert.strictEqual(result.name, "Title only");
  });

  test("extracts commit metadata correctly", () => {
    const commit = mockCommit("Title\n[1h]");
    const result = groom(commit);
    assert.strictEqual(result.sha, "abc123");
    assert.strictEqual(result.author, "testuser");
    assert.strictEqual(result.date, "2025-01-22T10:00:00Z");
    assert.strictEqual(result.url, "https://github.com/test/repo/commit/abc123");
  });
});

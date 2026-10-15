import { test, describe } from "node:test";
import assert from "node:assert";
import { findMarkdownMetadata, groomIssueComment, groom } from "./lib/commit-parser.js";
import { applyExceptions } from "./lib/journal-generator.js";
import { renderMarkdown, escapeCell } from "./lib/markdown-export.js";
import { explainGithubError } from "./lib/issue-reader.js";
import { condenseDescription } from "./lib/description-filter.js";
import { descriptionCell } from "./lib/markdown-export.js";

function mockComment(body) {
  return {
    id: 42,
    body,
    created_at: "2026-10-15T08:30:00Z",
    user: { login: "XCarrel" },
    html_url: "https://github.com/o/r/issues/92#issuecomment-42",
    issue_url: "https://api.github.com/repos/o/r/issues/92"
  };
}

describe("findMarkdownMetadata", () => {
  test("parses compact format and strips it", () => {
    const r = findMarkdownMetadata("[45m done] Tests concluants");
    assert.deepStrictEqual(r, { duration: 45, status: "done", text: "Tests concluants" });
  });

  test("parses classic format on its own line", () => {
    const r = findMarkdownMetadata("Communication établie\n[1][30][WIP]\nReste les consignes");
    assert.deepStrictEqual(r, { duration: 90, status: "WIP", text: "Communication établie\nReste les consignes" });
  });

  test("ignores links and checkboxes", () => {
    const r = findMarkdownMetadata("- [x] voir [la doc](https://x.y)\n- [ ] tester\nFait [2h wip]");
    assert.strictEqual(r.duration, 120);
    assert.strictEqual(r.status, "wip");
    assert.strictEqual(r.text, "- [x] voir [la doc](https://x.y)\n- [ ] tester\nFait");
  });

  test("ignores status-only brackets", () => {
    const r = findMarkdownMetadata("[WIP] pas de durée");
    assert.deepStrictEqual(r, { duration: 0, status: "", text: "[WIP] pas de durée" });
  });
});

describe("groomIssueComment", () => {
  test("builds a journal entry", () => {
    const e = groomIssueComment(mockComment("[30m done] Ok"), { number: 92, title: "Pilotage Batterie" });
    assert.strictEqual(e.commentId, 42);
    assert.strictEqual(e.source, "issue");
    assert.strictEqual(e.name, "#92 Pilotage Batterie");
    assert.strictEqual(e.description, "Ok");
    assert.strictEqual(e.duration, 30);
    assert.strictEqual(e.author, "XCarrel");
  });

  test("falls back on issue_url when the issue is unknown", () => {
    const e = groomIssueComment(mockComment("[30m]"), undefined);
    assert.strictEqual(e.issueNumber, 92);
    assert.strictEqual(e.name, "#92");
  });
});

describe("groom - text next to metadata on another line", () => {
  test("keeps the descriptive text", () => {
    const r = groom({
      sha: "a",
      commit: { message: "Title\n[30m done] tests unitaires", author: { date: "2026-01-01T00:00:00Z" } },
      html_url: ""
    });
    assert.strictEqual(r.description, "tests unitaires");
  });
});

describe("applyExceptions", () => {
  test("excludes and patches commits", () => {
    const entries = [
      { sha: "aaa", source: "commit", branch: "main", duration: 10 },
      { sha: "bbb", source: "commit", branch: "develop", duration: 20 }
    ];
    const { patched } = applyExceptions(entries, [
      { sha: "aaa", excluded: true },
      { sha: "bbb", duration: 25, patch: true }
    ]);
    assert.deepStrictEqual(patched, [{ source: "commit", branch: "develop", sha: "bbb", duration: 25, patch: true }]);
  });
});

describe("renderMarkdown", () => {
  const entries = [
    { source: "commit", sha: "a3f8c21ffff", branch: "develop", url: "u1", name: "Régulateur", description: "", date: "2026-10-15T07:00:00Z", duration: 90, status: "Done" },
    { source: "issue", issueNumber: 92, url: "u2", name: "#92 Batterie", description: "a | b\nc", date: "2026-10-14T22:30:00Z", duration: 45, status: "WIP" }
  ];
  const md = renderMarkdown(entries, { title: "Labo", now: new Date("2026-10-15T12:00:00Z") });

  test("groups by day in the configured timezone, most recent first", () => {
    // 22:30 UTC le 14 = 00:30 le 15 à Zurich : les deux entrées sont le même jour
    assert.match(md, /## Jeudi 15 octobre 2026 — 2h15/);
    assert.doesNotMatch(md, /14 octobre/);
  });

  test("renders sources and durations", () => {
    assert.match(md, /\| 00:30 \| \[#92\]\(u2\) \| #92 Batterie \| a \\\| b<br>c \| 0h45 \| WIP \|/);
    assert.match(md, /\[`a3f8c21`\]\(u1\) \(develop\)/);
  });

  test("escapes HTML", () => {
    assert.strictEqual(escapeCell("<script>"), "&lt;script&gt;");
  });
});

describe("explainGithubError", () => {
  const res = (status, headers = {}) => ({ status, headers: new Map(Object.entries(headers)) });

  test("401 blames the token", () => {
    assert.match(explainGithubError(res(401), "o/r", true), /^Accès refusé, probablement à cause du token/);
  });

  test("403 distinguishes rate limit from missing permission", () => {
    assert.match(explainGithubError(res(403, { "x-ratelimit-remaining": "0" }), "o/r", false), /Limite de requêtes/);
    assert.match(explainGithubError(res(403), "o/r", true), /permission « Issues : Read-only »/);
  });

  test("404 suggests a token for private repos", () => {
    assert.match(explainGithubError(res(404), "o/r", false), /définissez un token/);
  });
});

describe("condenseDescription", () => {
  test("replaces a run of adjacent tags by a single marker", () => {
    const { lines } = condenseDescription("Voir <details> <summary>Logs</summary><!-- note --> fin");
    assert.deepStrictEqual(lines, [[{ text: "Voir" }, { tags: true }, { text: "Logs" }, { tags: true }, { text: "fin" }]]);
  });

  test("leaves comparisons and plain text alone", () => {
    const { lines } = condenseDescription("si a < b et b > c");
    assert.deepStrictEqual(lines, [[{ text: "si a < b et b > c" }]]);
  });

  test("keeps 10 non-empty lines then announces more", () => {
    const text = Array.from({ length: 12 }, (_, i) => `ligne ${i + 1}`).join("\n\n");
    const { lines, more } = condenseDescription(text, "issue");
    assert.strictEqual(lines.length, 10);
    assert.deepStrictEqual(lines[9], [{ text: "ligne 10" }]);
    assert.strictEqual(more, "(plus sur l'issue…)");
  });

  test("no marker at exactly 10 lines", () => {
    const text = Array.from({ length: 10 }, (_, i) => `l${i}`).join("\n");
    assert.strictEqual(condenseDescription(text, "commit").more, null);
  });
});

describe("descriptionCell", () => {
  test("renders tags and truncation in italics", () => {
    const description = "<b>Gras</b> texte\n" + Array.from({ length: 11 }, (_, i) => `l${i}`).join("\n");
    const cell = descriptionCell({ description, source: "commit", url: "u" });
    assert.match(cell, /^\*\(balises\)\* Gras \*\(balises\)\* texte<br>l0/);
    assert.match(cell, /<br>\*\[\(plus sur le commit…\)\]\(u\)\*$/);
    assert.strictEqual(cell.split("<br>").length, 11);
  });
});

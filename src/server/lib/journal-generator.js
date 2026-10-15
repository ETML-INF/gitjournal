import { execFile } from "child_process";
import { promisify } from "util";
import { groom, groomIssueComment } from "./commit-parser.js";
import { readIssueComments } from "./issue-reader.js";

const execFileAsync = promisify(execFile);

export function parseRepoUrl(repoUrl) {
  if (!repoUrl) return {};
  const m = repoUrl.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!m) return {};
  return { owner: m[1], repo: m[2] };
}

export async function getRemoteBaseUrl(repoPath) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoPath, "remote", "get-url", "origin"], { timeout: 5000 });
    const remote = stdout.trim();
    // SSH → HTTPS : git@github.com:user/repo.git → https://github.com/user/repo
    const sshMatch = remote.match(/git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/);
    if (sshMatch) return `https://${sshMatch[1]}/${sshMatch[2]}/${sshMatch[3]}`;
    // Supprime aussi d'éventuels identifiants (https://x-access-token:...@github.com/...)
    return remote
      .replace(/\/\/[^/@]+@/, "//")
      .replace(/\.git$/, "")
      .replace(/\/+$/, "");
  } catch {
    return "";
  }
}

// refs/remotes/origin/develop → develop
function shortRef(ref) {
  return ref.replace(/^refs\/(heads|tags)\//, "").replace(/^refs\/remotes\/[^/]+\//, "");
}

/**
 * Lit les commits depuis le dépôt git local via `git log`.
 * Filtre par auteur (--author=me) et par date de début (--after=since).
 * Parcourt toutes les branches (--all, sans les tags) et déduplique par SHA.
 */
export async function readLocalCommits(repoPath, me, since, baseUrl) {
  // Séparateurs qui n'apparaissent pas dans les messages de commit
  const FIELD_SEP = "\x1e"; // ASCII 30
  const COMMIT_SEP = "\x1d"; // ASCII 29

  // %S = référence par laquelle le commit a été atteint, %B = message complet (sujet + corps)
  const fmt = `%H${FIELD_SEP}%an${FIELD_SEP}%ad${FIELD_SEP}%S${FIELD_SEP}%B${COMMIT_SEP}`;

  const authors = (Array.isArray(me) ? me : [me]).filter(Boolean);
  const args = [
    "-C",
    repoPath,
    "log",
    // Toutes les branches locales et distantes, sans tags ni stash (pour que %S désigne une branche)
    "--exclude=refs/tags/*",
    "--exclude=refs/stash",
    "--all",
    "--source",
    ...authors.map((a) => `--author=${a}`),
    "--date=iso-strict",
    `--format=format:${fmt}`
  ];

  if (since) args.push(`--after=${since}`);

  let stdout;
  try {
    ({ stdout } = await execFileAsync("git", args, { maxBuffer: 50 * 1024 * 1024 }));
  } catch (e) {
    return []; // Repo vide ou aucun commit encore
  }
  if (!stdout.trim()) return [];

  baseUrl = baseUrl ? baseUrl.replace(/\/+$/, "") : "";
  const seenShas = new Set();
  const commits = [];

  for (const record of stdout.split(COMMIT_SEP)) {
    const trimmed = record.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(FIELD_SEP);
    if (parts.length < 5) continue;

    const sha = parts[0].trim();
    const authorName = parts[1].trim();
    const date = parts[2].trim();
    const branch = shortRef(parts[3].trim());
    // Le message est tout ce qui suit (réassemblé au cas où il contiendrait FIELD_SEP)
    const message = parts.slice(4).join(FIELD_SEP).trim();

    if (!sha || sha.length < 7) continue;
    if (seenShas.has(sha)) continue;
    seenShas.add(sha);

    const url = baseUrl ? `${baseUrl}/commit/${sha}` : "";

    // Construit un objet compatible avec groom()
    commits.push({
      sha,
      branch,
      commit: {
        message,
        author: { date, name: authorName }
      },
      author: { login: authorName },
      html_url: url
    });
  }
  return commits;
}

/**
 * Applique les exceptions du .gitj (exclusions, modifications, entrées manuelles).
 */
export function applyExceptions(entries, exceptions = []) {
  const keyOf = (x) => (x.sha || x.id || "").toLowerCase().trim();

  const excludedShas = new Set(exceptions.filter((e) => e.excluded === true).map((e) => (e.sha || "").toLowerCase().trim()));
  const notExcluded = entries.filter((e) => !excludedShas.has((e.sha || "").toLowerCase().trim()));

  const excByKey = new Map(exceptions.map((x) => [keyOf(x), x]));
  const patched = notExcluded.map((e) => {
    const repl = excByKey.get(keyOf(e));
    if (repl && !repl.excluded) return { source: e.source, branch: e.branch, ...repl };
    return e;
  });

  const manualEntries = exceptions.filter((e) => e.type == "commitless").map((e) => ({ source: "manual", ...e }));
  return { notExcluded, patched, manualEntries };
}

/**
 * Rassemble toutes les entrées du journal : commits (toutes branches), commentaires d'issues, entrées manuelles.
 * Les commits doivent avoir une durée et passent par les exceptions du .gitj ;
 * les commentaires d'issues sont tous repris tels quels.
 *
 * @param {Object} opts
 * @param {Object} opts.project - Contenu du .gitj (me, journalStartDate, exceptions, githubUsers)
 * @param {string} opts.repoPath - Dossier du dépôt git local
 * @param {boolean} [opts.includeIssues] - Lire les commentaires d'issues via l'API GitHub
 * @param {string} [opts.token] - Token GitHub (requis pour les dépôts privés)
 */
export async function collectEntries({ project, repoPath, includeIssues = false, token = "" }) {
  const { me: meRaw, journalStartDate } = project;
  const meAuthors = (Array.isArray(meRaw) ? meRaw : [meRaw]).filter(Boolean);
  const remoteBaseUrl = repoPath ? await getRemoteBaseUrl(repoPath) : "";
  const { owner, repo } = parseRepoUrl(remoteBaseUrl);

  const stats = {
    fromUser: 0,
    withMetadata: 0,
    issueComments: 0,
    issuesError: null,
    afterExclusions: 0,
    manualEntries: 0,
    total: 0
  };

  let entries = [];
  if (repoPath) {
    const raw = await readLocalCommits(repoPath, meAuthors, journalStartDate, remoteBaseUrl);
    stats.fromUser = raw.length;
    entries = raw
      .filter((c) => !c.commit.author.name.endsWith("[bot]")) // ex. commits du journal par github-actions[bot]
      .map((c) => ({ ...groom(c), source: "commit", branch: c.branch }))
      .filter((e) => e.duration > 0);
    stats.withMetadata = entries.length;
  }

  const { notExcluded, patched, manualEntries } = applyExceptions(entries, project.exceptions || []);
  stats.afterExclusions = notExcluded.length;
  stats.manualEntries = manualEntries.length;
  let all = patched.concat(manualEntries);

  if (includeIssues && owner && repo) {
    try {
      const users = [...meAuthors, ...(project.githubUsers || [])].map((u) => u.toLowerCase());
      const fetched = await readIssueComments({ owner, repo, token, since: journalStartDate });
      const mine = users.length ? fetched.filter(({ comment }) => users.includes((comment.user?.login || "").toLowerCase())) : fetched;
      stats.issueComments = mine.length;
      all = all.concat(mine.map(({ comment, issue }) => groomIssueComment(comment, issue)));
    } catch (e) {
      stats.issuesError = e.message;
    }
  }

  stats.total = all.length;

  return { entries: all, stats, owner, repo, remoteBaseUrl };
}

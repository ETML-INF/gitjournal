import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const API = "https://api.github.com";

/**
 * Cherche un token GitHub : variables d'environnement (GitHub Actions), puis GitHub CLI.
 * Retourne "" si aucun n'est disponible.
 */
export async function resolveGithubToken() {
  const fromEnv = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (fromEnv) return fromEnv;
  try {
    const { stdout } = await execFileAsync("gh", ["auth", "token"], { timeout: 5000 });
    return stdout.trim();
  } catch {
    return "";
  }
}

// Traduit une réponse d'erreur de l'API GitHub en message compréhensible
export function explainGithubError(res, repoLabel, hasToken) {
  if (res.status === 401) {
    return "Accès refusé, probablement à cause du token : il est invalide, expiré ou révoqué.";
  }
  if (res.status === 403 || res.status === 429) {
    if (res.headers.get("x-ratelimit-remaining") === "0") {
      return hasToken
        ? "Limite de requêtes GitHub atteinte. Réessayez dans quelques minutes."
        : "Limite de requêtes GitHub atteinte (60 par heure sans token). Définissez un token dans les Préférences.";
    }
    return `Accès refusé : le token n'a pas la permission de lire les issues de ${repoLabel} (permission « Issues : Read-only »), ou l'organisation ne l'a pas encore approuvé.`;
  }
  if (res.status === 404) {
    return hasToken
      ? `Dépôt ${repoLabel} introuvable : le token n'a probablement pas accès à ce dépôt.`
      : `Dépôt ${repoLabel} introuvable : s'il est privé, définissez un token dans les Préférences.`;
  }
  return `Erreur GitHub ${res.status} lors de la lecture des issues de ${repoLabel}.`;
}

// Suit l'en-tête Link de l'API REST pour récupérer toutes les pages
async function fetchAllPages(url, token, repoLabel) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "gitjournal"
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const items = [];
  let next = url;
  while (next) {
    let res;
    try {
      res = await fetch(next, { headers });
    } catch {
      throw new Error("Impossible de joindre GitHub : vérifiez la connexion internet.");
    }
    if (!res.ok) {
      console.warn(`GitHub API ${res.status} sur ${next} : ${(await res.text()).slice(0, 200)}`);
      throw new Error(explainGithubError(res, repoLabel, Boolean(token)));
    }
    items.push(...(await res.json()));
    next = res.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1] || null;
  }
  return items;
}

/**
 * Lit tous les commentaires d'issues (et de pull requests) d'un dépôt, avec l'issue correspondante.
 * `since` filtre sur la date de création du commentaire (l'API, elle, filtre sur la date de modification).
 * @returns {Promise<Array<{comment: Object, issue: Object|undefined}>>}
 */
export async function readIssueComments({ owner, repo, token, since }) {
  const base = `${API}/repos/${owner}/${repo}`;
  const sinceParam = since ? `&since=${encodeURIComponent(new Date(since).toISOString())}` : "";

  const repoLabel = `${owner}/${repo}`;
  const [comments, issues] = await Promise.all([
    fetchAllPages(`${base}/issues/comments?per_page=100&sort=created&direction=asc${sinceParam}`, token, repoLabel),
    // Une issue commentée après `since` a forcément été modifiée après `since`
    fetchAllPages(`${base}/issues?state=all&per_page=100${sinceParam}`, token, repoLabel)
  ]);

  const issuesByUrl = new Map(issues.map((i) => [i.url, i]));
  const sinceTime = since ? new Date(since).getTime() : -Infinity;

  return comments
    .filter((c) => new Date(c.created_at).getTime() >= sinceTime)
    .map((comment) => ({ comment, issue: issuesByUrl.get(comment.issue_url) }));
}

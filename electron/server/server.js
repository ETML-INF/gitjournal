import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import expressLayouts from "express-ejs-layouts";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const GH = "https://api.github.com";

// Variables globales pour stocker les données du projet en cours
let currentProject = null;  // Les données du fichier .gitj
let githubToken = null;     // Le token GitHub

// Callback pour notifier main.js des changements
let onProjectChangeCallback = null;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout"); // => views/layout.ejs
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public"))); // optionnel pour CSS/images
app.use(express.json());

/**
 * Fonction appelée par main.js pour injecter les données du projet
 */
export function setProjectData(projectData, token) {
  currentProject = projectData;
  githubToken = token;
}

/**
 * Fonction pour enregistrer un callback appelé quand le projet change
 */
export function onProjectChange(callback) {
  onProjectChangeCallback = callback;
}

function ghHeaders() {
  const h = { Accept: "application/vnd.github+json" };
  if (githubToken) h["Authorization"] = `Bearer ${githubToken}`;
  return h;
}

function parseRepoUrl(repoUrl) {
  if (!repoUrl) return {};
  const m = repoUrl.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!m) return {};
  return { owner: m[1], repo: m[2] };
}

async function fetchBranches(owner, repo) {
  const url = `${GH}/repos/${owner}/${repo}/branches?per_page=100`;
  const r = await fetch(url, { headers: ghHeaders() });
  if (!r.ok) throw new Error(`GitHub branches error ${r.status}`);
  const data = await r.json();
  return data.map((b) => b.name);
}

async function fetchAllCommits({ owner, repo, branch, since }) {
  const perPage = 100;
  let page = 1;
  let all = [];
  let keep = true;
  while (keep) {
    const params = new URLSearchParams({ sha: branch, per_page: `${perPage}`, page: `${page}` });
    if (since) params.set("since", since);
    const url = `${GH}/repos/${owner}/${repo}/commits?${params}`;
    const r = await fetch(url, { headers: ghHeaders() });
    if (!r.ok) {
      let errorMsg = '';

      if (r.status === 401) {
        errorMsg = 'Token GitHub invalide ou expiré. Veuillez vérifier votre token dans Préférences.';
      } else if (r.status === 404) {
        errorMsg = `Repository "${owner}/${repo}" non trouvé. Vérifiez l'URL du repository ou que vous avez accès à ce repository.`;
      } else if (r.status === 403) {
        errorMsg = 'Limite de taux GitHub dépassée ou accès refusé. Vérifiez votre token GitHub.';
      } else {
        errorMsg = `Erreur GitHub API (${r.status}): ${r.statusText}`;
      }

      throw new Error(errorMsg);
    }
    const batch = await r.json();
    all = all.concat(batch);
    keep = batch.length === perPage;
    page++;
  }
  return all;
}

function groom(commit) {
  // 1ère ligne=titre, 2e ligne=meta [hh][mm][status], reste=description
  let duration = 0;
  let status = "";
  const lines = commit.commit.message.split("\n").filter((l) => l.trim() !== "");
  if (lines.length > 1) {
    const metaLine = lines[1];
    const matches = [...metaLine.matchAll(/\[(.*?)\]/g)].map((m) => m[1]);
    if (matches.length) {
      for (const m of matches) {
        const nums = m.match(/\d+/g);
        if (!nums) {
          status = m;
        } else if (nums.length < 3) {
          nums.forEach((n) => {
            duration = duration * 60 + parseInt(n);
          });
        }
      }
    }
  }
  return {
    sha: commit.sha,
    name: lines[0] || commit.commit.message.split("\n")[0],
    description: lines.slice(2).join("\n"),
    date: commit.commit.author.date,
    duration,
    status,
    author: commit.author?.login || commit.commit?.author?.name || "?",
    url: commit.html_url
  };
}

function totalDuration(commits) {
  const mins = commits.reduce((acc, c) => acc + (Number(c.duration) || 0), 0);
  const h = Math.floor(mins / 60),
    m = mins % 60;
  return { minutes: mins, h, m };
}

// helpers de format
const fmtDayLabel = (d) =>
  new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(d));

const toDayKey = (isoLike) => new Date(isoLike).toISOString().slice(0, 10); // "YYYY-MM-DD"

const sumMinutes = (items) => items.reduce((acc, c) => acc + (c.duration || 0), 0);

// entries: [{ date: ISO, duration: minutes, ... }]
function groupByDay(entries) {
  // assure l'ordre chronologique croissant (ou inverse si tu préfères)
  const sorted = [...entries].sort((a, b) => new Date(a.date) - new Date(b.date));

  const groupsMap = new Map(); // préserve l'ordre d'insertion
  for (const c of sorted) {
    const key = toDayKey(c.date);
    if (!groupsMap.has(key)) groupsMap.set(key, []);
    groupsMap.get(key).push(c);
  }

  // transforme en array de groupes avec label + totals
  const groups = [];
  for (const [day, commits] of groupsMap.entries()) {
    const minutes = sumMinutes(commits);
    groups.push({
      day, // "2025-01-10"
      label: fmtDayLabel(day), // "10 janv. 2025"
      commits,
      total: {
        minutes,
        h: Math.floor(minutes / 60),
        m: minutes % 60
      }
    });
  }
  return groups;
}

// === Validation ===
function validateException(x) {
  // minimal: name, date (ISO), duration en minutes
  if (!x || typeof x !== "object") return "Objet invalide";
  if (!x.name) return "Champ 'name' requis";
  if (!x.date || isNaN(new Date(x.date))) return "Champ 'date' invalide (ISO attendu)";
  if (x.duration == null || isNaN(Number(x.duration))) return "Champ 'duration' requis (minutes)";
  return null;
}

// Page d'accueil + génération serveur
app.get(["/", "/jdt"], async (req, res) => {
  try {
    // Vérifier qu'un projet est ouvert
    if (!currentProject) {
      return res.render('no-project', {
        message: 'Aucun projet ouvert. Utilisez Fichier > Ouvrir ou Nouveau projet.'
      });
    }

    const { repoUrl, projectName, branch, me, journalStartDate } = currentProject;
    const { owner, repo } = parseRepoUrl(repoUrl);

    const since = journalStartDate
      ? new Intl.DateTimeFormat("fr-FR", {
          day: "2-digit",
          month: "short",
          year: "numeric"
        }).format(new Date(journalStartDate))
      : null;

    let myEntries = [];

    // Fetch des commits seulement si un repo est configuré
    if (owner && repo) {
      const raw = await fetchAllCommits({ owner, repo, branch, since: journalStartDate });
      const entries = raw.map(groom).filter((c) => c.duration > 0);
      myEntries = entries.filter((c) => c.author == me);
    }

    // Utiliser les exceptions du projet au lieu de lire depuis JSON
    const exc = currentProject.exceptions || [];

    // Remplacer les commits par leurs exceptions
    const keyOf = (x) => (x.sha || x.id || "").toLowerCase().trim();
    const excByKey = new Map(exc.map((x) => [keyOf(x), x]));
    const patched = myEntries.map((e) => {
      const repl = excByKey.get(keyOf(e));
      if (repl) {
        return repl; // remplace si une exception existe
      }
      return e;
    });

    // Ajouter les entrées "commitless"
    const allEntriesReady = patched.concat(exc.filter((e) => e.type == "commitless"));

    // Grouper + totaux
    const groups = groupByDay(allEntriesReady);
    const totals = totalDuration(allEntriesReady);

    return res.render("index", {
      defaultRepoUrl: repoUrl,
      owner,
      repo,
      selectedBranch: branch,
      since,
      groups,
      totals,
      projectName: projectName || repo,
      me
    });
  } catch (e) {
    console.error('Erreur lors du chargement du journal:', e.message);

    // Déterminer le type d'erreur pour afficher les instructions appropriées
    let errorType = 'generic';
    if (e.message.includes('Token GitHub invalide') || e.message.includes('401')) {
      errorType = 'github_token';
    } else if (e.message.includes('non trouvé') || e.message.includes('404')) {
      errorType = 'github_repo';
    }

    return res.status(500).render("error", {
      errorMessage: e.message,
      errorType: errorType,
      repoUrl: currentProject?.repoUrl || 'N/A'
    });
  }
});

// POST créer une exception
app.post("/add", async (req, res) => {
  try {
    if (!currentProject) {
      return res.status(400).json({ error: 'Aucun projet ouvert' });
    }

    const err = validateException(req.body);
    if (err) return res.status(400).json({ error: err });

    if (req.body.exceptionId == "-") {
      if (req.body.sha == "-") {
        addNewCommitlessEntry(req.body);
      } else {
        addNewCommitPatchEntry(req.body);
      }
    } else {
      patchExistingException(req.body);
    }

    // Notifier main.js que le projet a changé
    if (onProjectChangeCallback) {
      onProjectChangeCallback(currentProject);
    }

    return res.redirect("/jdt");
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function patchExistingException(ex) {
  if (!currentProject.exceptions) {
    currentProject.exceptions = [];
  }

  const existing = currentProject.exceptions.find((e) => e.id == ex.exceptionId);
  if (existing) {
    existing.name = ex.name;
    existing.description = ex.description;
    existing.date = ex.date;
    existing.duration = Number(ex.duration) || 0;
    existing.author = ex.author;
    existing.status = ex.status;
  }
}

function addNewCommitlessEntry(ex) {
  if (!currentProject.exceptions) {
    currentProject.exceptions = [];
  }

  const newentry = {
    id: crypto.randomUUID(),
    type: "commitless",
    name: ex.name,
    description: ex.description || "",
    date: new Date(ex.date).toISOString(),
    duration: Number(ex.duration) || 0,
    status: ex.status || "",
    author: currentProject.me
  };
  currentProject.exceptions.push(newentry);
}

function addNewCommitPatchEntry(ex) {
  if (!currentProject.exceptions) {
    currentProject.exceptions = [];
  }

  const newentry = {
    id: crypto.randomUUID(),
    type: "commitpatch",
    sha: ex.sha,
    url: ex.url,
    name: ex.name,
    description: ex.description || "",
    date: new Date(ex.date).toISOString(),
    duration: Number(ex.duration) || 0,
    status: ex.status || "Done",
    author: ex.author || "?",
    patch: true
  };
  currentProject.exceptions.push(newentry);
}

// Exporter l'app Express au lieu de l'écouter ici
// C'est main.js qui le fera
export { app };

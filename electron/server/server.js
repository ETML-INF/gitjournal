import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { promisify } from "util";
import expressLayouts from "express-ejs-layouts";
import crypto from "crypto";
import { VERSION as APP_VERSION } from "../version.js";
import { groom } from "./lib/commit-parser.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);

const app = express();

// Variables globales pour stocker les données du projet en cours
let currentProject = null; // Les données du fichier .gitj
let currentRepoPath = null; // Chemin vers le dépôt git local

// Callback pour notifier main.js des changements
let onProjectChangeCallback = null;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

/**
 * Fonction appelée par main.js pour injecter les données du projet et le chemin du repo
 */
export function setProjectData(projectData, repoPath) {
  currentProject = projectData;
  currentRepoPath = repoPath;
}

/**
 * Fonction pour enregistrer un callback appelé quand le projet change
 */
export function onProjectChange(callback) {
  onProjectChangeCallback = callback;
}

function parseRepoUrl(repoUrl) {
  if (!repoUrl) return {};
  const m = repoUrl.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!m) return {};
  return { owner: m[1], repo: m[2] };
}

/**
 * Lit les commits depuis le dépôt git local via `git log`.
 * Filtre par auteur (--author=me) et par date de début (--after=since).
 * Parcourt toutes les branches (--all) et déduplique par SHA.
 */
async function readLocalCommits(repoPath, me, since, repoUrl) {
  // Séparateurs qui n'apparaissent pas dans les messages de commit
  const FIELD_SEP = "\x1e"; // ASCII 30
  const COMMIT_SEP = "\x1d"; // ASCII 29

  // %B = message complet (sujet + corps)
  const fmt = `%H${FIELD_SEP}%an${FIELD_SEP}%ad${FIELD_SEP}%B${COMMIT_SEP}`;

  const args = [
    "-C",
    repoPath,
    "log",
    "--all",
    "--no-merges",
    `--author=${me}`,
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

  const baseUrl = repoUrl ? repoUrl.replace(/\/+$/, "") : "";
  const seenShas = new Set();
  const commits = [];

  for (const record of stdout.split(COMMIT_SEP)) {
    const trimmed = record.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(FIELD_SEP);
    if (parts.length < 4) continue;

    const sha = parts[0].trim();
    const authorName = parts[1].trim();
    const date = parts[2].trim();
    // Le message est tout ce qui suit (réassemblé au cas où il contiendrait FIELD_SEP)
    const message = parts.slice(3).join(FIELD_SEP).trim();

    if (!sha || sha.length < 7) continue;
    if (seenShas.has(sha)) continue;
    seenShas.add(sha);

    const url = baseUrl ? `${baseUrl}/commit/${sha}` : "";

    // Construit un objet compatible avec groom()
    commits.push({
      sha,
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

function totalDuration(commits) {
  const mins = commits.reduce((acc, c) => acc + (Number(c.duration) || 0), 0);
  const h = Math.floor(mins / 60),
    m = mins % 60;
  return { minutes: mins, h, m };
}

const fmtDayLabel = (d) =>
  new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(d)
  );

const toDayKey = (isoLike) => new Date(isoLike).toISOString().slice(0, 10);

const sumMinutes = (items) => items.reduce((acc, c) => acc + (c.duration || 0), 0);

function groupByDay(entries) {
  const sorted = [...entries].sort((a, b) => new Date(a.date) - new Date(b.date));
  const groupsMap = new Map();
  for (const c of sorted) {
    const key = toDayKey(c.date);
    if (!groupsMap.has(key)) groupsMap.set(key, []);
    groupsMap.get(key).push(c);
  }
  const groups = [];
  for (const [day, commits] of groupsMap.entries()) {
    const minutes = sumMinutes(commits);
    groups.push({
      day,
      label: fmtDayLabel(day),
      commits,
      total: { minutes, h: Math.floor(minutes / 60), m: minutes % 60 }
    });
  }
  return groups;
}

function validateException(x) {
  if (!x || typeof x !== "object") return "Objet invalide";
  if (!x.name) return "Champ 'name' requis";
  if (!x.date || isNaN(new Date(x.date))) return "Champ 'date' invalide (ISO attendu)";
  if (x.duration == null || isNaN(Number(x.duration))) return "Champ 'duration' requis (minutes)";
  return null;
}

// Page principale — lit les commits depuis le dépôt git local
app.get(["/", "/jdt"], async (req, res) => {
  try {
    if (!currentProject) {
      return res.render("no-project", {
        message: "Aucun projet ouvert. Utilisez Fichier > Ouvrir ou Nouveau projet."
      });
    }

    const { repoUrl, projectName, me, journalStartDate } = currentProject;
    const { owner, repo } = parseRepoUrl(repoUrl);

    const since = journalStartDate
      ? new Intl.DateTimeFormat("fr-FR", {
          day: "2-digit",
          month: "short",
          year: "numeric"
        }).format(new Date(journalStartDate))
      : null;

    let myEntries = [];
    let commitStats = {
      fromGit: 0,
      afterExclusions: 0,
      manualEntries: 0,
      total: 0
    };

    if (currentRepoPath) {
      const raw = await readLocalCommits(currentRepoPath, me, journalStartDate, repoUrl);
      myEntries = raw.map(groom).filter((c) => c.duration > 0);
      commitStats.fromGit = myEntries.length;
    }

    const exc = currentProject.exceptions || [];

    const excludedShas = new Set(exc.filter((e) => e.excluded === true).map((e) => (e.sha || "").toLowerCase().trim()));
    const notExcluded = myEntries.filter((e) => !excludedShas.has((e.sha || "").toLowerCase().trim()));
    commitStats.afterExclusions = notExcluded.length;

    const keyOf = (x) => (x.sha || x.id || "").toLowerCase().trim();
    const excByKey = new Map(exc.map((x) => [keyOf(x), x]));
    const patched = notExcluded.map((e) => {
      const repl = excByKey.get(keyOf(e));
      if (repl && !repl.excluded) return repl;
      return e;
    });

    const manualEntries = exc.filter((e) => e.type == "commitless");
    commitStats.manualEntries = manualEntries.length;
    const allEntriesReady = patched.concat(manualEntries);
    commitStats.total = allEntriesReady.length;

    const groups = groupByDay(allEntriesReady);
    const totals = totalDuration(allEntriesReady);

    return res.render("index", {
      defaultRepoUrl: repoUrl,
      owner,
      repo,
      since,
      groups,
      totals,
      projectName: projectName || repo || me,
      me,
      appVersion: APP_VERSION,
      commitStats
    });
  } catch (e) {
    console.error("Erreur lors du chargement du journal:", e.message);

    let errorType = "generic";
    if (e.message.includes("n'est pas un dépôt Git")) errorType = "not_git_repo";
    if (e.message.includes("Git n'est pas installé")) errorType = "git_missing";

    return res.status(500).render("error", {
      errorMessage: e.message,
      errorType,
      repoUrl: currentProject?.repoUrl || "N/A"
    });
  }
});

// POST créer une exception
app.post("/add", async (req, res) => {
  try {
    if (!currentProject) return res.status(400).json({ error: "Aucun projet ouvert" });

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

    if (onProjectChangeCallback) onProjectChangeCallback(currentProject);
    return res.redirect("/jdt");
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST exclure un commit
app.post("/exclude", async (req, res) => {
  try {
    if (!currentProject) return res.status(400).json({ error: "Aucun projet ouvert" });

    const { sha } = req.body;
    if (!sha || sha === "-") return res.status(400).json({ error: "SHA invalide" });

    if (!currentProject.exceptions) currentProject.exceptions = [];

    const existing = currentProject.exceptions.find(
      (e) => e.sha && e.sha.toLowerCase().trim() === sha.toLowerCase().trim()
    );

    if (existing) {
      existing.excluded = true;
    } else {
      currentProject.exceptions.push({ sha, excluded: true });
    }

    if (onProjectChangeCallback) onProjectChangeCallback(currentProject);
    return res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST supprimer une entrée manuelle
app.post("/delete", async (req, res) => {
  try {
    if (!currentProject) return res.status(400).json({ error: "Aucun projet ouvert" });

    const { exceptionId } = req.body;
    if (!exceptionId || exceptionId === "-") return res.status(400).json({ error: "ID d'exception invalide" });
    if (!currentProject.exceptions) return res.status(404).json({ error: "Entrée non trouvée" });

    const index = currentProject.exceptions.findIndex((e) => e.id === exceptionId);
    if (index === -1) return res.status(404).json({ error: "Entrée non trouvée" });

    currentProject.exceptions.splice(index, 1);

    if (onProjectChangeCallback) onProjectChangeCallback(currentProject);
    return res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function patchExistingException(ex) {
  if (!currentProject.exceptions) currentProject.exceptions = [];
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
  if (!currentProject.exceptions) currentProject.exceptions = [];
  currentProject.exceptions.push({
    id: crypto.randomUUID(),
    type: "commitless",
    name: ex.name,
    description: ex.description || "",
    date: new Date(ex.date).toISOString(),
    duration: Number(ex.duration) || 0,
    status: ex.status || "",
    author: currentProject.me
  });
}

function addNewCommitPatchEntry(ex) {
  if (!currentProject.exceptions) currentProject.exceptions = [];
  currentProject.exceptions.push({
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
  });
}

export { app };

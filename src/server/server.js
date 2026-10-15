import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import expressLayouts from "express-ejs-layouts";
import crypto from "crypto";
import { VERSION as APP_VERSION } from "../version.js";
import { collectEntries } from "./lib/journal-generator.js";
import { resolveGithubToken } from "./lib/issue-reader.js";
import { condenseDescription } from "./lib/description-filter.js";

export function normalizeMeInput(me) {
  if (Array.isArray(me)) return me.map((m) => String(m).trim()).filter(Boolean);
  const names = String(me || "")
    .split(/[,;]+/)
    .map((m) => m.trim())
    .filter(Boolean);
  return names.length > 1 ? names : names[0] || "";
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Variables globales pour stocker les données du projet en cours
let currentProject = null; // Les données du fichier .gitj
let currentRepoPath = null; // Chemin vers le dépôt git local

// Callback pour notifier main.js des changements
let onProjectChangeCallback = null;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("view cache", false);
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

// Fournisseur du token GitHub des préférences (injecté par main.js)
let tokenProvider = async () => null;

export function setTokenProvider(provider) {
  tokenProvider = provider;
}

// Token des préférences en priorité, sinon GH_TOKEN / GITHUB_TOKEN / gh auth token
async function githubToken() {
  return (await tokenProvider()) || (await resolveGithubToken());
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

function extractColumnValue(entry, column) {
  const raw = entry[column.source];
  if (raw == null) return "";
  let value = String(raw);
  if (column.regex) {
    const match = value.match(new RegExp(column.regex, column.flags ?? "s"));
    value = match ? (match[column.group ?? 0] ?? "") : "";
  }
  return value;
}

function validateException(x) {
  if (!x || typeof x !== "object") return "Objet invalide";
  if (!x.date || isNaN(new Date(x.date))) return "Champ 'date' invalide (ISO attendu)";
  return null;
}

function editableColumns() {
  return (currentProject?.columns || []).filter((col) => col.field);
}

function valueForEditableField(entry, field) {
  const value = entry[field];
  return value == null ? "" : value;
}

function normalizeEditableFieldValue(field, value) {
  if (field === "date") return new Date(value).toISOString();
  if (field === "duration") return Number(value) || 0;
  return value ?? "";
}

function buildEditableValues(entry) {
  return Object.fromEntries(editableColumns().map((col) => [col.field, valueForEditableField(entry, col.field)]));
}

function applyEditableFields(target, source) {
  for (const { field } of editableColumns()) {
    if (source[field] !== undefined) {
      target[field] = normalizeEditableFieldValue(field, source[field]);
    }
  }
}

// Page principale — lit les commits depuis le dépôt git local
app.get(["/", "/jdt"], async (req, res) => {
  try {
    if (!currentProject) {
      return res.render("no-project", {
        message: "Aucun projet ouvert. Utilisez Fichier > Ouvrir ou Nouveau projet."
      });
    }

    const { projectName, me: meRaw, journalStartDate, columns } = currentProject;
    const me = Array.isArray(meRaw) ? meRaw.join(" / ") : meRaw;

    const since = journalStartDate
      ? new Intl.DateTimeFormat("fr-FR", {
          day: "2-digit",
          month: "short",
          year: "numeric"
        }).format(new Date(journalStartDate))
      : null;

    const includeIssues = currentProject.includeIssues === true;
    const {
      entries,
      stats: commitStats,
      owner,
      repo
    } = await collectEntries({
      project: currentProject,
      repoPath: currentRepoPath,
      includeIssues,
      token: includeIssues ? await githubToken() : ""
    });
    if (commitStats.issuesError) console.warn("Commentaires d'issues non lus:", commitStats.issuesError);

    const allEntriesReady = entries.map((e) => ({
      ...e,
      editableValues: buildEditableValues(e),
      cells: columns.map((col) => {
        const value = extractColumnValue(e, col);
        // La description affichée est condensée ; la valeur complète reste dans le formulaire d'édition
        const condensed = col.field === "description" ? condenseDescription(value, e.source) : null;
        return { column: col, value, condensed };
      })
    }));

    const groups = groupByDay(allEntriesReady);
    const totals = totalDuration(allEntriesReady);

    return res.render("index", {
      owner,
      repo,
      since,
      groups,
      totals,
      columns,
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
      errorType
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
    applyEditableFields(existing, ex);
    if (ex.author !== undefined) existing.author = ex.author;
  }
}

function addNewCommitlessEntry(ex) {
  if (!currentProject.exceptions) currentProject.exceptions = [];
  const entry = {
    id: crypto.randomUUID(),
    type: "commitless",
    author: currentProject.me
  };
  applyEditableFields(entry, ex);
  currentProject.exceptions.push(entry);
}

function addNewCommitPatchEntry(ex) {
  if (!currentProject.exceptions) currentProject.exceptions = [];
  const entry = {
    id: crypto.randomUUID(),
    type: "commitpatch",
    sha: ex.sha,
    url: ex.url,
    author: ex.author || "?",
    patch: true
  };
  applyEditableFields(entry, ex);
  if (!entry.status) entry.status = "Done";
  currentProject.exceptions.push(entry);
}

export { app };

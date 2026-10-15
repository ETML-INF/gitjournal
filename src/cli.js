#!/usr/bin/env node
// GitJournal en ligne de commande : génère un journal Markdown sans Electron (utilisé par la GitHub Action)
import fs from "fs/promises";
import path from "path";
import { parseArgs } from "util";
import { VERSION } from "./version.js";
import { loadProject } from "./server/lib/gitj-manager.js";
import { collectEntries } from "./server/lib/journal-generator.js";
import { resolveGithubToken } from "./server/lib/issue-reader.js";
import { renderMarkdown } from "./server/lib/markdown-export.js";

const HELP = `Usage: gitjournal [options]

  --repo <dossier>      Dépôt git à analyser (défaut : dossier courant)
  --gitj <fichier>      Fichier .gitj (défaut : premier *.gitj à la racine du dépôt, sinon aucun filtre)
  --output <fichier>    Fichier Markdown à écrire, "-" pour la sortie standard
                        (défaut : nom du .gitj avec l'extension .md, ou journal.md sans .gitj)
  --timezone <tz>       Fuseau horaire pour le regroupement par jour (défaut : Europe/Zurich)
  --no-issues           Ne pas lire les commentaires d'issues GitHub
  --help                Afficher cette aide

Le token GitHub est lu dans GH_TOKEN ou GITHUB_TOKEN, sinon via "gh auth token".`;

async function findGitj(repoPath) {
  const files = (await fs.readdir(repoPath)).filter((f) => f.endsWith(".gitj")).sort();
  return files.length ? path.join(repoPath, files[0]) : null;
}

async function main() {
  const { values } = parseArgs({
    options: {
      repo: { type: "string", default: "." },
      gitj: { type: "string" },
      output: { type: "string" },
      timezone: { type: "string", default: "Europe/Zurich" },
      "no-issues": { type: "boolean", default: false },
      help: { type: "boolean", default: false }
    }
  });
  if (values.help) {
    console.log(HELP);
    return;
  }

  const repoPath = path.resolve(values.repo);
  const gitjPath = values.gitj ? path.resolve(repoPath, values.gitj) : await findGitj(repoPath);
  const project = gitjPath ? await loadProject(gitjPath) : { projectName: "", me: "", journalStartDate: null, exceptions: [] };

  const includeIssues = !values["no-issues"];
  const { entries, stats, repo } = await collectEntries({
    project,
    repoPath,
    includeIssues,
    token: includeIssues ? await resolveGithubToken() : ""
  });
  if (stats.issuesError) {
    console.error(`Erreur lors de la lecture des issues : ${stats.issuesError}`);
    process.exitCode = 1;
    return;
  }

  // Par défaut, le journal porte le nom du .gitj (à côté de lui) : projet.gitj → projet.md
  const output = values.output ?? (gitjPath ? path.relative(repoPath, gitjPath).replace(/\.gitj$/i, ".md") : "journal.md");

  const markdown = renderMarkdown(entries, {
    title: project.projectName || repo || path.basename(repoPath),
    timeZone: values.timezone,
    version: VERSION
  });

  if (output === "-") {
    process.stdout.write(markdown);
  } else {
    await fs.writeFile(path.resolve(repoPath, output), markdown, "utf-8");
    // Dans GitHub Actions, transmet le chemin du journal à l'étape de commit
    if (process.env.GITHUB_OUTPUT) {
      await fs.appendFile(process.env.GITHUB_OUTPUT, `journal-file=${output.split(path.sep).join("/")}\n`);
    }
    console.error(
      `${output} : ${stats.total} entrées (${stats.withMetadata} commits, ${stats.issueComments} commentaires d'issues, ${stats.manualEntries} manuelles)` +
        (gitjPath ? ` — configuration ${path.basename(gitjPath)}` : "")
    );
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});

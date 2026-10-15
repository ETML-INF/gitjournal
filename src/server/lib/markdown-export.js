// Génération d'un journal Markdown à partir des entrées produites par collectEntries()
import { condenseDescription } from "./description-filter.js";

function formatDuration(minutes) {
  const m = Number(minutes) || 0;
  if (!m) return "";
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

// Texte sûr dans une cellule de tableau Markdown : pas de HTML, pas de pipe, retours à la ligne en <br>
export function escapeCell(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>")
    .trim();
}

// Description condensée : balises remplacées par *(balises)*, 10 lignes au plus puis renvoi en italique
export function descriptionCell(e) {
  const { lines, more } = condenseDescription(e.description, e.source);
  const rendered = lines.map((segs) => segs.map((s) => (s.tags ? "*(balises)*" : escapeCell(s.text))).join(" "));
  if (more) rendered.push(e.url ? `*[${escapeCell(more)}](${e.url})*` : `*${escapeCell(more)}*`);
  return rendered.join("<br>");
}

function sourceCell(e) {
  const link = (label) => (e.url ? `[${label}](${e.url})` : label);
  if (e.source === "issue" || e.source === "pr") return link(`#${e.issueNumber}`);
  if (e.source === "manual") return "Manuel";
  const short = (e.sha || "").slice(0, 7);
  return `${link(`\`${short}\``)}${e.branch ? ` (${escapeCell(e.branch)})` : ""}`;
}

/**
 * @param {Array} entries - Entrées du journal
 * @param {Object} opts
 * @param {string} opts.title - Titre du journal
 * @param {string} [opts.timeZone] - Fuseau horaire pour le regroupement par jour
 * @param {string} [opts.version] - Version de GitJournal
 * @param {Date} [opts.now] - Date de génération
 */
export function renderMarkdown(entries, { title, timeZone = "Europe/Zurich", version = "", now = new Date() }) {
  const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const dayLabel = new Intl.DateTimeFormat("fr-FR", { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const timeLabel = new Intl.DateTimeFormat("fr-CH", { timeZone, hour: "2-digit", minute: "2-digit" });

  const sorted = [...entries].sort((a, b) => new Date(a.date) - new Date(b.date));
  const days = new Map();
  for (const e of sorted) {
    const key = dayKey.format(new Date(e.date));
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(e);
  }

  const total = entries.reduce((acc, e) => acc + (Number(e.duration) || 0), 0);
  const lines = [
    `# Journal de travail — ${title}`,
    "",
    `> Généré automatiquement par GitJournal${version ? ` v${version}` : ""} le ${dayLabel.format(now)} à ${timeLabel.format(now)}.`,
    `> ${entries.length} entrées · Total : **${formatDuration(total) || "0h00"}**`,
    ""
  ];

  // Jours les plus récents en premier, entrées d'un même jour dans l'ordre chronologique
  for (const [, dayEntries] of [...days.entries()].reverse()) {
    const dayTotal = dayEntries.reduce((acc, e) => acc + (Number(e.duration) || 0), 0);
    const label = dayLabel.format(new Date(dayEntries[0].date));
    lines.push(`## ${label.charAt(0).toUpperCase()}${label.slice(1)}${dayTotal ? ` — ${formatDuration(dayTotal)}` : ""}`, "");
    lines.push("| Heure | Source | Tâche | Description | Durée | Statut |");
    lines.push("|---|---|---|---|---|---|");
    for (const e of dayEntries) {
      lines.push(
        `| ${timeLabel.format(new Date(e.date))} | ${sourceCell(e)} | ${escapeCell(e.name)} | ${descriptionCell(e)} | ${formatDuration(e.duration)} | ${escapeCell(e.status)} |`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

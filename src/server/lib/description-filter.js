// Condense une description pour l'affichage dans le journal :
//   - les balises (X)HTML sont remplacées par un marqueur « (balises) »
//   - au-delà de MAX_LINES lignes non vides, la suite est remplacée par un renvoi vers l'issue ou le commit
// Le résultat est structuré en segments pour que chaque rendu (Markdown, EJS) applique son propre échappement.

export const MAX_LINES = 10;

// Balise ouvrante/fermante/auto-fermante ou commentaire HTML ; une suite de balises adjacentes compte pour une
const TAG = String.raw`(?:<!--[\s\S]*?-->|<\/?[a-zA-Z][\w:.-]*(?:\s[^<>]*)?\/?>)`;
const TAG_RUN = new RegExp(`${TAG}(?:\\s*${TAG})*`, "g");
const MARK = "\u0000";

const MORE_LABELS = {
  issue: "(plus sur l'issue…)",
  pr: "(plus sur la pull request…)",
  commit: "(plus sur le commit…)"
};

/**
 * @param {string} text
 * @param {string} [source] - "commit", "issue", "pr" ou "manual"
 * @returns {{ lines: Array<Array<{text: string} | {tags: true}>>, more: string|null }}
 *   les segments d'une ligne sont à séparer par une espace
 *   `more` est le libellé du renvoi quand la description a été tronquée
 */
export function condenseDescription(text, source = "commit") {
  const allLines = String(text ?? "")
    .replace(TAG_RUN, MARK)
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "");

  // Le texte qui touche un marqueur est rogné de ce côté : les rendus séparent les segments par une espace
  const lines = allLines.slice(0, MAX_LINES).map((line) => {
    const parts = line.split(MARK);
    return parts
      .flatMap((part, i) => {
        let t = part;
        if (i > 0) t = t.trimStart();
        if (i < parts.length - 1) t = t.trimEnd();
        return i === 0 ? [t] : [{ tags: true }, t];
      })
      .filter((seg) => seg !== "")
      .map((seg) => (typeof seg === "string" ? { text: seg } : seg));
  });

  const more = allLines.length > MAX_LINES ? MORE_LABELS[source] || "(plus…)" : null;
  return { lines, more };
}

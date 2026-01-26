// Parse alternative concise format: [2h30 done], [45m wip], [1h], [30m done], [5 done]
export function parseCompactMeta(content) {
  // Pattern 1: hours with optional minutes (2h, 2h30, 2h30m) OR minutes with m suffix (30m)
  let match = content.match(/^(?:(\d+)h(?:(\d+)m?)?|(\d+)m)(?:\s+(\w+))?$/i);
  if (match) {
    const hours = match[1] ? parseInt(match[1]) : 0;
    const mins = match[2] ? parseInt(match[2]) : (match[3] ? parseInt(match[3]) : 0);
    const status = match[4] || "";
    return { duration: hours * 60 + mins, status };
  }

  // Pattern 2: implicit minutes with status [5 done] - number + status word (must start with letter)
  match = content.match(/^(\d+)\s+([a-z]\w*)$/i);
  if (match) {
    return { duration: parseInt(match[1]), status: match[2] };
  }

  return null;
}

// Check if bracket content looks like compact format
function isCompactFormat(content) {
  // Has h/m unit OR is "number word" pattern (e.g., "5 done" - status must start with letter)
  return /\d+[hm]/i.test(content) || /^\d+\s+[a-z]\w*$/i.test(content);
}

// Parse commit message metadata from a line
// Supports two formats:
//   - Classic: [hh][mm][status] e.g. [2][30][done]
//   - Compact: [2h30 done], [45m], [1h wip], [5 done]
export function parseMetadata(metaLine) {
  let duration = 0;
  let status = "";

  const matches = [...metaLine.matchAll(/\[(.*?)\]/g)].map((m) => m[1]);
  if (matches.length) {
    // Try compact format first (single bracket with h/m units or "number status")
    if (matches.length === 1 && isCompactFormat(matches[0])) {
      const parsed = parseCompactMeta(matches[0]);
      if (parsed) {
        duration = parsed.duration;
        status = parsed.status;
      }
    } else {
      // Classic multi-bracket format: [2][30][done]
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

  return { duration, status };
}

// Strip metadata brackets from a line
function stripMetadata(line) {
  const matches = [...line.matchAll(/\[(.*?)\]/g)].map((m) => m[1]);
  if (matches.length === 1 && isCompactFormat(matches[0])) {
    // Remove compact format bracket
    return line.replace(/\s*\[.*?\]\s*/, " ").trim();
  } else if (matches.length > 0) {
    // Remove all brackets (classic format)
    return line.replace(/\s*\[.*?\]/g, "").trim();
  }
  return line;
}

// Groom a commit object to extract structured data
export function groom(commit) {
  const lines = commit.commit.message.split("\n").filter((l) => l.trim() !== "");

  let duration = 0;
  let status = "";
  let metaLineIndex = -1;

  // Search all lines for metadata (first match wins)
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseMetadata(lines[i]);
    if (parsed.duration > 0 || parsed.status) {
      duration = parsed.duration;
      status = parsed.status;
      metaLineIndex = i;
      break;
    }
  }

  // Build title and description, stripping metadata from where it was found
  let name = lines[0] || "";
  let descLines = lines.slice(1);

  if (metaLineIndex === 0) {
    // Metadata in title - strip it
    name = stripMetadata(lines[0]);
  } else if (metaLineIndex > 0) {
    // Metadata on another line - remove that line from description
    descLines = lines.slice(1).filter((_, i) => i !== metaLineIndex - 1);
  }

  return {
    sha: commit.sha,
    name: name || commit.commit.message.split("\n")[0],
    description: descLines.join("\n"),
    date: commit.commit.author.date,
    duration,
    status,
    author: commit.author?.login || commit.commit?.author?.name || "?",
    url: commit.html_url
  };
}

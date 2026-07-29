// Matches the "{number}" prefix of "{number}. {name}: {action}" -- e.g.
// "4. Elephant: putting out a fire". The separator after the number is
// deliberately loose (".", ")", ":", "-", or nothing) since spreadsheet
// exports vary here; requiring exactly "." made a row silently unparseable
// (skipped, no name for that number) on anything else. The ": {action}"
// tail (if any) is split off separately below by a plain indexOf, not
// folded into this regex -- combining a lazy quantifier with an optional
// trailing group here would be vulnerable to super-linear backtracking on
// pathological input.
const LEADING_NUMBER_RE = /^(\d+)\s*[.):-]?\s*(.*)$/;

// Fallback when a row has no ": {action}" tail (e.g. plain "32. Dolphin
// studying marine life", no colon at all): split at the first gerund
// ("-ing") word instead of keeping the whole remainder as the name. Every
// entry in the reference 100-item batch follows the "{Subject} {gerund
// verb} {object}" pattern, so this recovers just "Dolphin" without a
// delimiter that row doesn't have.
const GERUND_RE = /\b([A-Za-z]+ing)\b/;

/** One CSV row's resolved text: the short `name` (printed on the palette
 * page, as "{name} #{number}") and the `text` (the row's full description,
 * printed on the summary page as "{text} #{number}") -- e.g. row "32.
 * Dolphin: studying marine life" (or "32. Dolphin studying marine life",
 * colon optional) resolves to `{ name: "Dolphin", text: "Dolphin studying
 * marine life" }`. */
export interface ArtworkName {
  name: string;
  text: string;
}

/**
 * Parses an artwork-name CSV (header "text", one row per artwork; falls
 * back to the first column if there's no "text" header) into a
 * number -> {name, text} map, keyed by each row's own leading number rather
 * than row position. Matching by number (not import order) is deliberate: a
 * batch converted out of numeric order, or covering only some of the CSV's
 * rows (e.g. items 5-8 from a 1-100 list), must still get each artwork's own
 * name -- positional matching would silently attach the wrong name.
 * Rows that don't start with "{number}." are skipped (unparseable, so there
 * is no number to key them by).
 */
export function parseArtworkNames(csvText: string): Map<number, ArtworkName> {
  // Strip a UTF-8 BOM some spreadsheet exports prepend -- left in place, it
  // sits inside the first header cell's text ("﻿text" !== "text"),
  // silently defeating the "text" header match below.
  const rows = parseCsvRows(csvText.replace(/^﻿/, ""));
  const names = new Map<number, ArtworkName>();
  if (rows.length === 0) return names;

  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const textCol = header.indexOf("text");
  const hasHeader = textCol !== -1;
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const col = hasHeader ? textCol : 0;

  for (const row of dataRows) {
    const match = LEADING_NUMBER_RE.exec((row[col] ?? "").trim());
    if (!match) continue;
    const rest = match[2];
    const colonIndex = rest.indexOf(":");
    let name: string;
    let text: string;
    if (colonIndex !== -1) {
      name = rest.slice(0, colonIndex).trim();
      // Drop just the colon -- "Dolphin: studying marine life" reads as
      // "Dolphin studying marine life" on the summary page, not literally
      // with the colon kept in.
      text = `${name} ${rest.slice(colonIndex + 1)}`.replace(/\s+/g, " ").trim();
    } else {
      const gerund = GERUND_RE.exec(rest);
      name = (gerund ? rest.slice(0, gerund.index) : rest).trim();
      text = rest.trim();
    }
    names.set(Number(match[1]), { name, text });
  }
  return names;
}

/** Minimal RFC 4180 CSV parser: handles quoted fields with embedded commas/newlines/escaped quotes. */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

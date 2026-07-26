/**
 * Parses a captions CSV with a "text" header column: each data row's `text`
 * value becomes the caption for the item at that row's position (1-based row
 * order maps to item order, matching how items are imported/uploaded). If
 * there's no "text" header (e.g. a single unlabeled column), the first
 * column is used as-is.
 */
export function parseCaptionsCsv(csvText: string): string[] {
  const rows = parseCsvRows(csvText);
  if (rows.length === 0) return [];

  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const textCol = header.indexOf("text");
  const hasHeader = textCol !== -1;
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const col = hasHeader ? textCol : 0;

  return dataRows.map((row) => (row[col] ?? "").trim());
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

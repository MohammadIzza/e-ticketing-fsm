/**
 * CSV utilities — encoder/decoder kecil tanpa dependency tambahan.
 *
 * Format yang didukung:
 *   - Pemisah field: `,` (koma)
 *   - Pemisah baris: `\n` atau `\r\n`
 *   - Quote: `"..."`, escape `""` di dalamnya
 *   - Baris pertama selalu header.
 *
 * Cukup untuk import/export tabel sederhana (gedung, ruangan, aset).
 * Tidak coba meng-handle spreadsheet eksotis — user diarahkan ke
 * format yang “simple agar tidak rumit” (sesuai brief).
 */

export type CsvRow = Record<string, string>;

export function encodeCsv(headers: string[], rows: CsvRow[]): string {
  const enc = (v: string | null | undefined) => {
    const s = v ?? "";
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const out: string[] = [];
  out.push(headers.map(enc).join(","));
  for (const row of rows) {
    out.push(headers.map((h) => enc(row[h])).join(","));
  }
  return out.join("\n");
}

/** Parse CSV ke list of rows (record). Throw kalau header kosong. */
export function parseCsv(text: string): { headers: string[]; rows: CsvRow[] } {
  const fields = tokenize(text);
  if (fields.length === 0) return { headers: [], rows: [] };
  const headers = fields[0].map((h) => h.trim());
  if (headers.length === 0 || headers.every((h) => !h)) {
    throw new Error("CSV tidak punya header.");
  }
  const rows: CsvRow[] = [];
  for (let i = 1; i < fields.length; i++) {
    const cols = fields[i];
    if (cols.length === 1 && cols[0].trim() === "") continue; // skip empty line
    const obj: CsvRow = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = (cols[j] ?? "").trim();
    }
    rows.push(obj);
  }
  return { headers, rows };
}

/** Trigger download di browser dengan content & filename. */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Stateful tokenizer: balikkan list-of-list dari string CSV. */
function tokenize(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      cur.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (c === "\r") {
      // ignore (\r\n handled by \n)
      i += 1;
      continue;
    }
    if (c === "\n") {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = "";
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  // flush last field/row if any
  if (field !== "" || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows;
}

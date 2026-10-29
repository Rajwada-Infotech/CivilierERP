// Reading a spreadsheet the user picked or pasted: .xlsx, or delimited text (CSV / TSV / clipboard).
import { readWorkbook } from "./xlsxBook";

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}

export function parseDelimitedAuto(text: string): { rows: string[][]; delimiter: string } {
  const cleanText = text.replace(/^\uFEFF/, "");
  const sample = cleanText.split(/\r?\n/).slice(0, 20).join("\n");
  const delimiters = ["\t", ",", ";", "|"];
  const scored = delimiters.map((delimiter) => {
    const rows = parseDelimited(sample, delimiter).filter((r) => r.length > 1);
    const cols = rows.reduce((sum, r) => sum + r.length, 0);
    return { delimiter, score: rows.length * 10 + cols };
  }).sort((a, b) => b.score - a.score);
  const delimiter = scored[0]?.score > 0 ? scored[0].delimiter : ",";
  return { rows: parseDelimited(cleanText, delimiter), delimiter };
}

/** Text from a file, honouring a UTF-16 byte-order mark (Meta's Leads Center exports are UTF-16 tab-separated). */
function decodeText(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf.slice(0, 2));
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(buf);
  return new TextDecoder("utf-8").decode(buf);
}

/** The first sheet of an .xlsx, or the rows of a .csv / .tsv / .txt, as a grid of strings. */
export async function readSheetFile(file: File): Promise<string[][]> {
  const buf = await file.arrayBuffer();
  if (/\.xlsx$/i.test(file.name)) {
    const sheets = await readWorkbook(buf);
    const first = Object.keys(sheets)[0];
    if (!first) throw new Error("No readable sheet in this workbook");
    return sheets[first];
  }
  if (/\.(csv|tsv|txt)$/i.test(file.name)) return parseDelimitedAuto(decodeText(buf)).rows;
  throw new Error("Use an .xlsx, .csv or .tsv file");
}

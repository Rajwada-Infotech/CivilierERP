// Multi-sheet .xlsx writer + reader on top of fflate (same no-SheetJS approach as
// lib/export.ts, which only writes a single plain sheet). Used for import
// templates: styled header rows, column widths, a frozen header, dropdown
// (list) validation, and a reader that returns every sheet as rows of strings.

export type XlsxStyle = "default" | "header" | "required" | "note" | "title" | "label";
export type XlsxCell = string | number | null | undefined | { v: string | number; s: XlsxStyle };

export interface XlsxSheet {
  name: string;
  rows: XlsxCell[][];
  /** Column widths in characters. */
  widths?: number[];
  /** Freeze everything above this 1-based row (e.g. 2 keeps row 1 visible). */
  freezeBelowRow?: number;
  /** Dropdown validation: `sqref` e.g. "A2:A500", `formula` e.g. "Masters!$F$2:$F$40". */
  lists?: { sqref: string; formula: string }[];
}

const STYLE_ID: Record<XlsxStyle, number> = {
  default: 0,
  header: 1,
  required: 2,
  note: 3,
  title: 4,
  label: 5,
};

const esc = (v: string) =>
  v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// XML 1.0 can't carry control characters; strip them so a stray one in a master
// name can't corrupt the workbook.
const clean = (v: string) => v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

const colName = (i: number): string => {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="5">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><i/><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/></font>
    <font><b/><sz val="14"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF6B7280"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEA580C"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F6"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="6">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="4" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
  </cellXfs>
</styleSheet>`;

function sheetXml(sh: XlsxSheet): string {
  const rowsXml = sh.rows
    .map((cells, ri) => {
      const cellsXml = cells
        .map((c, ci) => {
          if (c === null || c === undefined || c === "") return "";
          const ref = `${colName(ci)}${ri + 1}`;
          const v = typeof c === "object" ? c.v : c;
          const s = typeof c === "object" ? STYLE_ID[c.s] : 0;
          const sAttr = s ? ` s="${s}"` : "";
          if (typeof v === "number") return `<c r="${ref}"${sAttr}><v>${v}</v></c>`;
          return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(clean(String(v)))}</t></is></c>`;
        })
        .join("");
      return `<row r="${ri + 1}">${cellsXml}</row>`;
    })
    .join("");

  const cols = sh.widths?.length
    ? `<cols>${sh.widths
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join("")}</cols>`
    : "";
  const freeze =
    sh.freezeBelowRow && sh.freezeBelowRow > 1
      ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sh.freezeBelowRow - 1}" topLeftCell="A${sh.freezeBelowRow}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
      : "";
  const lists = sh.lists?.length
    ? `<dataValidations count="${sh.lists.length}">${sh.lists
        .map(
          (l) =>
            `<dataValidation type="list" errorStyle="warning" allowBlank="1" showErrorMessage="1" sqref="${l.sqref}"><formula1>${esc(l.formula)}</formula1></dataValidation>`,
        )
        .join("")}</dataValidations>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}${cols}<sheetData>${rowsXml}</sheetData>${lists}</worksheet>`;
}

export async function buildWorkbook(sheets: XlsxSheet[]): Promise<Blob> {
  const { zipSync, strToU8 } = await import("fflate");
  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
    .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("")}</sheets></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const pkgRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("")}</Types>`;

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(types),
    "_rels/.rels": strToU8(pkgRels),
    "xl/workbook.xml": strToU8(wb),
    "xl/_rels/workbook.xml.rels": strToU8(wbRels),
    "xl/styles.xml": strToU8(STYLES_XML),
  };
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s));
  });
  const zipped = zipSync(files);
  return new Blob([zipped.buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ─── Reader ──────────────────────────────────────────────────────────────────

const colIndex = (ref: string): number => {
  const letters = ref.replace(/[^A-Za-z]/g, "").toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

const textOf = (el: Element): string => {
  // Concatenate every <t> except phonetic runs (<rPh>).
  let out = "";
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (child.tagName === "rPh") continue;
      if (child.tagName === "t") out += child.textContent ?? "";
      else walk(child);
    }
  };
  walk(el);
  return out;
};

/** Reads every sheet of an .xlsx into `{ sheetName: rows[][] }` (all values as strings). */
export async function readWorkbook(buf: ArrayBuffer): Promise<Record<string, string[][]>> {
  const { unzipSync, strFromU8 } = await import("fflate");
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buf));
  } catch {
    throw new Error("This file isn't a valid .xlsx workbook.");
  }
  const read = (path: string) => (files[path] ? strFromU8(files[path]) : null);
  const parse = (xml: string) => new DOMParser().parseFromString(xml, "application/xml");

  const wbXml = read("xl/workbook.xml");
  if (!wbXml) throw new Error("This file isn't a valid .xlsx workbook.");
  const relsXml = read("xl/_rels/workbook.xml.rels");
  const rels = new Map<string, string>();
  if (relsXml) {
    for (const r of Array.from(parse(relsXml).getElementsByTagName("Relationship"))) {
      rels.set(r.getAttribute("Id") ?? "", r.getAttribute("Target") ?? "");
    }
  }

  const shared: string[] = [];
  const ssXml = read("xl/sharedStrings.xml");
  if (ssXml) {
    for (const si of Array.from(parse(ssXml).getElementsByTagName("si"))) shared.push(textOf(si));
  }

  const result: Record<string, string[][]> = {};
  for (const sh of Array.from(parse(wbXml).getElementsByTagName("sheet"))) {
    const name = sh.getAttribute("name") ?? "";
    const rid = sh.getAttribute("r:id") ?? sh.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? "";
    let target = rels.get(rid) ?? "";
    if (!target) continue;
    target = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    const xml = read(target);
    if (!xml) continue;

    const rows: string[][] = [];
    for (const row of Array.from(parse(xml).getElementsByTagName("row"))) {
      const rIdx = (parseInt(row.getAttribute("r") ?? "", 10) || rows.length + 1) - 1;
      const cells: string[] = [];
      for (const c of Array.from(row.getElementsByTagName("c"))) {
        const ci = colIndex(c.getAttribute("r") ?? "");
        if (ci < 0) continue;
        const t = c.getAttribute("t");
        let val = "";
        if (t === "s") {
          val = shared[parseInt(c.getElementsByTagName("v")[0]?.textContent ?? "", 10)] ?? "";
        } else if (t === "inlineStr") {
          const is = c.getElementsByTagName("is")[0];
          val = is ? textOf(is) : "";
        } else {
          val = c.getElementsByTagName("v")[0]?.textContent ?? "";
        }
        cells[ci] = val;
      }
      while (rows.length < rIdx) rows.push([]);
      rows[rIdx] = Array.from(cells, (v) => v ?? "");
    }
    result[name] = rows;
  }
  return result;
}

// ─── Dates ───────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");
const isoOk = (y: number, mo: number, d: number) => {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
    ? `${y}-${pad(mo)}-${pad(d)}`
    : null;
};

/** Accepts YYYY-MM-DD, DD/MM/YYYY (also - or .), or an Excel date serial. */
export const parseSheetDate = (raw: string): string | null => {
  const s = String(raw ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return isoOk(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return isoOk(+m[3], +m[2], +m[1]);
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial > 20000 && serial < 80000) {
      const dt = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
      return isoOk(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
    }
  }
  return null;
};


// ─── Table reading ───────────────────────────────────────────────────────────

const headerKey = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Turns a sheet's rows into records keyed by canonical field. The first non-empty row is the
 * header; each field lists the header spellings it accepts (letters/digits only, lower-case,
 * so "Total Rate (Rs) *" matches "totalraters"). Fully blank rows are skipped; `rowNo` is the
 * 1-based row number in the sheet, for error messages. `missing` lists fields with no column.
 */
export function readSheetTable(
  rows: string[][],
  aliases: Record<string, string[]>,
): { table: { rowNo: number; cells: Record<string, string> }[]; missing: string[] } {
  const hdrIdx = rows.findIndex((r) => (r ?? []).some((c) => headerKey(c) !== ""));
  if (hdrIdx === -1) return { table: [], missing: Object.keys(aliases) };
  const colOf: Record<string, number> = {};
  rows[hdrIdx].forEach((h, ci) => {
    const k = headerKey(h);
    for (const [field, names] of Object.entries(aliases)) {
      if (colOf[field] === undefined && names.includes(k)) colOf[field] = ci;
    }
  });
  const table: { rowNo: number; cells: Record<string, string> }[] = [];
  for (let r = hdrIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (!row.some((c) => String(c ?? "").trim() !== "")) continue;
    const cells: Record<string, string> = {};
    for (const f of Object.keys(aliases)) cells[f] = colOf[f] === undefined ? "" : String(row[colOf[f]] ?? "").trim();
    table.push({ rowNo: r + 1, cells });
  }
  return { table, missing: Object.keys(aliases).filter((f) => colOf[f] === undefined) };
}

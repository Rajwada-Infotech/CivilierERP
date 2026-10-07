// BOQ Excel import — template + validation.
//
// The workbook is validated against the same masters the manual BOQ form uses
// (Company → Project, Document Type, Financial Year, Activity Group → Activity,
// Item, UOM) and, only when everything checks out, turned into the exact payload
// the manual form posts to POST /api/boq (mirrors buildPayload in BOQ.tsx), so an
// imported BOQ is stored — and shows up, calculates and prints — exactly like a
// hand-keyed one. One invalid cell blocks the whole import: nothing partial is created.
import { buildWorkbook, downloadBlob, readWorkbook, type XlsxCell, type XlsxSheet } from "@/lib/xlsxBook";

export interface BoqImportMasters {
  companies: { id: number; label?: string }[];
  projects: { id: number; label?: string; companyId?: number | null; companyIds?: string[] }[];
  docTypes: { id: number; code: string; name: string; description: string }[];
  finYears: { year: string }[];
  uoms: { UOMName: string; UOMCode: string }[];
  items: { id: string; name: string; code: string; uomCode: string }[];
  activities: { id: string; name: string; code: string; groupId: string }[];
  groups: { id: string; name: string }[];
}

export interface BoqImportIssue {
  sheet: string;
  /** 1-based Excel row (0 = whole sheet / file). */
  row: number;
  message: string;
}

export interface BoqImportSummary {
  company: string;
  project: string;
  docType: string;
  finYear: string;
  date: string;
  activityCount: number;
  itemCount: number;
  activitiesTotal: number;
  itemsTotal: number;
}

export interface BoqImportResult {
  issues: BoqImportIssue[];
  /** Present only when there are no issues. Same shape buildPayload() produces. */
  payload: Record<string, unknown> | null;
  summary: BoqImportSummary | null;
}

const SHEET_HEADER = "BOQ Header";
const SHEET_ACTIVITIES = "Activities";
const SHEET_ITEMS = "Items";
const SHEET_MASTERS = "Masters";
const SHEET_HELP = "Instructions";
const MAX_ISSUES = 200;
const DEFAULT_TAX = "18"; // same default a new manual line starts with

const norm = (v: unknown) =>
  String(v ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
/** Column / label key: letters and digits only, so "Total Rate (₹) *" → "totalrate". */
const key = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const docLabel = (d: { code: string; description: string }) =>
  d.description ? `${d.code} — ${d.description}` : d.code;

// ─── Template ────────────────────────────────────────────────────────────────

const req = (v: string): XlsxCell => ({ v, s: "required" });
const opt = (v: string): XlsxCell => ({ v, s: "header" });

export async function downloadBoqTemplate(m: BoqImportMasters) {
  const uomNames = [...new Set(m.uoms.map((u) => u.UOMName).filter(Boolean))].sort();
  const pairs = m.activities
    .map((a) => ({ group: m.groups.find((g) => g.id === a.groupId)?.name ?? "", activity: a.name }))
    .filter((p) => p.group && p.activity)
    .sort((a, b) => a.group.localeCompare(b.group) || a.activity.localeCompare(b.activity));
  const groupNames = [...new Set(pairs.map((p) => p.group))];
  const projectRows = m.projects.map((p) => ({
    project: p.label ?? "",
    company:
      m.companies.find(
        (c) => (p.companyIds ?? []).includes(String(c.id)) || p.companyId === c.id,
      )?.label ?? "",
  }));

  // Masters (reference) sheet — column letters are referenced by the dropdowns.
  const cols: string[][] = [
    ["Company", ...m.companies.map((c) => c.label ?? "")], // A
    ["Project", ...projectRows.map((p) => p.project)], // B
    ["Project's Company", ...projectRows.map((p) => p.company)], // C
    ["Document Type", ...m.docTypes.map(docLabel)], // D
    ["Financial Year", ...m.finYears.map((f) => f.year)], // E
    ["Activity Group", ...groupNames], // F
    ["Group (for Activity)", ...pairs.map((p) => p.group)], // G
    ["Activity", ...pairs.map((p) => p.activity)], // H
    ["UOM", ...uomNames], // I
    ["Item Name", ...m.items.map((i) => i.name)], // J
    ["Item Code", ...m.items.map((i) => i.code)], // K
    ["Item's UOM", ...m.items.map((i) => m.uoms.find((u) => u.UOMCode === i.uomCode)?.UOMName ?? i.uomCode)], // L
  ];
  const depth = Math.max(...cols.map((c) => c.length));
  const masterRows: XlsxCell[][] = Array.from({ length: depth }, (_, r) =>
    cols.map((c, ci) => (r === 0 ? { v: c[0], s: "header" as const } : (c[r] ?? ""))),
  );
  const range = (col: string, len: number) => `${SHEET_MASTERS}!$${col}$2:$${col}$${Math.max(2, len + 1)}`;

  const header: XlsxSheet = {
    name: SHEET_HEADER,
    widths: [26, 44, 12, 70],
    freezeBelowRow: 2,
    rows: [
      [opt("Field"), opt("Value"), opt("Required"), opt("Notes")],
      [{ v: "Company", s: "label" }, "", "Yes", { v: "Pick from the dropdown / Masters sheet. Must match exactly.", s: "note" }],
      [{ v: "Project", s: "label" }, "", "Yes", { v: "Must be a project of the Company above.", s: "note" }],
      [{ v: "Document Type", s: "label" }, "", "Yes", { v: "Decides the BOQ number series, e.g. BOQ — Bill of Quantities.", s: "note" }],
      [{ v: "Financial Year", s: "label" }, "", "Yes", { v: "e.g. FY 2026-27 — as listed on the Masters sheet.", s: "note" }],
      [{ v: "BOQ Date", s: "label" }, "", "Yes", { v: "YYYY-MM-DD (or DD/MM/YYYY).", s: "note" }],
      [{ v: "Scope / Description", s: "label" }, "", "No", { v: "Free text.", s: "note" }],
      [{ v: "Remarks", s: "label" }, "", "No", { v: "Free text.", s: "note" }],
    ],
    lists: [
      { sqref: "B2", formula: range("A", m.companies.length) },
      { sqref: "B4", formula: range("D", m.docTypes.length) },
      { sqref: "B5", formula: range("E", m.finYears.length) },
    ],
  };

  const activities: XlsxSheet = {
    name: SHEET_ACTIVITIES,
    widths: [26, 30, 16, 16, 18, 10, 40],
    freezeBelowRow: 2,
    rows: [[req("Activity Group *"), req("Activity *"), req("Total Area *"), req("UOM *"), req("Total Rate (₹) *"), opt("Tax %"), opt("Spec / Notes")]],
    lists: [
      { sqref: "A2:A1000", formula: range("F", groupNames.length) },
      { sqref: "D2:D1000", formula: range("I", uomNames.length) },
    ],
  };

  const items: XlsxSheet = {
    name: SHEET_ITEMS,
    widths: [26, 30, 34, 14, 16, 16, 10, 40],
    freezeBelowRow: 2,
    rows: [[req("Activity Group *"), req("Activity *"), req("Item *"), req("Item Qty *"), opt("UOM"), req("Rate (₹) *"), opt("Tax %"), opt("Spec / Notes")]],
    lists: [
      { sqref: "A2:A1000", formula: range("F", groupNames.length) },
      { sqref: "C2:C1000", formula: range("J", m.items.length) },
      { sqref: "E2:E1000", formula: range("I", uomNames.length) },
    ],
  };

  const note = (v: string): XlsxCell[] => [{ v, s: "note" }];
  const help: XlsxSheet = {
    name: SHEET_HELP,
    widths: [110],
    rows: [
      [{ v: "BOQ Excel Import — how to fill this workbook", s: "title" }],
      note(""),
      [{ v: "One workbook = one BOQ. Fill the sheets in this order, then upload it on the BOQ page (Excel Import → Choose file → Import).", s: "default" }],
      note(""),
      [{ v: "1. BOQ Header", s: "label" }],
      note("Company, Project, Document Type, Financial Year and BOQ Date are required. Values must match the Masters sheet exactly (use the dropdowns). The BOQ number is generated automatically from the Document Type."),
      [{ v: "2. Activities", s: "label" }],
      note("One row per activity. Pick the Activity Group first, then an Activity that belongs to that group. Total Area and Total Rate are required: Total Rate is the price for the WHOLE activity (not per unit), so Per Activity Price = Total Rate ÷ Total Area. Tax % defaults to 18 when left blank."),
      [{ v: "3. Items", s: "label" }],
      note("One row per item required by an activity. Activity Group + Activity must match a row on the Activities sheet. Item Qty is the TOTAL quantity of the item for that whole activity; the per-unit quantity is worked out as Item Qty ÷ the activity's Total Area. UOM defaults to the item's own unit when left blank. Tax % defaults to 18."),
      [{ v: "Rules", s: "label" }],
      note("• Every required cell (dark orange headers) must be filled; Area, Total Rate and Item Qty must be numbers greater than 0."),
      note("• The same Activity can't be listed twice, and the same Item can't be listed twice under one Activity."),
      note("• If any row is invalid the import is refused and nothing is created — fix the rows listed and upload again."),
      note("• Don't rename the sheets or the header rows. The Masters sheet is for reference only and is ignored on import."),
      note(""),
      [{ v: "Example", s: "label" }],
      note("Activities:  PILING | PILING01 | 1000 | Square Feet | 2800 | 18 | Bored piles"),
      note("Items:  PILING | PILING01 | Cement 53 Grade | 60000 | Bag | 380 | 18     →  per-unit qty = 60000 ÷ 1000 = 60 Bag / area"),
    ],
  };

  const masters: XlsxSheet = {
    name: SHEET_MASTERS,
    widths: [28, 28, 28, 36, 16, 26, 26, 30, 18, 36, 18, 14],
    freezeBelowRow: 2,
    rows: masterRows,
  };

  downloadBlob(await buildWorkbook([help, header, activities, items, masters]), "BOQ_Import_Template.xlsx");
}

// ─── Parsing + validation ────────────────────────────────────────────────────

const toNumber = (v: string): number => {
  const s = String(v ?? "").replace(/[,₹\s]/g, "");
  if (s === "") return NaN;
  return Number(s);
};

const pad = (n: number) => String(n).padStart(2, "0");
const isoOk = (y: number, mo: number, d: number) => {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
    ? `${y}-${pad(mo)}-${pad(d)}`
    : null;
};

/** Accepts YYYY-MM-DD, DD/MM/YYYY (also - or .), or an Excel date serial. */
export const parseBoqDate = (raw: string): string | null => {
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

type Table = { rowNo: number; cells: Record<string, string> }[];

/** Rows of a sheet keyed by normalized header; skips fully blank rows. */
function readTable(rows: string[][], aliases: Record<string, string[]>): { table: Table; missing: string[] } {
  const hdrIdx = rows.findIndex((r) => r.some((c) => key(c) !== ""));
  if (hdrIdx === -1) return { table: [], missing: Object.keys(aliases) };
  const colOf: Record<string, number> = {};
  rows[hdrIdx].forEach((h, ci) => {
    const k = key(h);
    for (const [field, names] of Object.entries(aliases)) {
      if (colOf[field] === undefined && names.includes(k)) colOf[field] = ci;
    }
  });
  const missing = Object.keys(aliases).filter((f) => colOf[f] === undefined);
  const table: Table = [];
  for (let r = hdrIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (!row.some((c) => String(c ?? "").trim() !== "")) continue;
    const cells: Record<string, string> = {};
    for (const f of Object.keys(aliases)) cells[f] = colOf[f] === undefined ? "" : String(row[colOf[f]] ?? "").trim();
    table.push({ rowNo: r + 1, cells });
  }
  return { table, missing };
}

const ACT_ALIASES = {
  group: ["activitygroup", "group"],
  activity: ["activity"],
  area: ["totalarea", "area"],
  uom: ["uom", "unit"],
  rate: ["totalrate", "rate"],
  tax: ["tax", "taxpercent", "tax%"],
  notes: ["specnotes", "notes", "spec", "description"],
};
const ITEM_ALIASES = {
  group: ["activitygroup", "group"],
  activity: ["activity", "foractivity"],
  item: ["item", "itemname"],
  qty: ["itemqty", "qty", "quantity"],
  uom: ["uom", "unit"],
  rate: ["rate", "itemrate", "price"],
  tax: ["tax", "taxpercent", "tax%"],
  notes: ["specnotes", "notes", "spec", "description"],
};

export async function parseBoqWorkbook(file: File, m: BoqImportMasters): Promise<BoqImportResult> {
  const issues: BoqImportIssue[] = [];
  const add = (sheet: string, row: number, message: string) => {
    if (issues.length < MAX_ISSUES) issues.push({ sheet, row, message });
  };
  const fail = (): BoqImportResult => ({ issues, payload: null, summary: null });

  let book: Record<string, string[][]>;
  try {
    book = await readWorkbook(await file.arrayBuffer());
  } catch (e: any) {
    add("File", 0, e?.message ?? "Could not read the file.");
    return fail();
  }
  const sheetOf = (name: string) => {
    const k = Object.keys(book).find((n) => norm(n) === norm(name));
    return k ? book[k] : null;
  };
  const hdrRows = sheetOf(SHEET_HEADER);
  const actRows = sheetOf(SHEET_ACTIVITIES);
  const itemRows = sheetOf(SHEET_ITEMS);
  for (const [rows, name] of [
    [hdrRows, SHEET_HEADER],
    [actRows, SHEET_ACTIVITIES],
    [itemRows, SHEET_ITEMS],
  ] as const) {
    if (!rows) add(name, 0, `Sheet "${name}" not found — please fill the template downloaded from this page.`);
  }
  if (!hdrRows || !actRows || !itemRows) return fail();

  // ── BOQ Header ──
  const hv: Record<string, string> = {};
  for (const r of hdrRows) {
    const k = key(r[0]);
    if (["company", "project", "documenttype", "financialyear", "boqdate", "scopedescription", "remarks"].includes(k) && hv[k] === undefined) {
      hv[k] = String(r[1] ?? "").trim();
    }
  }
  const hRow = (label: string) => hdrRows.findIndex((r) => key(r[0]) === key(label)) + 1;

  const company = hv.company ? m.companies.find((c) => norm(c.label) === norm(hv.company)) : undefined;
  if (!hv.company) add(SHEET_HEADER, hRow("Company"), "Company is required.");
  else if (!company) add(SHEET_HEADER, hRow("Company"), `Company "${hv.company}" is not in the Company master.`);

  const project = hv.project
    ? m.projects.find((p) => norm(p.label) === norm(hv.project) && (!company || p.companyId == null || (p.companyIds ?? []).includes(String(company.id)) || p.companyId === company.id))
    : undefined;
  if (!hv.project) add(SHEET_HEADER, hRow("Project"), "Project is required.");
  else if (!project) {
    const exists = m.projects.some((p) => norm(p.label) === norm(hv.project));
    add(
      SHEET_HEADER,
      hRow("Project"),
      exists
        ? `Project "${hv.project}" does not belong to company "${hv.company}".`
        : `Project "${hv.project}" is not in the Project master.`,
    );
  }

  const docType = hv.documenttype
    ? m.docTypes.find((d) =>
        [d.code, d.description, d.name, docLabel(d), `${d.code} - ${d.description}`].some((x) => norm(x) === norm(hv.documenttype)),
      )
    : undefined;
  if (!hv.documenttype) add(SHEET_HEADER, hRow("Document Type"), "Document Type is required.");
  else if (!docType) add(SHEET_HEADER, hRow("Document Type"), `Document Type "${hv.documenttype}" is not a valid BOQ document type (see the Masters sheet).`);

  const finYear = hv.financialyear ? m.finYears.find((f) => norm(f.year) === norm(hv.financialyear)) : undefined;
  if (!hv.financialyear) add(SHEET_HEADER, hRow("Financial Year"), "Financial Year is required.");
  else if (!finYear) add(SHEET_HEADER, hRow("Financial Year"), `Financial Year "${hv.financialyear}" is not in the Financial Year master.`);

  const boqDate = hv.boqdate ? parseBoqDate(hv.boqdate) : null;
  if (!hv.boqdate) add(SHEET_HEADER, hRow("BOQ Date"), "BOQ Date is required.");
  else if (!boqDate) add(SHEET_HEADER, hRow("BOQ Date"), `BOQ Date "${hv.boqdate}" is not a valid date (use YYYY-MM-DD or DD/MM/YYYY).`);

  // ── Activities ──
  const uomByText = (txt: string) =>
    m.uoms.find((u) => norm(u.UOMName) === norm(txt) || (u.UOMCode && norm(u.UOMCode) === norm(txt)));
  const act = readTable(actRows, ACT_ALIASES);
  for (const f of act.missing.filter((f) => f !== "tax" && f !== "notes")) {
    add(SHEET_ACTIVITIES, 1, `Column for "${f === "group" ? "Activity Group" : f === "area" ? "Total Area" : f === "rate" ? "Total Rate" : f.toUpperCase()}" is missing — use the template headers.`);
  }
  if (act.table.length === 0 && act.missing.length === 0) add(SHEET_ACTIVITIES, 0, "Add at least one activity — a BOQ can't be imported without activities.");

  type ActRow = {
    groupId: string; groupName: string; activityId: string; activityName: string; activityCode: string;
    area: number; uomName: string; rate: number; tax: string; notes: string;
  };
  const acts: ActRow[] = [];
  const actKeys = new Set<string>();
  if (act.missing.filter((f) => f !== "tax" && f !== "notes").length === 0) {
    for (const { rowNo, cells: c } of act.table) {
      const start = issues.length;
      const bad = (msg: string) => add(SHEET_ACTIVITIES, rowNo, msg);
      const group = c.group ? m.groups.find((g) => norm(g.name) === norm(c.group)) : undefined;
      if (!c.group) bad("Activity Group is required.");
      else if (!group) bad(`Activity Group "${c.group}" is not in the Activity Group master.`);

      let activity: BoqImportMasters["activities"][number] | undefined;
      if (!c.activity) bad("Activity is required.");
      else if (group) {
        activity = m.activities.find((a) => a.groupId === group.id && norm(a.name) === norm(c.activity));
        if (!activity) {
          const other = m.activities.find((a) => norm(a.name) === norm(c.activity));
          bad(
            other
              ? `Activity "${c.activity}" belongs to group "${m.groups.find((g) => g.id === other.groupId)?.name ?? "another group"}", not "${group.name}".`
              : `Activity "${c.activity}" is not in the Activity master.`,
          );
        }
      }
      const area = toNumber(c.area);
      if (c.area === "") bad("Total Area is required.");
      else if (!(area > 0)) bad(`Total Area "${c.area}" must be a number greater than 0.`);
      const uom = c.uom ? uomByText(c.uom) : undefined;
      if (!c.uom) bad("UOM is required.");
      else if (!uom) bad(`UOM "${c.uom}" is not in the UOM master.`);
      const rate = toNumber(c.rate);
      if (c.rate === "") bad("Total Rate is required.");
      else if (!(rate > 0)) bad(`Total Rate "${c.rate}" must be a number greater than 0.`);
      const tax = c.tax === "" ? Number(DEFAULT_TAX) : toNumber(c.tax);
      if (!(tax >= 0 && tax <= 100)) bad(`Tax % "${c.tax}" must be between 0 and 100.`);

      if (group && activity) {
        const k = `${group.id}|${activity.id}`;
        if (actKeys.has(k)) bad(`Activity "${activity.name}" under group "${group.name}" is listed more than once.`);
        actKeys.add(k);
      }
      if (issues.length === start && group && activity && uom) {
        acts.push({
          groupId: group.id, groupName: group.name, activityId: activity.id, activityName: activity.name,
          activityCode: activity.code, area, uomName: uom.UOMName, rate, tax: String(tax), notes: c.notes,
        });
      }
    }
  }

  // ── Items ──
  const itm = readTable(itemRows, ITEM_ALIASES);
  for (const f of itm.missing.filter((f) => f !== "tax" && f !== "notes" && f !== "uom")) {
    add(SHEET_ITEMS, 1, `Column for "${f === "group" ? "Activity Group" : f === "qty" ? "Item Qty" : f === "item" ? "Item" : f === "rate" ? "Rate" : "Activity"}" is missing — use the template headers.`);
  }
  type ItemRow = {
    activityId: string; activityName: string; itemId: string; itemName: string; itemCode: string;
    qty: number; uomName: string; rate: number; tax: string; notes: string;
  };
  const itemsOut: ItemRow[] = [];
  const itemKeys = new Set<string>();
  if (itm.missing.filter((f) => f !== "tax" && f !== "notes" && f !== "uom").length === 0) {
    for (const { rowNo, cells: c } of itm.table) {
      const start = issues.length;
      const bad = (msg: string) => add(SHEET_ITEMS, rowNo, msg);
      const group = c.group ? m.groups.find((g) => norm(g.name) === norm(c.group)) : undefined;
      if (!c.group) bad("Activity Group is required.");
      else if (!group) bad(`Activity Group "${c.group}" is not in the Activity Group master.`);

      let parent: ActRow | undefined;
      if (!c.activity) bad("Activity is required (the activity this item is needed for).");
      else if (group) {
        parent = acts.find((a) => a.groupId === group.id && norm(a.activityName) === norm(c.activity));
        // Only complain when the Activities sheet row itself was fine (else that row already reports it).
        if (!parent && !actKeys.has(`${group.id}|${m.activities.find((a) => a.groupId === group.id && norm(a.name) === norm(c.activity))?.id}`)) {
          bad(`Activity "${c.activity}" under group "${group.name}" is not listed on the Activities sheet.`);
        }
      }

      let item: BoqImportMasters["items"][number] | undefined;
      if (!c.item) bad("Item is required.");
      else {
        const byCode = m.items.filter((i) => i.code && norm(i.code) === norm(c.item));
        const byName = m.items.filter((i) => norm(i.name) === norm(c.item));
        const hit = byCode.length === 1 ? byCode : byName;
        if (hit.length === 0) bad(`Item "${c.item}" is not in the Item master.`);
        else if (hit.length > 1) bad(`Item "${c.item}" matches ${hit.length} items — enter the Item Code instead.`);
        else item = hit[0];
      }
      const qty = toNumber(c.qty);
      if (c.qty === "") bad("Item Qty is required.");
      else if (!(qty > 0)) bad(`Item Qty "${c.qty}" must be a number greater than 0.`);
      const itemDefaultUom = item ? (m.uoms.find((u) => u.UOMCode === item!.uomCode)?.UOMName ?? item.uomCode) : "";
      let uomName = "";
      if (c.uom) {
        const uom = uomByText(c.uom);
        if (!uom) bad(`UOM "${c.uom}" is not in the UOM master.`);
        else uomName = uom.UOMName;
      } else if (item) {
        if (itemDefaultUom) uomName = itemDefaultUom;
        else bad(`UOM is required — item "${item.name}" has no default unit.`);
      }
      const rate = toNumber(c.rate);
      if (c.rate === "") bad("Rate is required.");
      else if (!(rate >= 0)) bad(`Rate "${c.rate}" must be a number (0 or more).`);
      const tax = c.tax === "" ? Number(DEFAULT_TAX) : toNumber(c.tax);
      if (!(tax >= 0 && tax <= 100)) bad(`Tax % "${c.tax}" must be between 0 and 100.`);

      if (parent && item) {
        const k = `${parent.activityId}|${item.id}`;
        if (itemKeys.has(k)) bad(`Item "${item.name}" is listed more than once under activity "${parent.activityName}".`);
        itemKeys.add(k);
      }
      if (issues.length === start && parent && item) {
        itemsOut.push({
          activityId: parent.activityId, activityName: parent.activityName, itemId: item.id, itemName: item.name,
          itemCode: item.code, qty, uomName, rate, tax: String(tax), notes: c.notes,
        });
      }
    }
  }

  if (issues.length > 0 || !company || !project || !docType || !finYear || !boqDate) return fail();

  // ── Payload: same shape as buildPayload() in BOQ.tsx ──
  const BoqActivities = acts.map((a) => ({
    groupId: a.groupId,
    groupName: a.groupName,
    area: String(a.area),
    activityId: a.activityId,
    activityName: a.activityName,
    activityCode: a.activityCode,
    description: a.notes,
    quantity: "1",
    uomName: a.uomName,
    unit: a.uomName,
    rate: String(a.rate),
    tax: a.tax,
    amount: a.rate, // Total Rate is the whole activity's price
  }));
  const BoqItems = itemsOut.map((i) => ({
    activityId: i.activityId,
    activityName: i.activityName,
    itemId: i.itemId,
    itemName: i.itemName,
    itemCode: i.itemCode,
    description: i.notes,
    quantity: String(i.qty),
    uomName: i.uomName,
    unit: i.uomName,
    rate: String(i.rate),
    tax: i.tax,
    amount: i.qty * i.rate,
  }));

  return {
    issues,
    payload: {
      BoqDate: boqDate,
      CompanyId: company.id,
      ProjectId: project.id,
      Description: hv.scopedescription ?? "",
      Remarks: hv.remarks ?? "",
      DocTypeId: docType.id,
      finYear: finYear.year,
      Status: "Draft",
      BoqItems,
      BoqActivities,
    },
    summary: {
      company: company.label ?? "",
      project: project.label ?? "",
      docType: docLabel(docType),
      finYear: finYear.year,
      date: boqDate,
      activityCount: BoqActivities.length,
      itemCount: BoqItems.length,
      activitiesTotal: BoqActivities.reduce((s, a) => s + a.amount, 0),
      itemsTotal: BoqItems.reduce((s, i) => s + i.amount, 0),
    },
  };
}

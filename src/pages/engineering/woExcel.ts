// Work Order Excel import — template + validation (Work Orders WITHOUT a BOQ).
//
// One workbook can carry many Work Orders. Rows on the Activities and Materials sheets are tied to
// their Work Order by a "WO Ref" label the user makes up (WO-1, WO-2 ...). The workbook is checked
// against the same masters the Work Order form uses (Company → Project, Contractor, Supplier,
// Activity Group → Activity, UOM, Item, SAC, Document Type, Financial Year); only a fully valid
// workbook is turned into payloads, built with the same arithmetic as the form (labour = Total Rate,
// material cost = Item Qty × price, HSN GST on the activity subtotal), so an imported Work Order
// stores, totals and prints exactly like a hand-keyed one. BoqID is always null.
import { buildWorkbook, downloadBlob, parseSheetDate, readSheetTable, readWorkbook, type XlsxCell, type XlsxSheet } from "@/lib/xlsxBook";
import { projectBelongsToCompany, projectCompanyIds, type ProjectCompanyLike } from "@/lib/projectBelongsTo";
import { didYouMean, normText } from "@/lib/importMatch";

export interface WoImportMasters {
  companies: { id: number; name: string }[];
  projects: (ProjectCompanyLike & { id: number; name: string })[];
  contractors: { id: number; name: string }[];
  suppliers: { id: number; name: string }[];
  groups: { id: number; name: string }[];
  activities: { id: number; name: string; groupId: number | null; hsnCode: string | null }[];
  uoms: { id: number; name: string; uomCode: string }[];
  items: { id: string; name: string; gstRate: number; uomName: string | null }[];
  sacCodes: { code: string; shortDesc: string; igstRate: number; cgstRate: number; sgstRate: number }[];
  /** Work Order document types (number series). */
  docTypes: { id: number; label: string }[];
  finYears: { year: string; startDate: string; endDate: string; status: string; locked: boolean }[];
  /** Existing work orders, for duplicate detection. */
  existing: { DocumentNumber?: string; DocumentDate?: string; TotalAmount?: number; CompanyName?: string; ProjectName?: string; ContractorName?: string }[];
}

export interface WoImportIssue {
  sheet: string;
  /** 1-based sheet row; 0 = whole sheet / file. */
  row: number;
  message: string;
}

export interface WoPlan {
  ref: string;
  /** Set when the user supplied their own document number. */
  manualDocNumber: string | null;
  docTypeLabel: string | null;
  summary: { company: string; project: string; contractor: string; date: string; activities: number; materials: number; total: number };
  /** Body for POST /api/work-orders (creates the header and, for a series, the document number). */
  createBody: Record<string, unknown>;
  /** Body for POST /api/work-orders/:id/save-full (header patched with the issued number). */
  fullHeader: Record<string, unknown>;
  activities: Record<string, unknown>[];
}

export interface WoImportResult {
  issues: WoImportIssue[];
  /** Present only when there are no issues. */
  plans: WoPlan[];
}

const SHEET_WO = "Work Orders";
const SHEET_ACT = "Activities";
const SHEET_MAT = "Materials";
const SHEET_MASTERS = "Masters";
const SHEET_HELP = "Instructions";
const MAX_ISSUES = 300;

const req = (v: string): XlsxCell => ({ v, s: "required" });
const opt = (v: string): XlsxCell => ({ v, s: "header" });
const note = (v: string): XlsxCell[] => [{ v, s: "note" }];

// ─── Template ────────────────────────────────────────────────────────────────

export async function downloadWoTemplate(m: WoImportMasters) {
  const projectRows = m.projects.flatMap((p) => {
    const linked = projectCompanyIds(p)
      .map((cid) => m.companies.find((c) => String(c.id) === cid)?.name)
      .filter((l): l is string => !!l);
    return (linked.length ? linked : [""]).map((company) => ({ project: p.name.trim(), company: company.trim() }));
  });
  const pairs = m.activities
    .map((a) => ({ group: m.groups.find((g) => g.id === a.groupId)?.name.trim() ?? "", activity: a.name.trim() }))
    .filter((p) => p.group && p.activity)
    .sort((a, b) => a.group.localeCompare(b.group) || a.activity.localeCompare(b.activity));
  const groupNames = [...new Set(pairs.map((p) => p.group))];

  const cols: string[][] = [
    ["Company", ...m.companies.map((c) => c.name.trim())], // A
    ["Project", ...projectRows.map((p) => p.project)], // B
    ["Project's Company", ...projectRows.map((p) => p.company)], // C
    ["Contractor", ...m.contractors.map((c) => c.name.trim())], // D
    ["Supplier", ...m.suppliers.map((c) => c.name.trim())], // E
    ["Document Type", ...m.docTypes.map((d) => d.label)], // F
    ["Activity Group", ...groupNames], // G
    ["Group (for Activity)", ...pairs.map((p) => p.group)], // H
    ["Activity", ...pairs.map((p) => p.activity)], // I
    ["UOM", ...m.uoms.map((u) => u.name.trim())], // J
    ["Item", ...m.items.map((i) => i.name.trim())], // K
    ["SAC Code", ...m.sacCodes.map((s) => s.code)], // L
    ["SAC GST %", ...m.sacCodes.map((s) => String(s.cgstRate + s.sgstRate || s.igstRate))], // M
  ];
  const depth = Math.max(...cols.map((c) => c.length));
  const masterRows: XlsxCell[][] = Array.from({ length: depth }, (_, r) => cols.map((c) => (r === 0 ? { v: c[0], s: "header" as const } : (c[r] ?? ""))));
  const range = (col: string, len: number) => `${SHEET_MASTERS}!$${col}$2:$${col}$${Math.max(2, len + 1)}`;

  const workOrders: XlsxSheet = {
    name: SHEET_WO,
    widths: [12, 26, 26, 16, 28, 28, 20, 26, 30, 40],
    freezeBelowRow: 2,
    rows: [[req("WO Ref *"), req("Company *"), req("Project *"), req("Document Date *"), req("Contractor *"), opt("Document Type"), opt("Document Number"), opt("Supplier"), opt("Remarks"), opt("Terms & Conditions")]],
    lists: [
      { sqref: "B2:B500", formula: range("A", m.companies.length) },
      { sqref: "C2:C500", formula: range("B", projectRows.length) },
      { sqref: "E2:E500", formula: range("D", m.contractors.length) },
      { sqref: "F2:F500", formula: range("F", m.docTypes.length) },
      { sqref: "H2:H500", formula: range("E", m.suppliers.length) },
    ],
  };
  const activities: XlsxSheet = {
    name: SHEET_ACT,
    widths: [12, 26, 30, 18, 14, 20, 16],
    freezeBelowRow: 2,
    rows: [[req("WO Ref *"), req("Activity Group *"), req("Activity *"), req("UOM *"), req("Area *"), req("Total Rate (Labour) *"), opt("SAC Code")]],
    lists: [
      { sqref: "B2:B2000", formula: range("G", groupNames.length) },
      { sqref: "D2:D2000", formula: range("J", m.uoms.length) },
      { sqref: "G2:G2000", formula: range("L", m.sacCodes.length) },
    ],
  };
  const materials: XlsxSheet = {
    name: SHEET_MAT,
    widths: [12, 26, 30, 32, 18, 14, 18, 26],
    freezeBelowRow: 2,
    rows: [[req("WO Ref *"), req("Activity Group *"), req("Activity *"), req("Item *"), req("Item Qty (total) *"), opt("UOM"), req("Price per Unit *"), opt("Supplier")]],
    lists: [
      { sqref: "B2:B5000", formula: range("G", groupNames.length) },
      { sqref: "D2:D5000", formula: range("K", m.items.length) },
      { sqref: "F2:F5000", formula: range("J", m.uoms.length) },
      { sqref: "H2:H5000", formula: range("E", m.suppliers.length) },
    ],
  };
  const help: XlsxSheet = {
    name: SHEET_HELP,
    widths: [112],
    rows: [
      [{ v: "Work Order Excel import — Work Orders without a BOQ", s: "title" }],
      note(""),
      [{ v: "One workbook can hold many Work Orders. Tie the rows together with a WO Ref you choose (WO-1, WO-2, …): the same WO Ref on the Work Orders, Activities and Materials sheets means the same Work Order.", s: "default" }],
      note(""),
      [{ v: "1. Work Orders sheet — one row per Work Order", s: "label" }],
      note("WO Ref, Company, Project, Document Date and Contractor are required. The Project must belong to the Company. Supplier, Remarks and Terms & Conditions are optional."),
      note("Numbering: leave Document Number empty and pick a Document Type — the next number of that series is issued automatically (if there is only one Work Order series you may leave Document Type empty too). Or type your own Document Number (e.g. an existing paper work order's number) and leave Document Type empty."),
      [{ v: "2. Activities sheet — the activities of each Work Order (at least one per Work Order)", s: "label" }],
      note("Pick the Activity Group first, then an Activity of that group. Area and Total Rate (Labour) are required and must be above 0: Total Rate is the price for the WHOLE activity, so the rate per unit of area = Total Rate ÷ Area. SAC Code is optional (it defaults to the activity's own SAC from the Activity Master) and decides the GST on the activity."),
      [{ v: "3. Materials sheet — the materials each activity needs (optional)", s: "label" }],
      note("Group + Activity must match a row on the Activities sheet for the same WO Ref. Item Qty is the TOTAL quantity for the whole activity (per-unit of area = Item Qty ÷ Area). Cost = Item Qty × Price per Unit. UOM defaults to the item's own unit; the item's GST comes from the Item Master."),
      [{ v: "Rules", s: "label" }],
      note("• Every required cell (dark orange headers) must be filled; amounts, Area and quantities must be numbers above 0."),
      note("• A WO Ref, a Document Number, an Activity within a Work Order and an Item within an Activity can't repeat. A Work Order that already exists (same Document Number, or same company, project, contractor, date and total) is rejected as a duplicate."),
      note("• If any row is invalid nothing is imported — fix the rows listed and upload again. A Work Order is never created half-filled."),
      note("• Imported Work Orders are created exactly like ones entered on screen (same numbering, status and approval flow) and are not linked to any BOQ."),
      note("• Don't rename the sheets or the header rows. The Masters sheet is reference only."),
      note(""),
      [{ v: "Example", s: "label" }],
      note("Work Orders:  WO-1 | Rajwada Group | Royal Garden | 2026-10-09 | A1 Contractors | (blank) | (blank) | | Foundation work"),
      note("Activities:  WO-1 | PILING | PILING01 | Square Feet | 1000 | 280000 | 9954"),
      note("Materials:  WO-1 | PILING | PILING01 | Cement 53 Grade | 60000 | | 380 |      →  material cost = 60000 × 380"),
    ],
  };
  const masters: XlsxSheet = { name: SHEET_MASTERS, widths: [26, 26, 26, 28, 28, 22, 24, 26, 30, 16, 32, 14, 12], freezeBelowRow: 2, rows: masterRows };

  downloadBlob(await buildWorkbook([help, workOrders, activities, materials, masters]), "Work_Order_Import_Template.xlsx");
}

// ─── Parsing + validation ────────────────────────────────────────────────────

const toNum = (v: string): number => {
  const s = String(v ?? "").replace(/[,₹\s]/g, "");
  return s === "" ? NaN : Number(s);
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const WO_ALIASES = {
  ref: ["woref", "ref", "reference"],
  company: ["company"],
  project: ["project"],
  date: ["documentdate", "date", "wodate"],
  contractor: ["contractor"],
  docType: ["documenttype", "doctype"],
  docNo: ["documentnumber", "docno", "wonumber", "documentno"],
  supplier: ["supplier"],
  remarks: ["remarks"],
  terms: ["termsconditions", "termsandconditions", "terms"],
};
const ACT_ALIASES = {
  ref: ["woref", "ref", "reference"],
  group: ["activitygroup", "group"],
  activity: ["activity"],
  uom: ["uom", "unit"],
  area: ["area"],
  rate: ["totalratelabour", "totalrate", "labourrate", "rate"],
  sac: ["saccode", "sac", "hsn", "hsncode"],
};
const MAT_ALIASES = {
  ref: ["woref", "ref", "reference"],
  group: ["activitygroup", "group"],
  activity: ["activity"],
  item: ["item", "itemname", "material"],
  qty: ["itemqtytotal", "itemqty", "qty", "quantity"],
  uom: ["uom", "unit"],
  price: ["priceperunit", "price", "rate", "itemrate"],
  supplier: ["supplier"],
};

export async function parseWoWorkbook(file: File, m: WoImportMasters): Promise<WoImportResult> {
  const issues: WoImportIssue[] = [];
  const add = (sheet: string, row: number, message: string) => {
    if (issues.length < MAX_ISSUES) issues.push({ sheet, row, message });
  };
  const fail = (): WoImportResult => ({ issues, plans: [] });

  let book: Record<string, string[][]>;
  try {
    book = await readWorkbook(await file.arrayBuffer());
  } catch (e: any) {
    add("File", 0, e?.message ?? "Could not read the file.");
    return fail();
  }
  const sheet = (name: string) => {
    const k = Object.keys(book).find((n) => normText(n) === normText(name));
    return k ? book[k] : null;
  };
  const woRows = sheet(SHEET_WO), actRows = sheet(SHEET_ACT), matRows = sheet(SHEET_MAT);
  for (const [rows, name] of [[woRows, SHEET_WO], [actRows, SHEET_ACT]] as const) {
    if (!rows) add(name, 0, `Sheet "${name}" not found — please fill the template downloaded from this page.`);
  }
  if (!woRows || !actRows) return fail();

  const wo = readSheetTable(woRows, WO_ALIASES);
  const act = readSheetTable(actRows, ACT_ALIASES);
  const mat = matRows ? readSheetTable(matRows, MAT_ALIASES) : { table: [], missing: [] as string[] };
  const label = (s: string) => ({ ref: "WO Ref", company: "Company", project: "Project", date: "Document Date", contractor: "Contractor", group: "Activity Group", activity: "Activity", uom: "UOM", area: "Area", rate: "Total Rate (Labour)", item: "Item", qty: "Item Qty", price: "Price per Unit" } as Record<string, string>)[s] ?? s;
  for (const f of wo.missing.filter((f) => ["ref", "company", "project", "date", "contractor"].includes(f))) add(SHEET_WO, 1, `Column "${label(f)}" is missing — use the template headers.`);
  for (const f of act.missing.filter((f) => ["ref", "group", "activity", "uom", "area", "rate"].includes(f))) add(SHEET_ACT, 1, `Column "${label(f)}" is missing — use the template headers.`);
  if (matRows) for (const f of mat.missing.filter((f) => ["ref", "group", "activity", "item", "qty", "price"].includes(f))) add(SHEET_MAT, 1, `Column "${label(f)}" is missing — use the template headers.`);
  if (issues.length) return fail();
  if (wo.table.length === 0) { add(SHEET_WO, 0, "Add at least one Work Order row."); return fail(); }

  const byName = <T extends { name: string }>(list: T[], v: string) => list.find((x) => normText(x.name) === normText(v));
  const fyOf = (iso: string) => m.finYears.find((f) => f.status === "Active" && !f.locked && f.startDate && f.endDate && iso >= f.startDate && iso <= f.endDate);

  // ── Work Orders ──
  type Header = {
    ref: string; rowNo: number; company: { id: number; name: string }; project: { id: number; name: string };
    contractor: { id: number; name: string }; supplierId: number | null; date: string; docNo: string | null;
    docType: { id: number; label: string } | null; finYear: string | null; remarks: string; terms: string; ok: boolean;
  };
  const headers = new Map<string, Header>();
  const manualNos = new Set<string>();
  const onlyType = m.docTypes.length === 1 ? m.docTypes[0] : null;

  for (const { rowNo, cells: c } of wo.table) {
    const start = issues.length;
    const bad = (msg: string) => add(SHEET_WO, rowNo, msg);
    if (!c.ref) bad("WO Ref is required.");
    else if (headers.has(normText(c.ref))) bad(`WO Ref "${c.ref}" is used on more than one row.`);

    const company = c.company ? byName(m.companies, c.company) : undefined;
    if (!c.company) bad("Company is required.");
    else if (!company) bad(`Company "${c.company}" is not in the Company master${didYouMean(c.company, m.companies.map((x) => x.name))}`);

    let project: (typeof m.projects)[number] | undefined;
    if (!c.project) bad("Project is required.");
    else {
      const named = m.projects.filter((p) => normText(p.name) === normText(c.project));
      if (named.length === 0) bad(`Project "${c.project}" is not in the Project master (or is inactive)${didYouMean(c.project, m.projects.map((x) => x.name))}`);
      else if (company) {
        project = named.find((p) => projectBelongsToCompany(p, company.id));
        if (!project) {
          const linked = [...new Set(named.flatMap((p) => projectCompanyIds(p)))].map((id) => m.companies.find((x) => String(x.id) === id)?.name.trim() ?? `#${id}`);
          bad(`Project "${c.project}" is not linked to company "${company.name.trim()}"${linked.length ? ` (linked to: ${linked.join(", ")})` : ""} — fix the Company, or link the project in Project Master`);
        }
      } else project = named[0];
    }

    const contractor = c.contractor ? byName(m.contractors, c.contractor) : undefined;
    if (!c.contractor) bad("Contractor is required.");
    else if (!contractor) bad(`Contractor "${c.contractor}" is not in the Contractor list${didYouMean(c.contractor, m.contractors.map((x) => x.name))}`);

    let supplierId: number | null = null;
    if (c.supplier) {
      const s = byName(m.suppliers, c.supplier);
      if (!s) bad(`Supplier "${c.supplier}" is not in the Supplier list${didYouMean(c.supplier, m.suppliers.map((x) => x.name))}`);
      else supplierId = s.id;
    }

    let date = "";
    let finYear: string | null = null;
    if (!c.date) bad("Document Date is required.");
    else {
      const iso = parseSheetDate(c.date);
      if (!iso) bad(`Document Date "${c.date}" is not valid — use YYYY-MM-DD or DD/MM/YYYY.`);
      else {
        date = iso;
        const fy = fyOf(iso);
        if (!fy) bad(`Document Date ${iso} doesn't fall in an open (active, unlocked) Financial Year.`);
        else finYear = fy.year;
      }
    }

    // Numbering: own number XOR a series.
    let docNo: string | null = null;
    let docType: { id: number; label: string } | null = null;
    if (c.docNo && c.docType) bad("Give either a Document Number or a Document Type, not both.");
    else if (c.docNo) {
      docNo = c.docNo.trim().toUpperCase();
      const exists = m.existing.some((e) => normText(e.DocumentNumber) === normText(docNo));
      if (exists) bad(`Document Number "${docNo}" already exists — a Work Order can't be imported twice.`);
      else if (manualNos.has(normText(docNo))) bad(`Document Number "${docNo}" is used on more than one row.`);
      manualNos.add(normText(docNo));
    } else if (c.docType) {
      docType = m.docTypes.find((d) => normText(d.label) === normText(c.docType)) ?? null;
      if (!docType) bad(`Document Type "${c.docType}" is not a Work Order series${didYouMean(c.docType, m.docTypes.map((x) => x.label))}`);
    } else if (onlyType) docType = onlyType;
    else if (m.docTypes.length === 0) bad("No Work Order document series is configured — enter a Document Number instead.");
    else bad("Pick a Document Type (several Work Order series exist) or enter your own Document Number.");

    if (c.ref && company && project && contractor) {
      headers.set(normText(c.ref), {
        ref: c.ref, rowNo, company, project, contractor, supplierId, date, docNo, docType, finYear,
        remarks: c.remarks, terms: c.terms, ok: issues.length === start,
      });
    } else if (c.ref && !headers.has(normText(c.ref))) {
      headers.set(normText(c.ref), { ref: c.ref, rowNo, company: company ?? { id: 0, name: "" }, project: project ?? { id: 0, name: "" }, contractor: contractor ?? { id: 0, name: "" }, supplierId, date, docNo, docType, finYear, remarks: c.remarks, terms: c.terms, ok: false });
    }
  }

  // ── Activities ──
  type Act = {
    ref: string; group: { id: number; name: string }; activity: { id: number; name: string; hsnCode: string | null };
    uom: { id: number; name: string }; area: number; totalRate: number;
    sac: { code: string; rate: number; type: "cgst_sgst" | "igst" } | null; materials: Mat[];
  };
  type Mat = { itemId: string; itemName: string; qty: number; uomId: number | null; price: number; gstRate: number; supplierId: number | null };
  const acts = new Map<string, Act[]>(); // by normalized WO ref
  const actKey = new Set<string>();

  for (const { rowNo, cells: c } of act.table) {
    const start = issues.length;
    const bad = (msg: string) => add(SHEET_ACT, rowNo, msg);
    const h = c.ref ? headers.get(normText(c.ref)) : undefined;
    if (!c.ref) bad("WO Ref is required.");
    else if (!h) bad(`WO Ref "${c.ref}" is not on the Work Orders sheet.`);

    const group = c.group ? byName(m.groups, c.group) : undefined;
    if (!c.group) bad("Activity Group is required.");
    else if (!group) bad(`Activity Group "${c.group}" is not in the Activity Group master${didYouMean(c.group, m.groups.map((x) => x.name))}`);

    let activity: (typeof m.activities)[number] | undefined;
    if (!c.activity) bad("Activity is required.");
    else if (group) {
      activity = m.activities.find((a) => a.groupId === group.id && normText(a.name) === normText(c.activity));
      if (!activity) {
        const other = m.activities.find((a) => normText(a.name) === normText(c.activity));
        bad(other ? `Activity "${c.activity}" belongs to group "${m.groups.find((g) => g.id === other.groupId)?.name.trim() ?? "another group"}", not "${group.name.trim()}".` : `Activity "${c.activity}" is not in the Activity master${didYouMean(c.activity, m.activities.map((x) => x.name))}`);
      }
    }
    const uom = c.uom ? m.uoms.find((u) => normText(u.name) === normText(c.uom) || (u.uomCode && normText(u.uomCode) === normText(c.uom))) : undefined;
    if (!c.uom) bad("UOM is required.");
    else if (!uom) bad(`UOM "${c.uom}" is not in the UOM master${didYouMean(c.uom, m.uoms.map((x) => x.name))}`);
    const area = toNum(c.area);
    if (c.area === "") bad("Area is required.");
    else if (!(area > 0)) bad(`Area "${c.area}" must be a number above 0.`);
    const totalRate = toNum(c.rate);
    if (c.rate === "") bad("Total Rate (Labour) is required.");
    else if (!(totalRate > 0)) bad(`Total Rate "${c.rate}" must be a number above 0.`);

    let sac: Act["sac"] = null;
    const sacCode = c.sac || activity?.hsnCode || "";
    if (sacCode) {
      const rec = m.sacCodes.find((s) => normText(s.code) === normText(sacCode));
      if (rec) sac = { code: rec.code, rate: rec.cgstRate + rec.sgstRate || rec.igstRate, type: rec.cgstRate > 0 ? "cgst_sgst" : "igst" };
      else if (c.sac) bad(`SAC Code "${c.sac}" is not a SAC code in the HSN master${didYouMean(c.sac, m.sacCodes.map((x) => x.code))}`);
    }

    if (h && group && activity) {
      const k = `${normText(c.ref)}|${group.id}|${activity.id}`;
      if (actKey.has(k)) bad(`Activity "${activity.name.trim()}" is listed more than once in ${c.ref}.`);
      actKey.add(k);
    }
    if (issues.length === start && h && group && activity && uom) {
      const list = acts.get(normText(c.ref)) ?? [];
      list.push({ ref: c.ref, group, activity, uom, area, totalRate, sac, materials: [] });
      acts.set(normText(c.ref), list);
    }
  }

  // ── Materials ──
  const matKey = new Set<string>();
  for (const { rowNo, cells: c } of mat.table) {
    const start = issues.length;
    const bad = (msg: string) => add(SHEET_MAT, rowNo, msg);
    const h = c.ref ? headers.get(normText(c.ref)) : undefined;
    if (!c.ref) bad("WO Ref is required.");
    else if (!h) bad(`WO Ref "${c.ref}" is not on the Work Orders sheet.`);

    const group = c.group ? byName(m.groups, c.group) : undefined;
    if (!c.group) bad("Activity Group is required.");
    else if (!group) bad(`Activity Group "${c.group}" is not in the Activity Group master.`);
    let parent: Act | undefined;
    if (!c.activity) bad("Activity is required (the activity the material is for).");
    else if (h && group) {
      parent = (acts.get(normText(c.ref)) ?? []).find((a) => a.group.id === group.id && normText(a.activity.name) === normText(c.activity));
      const declared = actKey.has(`${normText(c.ref)}|${group.id}|${m.activities.find((a) => a.groupId === group.id && normText(a.name) === normText(c.activity))?.id}`);
      if (!parent && !declared) bad(`Activity "${c.activity}" under group "${group.name.trim()}" is not on the Activities sheet for ${c.ref}.`);
    }

    let item: (typeof m.items)[number] | undefined;
    if (!c.item) bad("Item is required.");
    else {
      const hits = m.items.filter((i) => normText(i.name) === normText(c.item));
      if (hits.length === 0) bad(`Item "${c.item}" is not in the Item Master${didYouMean(c.item, m.items.map((x) => x.name))}`);
      else if (hits.length > 1) bad(`Item "${c.item}" matches ${hits.length} Item Master entries — rename one so the name is unique.`);
      else item = hits[0];
    }
    const qty = toNum(c.qty);
    if (c.qty === "") bad("Item Qty is required.");
    else if (!(qty > 0)) bad(`Item Qty "${c.qty}" must be a number above 0.`);
    const price = toNum(c.price);
    if (c.price === "") bad("Price per Unit is required.");
    else if (!(price >= 0)) bad(`Price per Unit "${c.price}" must be a number (0 or more).`);

    let uomId: number | null = null;
    if (c.uom) {
      const u = m.uoms.find((x) => normText(x.name) === normText(c.uom) || (x.uomCode && normText(x.uomCode) === normText(c.uom)));
      if (!u) bad(`UOM "${c.uom}" is not in the UOM master.`);
      else uomId = u.id;
    } else if (item?.uomName) {
      uomId = m.uoms.find((x) => x.uomCode === item!.uomName || normText(x.name) === normText(item!.uomName))?.id ?? null;
    }
    let supplierId: number | null = null;
    if (c.supplier) {
      const s = byName(m.suppliers, c.supplier);
      if (!s) bad(`Supplier "${c.supplier}" is not in the Supplier list.`);
      else supplierId = s.id;
    }
    if (parent && item) {
      const k = `${normText(c.ref)}|${parent.group.id}|${parent.activity.id}|${item.id}`;
      if (matKey.has(k)) bad(`Item "${item.name.trim()}" is listed more than once under activity "${parent.activity.name.trim()}".`);
      matKey.add(k);
    }
    if (issues.length === start && parent && item) {
      parent.materials.push({ itemId: item.id, itemName: item.name, qty, uomId, price, gstRate: item.gstRate || 0, supplierId });
    }
  }

  // ── Per-Work-Order completeness + duplicates ──
  for (const h of headers.values()) {
    if ((acts.get(normText(h.ref)) ?? []).length === 0 && h.ok !== undefined) {
      const anyActRow = act.table.some((r) => normText(r.cells.ref) === normText(h.ref));
      if (!anyActRow) add(SHEET_WO, h.rowNo, `${h.ref} has no activities — add at least one row on the Activities sheet.`);
    }
  }

  // ── Build plans (only when everything is valid) ──
  const plans: WoPlan[] = [];
  if (issues.length === 0) {
    const seen = new Set<string>();
    for (const h of headers.values()) {
      const list = acts.get(normText(h.ref)) ?? [];
      let labour = 0, materialsTotal = 0, gst = 0, matCount = 0;
      const activityBodies = list.map((a) => {
        const ratePerUnit = a.totalRate / a.area;
        const matAmt = a.materials.reduce((s, x) => s + x.qty * x.price, 0);
        const sub = a.totalRate + matAmt;
        labour += a.totalRate;
        materialsTotal += matAmt;
        gst += a.sac && a.sac.rate > 0 ? (sub * a.sac.rate) / 100 : 0;
        matCount += a.materials.length;
        return {
          ActivityGroupId: a.group.id,
          ActivityId: a.activity.id,
          UOMId: a.uom.id,
          Rate: ratePerUnit || null,
          Area: a.area || null,
          LabourAmount: a.totalRate || null,
          MaterialAmount: matAmt || null,
          GrandTotal: sub || null,
          Remarks: null,
          HsnCode: a.sac?.code || null,
          HsnGstRate: a.sac?.rate || null,
          HsnGstType: a.sac?.type || null,
          materials: a.materials.map((x) => ({
            ItemId: x.itemId,
            UOMId: x.uomId,
            // Stored as quantity per unit of area — the same value the form saves.
            Quantity: x.qty / a.area || null,
            Rate: x.price || null,
            GSTRate: x.gstRate,
            SupplierIdPerLine: x.supplierId,
            Remarks: null,
          })),
        };
      });
      const total = labour + materialsTotal + gst;

      // Probable duplicate of an existing work order.
      const dupe = m.existing.find(
        (e) => normText(e.CompanyName) === normText(h.company.name) && normText(e.ProjectName) === normText(h.project.name) &&
          normText(e.ContractorName) === normText(h.contractor.name) && String(e.DocumentDate ?? "").slice(0, 10) === h.date &&
          Math.abs(r2(Number(e.TotalAmount) || 0) - r2(total)) < 0.01,
      );
      if (dupe) add(SHEET_WO, h.rowNo, `${h.ref} looks like a duplicate of existing Work Order ${dupe.DocumentNumber} (same company, project, contractor, date and amount ${money(total)}).`);
      const fileKey = [h.company.id, h.project.id, h.contractor.id, h.date, r2(total)].join("|");
      if (seen.has(fileKey)) add(SHEET_WO, h.rowNo, `${h.ref} duplicates another Work Order in this file (same company, project, contractor, date and amount).`);
      seen.add(fileKey);

      const common = {
        BoqID: null,
        CompanyId: h.company.id,
        ProjectId: h.project.id,
        DocumentDate: h.date,
        ContractorId: h.contractor.id,
        SupplierId: h.supplierId,
        TotalAmount: total,
        Remarks: h.remarks || null,
        TermsAndConditions: h.terms || null,
      };
      plans.push({
        ref: h.ref,
        manualDocNumber: h.docNo,
        docTypeLabel: h.docType?.label ?? null,
        summary: { company: h.company.name.trim(), project: h.project.name.trim(), contractor: h.contractor.name.trim(), date: h.date, activities: list.length, materials: matCount, total },
        createBody: h.docNo
          ? { ...common, DocumentNumber: h.docNo, DocNo: h.docNo }
          : { ...common, DocTypeId: h.docType!.id, finYear: h.finYear },
        fullHeader: { ...common, DocTypeId: h.docType?.id ?? null },
        activities: activityBodies,
      });
    }
  }
  return issues.length ? fail() : { issues, plans };
}

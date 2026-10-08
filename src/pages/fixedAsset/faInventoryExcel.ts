// FA Inventory (Fixed Asset tagging) — Excel import template + file reader.
//
// The template carries every field a tagging entry needs (Company, Project,
// Godown, Item Code, Item Name, Date, Quantity, Remarks) with dropdowns fed from
// the masters — the Item lists only Fixed Asset items. Row-by-row validation
// against the Item Master (existence, Type of Item = Fixed Asset, untagged stock)
// happens in FixedAssetTagging.tsx's importer; this file builds the workbook and
// turns an uploaded .xlsx / .csv into plain rows for it.
import { parseCsv } from "@/lib/export";
import { projectCompanyIds, type ProjectCompanyLike } from "@/lib/projectBelongsTo";
import { buildWorkbook, downloadBlob, readWorkbook, type XlsxCell, type XlsxSheet } from "@/lib/xlsxBook";

export type FaImportMode = "bulk" | "individual";

export interface FaImportMasters {
  companies: { id: number; label: string }[];
  projects: (ProjectCompanyLike & { id: number; label: string })[];
  godowns: { GodownName: string; EnterpriseID: number | null; ProjectID: number | null }[];
  /** Fixed Asset items of the Item Master only. */
  faItems: { code: string; name: string; uom: string }[];
}

/** One data row of an uploaded file, keyed by canonical column. */
export interface FaImportFileRow {
  /** 1-based row number in the file (header = 1). */
  rowNo: number;
  Company: string;
  Project: string;
  Godown: string;
  ItemCode: string;
  ItemName: string;
  Date: string;
  Quantity: string;
  Rate: string;
  Remarks: string;
}

const SHEET = "FA Inventory";
const key = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const COLUMN_ALIASES: Record<keyof Omit<FaImportFileRow, "rowNo">, string[]> = {
  Company: ["company"],
  Project: ["project"],
  Godown: ["godown", "store", "warehouse"],
  ItemCode: ["itemcode", "code"],
  // "Item" is the single item column of the previous template — treated as the name.
  ItemName: ["itemname", "item", "assetname"],
  Date: ["date", "taggingdate", "docdate"],
  Quantity: ["quantity", "qty"],
  Rate: ["rate", "unitrate", "rateperunit", "cost", "unitcost"],
  Remarks: ["remarks", "remark", "notes"],
};

const req = (v: string): XlsxCell => ({ v, s: "required" });
const opt = (v: string): XlsxCell => ({ v, s: "header" });

export async function downloadFaInventoryTemplate(mode: FaImportMode, m: FaImportMasters) {
  const bulk = mode === "bulk";
  // One row per (project, linked company) — a project can be tagged to several companies.
  const projectRows = m.projects.flatMap((p) => {
    const linked = projectCompanyIds(p)
      .map((cid) => m.companies.find((c) => String(c.id) === cid)?.label)
      .filter((l): l is string => !!l);
    return (linked.length ? linked : [""]).map((company) => ({ project: p.label.trim(), company: company.trim() }));
  });
  const godownRows = m.godowns.map((g) => ({
    godown: g.GodownName.trim(),
    company: m.companies.find((c) => c.id === g.EnterpriseID)?.label ?? "",
    project: m.projects.find((p) => p.id === g.ProjectID)?.label ?? "",
  }));

  const cols: string[][] = [
    ["Company", ...m.companies.map((c) => c.label.trim())], // A
    ["Project", ...projectRows.map((p) => p.project)], // B
    ["Project's Company", ...projectRows.map((p) => p.company)], // C
    ["Godown", ...godownRows.map((g) => g.godown)], // D
    ["Godown's Company", ...godownRows.map((g) => g.company)], // E
    ["Godown's Project", ...godownRows.map((g) => g.project)], // F
    ["Fixed Asset Item Code", ...m.faItems.map((i) => i.code.trim())], // G
    ["Fixed Asset Item Name", ...m.faItems.map((i) => i.name.trim())], // H
    ["Item's UOM", ...m.faItems.map((i) => i.uom)], // I
  ];
  const depth = Math.max(...cols.map((c) => c.length));
  const masterRows: XlsxCell[][] = Array.from({ length: depth }, (_, r) =>
    cols.map((c) => (r === 0 ? { v: c[0], s: "header" as const } : (c[r] ?? ""))),
  );
  const range = (col: string, len: number) => `Masters!$${col}$2:$${col}$${Math.max(2, len + 1)}`;

  // Column order: Company, Project, Godown, Item Code, Item Name, Date, [Quantity], Remarks
  const head: XlsxCell[] = [
    req("Company *"),
    req("Project *"),
    req("Godown *"),
    req("Item Code *"),
    req("Item Name *"),
    req("Date *"),
    ...(bulk ? [req("Quantity *")] : []),
    opt("Rate (₹ per unit)"),
    opt("Remarks"),
  ];
  const inventory: XlsxSheet = {
    name: SHEET,
    widths: bulk ? [26, 26, 26, 18, 32, 14, 12, 18, 36] : [26, 26, 26, 18, 32, 14, 18, 36],
    freezeBelowRow: 2,
    rows: [head],
    lists: [
      { sqref: "A2:A2000", formula: range("A", m.companies.length) },
      { sqref: "B2:B2000", formula: range("B", projectRows.length) },
      { sqref: "C2:C2000", formula: range("D", m.godowns.length) },
      { sqref: "D2:D2000", formula: range("G", m.faItems.length) },
      { sqref: "E2:E2000", formula: range("H", m.faItems.length) },
    ],
  };

  const note = (v: string): XlsxCell[] => [{ v, s: "note" }];
  const help: XlsxSheet = {
    name: "Instructions",
    widths: [110],
    rows: [
      [{ v: `FA Inventory import — ${bulk ? "Bulk" : "Individual"} template`, s: "title" }],
      note(""),
      [{ v: "Fill the “FA Inventory” sheet (one row per entry), save it, then use Import from Excel on the FA Inventory page.", s: "default" }],
      note(""),
      [{ v: "What an entry is", s: "label" }],
      note(
        bulk
          ? "Each row adds Fixed Asset stock straight into the Godown — no GRN and no existing stock needed — and then generates that many FA Item Codes (one per unit) through the normal FA tagging. The entry is marked “Imported Stock / Without GRN”."
          : "Each row adds exactly ONE unit of Fixed Asset stock straight into the Godown (there is no Quantity column — list a unit per row) — no GRN and no existing stock needed — and generates its FA Item Code through the normal FA tagging. The entry is marked “Imported Stock / Without GRN”.",
      ),
      [{ v: "Required columns (dark orange headers)", s: "label" }],
      note("Company · Project · Godown · Item Code · Item Name · Date" + (bulk ? " · Quantity" : "")),
      note("Rate (₹ per unit) and Remarks are optional. Rate becomes the asset's purchase cost."),
      [{ v: "Rules checked on import", s: "label" }],
      note("• Company, Project (of that company) and Godown must exist in the masters — use the dropdowns or the Masters sheet."),
      note("• The item must exist in the Item Master (Item Code and Item Name must belong to the same item). If only one is given, that one is used."),
      note("• Only items whose Type of Item = Fixed Asset are accepted; any other item is rejected with its type shown."),
      note("• The Godown does not need to hold the item already — the imported quantity is added to its stock. No GRN number is required or created."),
      note("• Date: YYYY-MM-DD or DD/MM/YYYY, inside a configured Financial Year." + (bulk ? " Quantity: a whole number above 0." : "")),
      note("• Rows with problems are shown with the reason and are not imported; valid rows can still be imported."),
      note(""),
      [{ v: "Example", s: "label" }],
      note(bulk ? "Rajwada | Rajwada 2 | Main Store | CAM-01 | Camera | 2026-10-06 | 3 | 18500 | Site CCTV" : "Rajwada | Rajwada 2 | Main Store | CAM-01 | Camera | 2026-10-06 | 18500 | Site CCTV"),
    ],
  };

  const masters: XlsxSheet = {
    name: "Masters",
    widths: [26, 26, 26, 26, 26, 26, 22, 32, 14],
    freezeBelowRow: 2,
    rows: masterRows,
  };

  downloadBlob(
    await buildWorkbook([help, inventory, masters]),
    bulk ? "FA_Inventory_Import_Template_Bulk.xlsx" : "FA_Inventory_Import_Template_Individual.xlsx",
  );
}

/** Reads an uploaded .xlsx or .csv into canonical rows (blank rows skipped). */
export async function readFaImportFile(file: File): Promise<FaImportFileRow[]> {
  let grid: string[][];
  if (/\.xlsx$/i.test(file.name)) {
    const book = await readWorkbook(await file.arrayBuffer());
    const names = Object.keys(book);
    const name =
      names.find((n) => key(n) === key(SHEET)) ??
      names.find((n) => key(n) !== "instructions" && key(n) !== "masters" && (book[n] ?? []).length > 0);
    if (!name) throw new Error(`No "${SHEET}" sheet found — please use the downloaded template.`);
    grid = book[name];
  } else {
    const objs = parseCsv(await file.text());
    const headers = objs.length ? Object.keys(objs[0]) : [];
    grid = [headers, ...objs.map((o) => headers.map((h) => o[h] ?? ""))];
  }

  const hdrIdx = grid.findIndex((r) => (r ?? []).some((c) => key(c) !== ""));
  if (hdrIdx === -1) return [];
  const colOf: Partial<Record<keyof typeof COLUMN_ALIASES, number>> = {};
  grid[hdrIdx].forEach((h, ci) => {
    const k = key(h);
    for (const [field, names] of Object.entries(COLUMN_ALIASES)) {
      const f = field as keyof typeof COLUMN_ALIASES;
      if (colOf[f] === undefined && names.includes(k)) colOf[f] = ci;
    }
  });

  const rows: FaImportFileRow[] = [];
  for (let r = hdrIdx + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    if (!row.some((c) => String(c ?? "").trim() !== "")) continue;
    const get = (f: keyof typeof COLUMN_ALIASES) => (colOf[f] === undefined ? "" : String(row[colOf[f]!] ?? "").trim());
    rows.push({
      rowNo: r + 1,
      Company: get("Company"),
      Project: get("Project"),
      Godown: get("Godown"),
      ItemCode: get("ItemCode"),
      ItemName: get("ItemName"),
      Date: get("Date"),
      Quantity: get("Quantity"),
      Rate: get("Rate"),
      Remarks: get("Remarks"),
    });
  }
  return rows;
}

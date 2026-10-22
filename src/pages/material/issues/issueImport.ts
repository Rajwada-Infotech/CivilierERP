// CSV import for Material Issues: turns template rows into issues and checks them
// against the same masters the form uses. Rows that share every issue column (date,
// company, project, godown, issued to, reason, remarks) become one issue; each row
// is one of its items. Nothing is created here — the dialog shows the plan, then
// saves the issues that passed. The server checks stock again when each is saved.
import { projectBelongsToCompany } from "@/lib/projectBelongsTo";
import { parseDate } from "@/pages/material/materialRequest/mrImport";

export const COL = {
  date: "Issue Date (YYYY-MM-DD)",
  company: "Company",
  project: "Project/Site",
  godown: "Godown",
  issuedTo: "Issued To",
  reason: "Reason",
  remarks: "Remarks",
  item: "Item Name",
  uom: "UOM",
  qty: "Quantity",
  itemRemarks: "Item Remarks",
} as const;

export const ISSUES_TEMPLATE_COLUMNS = Object.values(COL).map((h) => ({ header: h, accessor: h }));

export interface PlannedIssue {
  key: string;
  rows: number[]; // CSV line numbers (header is line 1)
  label: { company: string; project: string; godown: string; date: string };
  payload: Record<string, unknown> | null;
  itemCount: number;
  errors: string[];
}

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const cell = (r: Record<string, string>, name: string) => String(r[name] ?? "").trim();

export interface ImportMasters {
  companies: any[];
  projects: any[];
  godowns: any[];
  finYears: any[];
  uoms: any[];
  /** Item options for a godown, with its AvailableStock (fetched per godown). */
  itemsFor: (godownId: number) => Promise<any[]>;
}

export async function planImport(rows: Record<string, string>[], m: ImportMasters): Promise<PlannedIssue[]> {
  const today = new Date().toISOString().slice(0, 10);
  const groups = new Map<string, { line: number; r: Record<string, string> }[]>();
  rows.forEach((r, i) => {
    // Skip fully blank lines (spreadsheets often leave a few at the end).
    if (Object.values(r).every((v) => !String(v ?? "").trim())) return;
    const key = [COL.date, COL.company, COL.project, COL.godown, COL.issuedTo, COL.reason, COL.remarks]
      .map((c) => norm(cell(r, c)))
      .join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ line: i + 2, r });
  });

  const itemCache = new Map<number, Promise<any[]>>();
  const itemsFor = (gid: number) => {
    if (!itemCache.has(gid)) itemCache.set(gid, m.itemsFor(gid).catch(() => []));
    return itemCache.get(gid)!;
  };
  // Stock already taken by issues earlier in the file, per godown + item, so two issues can't spend the same stock.
  const spent = new Map<string, number>();

  const out: PlannedIssue[] = [];
  for (const [key, g] of groups) {
    const first = g[0].r;
    const errors: string[] = [];

    const date = parseDate(cell(first, COL.date)) || (cell(first, COL.date) ? null : today);
    if (date === null) errors.push(`Issue Date "${cell(first, COL.date)}" — use YYYY-MM-DD`);
    else if (date > today) errors.push(`Issue Date ${date} is in the future`);

    const companyName = cell(first, COL.company);
    const company = m.companies.find((c) => norm(c.label ?? c.name) === norm(companyName) || norm(c.name) === norm(companyName));
    if (!companyName) errors.push("Company is missing");
    else if (!company) errors.push(`Company "${companyName}" not found`);

    const projectName = cell(first, COL.project);
    const project = m.projects.find(
      (p) => norm(p.name) === norm(projectName) && (!company || projectBelongsToCompany(p, Number(company.id))),
    );
    if (!projectName) errors.push("Project/Site is missing");
    else if (!project) errors.push(`Project "${projectName}" not found${company ? ` under ${company.label ?? company.name}` : ""}`);

    // The godown must be tagged to this company + project, as in the form. Blank picks the only one there is.
    const tagged = company && project
      ? m.godowns.filter((x) => Number(x.companyId) === Number(company.id) && Number(x.projectId) === Number(project.id))
      : [];
    const godownName = cell(first, COL.godown);
    let godown: any = null;
    if (company && project) {
      if (godownName) {
        godown = tagged.find((x) => norm(x.name) === norm(godownName) || (x.code && norm(x.code) === norm(godownName)));
        if (!godown) errors.push(`Godown "${godownName}" is not tagged to ${project.name}`);
      } else if (tagged.length === 1) {
        godown = tagged[0];
      } else {
        errors.push(tagged.length ? "Godown is missing — this project has more than one" : `No godown is tagged to ${project.name}`);
      }
    }

    const finYear = date
      ? m.finYears.find((f) => f.startDate <= date && f.endDate >= date && (f.status === "Active" || f.isActive))
      : null;
    if (date && !finYear) errors.push(`No active financial year covers ${date}`);
    if (finYear?.locked || finYear?.isLocked) errors.push(`Financial year ${finYear.year ?? finYear.name} is locked`);

    const reason = cell(first, COL.reason);
    if (!reason) errors.push("Reason is missing");

    const stock = godown ? await itemsFor(Number(godown.id)) : [];
    const items: Record<string, unknown>[] = [];
    for (const { line, r } of g) {
      const itemName = cell(r, COL.item);
      if (!itemName) { errors.push(`Line ${line}: Item Name is missing`); continue; }
      if (!godown) continue; // without a godown the item and its stock can't be checked
      const it = stock.find((x) => norm(x.M_Name) === norm(itemName) || (x.M_code && norm(x.M_code) === norm(itemName)));
      if (!it) { errors.push(`Line ${line}: item "${itemName}" is not in ${godown.name}`); continue; }
      const uomRaw = cell(r, COL.uom);
      const uom = uomRaw
        ? m.uoms.find((u) => [u.UOMCode, u.UOMName, u.Symbol].some((v) => v && norm(v) === norm(uomRaw)))
        : m.uoms.find((u) => u.UOMCode === it.DefaultUOM || u.UOMName === it.DefaultUOM);
      if (!uom) { errors.push(`Line ${line}: unit "${uomRaw || "(item default)"}" not found`); continue; }
      const qty = Number(cell(r, COL.qty).replace(/,/g, ""));
      if (!(qty > 0)) { errors.push(`Line ${line}: Quantity must be more than 0`); continue; }
      const sk = `${godown.id}|${it.M_Id}`;
      const left = Number(it.AvailableStock ?? 0) - (spent.get(sk) ?? 0);
      if (qty > left) { errors.push(`Line ${line}: ${it.M_Name} — ${qty} asked, ${Math.max(0, left)} in stock`); continue; }
      spent.set(sk, (spent.get(sk) ?? 0) + qty);
      items.push({
        ItemId: String(it.M_Id),
        UOMCode: uom.UOMCode,
        Quantity: qty,
        Remarks: cell(r, COL.itemRemarks) || null,
        CostCenterId: it.M_CostCenterId ? String(it.M_CostCenterId) : null,
      });
    }
    if (godown && items.length === 0 && !errors.some((e) => e.startsWith("Line"))) errors.push("No items");

    // A rejected issue gives its stock back for the issues after it.
    if (errors.length) for (const x of items) {
      const sk = `${godown.id}|${x.ItemId}`;
      spent.set(sk, (spent.get(sk) ?? 0) - Number(x.Quantity));
    }

    out.push({
      key,
      rows: g.map((x) => x.line),
      label: {
        company: company ? (company.label ?? company.name) : companyName || "—",
        project: project ? project.name : projectName || "—",
        godown: godown ? godown.name : godownName || "—",
        date: date || cell(first, COL.date) || "—",
      },
      itemCount: g.length,
      errors,
      payload: errors.length
        ? null
        : {
            CompanyId: Number(company.id),
            ProjectId: Number(project.id),
            FinYearId: Number(finYear.id),
            Date: date,
            Reason: reason,
            Remarks: cell(first, COL.remarks) || null,
            GodownId: Number(godown.id),
            IssuedTo: cell(first, COL.issuedTo) || null,
            items,
          },
    });
  }
  return out;
}

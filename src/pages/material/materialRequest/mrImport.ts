// CSV import for Material Requests: turns template rows into requests and checks
// them against the same masters the form uses. Rows that share every request
// column (document type, company, project, year, priority, required-by date,
// reason, remarks) become one request; each row is one of its items. Nothing is
// created here — the dialog shows the plan, then saves the requests that passed.
import { projectBelongsToCompany } from "@/lib/projectBelongsTo";
import type { DocType } from "@/pages/material/ExpenseBooking/DocNumberPreview";
import type { CreateMRPayload } from "@/api/materialRequestApi";
import { PRIORITY_OPTIONS } from "./config";

export const COL = {
  docType: "Document Type",
  company: "Company",
  project: "Project/Site",
  finYear: "Financial Year",
  priority: "Priority (Low/Normal/High/Urgent)",
  requiredBy: "Required By Date (YYYY-MM-DD)",
  reason: "Reason",
  remarks: "Remarks",
  item: "Item Name",
  uom: "UOM",
  qty: "Quantity",
  itemRemarks: "Item Remarks",
} as const;

export interface PlannedRequest {
  key: string;
  rows: number[]; // CSV line numbers (header is line 1)
  label: { company: string; project: string; docType: string; finYear: string };
  payload: (CreateMRPayload & { DocTypeId: number | null }) | null;
  itemCount: number;
  errors: string[];
}

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
// Older templates labelled these columns differently — read either header.
const cell = (r: Record<string, string>, ...names: string[]) => {
  for (const n of names) if (r[n] != null && String(r[n]).trim() !== "") return String(r[n]).trim();
  return "";
};
const OLD_PRIORITY = "Priority (Normal/High/Critical/Low)";

/** YYYY-MM-DD, or DD-MM-YYYY / DD/MM/YYYY as Excel often saves it. "" when blank, null when unreadable. */
export function parseDate(v: string): string | null {
  const s = v.trim();
  if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const docTypeLabel = (dt: DocType) =>
  dt.ProjectCode && dt.ModuleCode ? `${dt.ProjectCode}-${dt.ModuleCode}` : (dt.DocNoPrefix ?? dt.FullPrefix ?? dt.Prefix ?? "");

export interface ImportMasters {
  companies: any[];
  projects: any[];
  finYears: any[];
  docTypes: DocType[];
  uoms: any[];
  /** Item options for a project, as the form loads them (fetched per project). */
  itemsFor: (projectId: string) => Promise<any[]>;
}

export async function planImport(rows: Record<string, string>[], m: ImportMasters): Promise<PlannedRequest[]> {
  const today = new Date().toISOString().slice(0, 10);
  const groups = new Map<string, { rows: { line: number; r: Record<string, string> }[] }>();
  rows.forEach((r, i) => {
    // Skip fully blank lines (spreadsheets often leave a few at the end).
    if (Object.values(r).every((v) => !String(v ?? "").trim())) return;
    const key = [
      cell(r, COL.docType), cell(r, COL.company), cell(r, COL.project), cell(r, COL.finYear),
      cell(r, COL.priority, OLD_PRIORITY), cell(r, COL.requiredBy), cell(r, COL.reason), cell(r, COL.remarks),
    ].map(norm).join("|");
    if (!groups.has(key)) groups.set(key, { rows: [] });
    groups.get(key)!.rows.push({ line: i + 2, r });
  });

  const itemCache = new Map<string, Promise<any[]>>();
  const itemsFor = (pid: string) => {
    if (!itemCache.has(pid)) itemCache.set(pid, m.itemsFor(pid).catch(() => []));
    return itemCache.get(pid)!;
  };

  const out: PlannedRequest[] = [];
  for (const [key, g] of groups) {
    const first = g.rows[0].r;
    const errors: string[] = [];
    const lines = g.rows.map((x) => x.line);

    const companyName = cell(first, COL.company);
    const company = m.companies.find((c) => norm(c.label ?? c.name) === norm(companyName) || norm(c.name) === norm(companyName));
    if (!companyName) errors.push("Company is missing");
    else if (!company) errors.push(`Company "${companyName}" not found`);

    const projectName = cell(first, COL.project);
    const project = m.projects.find(
      (p) => norm(p.name ?? p.label) === norm(projectName) && (!company || projectBelongsToCompany(p, String(company.id))),
    );
    if (!projectName) errors.push("Project/Site is missing");
    else if (!project) errors.push(`Project "${projectName}" not found${company ? ` under ${company.label ?? company.name}` : ""}`);

    const fyName = cell(first, COL.finYear);
    let finYear: any = null;
    if (fyName) {
      finYear = m.finYears.find((f) => norm(f.name) === norm(fyName));
      if (!finYear) errors.push(`Financial year "${fyName}" not found`);
    } else {
      finYear = m.finYears.find((f) => f.isActive && f.startDate <= today && f.endDate >= today) ?? m.finYears.find((f) => f.isActive) ?? null;
      if (!finYear) errors.push("No active financial year to use — fill in Financial Year");
    }
    if (finYear?.isLocked) errors.push(`Financial year ${finYear.name} is locked`);

    const dtName = cell(first, COL.docType);
    let docType: DocType | null = null;
    if (dtName) {
      docType = m.docTypes.find((d) => [docTypeLabel(d), d.Description, d.Prefix, d.FullPrefix, d.DocNoPrefix].some((v) => v && norm(v) === norm(dtName))) ?? null;
      if (!docType) errors.push(`Document type "${dtName}" not found`);
    } else {
      docType = m.docTypes[0] ?? null;
    }

    const prRaw = cell(first, COL.priority, OLD_PRIORITY);
    const priority = !prRaw ? "Normal" : norm(prRaw) === "critical" ? "Urgent" : PRIORITY_OPTIONS.find((p) => norm(p) === norm(prRaw));
    if (!priority) errors.push(`Priority "${prRaw}" — use Low, Normal, High or Urgent`);

    const reqBy = parseDate(cell(first, COL.requiredBy));
    if (reqBy === null) errors.push(`Required By Date "${cell(first, COL.requiredBy)}" — use YYYY-MM-DD`);
    else if (reqBy && reqBy < today) errors.push(`Required By Date ${reqBy} is in the past`);

    const reason = cell(first, COL.reason);
    if (!reason) errors.push("Reason is missing");

    const projectItems = project ? await itemsFor(String(project.id)) : [];
    const items: CreateMRPayload["items"] = [];
    for (const { line, r } of g.rows) {
      const itemName = cell(r, COL.item);
      const it = projectItems.find((x) => norm(x.M_Name) === norm(itemName) || (x.M_code && norm(x.M_code) === norm(itemName)));
      if (!itemName) { errors.push(`Line ${line}: Item Name is missing`); continue; }
      if (project && !it) { errors.push(`Line ${line}: item "${itemName}" is not available for ${project.name ?? project.label}`); continue; }
      const uomRaw = cell(r, COL.uom);
      const uom = uomRaw
        ? m.uoms.find((u) => [u.UOMCode, u.UOMName, u.Symbol].some((v) => v && norm(v) === norm(uomRaw)))
        : m.uoms.find((u) => u.UOMCode === it?.DefaultUOM);
      if (!uom) { errors.push(`Line ${line}: unit "${uomRaw || "(item default)"}" not found`); continue; }
      const qty = Number(cell(r, COL.qty).replace(/,/g, ""));
      if (!(qty > 0)) { errors.push(`Line ${line}: Quantity must be more than 0`); continue; }
      if (it) {
        items.push({
          ItemId: String(it.M_Id),
          ItemName: it.M_Name,
          UOMCode: uom.UOMCode,
          Quantity: qty,
          Remarks: cell(r, COL.itemRemarks) || null,
          CostCenterId: it.M_CostCenterId ? String(it.M_CostCenterId) : null,
        } as any);
      }
    }
    // (Without a project its items can't be checked, so "no items" would only add noise.)
    if (project && items.length === 0 && !errors.some((e) => e.startsWith("Line"))) errors.push("No items");

    out.push({
      key,
      rows: lines,
      label: {
        company: company ? (company.label ?? company.name) : companyName || "—",
        project: project ? (project.name ?? project.label) : projectName || "—",
        docType: docType ? docTypeLabel(docType) : dtName || "—",
        finYear: finYear?.name ?? fyName ?? "—",
      },
      itemCount: g.rows.length,
      errors,
      payload: errors.length
        ? null
        : {
            CompanyId: Number(company.id),
            ProjectId: Number(project.id),
            FinYearId: Number(finYear.id),
            RequestDate: today,
            RequiredByDate: reqBy || null,
            Priority: priority as string,
            Reason: reason,
            Remarks: cell(first, COL.remarks) || null,
            DocTypeId: docType?.TypeOfDocId ?? null,
            items,
          },
    });
  }
  return out;
}

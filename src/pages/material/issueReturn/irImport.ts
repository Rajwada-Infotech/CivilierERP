// CSV import for Issue Returns: turns template rows into returns and checks them against
// the issue each one names. Rows that share every return column (date, company, project,
// issue, reason, remarks) become one return; each row is one of its items. Nothing is
// created here — the dialog shows the plan, then saves the returns that passed. The
// server checks the quantities again when each is saved.
import { projectBelongsToCompany } from "@/lib/projectBelongsTo";
import { parseDate } from "@/pages/material/materialRequest/mrImport";
import { leftOnLine, type IssueItem, type IssueOption } from "./config";

export const COL = {
  date: "Return Date (YYYY-MM-DD)",
  company: "Company",
  project: "Project/Site",
  issue: "Issue Reference",
  reason: "Reason",
  remarks: "Remarks",
  item: "Item Name",
  uom: "UOM",
  qty: "Quantity",
} as const;

export const IR_TEMPLATE_COLUMNS = Object.values(COL).map((h) => ({ header: h, accessor: h }));

export interface PlannedReturn {
  key: string;
  rows: number[]; // CSV line numbers (header is line 1)
  label: { company: string; project: string; issue: string; date: string };
  payload: Record<string, unknown> | null;
  itemCount: number;
  errors: string[];
}

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const cell = (r: Record<string, string>, name: string) => String(r[name] ?? "").trim();

export interface ImportMasters {
  companies: any[];
  projects: any[];
  finYears: any[];
  /** Approved issues of a company + project — the ones a return can be made against. */
  issuesFor: (companyId: number, projectId: number) => Promise<IssueOption[]>;
  /** An issue's lines with what other returns already take back. */
  linesFor: (issueId: number) => Promise<IssueItem[]>;
}

export async function planImport(rows: Record<string, string>[], m: ImportMasters): Promise<PlannedReturn[]> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const groups = new Map<string, { line: number; r: Record<string, string> }[]>();
  rows.forEach((r, i) => {
    if (Object.values(r).every((v) => !String(v ?? "").trim())) return;
    const key = [COL.date, COL.company, COL.project, COL.issue, COL.reason, COL.remarks].map((c) => norm(cell(r, c))).join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ line: i + 2, r });
  });

  const cache = new Map<string, Promise<any[]>>();
  const once = <T,>(k: string, f: () => Promise<T[]>) => {
    if (!cache.has(k)) cache.set(k, f().catch(() => []));
    return cache.get(k)! as Promise<T[]>;
  };
  // Quantity taken back by returns earlier in the file, per issue line.
  const spent = new Map<number, number>();

  const out: PlannedReturn[] = [];
  for (const [key, g] of groups) {
    const first = g[0].r;
    const errors: string[] = [];

    const rawDate = cell(first, COL.date);
    const date = rawDate ? parseDate(rawDate) : todayStr;
    if (date === null) errors.push(`Return Date "${rawDate}" — use YYYY-MM-DD`);
    else if (date > todayStr) errors.push(`Return Date ${date} is in the future`);
    if (date && !m.finYears.some((f) => f.startDate <= date && f.endDate >= date && f.status === "Active"))
      errors.push(`No active financial year covers ${date}`);

    const companyName = cell(first, COL.company);
    const company = m.companies.find((c) => norm(c.label ?? c.name) === norm(companyName));
    if (!companyName) errors.push("Company is missing");
    else if (!company) errors.push(`Company "${companyName}" not found`);

    const projectName = cell(first, COL.project);
    const project = m.projects.find((p) => norm(p.label ?? p.name) === norm(projectName) && (!company || projectBelongsToCompany(p, String(company.id))));
    if (!projectName) errors.push("Project/Site is missing");
    else if (!project) errors.push(`Project "${projectName}" not found${company ? ` under ${company.label ?? company.name}` : ""}`);

    const issueRef = cell(first, COL.issue);
    let issue: IssueOption | undefined;
    if (!issueRef) errors.push("Issue Reference is missing");
    else if (company && project) {
      const list = await once<IssueOption>(`i|${company.id}|${project.id}`, () => m.issuesFor(Number(company.id), Number(project.id)));
      issue = list.find((x) => norm(x.DocNo) === norm(issueRef));
      if (!issue) errors.push(`Issue "${issueRef}" is not an approved issue of ${project.label ?? project.name}`);
    }

    const reason = cell(first, COL.reason);
    const lines = issue ? await once<IssueItem>(`l|${issue.IssueId}`, () => m.linesFor(issue!.IssueId)) : [];
    const items: Record<string, unknown>[] = [];
    for (const { line, r } of g) {
      const itemName = cell(r, COL.item);
      if (!itemName) { errors.push(`Line ${line}: Item Name is missing`); continue; }
      if (!issue) continue; // without the issue its lines can't be checked
      const ii = lines.find((x) => norm(x.ItemName) === norm(itemName) || norm(x.M_Id) === norm(itemName));
      if (!ii) { errors.push(`Line ${line}: "${itemName}" is not on ${issue.DocNo}`); continue; }
      const qty = Number(cell(r, COL.qty).replace(/,/g, ""));
      if (!(qty > 0)) { errors.push(`Line ${line}: Quantity must be more than 0`); continue; }
      const left = leftOnLine(ii) - (spent.get(ii.ItemId) ?? 0);
      if (qty > left) { errors.push(`Line ${line}: ${ii.ItemName} — ${qty} to return, ${Math.max(0, left)} still out`); continue; }
      spent.set(ii.ItemId, (spent.get(ii.ItemId) ?? 0) + qty);
      items.push({ origIssueItemId: ii.ItemId, M_Id: ii.M_Id, ItemName: ii.ItemName, Quantity: qty, UOMSymbol: ii.UOMSymbol || "" });
    }
    if (issue && items.length === 0 && !errors.some((e) => e.startsWith("Line"))) errors.push("No items");

    // A rejected return gives its quantities back for the returns after it.
    if (errors.length) for (const x of items) spent.set(x.origIssueItemId as number, (spent.get(x.origIssueItemId as number) ?? 0) - Number(x.Quantity));

    out.push({
      key,
      rows: g.map((x) => x.line),
      label: {
        company: company ? (company.label ?? company.name) : companyName || "—",
        project: project ? (project.label ?? project.name) : projectName || "—",
        issue: issue ? issue.DocNo : issueRef || "—",
        date: date || rawDate || "—",
      },
      itemCount: g.length,
      errors,
      payload: errors.length
        ? null
        : {
            ReturnDate: date,
            IssueId: String(issue!.IssueId),
            CompanyId: String(company.id),
            ProjectId: String(project.id),
            Reason: reason,
            Remarks: cell(first, COL.remarks),
            items,
          },
    });
  }
  return out;
}

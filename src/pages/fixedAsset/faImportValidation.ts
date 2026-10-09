// FA Inventory import — row validation against the masters.
//
// Every row is checked and ALL of its problems are reported together (so a file
// needs one fix pass, not one pass per error). Names are compared trimmed and
// case/space-insensitive — master names such as "RAJWADA CITY " or "Mobile " carry
// trailing spaces nobody can see in Excel. A project counts as linked to a company
// by the same rule every project dropdown in the app uses (primary company,
// belongs-to, or tagged through Project Master's multi-company tagging).
import { projectBelongsToCompany, projectCompanyIds, type ProjectCompanyLike } from "@/lib/projectBelongsTo";
import { parseSheetDate } from "@/lib/xlsxBook";
import { didYouMean, normText } from "@/lib/importMatch";
import type { FaImportFileRow, FaImportMode } from "./faInventoryExcel";

export interface FaImportResultRow {
  row: number;
  companyId: number;
  companyLabel: string;
  projectId: number | null;
  projectLabel: string;
  godownId: number | null;
  godownLabel: string;
  itemId: string | null;
  itemCode: string;
  itemName: string;
  assetCategory: string;
  docDate: string;
  quantity: number;
  rate: number | null;
  remarks?: string;
  /** FA Item Codes generated for this row once imported. */
  tagged?: number;
  status: "valid" | "success" | "error";
  message?: string;
}

export interface FaGodownLike {
  GodownID: number;
  GodownName: string;
  EnterpriseID: number | null;
  ProjectID: number | null;
}

export interface FaImportContext {
  mode: FaImportMode;
  companies: { id: number; label: string }[];
  projects: (ProjectCompanyLike & { id: number; label: string })[];
  /** Active, non-deleted godowns. */
  godowns: FaGodownLike[];
  itemMaster: { M_Id: string; M_Name: string; M_code: string | null; M_Type: string | null }[];
  /** Categories with an active Depreciation Setup. */
  assetCategories: string[];
  /** Financial Year label for an ISO date, "" when none covers it. */
  deriveFinYear: (isoDate: string) => string;
}

export { normText };

/**
 * Whether a godown can be used for this company + project. A project's own
 * godown is valid whichever company the project is tagged to (its EnterpriseID is
 * only the primary company); a company-level godown (no project) must be the
 * company's own.
 */
export function godownMatches(g: FaGodownLike, companyId: number, projectId: number | null): boolean {
  if (!projectId) return g.EnterpriseID === companyId;
  return g.ProjectID === projectId || (g.ProjectID == null && g.EnterpriseID === companyId);
}

export function validateFaImportRows(rawRows: FaImportFileRow[], ctx: FaImportContext): FaImportResultRow[] {
  const companyName = (id: string | number) => ctx.companies.find((c) => String(c.id) === String(id))?.label.trim() ?? `#${id}`;

  return rawRows.map((raw): FaImportResultRow => {
    const problems: string[] = [];
    const row: FaImportResultRow = {
      row: raw.rowNo,
      companyId: 0,
      companyLabel: raw.Company || "—",
      projectId: null,
      projectLabel: raw.Project || "—",
      godownId: null,
      godownLabel: raw.Godown || "—",
      itemId: null,
      itemCode: raw.ItemCode,
      itemName: raw.ItemName || "—",
      assetCategory: raw.AssetCategory,
      docDate: raw.Date,
      quantity: 0,
      rate: null,
      remarks: raw.Remarks || undefined,
      status: "error",
    };

    const missing = [
      !raw.Company && "Company",
      !raw.Project && "Project",
      !raw.Godown && "Godown",
      !raw.ItemCode && !raw.ItemName && "Item Code / Item Name",
      !raw.AssetCategory && "Asset Category",
      !raw.Date && "Date",
      ctx.mode === "bulk" && !raw.Quantity && "Quantity",
    ].filter(Boolean);
    if (missing.length) problems.push(`Missing required field(s): ${missing.join(", ")}`);

    // ── Company ──
    const company = raw.Company ? ctx.companies.find((c) => normText(c.label) === normText(raw.Company)) : undefined;
    if (raw.Company && !company) {
      problems.push(`Company "${raw.Company}" is not in the Company master${didYouMean(raw.Company, ctx.companies.map((c) => c.label))}`);
    }
    if (company) {
      row.companyId = company.id;
      row.companyLabel = company.label.trim();
    }

    // ── Project: must exist AND be linked to the company ──
    let project: (typeof ctx.projects)[number] | undefined;
    if (raw.Project) {
      const named = ctx.projects.filter((p) => normText(p.label) === normText(raw.Project));
      if (named.length === 0) {
        problems.push(
          `Project "${raw.Project}" is not in the Project master (or is inactive)${didYouMean(raw.Project, ctx.projects.map((p) => p.label))}`,
        );
      } else if (company) {
        project = named.find((p) => projectBelongsToCompany(p, company.id));
        if (!project) {
          const linked = [...new Set(named.flatMap((p) => projectCompanyIds(p)))].map(companyName);
          problems.push(
            `Project "${raw.Project}" is not linked to company "${company.label.trim()}"` +
              (linked.length ? ` (linked to: ${linked.join(", ")})` : "") +
              " — correct the Company in the file, or link the project to this company in Project Master",
          );
        }
      } else {
        project = named[0]; // the company problem is already reported; keep looking for other problems
      }
    }
    if (project) {
      row.projectId = project.id;
      row.projectLabel = project.label.trim();
    }

    // ── Godown: must exist and serve this company / project ──
    if (raw.Godown) {
      const named = ctx.godowns.filter((g) => normText(g.GodownName) === normText(raw.Godown));
      if (named.length === 0) {
        problems.push(
          `Godown "${raw.Godown}" is not in the Godown master (or is inactive)${didYouMean(raw.Godown, ctx.godowns.map((g) => g.GodownName))}`,
        );
      } else if (company && project) {
        const godown = named.find((g) => godownMatches(g, company.id, project!.id));
        if (!godown) {
          const g = named[0];
          const owner = g.ProjectID
            ? `project "${ctx.projects.find((p) => p.id === g.ProjectID)?.label.trim() ?? `#${g.ProjectID}`}"`
            : `company "${g.EnterpriseID ? companyName(g.EnterpriseID) : "—"}"`;
          problems.push(
            `Godown "${raw.Godown}" belongs to ${owner}, not to project "${project.label.trim()}" / company "${company.label.trim()}"`,
          );
        } else {
          row.godownId = godown.GodownID;
          row.godownLabel = godown.GodownName.trim();
        }
      } else if (named.length === 1) {
        row.godownLabel = named[0].GodownName.trim(); // company / project problem already reported
      }
    }

    // ── Asset Category: must be one Depreciation Setup knows (so a rate applies) ──
    if (raw.AssetCategory) {
      const cat = ctx.assetCategories.find((c) => normText(c) === normText(raw.AssetCategory));
      if (cat) row.assetCategory = cat.trim();
      else if (ctx.assetCategories.length === 0) problems.push("No active Asset Category exists — add categories in Depreciation Setup first");
      else problems.push(`Asset Category "${raw.AssetCategory}" has no active Depreciation Setup${didYouMean(raw.AssetCategory, ctx.assetCategories)}`);
    }

    // ── Date ──
    if (raw.Date) {
      const iso = parseSheetDate(raw.Date);
      if (!iso) problems.push(`Date "${raw.Date}" is not valid — use YYYY-MM-DD or DD/MM/YYYY`);
      else {
        row.docDate = iso;
        if (!ctx.deriveFinYear(iso)) problems.push(`Date ${iso} doesn't fall in any configured Financial Year`);
      }
    }

    // ── Quantity ──
    if (ctx.mode === "bulk") {
      if (raw.Quantity) {
        const q = parseInt(raw.Quantity, 10);
        if (!Number.isFinite(q) || q <= 0 || String(q) !== raw.Quantity.trim()) {
          problems.push(`Quantity "${raw.Quantity}" must be a positive whole number`);
        } else {
          row.quantity = q;
        }
      }
    } else {
      row.quantity = 1;
    }

    // ── Item Master: must exist and be a Fixed Asset ──
    if (raw.ItemCode || raw.ItemName) {
      let master: FaImportContext["itemMaster"][number] | undefined;
      if (raw.ItemCode) {
        master = ctx.itemMaster.find((i) => normText(i.M_code) === normText(raw.ItemCode));
        if (!master) {
          const byName = raw.ItemName ? ctx.itemMaster.filter((i) => normText(i.M_Name) === normText(raw.ItemName)) : [];
          problems.push(
            `Item Code "${raw.ItemCode}" is not in the Item Master` +
              (byName.length === 1
                ? ` — "${byName[0].M_Name.trim()}" has code "${byName[0].M_code ?? ""}"`
                : didYouMean(raw.ItemCode, ctx.itemMaster.map((i) => i.M_code ?? ""))),
          );
        } else if (raw.ItemName && normText(master.M_Name) !== normText(raw.ItemName)) {
          problems.push(`Item Code "${raw.ItemCode}" is "${master.M_Name.trim()}" in the Item Master, not "${raw.ItemName}"`);
          master = undefined;
        }
      } else {
        const hits = ctx.itemMaster.filter((i) => normText(i.M_Name) === normText(raw.ItemName));
        if (hits.length === 0) {
          problems.push(`Item "${raw.ItemName}" is not in the Item Master${didYouMean(raw.ItemName, ctx.itemMaster.map((i) => i.M_Name))}`);
        } else if (hits.length > 1) {
          problems.push(`Item "${raw.ItemName}" matches ${hits.length} Item Master entries — enter the Item Code`);
        } else {
          master = hits[0];
        }
      }
      if (master) {
        row.itemCode = master.M_code || "";
        row.itemName = master.M_Name.trim();
        if (normText(master.M_Type) !== "fixed asset") {
          problems.push(`"${master.M_Name.trim()}" has Type of Item "${master.M_Type || "not set"}" — only Fixed Asset items can be imported`);
        } else {
          row.itemId = String(master.M_Id);
        }
      }
    }

    // ── Rate (optional) ──
    if (raw.Rate) {
      const rate = Number(raw.Rate.replace(/[,₹\s]/g, ""));
      if (!Number.isFinite(rate) || rate < 0) problems.push(`Rate "${raw.Rate}" must be a number (0 or more)`);
      else row.rate = rate;
    }

    if (problems.length) row.message = problems.join(" · ");
    else row.status = "valid";
    return row;
  });
}

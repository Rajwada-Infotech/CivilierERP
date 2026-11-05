// Constants, types, styles and the API helper shared by the Issue Return page and its parts.
import type { ReactNode } from "react";
import type { ExportColumn } from "@/lib/export";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

export const API = "/api/material-issue-returns";

export const ISSUE_RETURN_EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Doc No", accessor: "DocNo" },
  { header: "Return Date", accessor: (r) => (r.ReturnDate ? new Date(r.ReturnDate as string).toLocaleDateString("en-IN") : "") },
  { header: "Issue Doc No", accessor: "IssueDocNo" },
  { header: "Company", accessor: "CompanyName" },
  { header: "Project", accessor: "ProjectName" },
  { header: "Godown", accessor: "GodownName" },
  { header: "Reason", accessor: "Reason" },
  { header: "Status", accessor: "Status" },
];

export interface ReturnRow {
  ReturnId: number;
  DocNo: string;
  ReturnDate: string;
  Status: string;
  IssueDocNo: string | null;
  Reason: string | null;
  CompanyName: string | null;
  ProjectName: string | null;
  GodownName: string | null;
  CreatedAt: string;
}
export interface IssueOption { IssueId: number; DocNo: string; IssueDate: string }
/** A line of the issue: what was issued and what other returns already take back. */
export interface IssueItem { ItemId: number; M_Id: string; ItemName: string; Quantity: number; UOMSymbol: string | null; Returned?: number }
export interface ReturnItem { origIssueItemId: number | null; M_Id: string; ItemName: string; Quantity: number; UOMSymbol: string; issued?: number; maxQty?: number }
export interface FormState { ReturnDate: string; IssueId: string; CompanyId: string; ProjectId: string; Reason: string; Remarks: string; items: ReturnItem[] }

export const today = () => new Date().toISOString().split("T")[0];
export const emptyForm = (): FormState => ({ ReturnDate: today(), IssueId: "", CompanyId: "", ProjectId: "", Reason: "", Remarks: "", items: [] });

/** What can still come back on a line: issued, less what other returns take. */
export const leftOnLine = (ii: IssueItem) => Math.max(0, Number(ii.Quantity) - Number(ii.Returned ?? 0));

export const fmtQty = (n: number) => Number(n).toLocaleString("en-IN", { maximumFractionDigits: 4 });

export async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetchWithAuth(url, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || res.statusText);
  }
  return res.json().catch(() => ({}));
}

// ─── Sheet styles ─────────────────────────────────────────────────────────────
export const inp =
  "w-full px-3 py-2.5 text-sm font-body bg-card border border-foreground/40 transition-colors focus:outline-none focus:border-foreground text-foreground placeholder:text-muted-foreground/60 disabled:opacity-60";
export const sel =
  "w-full px-3 py-2.5 pr-8 text-sm font-body bg-card border border-foreground/40 transition-colors focus:outline-none focus:border-foreground text-foreground appearance-none disabled:opacity-60";
export const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
export const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
export const RULE = "1px solid hsl(var(--foreground))";
export const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
export const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
export const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
export const ACT = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground transition-colors disabled:opacity-40";
export const TH = "px-4 py-2.5 text-left font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";

export function FieldLabel({ children, required }: { children: ReactNode; required?: boolean }) {
  return (
    <label className={`block ${LBL} mb-1.5`}>
      {children}
      {required && <span className="text-destructive ml-0.5">*</span>}
    </label>
  );
}

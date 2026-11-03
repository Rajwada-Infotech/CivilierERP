import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { TableDocument } from "iconsax-react";
import { CheckCircle2, ChevronRight, Download } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { getLegalDeeds, type LegalDeedSummary } from "@/api/legalOperationsApi";

// The final approved land register — all deeds that have passed L2 approval.
// This is the user's single source of truth for what land the company owns.

const ACTIVE_STATUSES = ["L2 Approved", "Closed", "Active", "Registered"];

function statusBadge(status: string) {
  if (status === "Closed") return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  return "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
}

function inr(v: number | null | undefined) {
  if (v == null) return "—";
  return "₹" + Number(v).toLocaleString("en-IN");
}

export default function LegalActiveLandPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const { data: allDeeds = [], isLoading } = useQuery({
    queryKey: ["legal-deeds"],
    queryFn: getLegalDeeds,
    staleTime: 60_000,
  });

  // Only show approved / closed / active deeds
  const deeds: LegalDeedSummary[] = useMemo(
    () =>
      allDeeds
        .filter((d) => ACTIVE_STATUSES.some((s) => d.OverallStatus?.toLowerCase().includes(s.toLowerCase()) || d.L2Status === "Approved"))
        .filter((d) => {
          if (!search.trim()) return true;
          const q = search.toLowerCase();
          return (
            d.DeedFileNo?.toLowerCase().includes(q) ||
            d.DeedNo?.toLowerCase().includes(q) ||
            d.DeedTypeName?.toLowerCase().includes(q) ||
            d.MouzaName?.toLowerCase().includes(q) ||
            d.SellerName?.toLowerCase().includes(q) ||
            d.BuyerName?.toLowerCase().includes(q) ||
            d.ProjectName?.toLowerCase().includes(q)
          );
        }),
    [allDeeds, search]
  );

  const handleExportCSV = () => {
    const headers = ["File No", "Deed No", "Year", "Deed Type", "Mouza", "RS Dag", "LR Dag", "RS Khatian", "LR Khatian", "Area", "Unit", "Seller", "Buyer", "Consideration", "Status"];
    const rows = deeds.map((d) => [
      d.DeedFileNo,
      d.DeedNo ?? "",
      d.DeedYear ?? "",
      d.DeedTypeName,
      d.MouzaName ?? "",
      d.RsDag ?? d.RsPlotNo ?? "",
      d.LrDag ?? "",
      d.RsKhatian ?? d.RsKhatianNo ?? "",
      d.LrKhatian ?? "",
      d.PurchasedArea ?? "",
      d.AreaUnitName ?? "",
      d.SellerName ?? "",
      d.BuyerName ?? "",
      d.ConsiderationAmount ?? "",
      d.OverallStatus,
    ]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `active-land-register-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Legal", "Active Land Register"]} />
      <LegalShell
        title="Active Land Register"
        subtitle="All land deeds that have completed L2 approval — the company's confirmed land holdings."
        icon={TableDocument}
        action={
          <button
            onClick={handleExportCSV}
            disabled={deeds.length === 0}
            className="inline-flex items-center gap-1.5 border border-foreground bg-foreground px-3 py-2 text-xs font-heading font-semibold uppercase tracking-[0.08em] text-card hover:opacity-85 disabled:opacity-40"
          >
            <Download size={13} />
            Export CSV
          </button>
        }
      >
        {/* Summary strip */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2">
            <CheckCircle2 size={15} className="text-emerald-600" />
            <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">{deeds.length}</span>
            <span className="text-xs text-emerald-600 dark:text-emerald-500">Active land record{deeds.length !== 1 ? "s" : ""}</span>
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by file no, deed no, mouza, buyer, seller…"
            className="flex-1 min-w-[200px] rounded-md border border-border bg-background px-3 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Table */}
        <div className="rounded-xl border border-border overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading active land register…</div>
          ) : deeds.length === 0 ? (
            <div className="p-10 text-center">
              <CheckCircle2 size={32} className="mx-auto mb-3 text-muted-foreground/40" />
              <p className="text-sm font-semibold text-foreground">No active land records yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Land deed entries appear here after completing L1 and L2 approval.
                <br />
                Go to <strong>Land Deed Entries</strong> to submit a deed for approval.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-muted/40 text-[0.6875rem] font-heading uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 whitespace-nowrap">File No.</th>
                    <th className="px-4 py-3 whitespace-nowrap">Deed No / Year</th>
                    <th className="px-4 py-3 whitespace-nowrap">Deed Type</th>
                    <th className="px-4 py-3 whitespace-nowrap">Mouza</th>
                    <th className="px-4 py-3 whitespace-nowrap">RS Dag</th>
                    <th className="px-4 py-3 whitespace-nowrap">LR Dag</th>
                    <th className="px-4 py-3 whitespace-nowrap">RS Khatian</th>
                    <th className="px-4 py-3 whitespace-nowrap">LR Khatian</th>
                    <th className="px-4 py-3 whitespace-nowrap">Area</th>
                    <th className="px-4 py-3 whitespace-nowrap">Seller</th>
                    <th className="px-4 py-3 whitespace-nowrap">Buyer</th>
                    <th className="px-4 py-3 whitespace-nowrap">Consideration</th>
                    <th className="px-4 py-3 whitespace-nowrap">Status</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {deeds.map((d) => (
                    <tr key={d.DeedRecordId} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-mono font-semibold text-foreground whitespace-nowrap">{d.DeedFileNo}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-medium text-foreground">{d.DeedNo || "—"}</span>
                        {d.DeedYear && <span className="ml-1 text-muted-foreground">/ {d.DeedYear}</span>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{d.DeedTypeName}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {d.MouzaName ? (
                          <span>
                            {d.MouzaName}
                            {d.JLNo && <span className="ml-1 text-muted-foreground">(J.L. {d.JLNo})</span>}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3 font-mono whitespace-nowrap">{d.RsDag ?? d.RsPlotNo ?? "—"}</td>
                      <td className="px-4 py-3 font-mono whitespace-nowrap">{d.LrDag ?? "—"}</td>
                      <td className="px-4 py-3 font-mono whitespace-nowrap">{d.RsKhatian ?? d.RsKhatianNo ?? "—"}</td>
                      <td className="px-4 py-3 font-mono whitespace-nowrap">{d.LrKhatian ?? "—"}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {d.PurchasedArea != null ? `${d.PurchasedArea} ${d.AreaUnitName ?? ""}`.trim() : "—"}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap max-w-[160px] truncate">{d.SellerName || "—"}</td>
                      <td className="px-4 py-3 whitespace-nowrap max-w-[160px] truncate">{d.BuyerName || "—"}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{inr(d.ConsiderationAmount)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ${statusBadge(d.OverallStatus)}`}>
                          <CheckCircle2 size={10} />
                          {d.OverallStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => navigate(`/legal/deeds/${d.DeedRecordId}`)}
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted whitespace-nowrap"
                        >
                          View <ChevronRight size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </LegalShell>
    </>
  );
}

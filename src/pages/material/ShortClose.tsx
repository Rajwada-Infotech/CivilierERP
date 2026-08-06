import React, { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Archive,
  Search,
  AlertTriangle,
  Package,
  ClipboardList,
  Loader2,
  X,
} from "lucide-react";
import { MaterialShell } from "@/components/material/MaterialShell";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { usePageRights } from "@/hooks/usePageRights";
import { useFinYear } from "@/contexts/FinYearContext";
import * as mrApi from "@/api/materialRequestApi";
import {
  searchShortCloseCandidates,
  processShortClose,
  type ShortCloseDocType,
  type ShortCloseCandidate,
} from "@/api/shortCloseApi";

const fmtQty = (n: number) =>
  n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

const fmtDate = (d: string | null) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

export default function ShortClose() {
  const rights = usePageRights("short-close");
  const queryClient = useQueryClient();
  const { finYears } = useFinYear();
  const activeYear = finYears.find((y) => y.status === "Active") ?? null;

  const [docType, setDocType] = useState<ShortCloseDocType>("PO");
  const [finYearId, setFinYearId] = useState<string>(
    activeYear ? String(activeYear.id) : "",
  );
  const [companyId, setCompanyId] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("");
  const [searched, setSearched] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [remarks, setRemarks] = useState("");

  const { data: companies = [] } = useQuery({
    queryKey: ["mr-companies"],
    queryFn: mrApi.getMRCompanies,
    staleTime: 5 * 60_000,
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["mr-projects"],
    queryFn: mrApi.getMRProjects,
    staleTime: 5 * 60_000,
  });
  const filteredProjects = useMemo(
    () =>
      (projects as any[]).filter(
        (p) => !companyId || String(p.company_id) === String(companyId),
      ),
    [projects, companyId],
  );

  const {
    data: candidates = [],
    isFetching,
    refetch,
  } = useQuery<ShortCloseCandidate[]>({
    queryKey: ["short-close-search", docType, finYearId, companyId, projectId],
    queryFn: () =>
      searchShortCloseCandidates({
        docType,
        finYearId: finYearId || undefined,
        companyId: companyId || undefined,
        projectId: projectId || undefined,
      }),
    enabled: false,
  });

  const handleSearch = () => {
    setSelectedIds(new Set());
    setSearched(true);
    refetch();
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) =>
      prev.size === candidates.length
        ? new Set()
        : new Set(candidates.map((c) => c.docId)),
    );
  };

  const processMutation = useMutation({
    mutationFn: () =>
      processShortClose({
        docType,
        ids: Array.from(selectedIds),
        remarks: remarks.trim() || undefined,
      }),
    onSuccess: (res) => {
      setConfirmOpen(false);
      setRemarks("");
      setSelectedIds(new Set());
      if (res.failedCount > 0) {
        const skipped = res.results.filter((r) => !r.ok);
        toast.warning(
          `${res.succeeded} Short Closed, ${res.failedCount} skipped: ${skipped
            .map((s) => s.reason)
            .filter(Boolean)
            .join("; ")}`,
        );
      } else {
        toast.success(res.message);
      }
      refetch();
      queryClient.invalidateQueries({ queryKey: ["mr-list"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
    onError: (err: any) => {
      toast.error(err.message || "Short Close failed.");
    },
  });

  const allSelected = candidates.length > 0 && selectedIds.size === candidates.length;

  return (
    <MaterialShell
      title="Short Close"
      subtitle="Year-end housekeeping — retire partially-fulfilled POs and MRs"
      icon={Archive}
    >
      {/* ── Filters ── */}
      <Card className="border-border shadow-sm mb-5">
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center gap-2">
            {(["PO", "MR"] as ShortCloseDocType[]).map((dt) => (
              <button
                key={dt}
                onClick={() => {
                  setDocType(dt);
                  setSearched(false);
                  setSelectedIds(new Set());
                }}
                className={`inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg border transition-all ${
                  docType === dt
                    ? "bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 text-white border-transparent shadow-sm"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {dt === "PO" ? (
                  <Package size={14} />
                ) : (
                  <ClipboardList size={14} />
                )}
                {dt === "PO" ? "Purchase Order" : "Material Request"}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                Financial Year
              </label>
              <select
                value={finYearId}
                onChange={(e) => setFinYearId(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm"
              >
                <option value="">All Years</option>
                {finYears.map((fy) => (
                  <option key={fy.id} value={fy.id}>
                    {fy.year}
                    {fy.status === "Active" ? " (Current)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                Company
              </label>
              <select
                value={companyId}
                onChange={(e) => {
                  setCompanyId(e.target.value);
                  setProjectId("");
                }}
                className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm"
              >
                <option value="">All Companies</option>
                {(companies as any[]).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                Project
              </label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm"
              >
                <option value="">All Projects</option>
                {filteredProjects.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={handleSearch}
                disabled={isFetching}
                className="w-full h-9 inline-flex items-center justify-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs rounded-lg bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 transition-all disabled:opacity-50"
              >
                {isFetching ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Search size={13} />
                )}
                Search
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Results ── */}
      {searched && (
        <Card className="border-border shadow-sm">
          <CardContent className="p-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <p className="text-xs text-muted-foreground">
                {isFetching
                  ? "Loading…"
                  : `${candidates.length} document${candidates.length !== 1 ? "s" : ""} in Partial status`}
              </p>
              {selectedIds.size > 0 && rights.canEdit && (
                <button
                  onClick={() => setConfirmOpen(true)}
                  className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-destructive hover:bg-destructive/90 transition-all"
                >
                  <Archive size={13} />
                  Short Close {selectedIds.size} Selected
                </button>
              )}
            </div>

            {!isFetching && candidates.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground/60 italic">
                No {docType === "PO" ? "Purchase Orders" : "Material Requests"} in
                Partial status match these filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/30 text-[10px] uppercase tracking-widest text-muted-foreground">
                      <th className="px-3 py-2.5 text-left w-8">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleSelectAll}
                          className="rounded border-border"
                        />
                      </th>
                      <th className="px-3 py-2.5 text-left">Document Number</th>
                      <th className="px-3 py-2.5 text-left">Date</th>
                      <th className="px-3 py-2.5 text-left">
                        {docType === "PO" ? "Vendor" : "Requestor"}
                      </th>
                      <th className="px-3 py-2.5 text-right">Total Qty</th>
                      <th className="px-3 py-2.5 text-right">Completed Qty</th>
                      <th className="px-3 py-2.5 text-right">Pending Qty</th>
                      <th className="px-3 py-2.5 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {candidates.map((c) => (
                      <tr
                        key={c.docId}
                        className={`hover:bg-muted/20 transition-colors ${
                          selectedIds.has(c.docId) ? "bg-primary/5" : ""
                        }`}
                      >
                        <td className="px-3 py-2.5">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(c.docId)}
                            onChange={() => toggleSelect(c.docId)}
                            className="rounded border-border"
                          />
                        </td>
                        <td className="px-3 py-2.5 font-mono font-semibold text-foreground">
                          {c.docNo}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {fmtDate(c.docDate)}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {c.party || "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right font-medium">
                          {fmtQty(c.totalQty)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-medium text-emerald-600 dark:text-emerald-400">
                          {fmtQty(c.completedQty)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-medium text-amber-600 dark:text-amber-400">
                          {fmtQty(c.pendingQty)}
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge status={c.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Confirmation dialog ── */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !processMutation.isPending)
              setConfirmOpen(false);
          }}
        >
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-destructive/10 border border-destructive/20 flex items-center justify-center shrink-0">
                <AlertTriangle size={16} className="text-destructive" />
              </div>
              <div className="min-w-0">
                <h3 className="font-heading font-bold text-sm text-foreground">
                  Short Close {selectedIds.size} Document
                  {selectedIds.size !== 1 ? "s" : ""}?
                </h3>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                  All pending quantities on the selected document
                  {selectedIds.size !== 1 ? "s" : ""} will be permanently
                  cancelled. Quantities already received/ordered are kept as-is.
                  No further transactions can be raised against{" "}
                  {selectedIds.size !== 1 ? "these documents" : "this document"}{" "}
                  once Short Closed.{" "}
                  <span className="font-semibold text-destructive">
                    This action is irreversible.
                  </span>
                </p>
              </div>
              <button
                onClick={() => !processMutation.isPending && setConfirmOpen(false)}
                className="text-muted-foreground hover:text-foreground shrink-0"
              >
                <X size={16} />
              </button>
            </div>

            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                Remarks (optional)
              </label>
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={3}
                placeholder="Reason for short closing…"
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm resize-none"
              />
            </div>

            <div className="flex items-center gap-2 justify-end pt-1">
              <button
                onClick={() => setConfirmOpen(false)}
                disabled={processMutation.isPending}
                className="shrink-0 font-heading font-semibold text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg border border-border text-muted-foreground hover:bg-muted transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => processMutation.mutate()}
                disabled={processMutation.isPending}
                className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-destructive hover:bg-destructive/90 transition-all disabled:opacity-50"
              >
                {processMutation.isPending && (
                  <Loader2 size={13} className="animate-spin" />
                )}
                Confirm Short Close
              </button>
            </div>
          </div>
        </div>
      )}
    </MaterialShell>
  );
}

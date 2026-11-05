import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, Search, Loader2, X, ChevronDown } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark, statusTone } from "@/components/sheet/Sheet";
import { usePageRights } from "@/hooks/usePageRights";
import { useFinYear } from "@/contexts/FinYearContext";
import { projectBelongsToCompany } from "@/lib/projectBelongsTo";
import * as mrApi from "@/api/materialRequestApi";
import {
  searchShortCloseCandidates,
  processShortClose,
  type ShortCloseDocType,
  type ShortCloseCandidate,
} from "@/api/shortCloseApi";
import { BodyPortal } from "@/components/ui/body-portal";

const fmtQty = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

// Sheet styles
const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
const KEY_RED = `${KEY} bg-destructive text-destructive-foreground border border-destructive`;
const SEL = "w-full h-9 px-3 pr-8 text-sm font-body bg-card border border-foreground/40 transition-colors focus:outline-none focus:border-foreground text-foreground appearance-none";
const TH = "px-3 py-2.5 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const chip = (on: boolean) =>
  `${KEY} h-8 px-3 border ${on ? "bg-foreground text-card border-foreground" : "border-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground"}`;

export default function ShortClose() {
  const rights = usePageRights("short-close");
  const queryClient = useQueryClient();
  const { finYears } = useFinYear();

  const [docType, setDocType] = useState<ShortCloseDocType>("PO");
  // null = not chosen yet; becomes the current year once the years load.
  const [finYearId, setFinYearId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("");
  const [searched, setSearched] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [remarks, setRemarks] = useState("");

  useEffect(() => {
    if (finYearId === null && finYears.length) {
      const active = finYears.find((y) => y.status === "Active");
      setFinYearId(active ? String(active.id) : "");
    }
  }, [finYears, finYearId]);

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
    () => (projects as any[]).filter((p) => !companyId || projectBelongsToCompany(p, companyId)),
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
    setSelectedIds((prev) => (prev.size === candidates.length ? new Set() : new Set(candidates.map((c) => c.docId))));
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
  const chevron = <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />;
  const docs = selectedIds.size !== 1 ? "documents" : "document";

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material", "Short Close"]} />
      <SheetShell
        eyebrow="CivilierERP · Material"
        title="Short close"
        subtitle="Year-end housekeeping: retire partly fulfilled purchase orders and material requests, cancelling what is still pending on them."
      >
        {/* ── Filters ── */}
        <div className="bg-card mb-5" style={{ border: RULE }}>
          <div className="px-5 py-3 flex flex-wrap items-center justify-between gap-3" style={{ borderBottom: RULE }}>
            <h3 className={HEAD}>Find documents</h3>
            <div className="flex items-center gap-2">
              {(["PO", "MR"] as ShortCloseDocType[]).map((dt) => (
                <button
                  key={dt}
                  onClick={() => {
                    setDocType(dt);
                    setSearched(false);
                    setSelectedIds(new Set());
                  }}
                  className={chip(docType === dt)}
                >
                  {dt === "PO" ? "Purchase orders" : "Material requests"}
                </button>
              ))}
            </div>
          </div>

          <div className="p-5 grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className={`block ${LBL} mb-1.5`}>Financial year</label>
              <div className="relative">
                <select value={finYearId ?? ""} onChange={(e) => setFinYearId(e.target.value)} className={SEL}>
                  <option value="">All years</option>
                  {finYears.map((fy) => (
                    <option key={fy.id} value={fy.id}>
                      {fy.year}
                      {fy.status === "Active" ? " (current)" : ""}
                    </option>
                  ))}
                </select>
                {chevron}
              </div>
            </div>
            <div>
              <label className={`block ${LBL} mb-1.5`}>Company</label>
              <div className="relative">
                <select
                  value={companyId}
                  onChange={(e) => {
                    setCompanyId(e.target.value);
                    setProjectId("");
                  }}
                  className={SEL}
                >
                  <option value="">All companies</option>
                  {(companies as any[]).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {chevron}
              </div>
            </div>
            <div>
              <label className={`block ${LBL} mb-1.5`}>Project</label>
              <div className="relative">
                <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={SEL}>
                  <option value="">All projects</option>
                  {filteredProjects.map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {chevron}
              </div>
            </div>
            <div className="flex items-end">
              <button onClick={handleSearch} disabled={isFetching} className={`${KEY_INK} w-full h-9`}>
                {isFetching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                Search
              </button>
            </div>
          </div>
        </div>

        {/* ── Results ── */}
        {searched && (
          <div className="bg-card" style={{ border: RULE }}>
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3" style={{ borderBottom: RULE }}>
              <div>
                <h3 className={HEAD}>Partly fulfilled</h3>
                <p className={`${LBL} mt-1 tabular-nums`}>
                  {isFetching ? "Loading…" : `${candidates.length} document${candidates.length !== 1 ? "s" : ""}`}
                  {selectedIds.size > 0 && ` · ${selectedIds.size} selected`}
                </p>
              </div>
              {selectedIds.size > 0 && rights.canEdit && (
                <button onClick={() => setConfirmOpen(true)} className={`${KEY_RED} h-9 px-4`}>
                  <Archive size={13} />
                  Short close {selectedIds.size} selected
                </button>
              )}
            </div>

            {!isFetching && candidates.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                No partly fulfilled {docType === "PO" ? "purchase orders" : "material requests"} match these filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[720px]">
                  <thead>
                    <tr style={{ borderBottom: RULE }}>
                      <th className={`${TH} text-left w-8`}>
                        <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="accent-foreground" aria-label="Select all" />
                      </th>
                      <th className={`${TH} text-left`}>Document</th>
                      <th className={`${TH} text-left`}>Date</th>
                      <th className={`${TH} text-left`}>{docType === "PO" ? "Vendor" : "Requestor"}</th>
                      <th className={`${TH} text-right`}>{docType === "PO" ? "Ordered" : "Requested"}</th>
                      <th className={`${TH} text-right`}>{docType === "PO" ? "Received" : "Ordered"}</th>
                      <th className={`${TH} text-right`}>Pending</th>
                      <th className={`${TH} text-left`}>Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-foreground/10">
                    {candidates.map((c) => (
                      <tr key={c.docId} className={`cursor-pointer transition-colors ${selectedIds.has(c.docId) ? "bg-primary/10" : "hover:bg-primary/5"}`} onClick={() => toggleSelect(c.docId)}>
                        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={selectedIds.has(c.docId)} onChange={() => toggleSelect(c.docId)} className="accent-foreground" aria-label={`Select ${c.docNo}`} />
                        </td>
                        <td className="px-3 py-2.5 font-heading font-semibold tracking-wide text-foreground whitespace-nowrap">{c.docNo}</td>
                        <td className="px-3 py-2.5 text-muted-foreground tabular-nums whitespace-nowrap">{fmtDate(c.docDate)}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">{c.party || "—"}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmtQty(c.totalQty)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmtQty(c.completedQty)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-heading font-semibold">{fmtQty(c.pendingQty)}</td>
                        <td className="px-3 py-2.5">
                          <SheetMark text={c.status} tone={statusTone(c.status)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </SheetShell>

      {/* ── Confirmation ── */}
      {confirmOpen && (
        <BodyPortal>
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget && !processMutation.isPending) setConfirmOpen(false);
            }}
          >
            <div className="sheet-frame bg-card w-full max-w-md" style={{ margin: 0 }} role="dialog" aria-modal="true" aria-label="Confirm short close">
              <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4" style={{ borderBottom: RULE }}>
                <div className="min-w-0">
                  <p className={LBL}>Short close</p>
                  <h3 className="font-heading text-lg font-bold tracking-tight text-foreground mt-1">
                    Short close {selectedIds.size} {docs}?
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                    Everything still pending on the selected {docs} is cancelled. What has already been {docType === "PO" ? "received" : "ordered"} stays as it is, and nothing more can be raised against{" "}
                    {selectedIds.size !== 1 ? "them" : "it"}. <span className="font-semibold text-destructive">This cannot be undone.</span>
                  </p>
                </div>
                <button
                  onClick={() => !processMutation.isPending && setConfirmOpen(false)}
                  className="w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground shrink-0"
                  aria-label="Close"
                >
                  <X size={15} />
                </button>
              </div>

              <div className="px-5 py-4">
                <label className={`block ${LBL} mb-1.5`}>Remarks (optional)</label>
                <textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={3}
                  placeholder="Reason for short closing…"
                  className="w-full px-3 py-2 text-sm bg-card border border-foreground/40 focus:outline-none focus:border-foreground resize-none"
                />
              </div>

              <div className="flex items-center gap-2 justify-end px-5 pb-5">
                <button onClick={() => setConfirmOpen(false)} disabled={processMutation.isPending} className={`${KEY_LINE} h-9 px-4`}>
                  Cancel
                </button>
                <button onClick={() => processMutation.mutate()} disabled={processMutation.isPending} className={`${KEY_RED} h-9 px-4`}>
                  {processMutation.isPending && <Loader2 size={13} className="animate-spin" />}
                  Confirm short close
                </button>
              </div>
            </div>
          </div>
        </BodyPortal>
      )}
    </>
  );
}

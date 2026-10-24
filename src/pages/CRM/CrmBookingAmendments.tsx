// CRM Booking Amendments: parking and extra-charge changes requested on a booking after its Agreement was executed.
// Each needs an approver (admin, super admin, marketing head, or the amendment workflow's level) before it is applied.
import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark, statusTone } from "@/components/sheet/Sheet";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { useAuth } from "@/contexts/AuthContext";
import { usePageRights } from "@/hooks/usePageRights";
import { useSearchAsYouType } from "@/hooks/useSearchAsYouType";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { fmtIstDateTime } from "@/lib/istTime";
import { translateError } from "@/lib/translateError";
import { KEY_INK, KEY_LINE, KEY_RED, LBL, RULE, RULE_SOFT } from "./customers/config";

// The roles the server always lets approve; others need the Approval Inbox edit right and the workflow's level (the
// server decides).
const AMENDMENT_APPROVER_ROLES = ["admin", "super_admin", "marketing_head"];
const BASE = "/api/crm/booking-amendments";
const PAGE_SIZE = 20;

type AmendmentStatus = "Pending" | "Approved" | "Rejected";
type StatusFilter = AmendmentStatus | "All";
const STATUS_FILTERS: StatusFilter[] = ["Pending", "Approved", "Rejected", "All"];

interface AmendmentRow {
  Id: number; BookingId: number; BookingNo: string; ProjectName: string; UnitNo: string; ApplicantName: string;
  ChangeType: string; Action: string; Reason: string; ProposedChange: string; Status: AmendmentStatus;
  RequestedByName: string; RequestedAt: string; ReviewedByName: string | null; ReviewedAt: string | null; ReviewNotes: string | null;
}
interface AmendmentListFilters { status?: string; search: string; companyId: string; projectId: string; blockId: string }

const changeLabel = (type: string, action: string) =>
  `${type === "ParkingAllotment" ? "Parking" : type === "ExtraCharge" ? "Extra charge" : type} · ${action}`;

const proposedEntries = (json: string) => {
  try { return Object.entries(JSON.parse(json || "{}") as Record<string, unknown>).filter(([k]) => k !== "Reason"); }
  catch { return []; }
};

// The server's { error } is read out instead of showing the raw response body.
async function readError(r: Response, fallback: string) {
  const data = await r.json().catch(() => ({}));
  return new Error(data?.error || `${fallback} (${r.status}).`);
}

async function fetchAmendmentsList(filters: AmendmentListFilters, page: number, pageSize: number) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (filters.status) params.set("status", filters.status);
  if (filters.search) params.set("search", filters.search);
  if (filters.companyId) params.set("companyId", filters.companyId);
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.blockId) params.set("blockId", filters.blockId);
  const r = await fetchWithAuth(`${BASE}?${params}`);
  if (!r.ok) throw await readError(r, "Could not load the amendments");
  const data = await r.json();
  return { rows: (data.rows || []) as AmendmentRow[], total: Number(data.total || 0), statusCounts: (data.statusCounts || {}) as Record<string, number> };
}

async function reviewAmendment(id: number, action: "approve" | "reject", notes: string) {
  const r = await fetchWithAuth(`${BASE}/${id}/${action}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Notes: notes || null }),
  });
  if (!r.ok) throw await readError(r, `Could not ${action} the amendment`);
  return r.json();
}

export default function CrmBookingAmendments() {
  const { canEdit } = usePageRights("crm-bookings");
  const { currentUser, canDoAction } = useAuth();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("Pending");
  const [review, setReview] = useState<{ row: AmendmentRow; action: "approve" | "reject" } | null>(null);
  const [notes, setNotes] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [cpb, setCpb] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  function updateFilter<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(1); };
  }
  // Searches as you type (after a short pause); Enter still searches at once.
  useSearchAsYouType(searchInput, (v) => updateFilter(setSearch)(v));

  const role = String(currentUser?.role || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const isApprover = AMENDMENT_APPROVER_ROLES.includes(role) || canDoAction("approval-inbox" as any, "edit");

  const listFilters: AmendmentListFilters = useMemo(() => ({
    status: statusFilter === "All" ? undefined : statusFilter,
    search, companyId: cpb.companyId, projectId: cpb.projectId, blockId: cpb.blockId,
  }), [statusFilter, search, cpb]);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["crm-booking-amendments", listFilters, page, pageSize],
    queryFn: () => fetchAmendmentsList(listFilters, page, pageSize),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const counts = data?.statusCounts ?? {};
  const countOf = (s: StatusFilter) => (s === "All" ? Object.values(counts).reduce((a, b) => a + b, 0) : counts[s] || 0);

  const mutation = useMutation({
    mutationFn: ({ id, action, notes: n }: { id: number; action: "approve" | "reject"; notes: string }) => reviewAmendment(id, action, n),
    onSuccess: (_, { action }) => {
      toast.success(action === "approve" ? "Amendment approved and applied" : "Amendment rejected");
      // An approved change re-prices the booking: its card and list must not show the old figures.
      ["crm-booking-amendments", "crm-bookings", "crm-booking-detail"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setReview(null);
      setNotes("");
    },
    onError: (e: Error) => toast.error(translateError(e.message)),
  });

  const columns: ColumnDef<AmendmentRow>[] = [
    { header: "Booking", accessorKey: "BookingNo", size: 170,
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="font-heading text-xs font-semibold tabular-nums">{row.original.BookingNo}</div>
          <div className="text-[0.6875rem] text-muted-foreground truncate">{[row.original.ProjectName, row.original.UnitNo].filter(Boolean).join(" · ")}</div>
        </div>
      ) },
    { header: "Customer", accessorKey: "ApplicantName", size: 170,
      cell: ({ row }) => <span className="text-xs font-medium"><ApplicantNames name={row.original.ApplicantName} bookingId={row.original.BookingId} /></span> },
    { header: "Change", accessorKey: "ChangeType", size: 230,
      cell: ({ row }) => {
        const entries = proposedEntries(row.original.ProposedChange);
        return (
          <div className="min-w-0">
            <div className="text-xs font-medium">{changeLabel(row.original.ChangeType, row.original.Action)}</div>
            {entries.length > 0 && <div className="mt-0.5 text-[0.6875rem] text-muted-foreground truncate">{entries.map(([k, v]) => `${k}: ${v}`).join(" · ")}</div>}
          </div>
        );
      } },
    { header: "Reason", accessorKey: "Reason", size: 180,
      cell: ({ row }) => <span className="text-xs text-muted-foreground block truncate" title={row.original.Reason}>{row.original.Reason || "—"}</span> },
    { header: "Requested", accessorKey: "RequestedByName", size: 150,
      cell: ({ row }) => (
        <div>
          <div className="text-xs font-medium">{row.original.RequestedByName || "—"}</div>
          <div className="text-[0.6875rem] text-muted-foreground tabular-nums">{fmtIstDateTime(row.original.RequestedAt)}</div>
        </div>
      ) },
    { header: "Status", accessorKey: "Status", size: 170,
      cell: ({ row }) => (
        <div className="min-w-0">
          <SheetMark text={row.original.Status} tone={statusTone(row.original.Status)} />
          {row.original.ReviewedByName && (
            <div className="text-[0.6875rem] text-muted-foreground mt-0.5">by {row.original.ReviewedByName} · {fmtIstDateTime(row.original.ReviewedAt)}</div>
          )}
          {row.original.ReviewNotes && <div className="text-[0.6875rem] text-muted-foreground italic mt-0.5 truncate" title={row.original.ReviewNotes}>{row.original.ReviewNotes}</div>}
        </div>
      ) },
    ...(canEdit && isApprover
      ? [{
          id: "actions", header: "", enableSorting: false, size: 170,
          cell: ({ row }: { row: { original: AmendmentRow } }) => row.original.Status !== "Pending" ? null : (
            <div className="flex items-center gap-1.5 justify-end">
              <button type="button" onClick={() => { setReview({ row: row.original, action: "approve" }); setNotes(""); }} className={`${KEY_INK} h-7 px-2`}>
                <CheckCircle2 size={11} /> Approve
              </button>
              <button type="button" onClick={() => { setReview({ row: row.original, action: "reject" }); setNotes(""); }} className={`${KEY_LINE} h-7 px-2 !text-destructive !border-destructive`}>
                <XCircle size={11} /> Reject
              </button>
            </div>
          ),
        } as ColumnDef<AmendmentRow>]
      : []),
  ];

  const isApprove = review?.action === "approve";

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Booking Amendments"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM"
        title="Booking Amendments"
        subtitle="Parking and extra-charge changes asked for after the Agreement was executed. Each is applied only once an approver signs it off."
      >
        <div className="space-y-5">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {([
                { s: "Pending", note: isApprover ? "Waiting for your decision" : "Waiting for an approver" },
                { s: "Approved", note: "Applied to the booking" },
                { s: "Rejected", note: "Not applied" },
                { s: "All", note: "Under these filters" },
              ] as { s: StatusFilter; note: string }[]).map((x) => (
                <div key={x.s}>
                  <button onClick={() => updateFilter(setStatusFilter)(x.s)} className="label link">{x.s === "All" ? "All requests" : x.s}</button>
                  <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : countOf(x.s)}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card" style={{ border: RULE }}>
            <div className="flex items-stretch overflow-x-auto overflow-y-hidden" style={{ borderBottom: RULE }}>
              {STATUS_FILTERS.map((s) => (
                <button key={s} type="button" onClick={() => updateFilter(setStatusFilter)(s)}
                  className={`inline-flex items-center gap-2 px-4 h-11 font-heading text-[0.6875rem] font-semibold uppercase tracking-[0.1em] shrink-0 transition-colors ${statusFilter === s ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"}`}
                  style={{ borderRight: RULE_SOFT }}>
                  {s} <span className="tabular-nums">{countOf(s)}</span>
                </button>
              ))}
            </div>
            <div className="px-5 py-4 flex flex-wrap items-center gap-3" style={{ borderBottom: RULE }}>
              <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") updateFilter(setSearch)(searchInput); }}
                placeholder="Search booking or customer…"
                className="h-9 w-full sm:w-72 border border-foreground/40 focus:border-foreground bg-card px-3 text-xs text-foreground outline-none" />
              <CrmCompanyProjectBlockFilter value={cpb} onChange={updateFilter(setCpb)} />
            </div>
            {isError ? (
              <p className="px-5 py-10 text-center text-sm text-destructive">{(error as Error)?.message}</p>
            ) : (
              <DataTable serverPagination={{ page, pageSize, total, onPageChange: setPage, onPageSizeChange: (n) => { setPageSize(n); setPage(1); } }}
                columns={columns} data={rows} loading={isLoading} searchable={false} className="border-0"
                emptyMessage={statusFilter === "Pending" ? "Nothing waiting for a decision." : "No amendment requests match these filters."} />
            )}
          </div>
        </div>
      </SheetShell>

      {review && (
        <Dialog open onOpenChange={(o) => !o && setReview(null)}>
          <DialogContent className="max-w-lg p-5 gap-4 rounded-none" style={{ border: RULE }}>
            <DialogHeader>
              <DialogTitle className="font-heading text-[0.75rem] font-bold uppercase tracking-[0.14em] flex items-center gap-2">
                {isApprove ? <CheckCircle2 size={14} /> : <XCircle size={14} className="text-destructive" />}
                {isApprove ? "Approve amendment" : "Reject amendment"}
                <span className="tabular-nums normal-case tracking-normal text-sm text-muted-foreground">· {review.row.BookingNo}</span>
              </DialogTitle>
            </DialogHeader>

            <div className="grid grid-cols-3 gap-px" style={{ background: "hsl(var(--foreground) / 0.15)", border: RULE_SOFT }}>
              {[
                ["Change", changeLabel(review.row.ChangeType, review.row.Action)],
                ["Customer", <ApplicantNames key="c" name={review.row.ApplicantName} bookingId={review.row.BookingId} />],
                ["Unit", review.row.UnitNo || "—"],
              ].map(([k, v]) => (
                <div key={k as string} className="bg-card px-3 py-2 min-w-0">
                  <p className={LBL}>{k as string}</p>
                  <p className="text-xs font-semibold mt-0.5 truncate">{v}</p>
                </div>
              ))}
            </div>

            <div className="bg-card" style={{ border: RULE }}>
              <p className="px-3 py-2 font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em]" style={{ borderBottom: RULE }}>Proposed change</p>
              <div className="px-3 py-2.5">
                {proposedEntries(review.row.ProposedChange).length ? (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
                    {proposedEntries(review.row.ProposedChange).map(([k, v]) => (
                      <React.Fragment key={k}>
                        <dt className="text-muted-foreground whitespace-nowrap">{k}</dt>
                        <dd className="text-foreground font-medium break-all tabular-nums">{String(v ?? "—")}</dd>
                      </React.Fragment>
                    ))}
                  </dl>
                ) : <p className="text-xs text-muted-foreground italic">No field details recorded.</p>}
              </div>
            </div>

            {review.row.Reason && (
              <p className="px-3 py-2 text-xs" style={{ border: RULE_SOFT }}><span className="text-muted-foreground">Reason: </span>{review.row.Reason}</p>
            )}

            {isApprove && (
              <p className="flex items-start gap-2 text-xs px-3 py-2" style={{ border: RULE_SOFT }}>
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                Approving applies the change to the booking at once; its payment milestones are recalculated.
              </p>
            )}

            <div>
              <label className={`block mb-1.5 ${LBL}`}>Review notes {isApprove ? "(optional)" : "(required)"}</label>
              <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes for this decision"
                className="w-full border border-foreground/40 focus:border-foreground bg-card px-2.5 py-2 text-sm text-foreground outline-none resize-none" />
            </div>

            <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
              <button onClick={() => setReview(null)} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
              <button
                disabled={mutation.isPending || (!isApprove && !notes.trim())}
                onClick={() => mutation.mutate({ id: review.row.Id, action: review.action, notes })}
                className={`${isApprove ? KEY_INK : KEY_RED} h-9 px-4`}>
                {mutation.isPending ? "Working…" : isApprove ? "Approve and apply" : "Reject"}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

import React, { useState } from "react";
import { fmtIstDateTime } from "@/lib/istTime";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  XCircle,
  Clock,
  FileEdit,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { CrmShell } from "@/components/crm/CrmShell";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { CrmDataTable, type CrmColumn } from "@/components/crm/CrmDataTable";
import { CrmListToolbar, type CrmStatusTab } from "@/components/crm/CrmListToolbar";
import { useCrmListState, useSticky, listParams, type CrmListQuery } from "@/hooks/useCrmListState";

const AMENDMENT_APPROVER_ROLES = ["admin", "super_admin", "marketing_head"];

const BASE = "/api/crm/booking-amendments";

type AmendmentStatus = "Pending" | "Approved" | "Rejected";

interface AmendmentRow {
  Id: number;
  BookingId: number;
  BookingNo: string;
  ProjectName: string;
  UnitNo: string;
  ApplicantName: string;
  ChangeType: string;
  Action: string;
  Reason: string;
  ProposedChange: string;
  Status: AmendmentStatus;
  RequestedByName: string;
  RequestedAt: string;
  ReviewedByName: string | null;
  ReviewedAt: string | null;
  ReviewNotes: string | null;
}

function fmtDate(v: string | null) {
  return fmtIstDateTime(v);
}

function formatChangeType(type: string, action: string) {
  const typeLabel =
    type === "ParkingAllotment"
      ? "Parking"
      : type === "ExtraCharge"
      ? "Extra Charge"
      : type;
  return `${typeLabel} — ${action}`;
}

const STATUS_ACCENT: Record<AmendmentStatus, string> = {
  Pending: "border-l-amber-400",
  Approved: "border-l-emerald-500",
  Rejected: "border-l-red-500",
};

function StatusBadge({ status }: { status: AmendmentStatus }) {
  if (status === "Approved")
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800">
        {status}
      </Badge>
    );
  if (status === "Rejected")
    return (
      <Badge className="bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800">
        {status}
      </Badge>
    );
  return (
    <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800">
      <Clock className="w-3 h-3 mr-1 inline" />
      {status}
    </Badge>
  );
}

/** Parses ProposedChange JSON and renders as a read-only diff card. */
function ProposedChangeDiffCard({ json }: { json: string }) {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(json || "{}");
  } catch {
    /* ignore */
  }
  const entries = Object.entries(parsed).filter(
    ([k]) => !["Reason"].includes(k)
  );
  if (!entries.length)
    return (
      <p className="text-xs text-muted-foreground italic">
        No field details recorded.
      </p>
    );

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
      {entries.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="text-muted-foreground font-medium whitespace-nowrap">
            {k}
          </dt>
          <dd className="text-foreground font-medium break-all">
            {String(v ?? "—")}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

interface ListPage { rows: AmendmentRow[]; total: number; counts: Record<string, number> }
async function fetchAmendmentsList(q: CrmListQuery & { from?: string; to?: string }): Promise<ListPage> {
  // Server-side filtering: status, search, and cpb are handled via listParams;
  // status, from, and to are explicitly forwarded as query params for server-side filtering.
  const params = listParams(q);
  if (q.status && q.status !== "All") params.set("status", q.status);
  if (q.from) params.set("from", q.from);
  if (q.to) params.set("to", q.to);
  const r = await fetchWithAuth(`${BASE}?${params}`);
  if (!r.ok) throw new Error(await r.text());
  const d = await r.json();
  return { rows: d.rows ?? [], total: d.total ?? 0, counts: d.counts ?? {} };
}

async function reviewAmendment(
  id: number,
  action: "approve" | "reject",
  notes: string
) {
  const r = await fetchWithAuth(`${BASE}/${id}/${action}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Notes: notes || null }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export default function CrmBookingAmendments() {
  const { canEdit } = usePageRights("crm-bookings");
  const { currentUser, canDoAction } = useAuth();
  const qc = useQueryClient();
  const [reviewDialog, setReviewDialog] = useState<{
    row: AmendmentRow;
    action: "approve" | "reject";
  } | null>(null);
  const [notes, setNotes] = useState("");

  const list = useCrmListState({ pageSize: 25, defaultSort: { key: "RequestedAt", dir: "desc" }, defaultStatus: "Pending" });

  const isApprover =
    AMENDMENT_APPROVER_ROLES.includes(
      String(currentUser?.role || "").toLowerCase()
    ) || canDoAction("approval-inbox" as any, "edit");

  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["crm-booking-amendments", list.query, list.status],
    queryFn: () => fetchAmendmentsList({ ...list.query, status: list.status }),
    staleTime: 30_000,
  });
  const pageData = useSticky(data);
  const rows = pageData?.rows ?? [];
  const total = pageData?.total ?? 0;
  const counts = pageData?.counts ?? {};

  const mutation = useMutation({
    mutationFn: ({
      id,
      action,
      notes,
    }: {
      id: number;
      action: "approve" | "reject";
      notes: string;
    }) => reviewAmendment(id, action, notes),
    onSuccess: (_, { action }) => {
      toast.success(
        `Amendment ${action === "approve" ? "approved and applied" : "rejected"}`
      );
      qc.invalidateQueries({ queryKey: ["crm-booking-amendments"] });
      setReviewDialog(null);
      setNotes("");
    },
    onError: (e: Error) => toast.error(e.message || "Failed"),
  });

  const columns: CrmColumn<AmendmentRow>[] = [
    {
      key: "booking", header: "Booking", sortKey: "BookingNo",
      cell: (r) => (
        <div>
          <div className="font-semibold text-xs whitespace-nowrap">{r.BookingNo}</div>
          <div className="text-[0.6875rem] text-muted-foreground whitespace-nowrap">
            {r.ProjectName} · {r.UnitNo}
          </div>
        </div>
      ),
    },
    {
      key: "customer", header: "Customer", sortKey: "ApplicantName", className: "hidden md:table-cell",
      cell: (r) => (
        <span className="text-xs font-medium"><ApplicantNames name={r.ApplicantName} bookingId={r.BookingId} /></span>
      ),
    },
    {
      key: "change", header: "Change", className: "hidden lg:table-cell",
      cell: (r) => (
        <div>
          <div className="text-xs font-medium whitespace-nowrap">
            {formatChangeType(r.ChangeType, r.Action)}
          </div>
          {(() => {
            let parsed: Record<string, unknown> = {};
            try {
              parsed = JSON.parse(r.ProposedChange || "{}");
            } catch {
              /* ignore */
            }
            const entries = Object.entries(parsed).filter(
              ([k]) => !["Reason"].includes(k)
            );
            if (!entries.length) return null;
            return (
              <div className="mt-0.5 text-[0.6875rem] text-muted-foreground truncate max-w-[200px]">
                {entries.map(([k, v]) => `${k}: ${v}`).join(" · ")}
              </div>
            );
          })()}
        </div>
      ),
    },
    {
      key: "reason", header: "Reason", className: "hidden xl:table-cell",
      cell: (r) => (
        <span
          className="text-xs text-muted-foreground max-w-[180px] block truncate"
          title={r.Reason}
        >
          {r.Reason || "—"}
        </span>
      ),
    },
    {
      key: "requestedBy", header: "Requested By", sortKey: "RequestedAt", className: "hidden lg:table-cell",
      cell: (r) => (
        <div>
          <div className="text-xs font-medium whitespace-nowrap">
            {r.RequestedByName || "—"}
          </div>
          <div className="text-[0.6875rem] text-muted-foreground whitespace-nowrap">
            {fmtDate(r.RequestedAt)}
          </div>
        </div>
      ),
    },
    {
      key: "status", header: "Status", sortKey: "Status",
      cell: (r) => (
        <div>
          <StatusBadge status={r.Status} />
          {r.ReviewedByName && (
            <div className="text-[0.6875rem] text-muted-foreground mt-0.5">
              by {r.ReviewedByName} ·{" "}
              {fmtDate(r.ReviewedAt)}
            </div>
          )}
          {r.ReviewNotes && (
            <div
              className="text-[0.6875rem] text-muted-foreground italic mt-0.5 max-w-[160px] truncate"
              title={r.ReviewNotes}
            >
              {r.ReviewNotes}
            </div>
          )}
        </div>
      ),
    },
    ...(canEdit && isApprover
      ? [
          {
            key: "actions", header: <span className="sr-only">Actions</span>, align: "right" as const, className: "w-px whitespace-nowrap",
            cell: (r: AmendmentRow) => {
              if (r.Status !== "Pending") return null;
              return (
                <div className="flex items-center gap-1.5 justify-end" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    title="Approve this amendment"
                    onClick={() => {
                      setReviewDialog({ row: r, action: "approve" });
                      setNotes("");
                    }}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-green-600 hover:bg-green-50 hover:text-green-700 dark:hover:bg-green-900/30 border border-transparent hover:border-green-200 dark:hover:border-green-800 transition-colors"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    title="Reject this amendment"
                    onClick={() => {
                      setReviewDialog({ row: r, action: "reject" });
                      setNotes("");
                    }}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 border border-transparent hover:border-red-200 dark:hover:border-red-800 transition-colors"
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                </div>
              );
            },
          } as CrmColumn<AmendmentRow>,
        ]
      : []),
  ];

  const isApprove = reviewDialog?.action === "approve";

  const tabs: CrmStatusTab[] = [
    { key: "All",      label: "All",      count: counts.All ?? 0 },
    { key: "Pending",  label: "Pending",  count: counts.Pending ?? 0,  dot: "bg-amber-400" },
    { key: "Approved", label: "Approved", count: counts.Approved ?? 0, dot: "bg-emerald-500" },
    { key: "Rejected", label: "Rejected", count: counts.Rejected ?? 0, dot: "bg-red-500" },
  ];

  return (
    <CrmShell
      title="Booking Amendments"
      subtitle="Parking and extra-charge changes requested after Agreement execution — requires admin approval before applying."
      icon={FileEdit}
    >
      <Breadcrumbs items={["Dashboard", "CRM", "Booking Amendments"]} />

      <div className="space-y-3">
        <CrmListToolbar tabs={tabs} status={list.status} onStatus={list.setStatus}
          searchValue={list.searchInput} onSearch={list.setSearchInput}
          placeholder="Search by booking, customer…">
          <CrmCompanyProjectBlockFilter value={list.cpb} onChange={list.setCpb} />
        </CrmListToolbar>

        <CrmDataTable
          columns={columns} rows={rows} rowKey={(r) => r.Id}
          loading={isLoading} fetching={isFetching}
          error={isError ? (error as Error)?.message : null} onRetry={() => refetch()}
          sort={list.sort} onSort={list.toggleSort}
          rowAccent={(r) => STATUS_ACCENT[r.Status]}
          empty={<>No amendment requests match these filters. <button onClick={list.reset} className="text-primary hover:underline ml-1">Clear filters</button></>}
          page={list.page} pageSize={list.pageSize} total={total} onPage={list.setPage}
        />
      </div>

      {/* ── Review dialog ─────────────────────────────────────────────────── */}
      {reviewDialog && (
        <Dialog open onOpenChange={() => setReviewDialog(null)}>
          <DialogContent accent="crm" className="max-w-lg">
            <DialogHeader>
              {/* Coloured header banner */}
              <div
                className="flex items-center gap-2.5 px-4 py-3 -mx-6 -mt-4 mb-2 rounded-t-lg"
                style={{
                  background: isApprove
                    ? "linear-gradient(135deg, rgba(16,185,129,0.12) 0%, transparent 70%)"
                    : "linear-gradient(135deg, rgba(239,68,68,0.10) 0%, transparent 70%)",
                  borderBottom: isApprove
                    ? "1px solid rgba(16,185,129,0.2)"
                    : "1px solid rgba(239,68,68,0.18)",
                }}
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{
                    background: isApprove
                      ? "rgba(16,185,129,0.15)"
                      : "rgba(239,68,68,0.12)",
                    border: isApprove
                      ? "1px solid rgba(16,185,129,0.3)"
                      : "1px solid rgba(239,68,68,0.25)",
                  }}
                >
                  {isApprove ? (
                    <CheckCircle2
                      className="w-4 h-4"
                      style={{ color: "#10b981" }}
                    />
                  ) : (
                    <XCircle className="w-4 h-4" style={{ color: "#ef4444" }} />
                  )}
                </div>
                <DialogTitle className="text-sm font-semibold">
                  {isApprove ? "Approve" : "Reject"} Amendment
                  <span className="ml-1.5 font-mono text-muted-foreground font-normal">
                    {reviewDialog.row.BookingNo}
                  </span>
                </DialogTitle>
              </div>
            </DialogHeader>

            <div className="space-y-4">
              {/* Context row */}
              <div className="flex items-start gap-3 text-xs">
                <div className="flex-1 min-w-0">
                  <p className="text-muted-foreground">Change</p>
                  <p className="font-semibold mt-0.5">
                    {formatChangeType(
                      reviewDialog.row.ChangeType,
                      reviewDialog.row.Action
                    )}
                  </p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-muted-foreground">Customer</p>
                  <p className="font-semibold mt-0.5 truncate">
                    <ApplicantNames name={reviewDialog.row.ApplicantName} bookingId={reviewDialog.row.BookingId} />
                  </p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-muted-foreground">Unit</p>
                  <p className="font-semibold mt-0.5">
                    {reviewDialog.row.UnitNo}
                  </p>
                </div>
              </div>

              {/* Proposed change diff card — always visible */}
              <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 space-y-2">
                <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  Proposed Changes
                </p>
                <ProposedChangeDiffCard json={reviewDialog.row.ProposedChange} />
              </div>

              {/* Reason */}
              {reviewDialog.row.Reason && (
                <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs">
                  <span className="text-muted-foreground font-medium">
                    Reason:{" "}
                  </span>
                  {reviewDialog.row.Reason}
                </div>
              )}

              {/* Approve warning */}
              {isApprove && (
                <div className="flex items-start gap-2 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-lg px-3 py-2 border border-green-100 dark:border-green-900">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>
                    Approving will immediately apply this change to the booking.
                    The customer's payment milestones will be recalculated.
                  </span>
                </div>
              )}

              {/* Notes */}
              <div className="space-y-1">
                <Label className="text-xs">
                  Review Notes{" "}
                  <span className="text-muted-foreground">
                    {reviewDialog.action === "reject"
                      ? "(required)"
                      : "(optional)"}
                  </span>
                </Label>
                <Textarea
                  rows={3}
                  placeholder="Add notes for this decision…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="text-sm resize-none"
                />
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReviewDialog(null)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant={isApprove ? "default" : "destructive"}
                disabled={
                  mutation.isPending ||
                  (!isApprove && !notes.trim())
                }
                onClick={() =>
                  mutation.mutate({
                    id: reviewDialog.row.Id,
                    action: reviewDialog.action,
                    notes,
                  })
                }
              >
                {mutation.isPending
                  ? "Processing…"
                  : isApprove
                  ? "Approve & Apply"
                  : "Reject"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </CrmShell>
  );
}

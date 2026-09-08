import React, { useState } from "react";
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
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
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

const AMENDMENT_APPROVER_ROLES = ["admin", "super_admin", "marketing_head"];

const BASE = "/api/crm/booking-amendments";

type AmendmentStatus = "Pending" | "Approved" | "Rejected";
type StatusFilter = AmendmentStatus | "All";

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
  if (!v) return "—";
  const d = new Date(v.replace(/Z$/, ""));
  if (isNaN(d.getTime())) return v;
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

async function fetchAmendments(status?: string): Promise<AmendmentRow[]> {
  const url = status ? `${BASE}?status=${status}` : BASE;
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function reviewAmendment(
  id: number,
  action: "approve" | "reject",
  notes: string
) {
  const r = await fetch(`${BASE}/${id}/${action}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ Notes: notes || null }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

const STATUS_FILTERS: StatusFilter[] = ["Pending", "Approved", "Rejected", "All"];

const filterAccent: Record<StatusFilter, string> = {
  Pending: "#f59e0b",
  Approved: "#10b981",
  Rejected: "#ef4444",
  All: "#6366f1",
};

export default function CrmBookingAmendments() {
  const { canEdit } = usePageRights("crm-bookings");
  const { currentUser, canDoAction } = useAuth();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("Pending");
  const [reviewDialog, setReviewDialog] = useState<{
    row: AmendmentRow;
    action: "approve" | "reject";
  } | null>(null);
  const [notes, setNotes] = useState("");

  const isApprover =
    AMENDMENT_APPROVER_ROLES.includes(
      String(currentUser?.role || "").toLowerCase()
    ) || canDoAction("approval-inbox" as any, "edit");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["crm-booking-amendments", statusFilter],
    queryFn: () =>
      fetchAmendments(statusFilter === "All" ? undefined : statusFilter),
    staleTime: 30_000,
  });

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

  const columns: ColumnDef<AmendmentRow>[] = [
    {
      header: "Booking",
      accessorKey: "BookingNo",
      cell: ({ row }) => (
        <div>
          <div className="font-semibold text-xs">{row.original.BookingNo}</div>
          <div className="text-[11px] text-muted-foreground">
            {row.original.ProjectName} · {row.original.UnitNo}
          </div>
        </div>
      ),
    },
    {
      header: "Customer",
      accessorKey: "ApplicantName",
      cell: ({ row }) => (
        <span className="text-xs font-medium">{row.original.ApplicantName}</span>
      ),
    },
    {
      header: "Change",
      accessorKey: "ChangeType",
      cell: ({ row }) => (
        <div>
          <div className="text-xs font-medium">
            {formatChangeType(row.original.ChangeType, row.original.Action)}
          </div>
          {(() => {
            let parsed: Record<string, unknown> = {};
            try {
              parsed = JSON.parse(row.original.ProposedChange || "{}");
            } catch {
              /* ignore */
            }
            const entries = Object.entries(parsed).filter(
              ([k]) => !["Reason"].includes(k)
            );
            if (!entries.length) return null;
            return (
              <div className="mt-0.5 text-[11px] text-muted-foreground truncate max-w-[200px]">
                {entries.map(([k, v]) => `${k}: ${v}`).join(" · ")}
              </div>
            );
          })()}
        </div>
      ),
    },
    {
      header: "Reason",
      accessorKey: "Reason",
      cell: ({ row }) => (
        <span
          className="text-xs text-muted-foreground max-w-[180px] block truncate"
          title={row.original.Reason}
        >
          {row.original.Reason || "—"}
        </span>
      ),
    },
    {
      header: "Requested By",
      accessorKey: "RequestedByName",
      cell: ({ row }) => (
        <div>
          <div className="text-xs font-medium">
            {row.original.RequestedByName || "—"}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {fmtDate(row.original.RequestedAt)}
          </div>
        </div>
      ),
    },
    {
      header: "Status",
      accessorKey: "Status",
      cell: ({ row }) => (
        <div>
          <StatusBadge status={row.original.Status} />
          {row.original.ReviewedByName && (
            <div className="text-[11px] text-muted-foreground mt-0.5">
              by {row.original.ReviewedByName} ·{" "}
              {fmtDate(row.original.ReviewedAt)}
            </div>
          )}
          {row.original.ReviewNotes && (
            <div
              className="text-[11px] text-muted-foreground italic mt-0.5 max-w-[160px] truncate"
              title={row.original.ReviewNotes}
            >
              {row.original.ReviewNotes}
            </div>
          )}
        </div>
      ),
    },
    ...(canEdit && isApprover
      ? [
          {
            id: "actions",
            header: "",
            enableSorting: false,
            size: 72,
            cell: ({ row }: { row: { original: AmendmentRow } }) => {
              if (row.original.Status !== "Pending") return null;
              return (
                <div className="flex items-center gap-1.5 justify-end">
                  <button
                    type="button"
                    title="Approve this amendment"
                    onClick={() => {
                      setReviewDialog({ row: row.original, action: "approve" });
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
                      setReviewDialog({ row: row.original, action: "reject" });
                      setNotes("");
                    }}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 border border-transparent hover:border-red-200 dark:hover:border-red-800 transition-colors"
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                </div>
              );
            },
          } as ColumnDef<AmendmentRow>,
        ]
      : []),
  ];

  const isApprove = reviewDialog?.action === "approve";

  return (
    <CrmShell
      title="Booking Amendments"
      subtitle="Parking and extra-charge changes requested after Agreement execution — requires admin approval before applying."
      icon={FileEdit}
    >
      <Breadcrumbs items={["Dashboard", "CRM", "Booking Amendments"]} />

      {/* ── Status filter tab bar ─────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {STATUS_FILTERS.map((s) => {
          const active = statusFilter === s;
          const accent = filterAccent[s];
          return (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className="relative flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all"
              style={
                active
                  ? {
                      background: `${accent}18`,
                      border: `1px solid ${accent}50`,
                      color: accent,
                      boxShadow: `0 0 8px ${accent}20`,
                    }
                  : {
                      background: "transparent",
                      border: "1px solid var(--border)",
                      color: "var(--muted-foreground)",
                    }
              }
            >
              {s === "Pending" && (
                <Clock className="w-3 h-3" style={{ color: active ? accent : undefined }} />
              )}
              {s === "Approved" && (
                <CheckCircle2 className="w-3 h-3" style={{ color: active ? accent : undefined }} />
              )}
              {s === "Rejected" && (
                <XCircle className="w-3 h-3" style={{ color: active ? accent : undefined }} />
              )}
              {s}
              {/* Live count badge */}
              {!isLoading && statusFilter === s && rows.length > 0 && (
                <span
                  className="text-[10px] font-bold px-1 py-0.5 rounded-full leading-none min-w-[18px] text-center"
                  style={{
                    background: `${accent}25`,
                    color: accent,
                  }}
                >
                  {rows.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Main data table ───────────────────────────────────────────────── */}
      <DataTable
        columns={columns}
        data={rows}
        loading={isLoading}
        searchable
        searchPlaceholder="Search by booking, customer, or project…"
        emptyMessage="No amendment requests found."
      />

      {/* ── Review dialog ─────────────────────────────────────────────────── */}
      {reviewDialog && (
        <Dialog open onOpenChange={() => setReviewDialog(null)}>
          <DialogContent className="max-w-lg">
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
                    {reviewDialog.row.ApplicantName}
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
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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

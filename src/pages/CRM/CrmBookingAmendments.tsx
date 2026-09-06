import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, XCircle, Clock, ChevronDown, ChevronUp } from "lucide-react";
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
  if (!v) return "—";
  const d = new Date(v.replace(/Z$/, ""));
  if (isNaN(d.getTime())) return v;
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatChangeType(type: string, action: string) {
  const typeLabel = type === "ParkingAllotment" ? "Parking" : type === "ExtraCharge" ? "Extra Charge" : type;
  return `${typeLabel} — ${action}`;
}

function StatusBadge({ status }: { status: AmendmentStatus }) {
  if (status === "Approved") return <Badge className="bg-green-100 text-green-800 border-green-200">{status}</Badge>;
  if (status === "Rejected") return <Badge className="bg-red-100 text-red-800 border-red-200">{status}</Badge>;
  return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200"><Clock className="w-3 h-3 mr-1 inline" />{status}</Badge>;
}

function ProposedChangeView({ json }: { json: string }) {
  const [open, setOpen] = useState(false);
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(json || "{}"); } catch { /* ignore */ }
  const entries = Object.entries(parsed).filter(([k]) => !["Reason"].includes(k));
  if (!entries.length) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div>
      <button onClick={() => setOpen(o => !o)} className="text-xs text-primary flex items-center gap-1 hover:underline">
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {open ? "Hide" : "Show"} details
      </button>
      {open && (
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
          {entries.map(([k, v]) => (
            <React.Fragment key={k}>
              <dt className="text-muted-foreground font-medium">{k}:</dt>
              <dd className="text-foreground">{String(v ?? "—")}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
    </div>
  );
}

async function fetchAmendments(status?: string): Promise<AmendmentRow[]> {
  const url = status ? `${BASE}?status=${status}` : BASE;
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function reviewAmendment(id: number, action: "approve" | "reject", notes: string) {
  const r = await fetch(`${BASE}/${id}/${action}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ Notes: notes || null }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export default function CrmBookingAmendments() {
  const { canEdit } = usePageRights("crm-bookings");
  const { currentUser, canDoAction } = useAuth();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("Pending");
  const [reviewDialog, setReviewDialog] = useState<{ row: AmendmentRow; action: "approve" | "reject" } | null>(null);
  const [notes, setNotes] = useState("");

  const isApprover = AMENDMENT_APPROVER_ROLES.includes(String(currentUser?.role || "").toLowerCase())
    || canDoAction("approval-inbox" as any, "edit");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["crm-booking-amendments", statusFilter],
    queryFn: () => fetchAmendments(statusFilter === "All" ? undefined : statusFilter),
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: ({ id, action, notes }: { id: number; action: "approve" | "reject"; notes: string }) =>
      reviewAmendment(id, action, notes),
    onSuccess: (_, { action }) => {
      toast.success(`Amendment ${action === "approve" ? "approved and applied" : "rejected"}`);
      qc.invalidateQueries({ queryKey: ["crm-booking-amendments"] });
      setReviewDialog(null);
      setNotes("");
    },
    onError: (e: Error) => toast.error(e.message || "Failed"),
  });

  const columns: ColumnDef<AmendmentRow>[] = [
    { header: "Booking", accessorKey: "BookingNo", cell: ({ row }) => (
      <div>
        <div className="font-medium text-xs">{row.original.BookingNo}</div>
        <div className="text-[11px] text-muted-foreground">{row.original.ProjectName} · {row.original.UnitNo}</div>
      </div>
    )},
    { header: "Customer", accessorKey: "ApplicantName", cell: ({ row }) => (
      <span className="text-xs">{row.original.ApplicantName}</span>
    )},
    { header: "Change", accessorKey: "ChangeType", cell: ({ row }) => (
      <div>
        <div className="text-xs font-medium">{formatChangeType(row.original.ChangeType, row.original.Action)}</div>
        <ProposedChangeView json={row.original.ProposedChange} />
      </div>
    )},
    { header: "Reason", accessorKey: "Reason", cell: ({ row }) => (
      <span className="text-xs text-muted-foreground max-w-[180px] block truncate" title={row.original.Reason}>
        {row.original.Reason || "—"}
      </span>
    )},
    { header: "Requested By", accessorKey: "RequestedByName", cell: ({ row }) => (
      <div>
        <div className="text-xs">{row.original.RequestedByName || "—"}</div>
        <div className="text-[11px] text-muted-foreground">{fmtDate(row.original.RequestedAt)}</div>
      </div>
    )},
    { header: "Status", accessorKey: "Status", cell: ({ row }) => (
      <div>
        <StatusBadge status={row.original.Status} />
        {row.original.ReviewedByName && (
          <div className="text-[11px] text-muted-foreground mt-0.5">
            by {row.original.ReviewedByName} · {fmtDate(row.original.ReviewedAt)}
          </div>
        )}
        {row.original.ReviewNotes && (
          <div className="text-[11px] text-muted-foreground italic mt-0.5 max-w-[160px] truncate" title={row.original.ReviewNotes}>
            {row.original.ReviewNotes}
          </div>
        )}
      </div>
    )},
    ...(canEdit && isApprover ? [{
      id: "actions",
      header: "",
      cell: ({ row }: { row: { original: AmendmentRow } }) => {
        if (row.original.Status !== "Pending") return null;
        return (
          <div className="flex gap-1">
            <button
              onClick={() => { setReviewDialog({ row: row.original, action: "approve" }); setNotes(""); }}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-green-50 text-green-700 border border-green-200 hover:bg-green-100"
            >
              <CheckCircle className="w-3 h-3" /> Approve
            </button>
            <button
              onClick={() => { setReviewDialog({ row: row.original, action: "reject" }); setNotes(""); }}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-red-50 text-red-700 border border-red-200 hover:bg-red-100"
            >
              <XCircle className="w-3 h-3" /> Reject
            </button>
          </div>
        );
      },
    } as ColumnDef<AmendmentRow>] : []),
  ];

  return (
    <div className="p-4 space-y-4">
      <Breadcrumbs items={["Dashboard", "CRM", "Booking Amendments"]} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Booking Amendments</h1>
          <p className="text-sm text-muted-foreground">
            Parking and extra-charge changes requested after the Agreement was executed — requires admin approval before applying.
          </p>
        </div>
        <div className="flex gap-1">
          {(["Pending", "Approved", "Rejected", "All"] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${statusFilter === s ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:border-primary/40"}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        loading={isLoading}
        searchable
        searchPlaceholder="Search by booking, customer, or project..."
        emptyMessage="No amendment requests found."
      />

      {reviewDialog && (
        <Dialog open onOpenChange={() => setReviewDialog(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {reviewDialog.action === "approve" ? "Approve" : "Reject"} Amendment
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="text-sm">
                <span className="font-medium">{reviewDialog.row.BookingNo}</span> — {formatChangeType(reviewDialog.row.ChangeType, reviewDialog.row.Action)}
              </div>
              <div className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
                <strong>Reason:</strong> {reviewDialog.row.Reason || "—"}
              </div>
              {reviewDialog.action === "approve" && (
                <p className="text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2 border border-green-100">
                  Approving will immediately apply this change to the booking. The customer's payment milestones will be recalculated.
                </p>
              )}
              <div className="space-y-1">
                <Label className="text-xs">Review Notes {reviewDialog.action === "reject" ? "(required)" : "(optional)"}</Label>
                <Textarea
                  rows={3}
                  placeholder="Add notes for this decision…"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="text-sm"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setReviewDialog(null)}>Cancel</Button>
              <Button
                size="sm"
                variant={reviewDialog.action === "approve" ? "default" : "destructive"}
                disabled={mutation.isPending || (reviewDialog.action === "reject" && !notes.trim())}
                onClick={() => mutation.mutate({ id: reviewDialog.row.Id, action: reviewDialog.action, notes })}
              >
                {mutation.isPending ? "Processing…" : reviewDialog.action === "approve" ? "Approve & Apply" : "Reject"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

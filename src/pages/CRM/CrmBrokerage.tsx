import { CrmStatus } from "@/constants/crmStatuses";
import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { CrmShell } from "@/components/crm/CrmShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, ShieldAlert, IndianRupee, Lock, Unlock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApprovalActions } from "@/components/ApprovalActions";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useTds } from "@/contexts/TdsContext";

const API = "/api/crm/brokerage";
const BKG_API = "/api/crm/bookings";
const BROKER_API = "/api/account-head?type=BR";

const statusColor: Record<string, string> = {
  Pending: "text-orange-600 bg-orange-50 border-orange-200",
  Approved: "text-blue-600 bg-blue-50 border-blue-200",
  Paid: "text-green-600 bg-green-50 border-green-200",
};

const EMPTY_FORM = { BookingId: "", BrokerId: "", BrokerFirm: "", RateType: "Percentage", RateValue: "", ComputedAmount: "", TDSId: "", Notes: "" };

async function fetchAll(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(BKG_API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBrokers(): Promise<any[]> {
  try { const r = await fetchWithAuth(BROKER_API); return r.ok ? r.json() : []; } catch { return []; }
}

// Read role from JWT to decide whether to show the Approve button in the
// Customize dialog. The backend re-checks independently — this only affects rendering.
function getUserRole(): string | null {
  try {
    const token = localStorage.getItem("token");
    if (!token) return null;
    return JSON.parse(atob(token.split(".")[1])).role ?? null;
  } catch { return null; }
}
const CRM_APPROVER_ROLES = ["admin", "super_admin", "marketing_head"];

const CrmBrokerage: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const rights = usePageRights("crm-brokerage");
  const { canEdit: hasApprovalInboxEdit } = usePageRights("approval-inbox");
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingStatus, setEditingStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const isApprover = CRM_APPROVER_ROLES.includes(getUserRole() ?? "") || hasApprovalInboxEdit;

  const { data: records = [], isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({ queryKey: ["crm-brokerage"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000 });
  const { data: brokers = [] } = useQuery({ queryKey: ["broker-master"], queryFn: fetchBrokers, staleTime: 5 * 60_000 });
  const { tdsRecords } = useTds();
  // Broker Master is the source of truth for the broker's own identity —
  // once picked, his details are only ever displayed read-only here, never
  // re-typed. Only the Firm/Rate below are genuinely per-deal fields.
  const selectedBroker = useMemo(() => (brokers as any[]).find((b: any) => String(b.LHeadId) === form.BrokerId) || null, [brokers, form.BrokerId]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setDialogOpen(true);
  };

  const openEdit = (r: any) => {
    setEditingId(r.Id);
    setEditingStatus(r.Status ?? null);
    setForm({
      BookingId: String(r.BookingId || ""),
      BrokerId: String(r.BrokerId || ""),
      BrokerFirm: r.BrokerFirm || "",
      RateType: r.RateType || "Percentage",
      RateValue: r.RateValue != null ? String(r.RateValue) : "",
      ComputedAmount: r.ComputedAmount != null ? String(r.ComputedAmount) : "",
      TDSId: r.TDSId != null ? String(r.TDSId) : "",
      Notes: r.Notes || "",
    });
    setDialogOpen(true);
  };

  // Deep-link from the Admin Approval Inbox's "Review & Approve" action
  // (/crm/brokerage?view=X) — opens the same Customize dialog a manual
  // "Customize amount" click would, instead of leaving the reviewer to
  // hunt for the row themselves or approve blind straight from the inbox
  // list. Waits for the records list to load so the row is actually there
  // to find.
  useEffect(() => {
    const viewId = searchParams.get("view");
    if (!viewId || !(records as any[]).length) return;
    const row = (records as any[]).find((r) => String(r.Id) === viewId);
    if (row) {
      if (rights.canEdit) {
        openEdit(row);
      } else {
        toast.info("You don't have edit rights on this page — ask an admin to grant access to review this record.");
      }
    }
    setSearchParams((sp) => { sp.delete("view"); return sp; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, records]);

  const handleApprove = async () => {
    if (!editingId) return;
    setApproving(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API}/${editingId}/approve`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 207) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.financeHandoffError) {
        toast.warning(data.financeHandoffError);
      } else {
        toast.success("Brokerage approved and sent to Finance");
      }
      setDialogOpen(false);
      setForm({ ...EMPTY_FORM });
      setEditingId(null);
      setEditingStatus(null);
      qc.invalidateQueries({ queryKey: ["crm-brokerage"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setApproving(false);
    }
  };

  const handleSave = async () => {
    if (!editingId && (!form.BookingId || !form.BrokerId || !form.RateValue)) { toast.error("Booking, broker and rate are required"); return; }
    if (editingId && (!form.RateValue || !form.ComputedAmount)) { toast.error("Rate and approved amount are required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(editingId ? `${API}/${editingId}` : API, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          BookingId: form.BookingId ? parseInt(form.BookingId) : undefined,
          BrokerId: form.BrokerId ? parseInt(form.BrokerId) : undefined,
          RateValue: form.RateValue ? Number(form.RateValue) : undefined,
          ComputedAmount: form.ComputedAmount ? Number(form.ComputedAmount) : undefined,
          TDSId: form.TDSId ? parseInt(form.TDSId) : null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success(editingId ? "Brokerage updated" : "Brokerage recorded");
      setDialogOpen(false);
      setForm({ ...EMPTY_FORM });
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ["crm-brokerage"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const columns: ColumnDef<any, unknown>[] = [
    { accessorKey: "BookingNo", header: "Booking", size: 110, cell: (i) => <span className="font-mono text-xs">{i.getValue() as string}</span> },
    { accessorKey: "BrokerName", header: "Broker", size: 150,
      cell: (i) => (
        <div>
          <div className="font-medium">{i.row.original.BrokerName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.BrokerFirm || "—"}</div>
        </div>
      ) },
    { id: "rate", header: "Rate", size: 90, enableSorting: false,
      cell: (i) => <span className="text-xs">{i.row.original.RateType === "Percentage" ? `${i.row.original.RateValue}%` : `₹${i.row.original.RateValue}`}</span> },
    { id: "tranche", header: "Tranche", size: 150, enableSorting: false,
      cell: (i) => {
        const r = i.row.original;
        // TrancheLabel/UnlockGate cover all three payment plans now:
        // OneTime -> single "Full" row, gate "Booking".
        // TwoPart -> "Booking" (unlocked immediately) + "Agreement" tranches.
        // AgreementOnly -> single "Agreement"-gated tranche.
        // Older milestone-tranche records (pre-plan rework) still carry
        // MilestoneNo/MilestoneId and fall through to that rendering.
        if (r.TrancheLabel === "Full" || (r.UnlockGate == null && r.MilestoneNo == null)) {
          return <span className="text-xs text-muted-foreground">Full payout</span>;
        }
        const label = r.UnlockGate === "Agreement"
          ? `${r.TrancheLabel || "Agreement"} — unlocks on Agreement Executed`
          : r.UnlockGate === "Booking"
          ? `${r.TrancheLabel || "Booking"} — unlocks on booking amount paid`
          : `Milestone ${r.MilestoneNo}${r.MilestoneName ? ` — ${r.MilestoneName}` : ""}`;
        return (
          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${r.IsLocked ? "text-red-600 bg-red-50 border-red-200" : "text-green-600 bg-green-50 border-green-200"}`}>
            {r.IsLocked ? <Lock size={11} /> : <Unlock size={11} />} {label}
          </span>
        );
      } },
    { accessorKey: "ComputedAmount", header: "Amount / TDS / Net", size: 180,
      cell: (i) => {
        const r = i.row.original;
        const gross = Number(r.ComputedAmount || 0);
        const tds   = Number(r.TDSAmount || 0);
        const net   = Number(r.NetPayable ?? gross);
        return (
          <div className="text-xs space-y-0.5">
            <div className="font-semibold text-foreground">₹{gross.toLocaleString("en-IN")}</div>
            {tds > 0 && (
              <div className="text-orange-600">− TDS {r.TDSPercentage}%: ₹{tds.toLocaleString("en-IN")}</div>
            )}
            <div className={`font-bold ${tds > 0 ? "text-green-600" : "text-foreground"}`}>
              Net: ₹{net.toLocaleString("en-IN")}
            </div>
          </div>
        );
      } },
    { accessorKey: "Status", header: "Status", size: 100,
      cell: (i) => <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor[i.row.original.Status] || ""}`}>{i.row.original.Status}</span> },
    { id: "actions", header: "Actions", size: 160, enableSorting: false,
      cell: (i) => {
        const r = i.row.original;
        if (r.IsLocked) {
          // Only an Agreement-gated tranche (TwoPart's second half /
          // AgreementOnly) is ever created locked — a Booking-gated tranche
          // always starts unlocked (see buildBrokerageTranches).
          return <span className="flex items-center gap-1 text-xs text-red-600"><Lock size={11} /> Unlocks once the Agreement is Executed</span>;
        }
        return (
          <>
            {/* submitOnly: Approve/Reject only ever happen from the Admin
                Approval Inbox (admin/super_admin/dba), never self-service here */}
            <ApprovalActions
              status={r.Status}
              recordId={r.Id}
              endpoint={API}
              submitOnly
              onSuccess={() => qc.invalidateQueries({ queryKey: ["crm-brokerage"] })}
            />
            {rights.canEdit && r.Status === CrmStatus.PENDING && (
              <button onClick={() => openEdit(r)} className="text-xs text-primary hover:underline">Customize amount</button>
            )}
            {r.Status === CrmStatus.APPROVED && (
              <button onClick={() => navigate(r.FinancePaymentId ? `/payments?id=${r.FinancePaymentId}` : "/payments")} className="text-xs text-primary hover:underline">
                {r.FinancePaymentDocNo ? `Finance: ${r.FinancePaymentDocNo}` : "Sent to Finance"}
              </button>
            )}
            {r.Status === CrmStatus.PAID && <span className="text-xs text-muted-foreground">Fully paid</span>}
          </>
        );
      } },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Brokerage"]} />
      <CrmShell
        title="CRM — Brokerage"
      subtitle="Per-booking broker assignment — internal only, never shown to the customer"
      action={
          <div className="flex items-center gap-3">
          <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />
          {rights.canCreate && (
            <button onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
            <Plus size={14} /> Add Broker
          </button>
          )}
        </div>
      }
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
          <ShieldAlert size={14} /> This data is internal-only and is excluded from the customer portal by design.
        </div>
        <button onClick={() => navigate("/crm/broker-payments")}
          className="flex items-center gap-1.5 text-xs px-3 py-2 border border-border rounded-lg hover:bg-muted transition-colors">
          <IndianRupee size={14} /> Go to Broker Payment
        </button>
      </div>

      <DataTable
        data={records}
        columns={columns}
        loading={isLoading}
        emptyMessage="No brokerage records"
        className="rounded-xl border border-border overflow-hidden bg-card"
      />

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setForm({ ...EMPTY_FORM }); setEditingId(null); setEditingStatus(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-heading">{editingId ? "Customize Brokerage" : "Add Broker Involvement"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Booking *</label>
              <select value={form.BookingId} disabled={!!editingId} onChange={(e) => setForm((f) => ({ ...f, BookingId: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select booking</option>
                {(bookings as any[]).map((b: any) => (
                  <option key={b.Id} value={String(b.Id)}>{b.BookingNo} — {b.ApplicantName} (₹{Number(b.TotalValue || 0).toLocaleString("en-IN")})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Broker * (from Broker Master)</label>
              <select value={form.BrokerId} disabled={!!editingId} onChange={(e) => {
                  const brokerId = e.target.value;
                  const broker = (brokers as any[]).find((b: any) => String(b.LHeadId) === brokerId);
                  setForm((f) => ({
                    ...f,
                    BrokerId: brokerId,
                    // Clear TDS if broker is marked TDS not applicable
                    TDSId: broker && !broker.IsTdsApplicable ? "" : f.TDSId,
                  }));
                }}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select broker</option>
                {(brokers as any[]).map((b: any) => (
                  <option key={b.LHeadId} value={String(b.LHeadId)}>{b.LHeadName}{b.LHeadPhone ? ` — ${b.LHeadPhone}` : ""}</option>
                ))}
              </select>
              {!brokers.length && (
                <p className="text-xs text-muted-foreground mt-1">No brokers found — add one in Broker Master first.</p>
              )}
            </div>

            {selectedBroker && (
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-lg bg-muted/20 border border-border p-2.5 text-xs">
                {selectedBroker.LHeadPhone && <div><span className="text-muted-foreground">Phone: </span><span className="font-medium">{selectedBroker.LHeadPhone}</span></div>}
                {selectedBroker.LHeadPan && <div><span className="text-muted-foreground">PAN: </span><span className="font-mono font-medium">{selectedBroker.LHeadPan}</span></div>}
                {selectedBroker.LHeadRera && <div><span className="text-muted-foreground">RERA: </span><span className="font-mono font-medium">{selectedBroker.LHeadRera}</span></div>}
                {selectedBroker.LHeadPaymentTerms && <div><span className="text-muted-foreground">Terms: </span><span className="font-medium">{selectedBroker.LHeadPaymentTerms}</span></div>}
                <div><span className="text-muted-foreground">TDS: </span><span className={`font-medium ${selectedBroker.IsTdsApplicable !== false ? "text-amber-600" : "text-muted-foreground"}`}>{selectedBroker.IsTdsApplicable !== false ? "Applicable (Sec. 194H)" : "Not Applicable"}</span></div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Firm (optional, for this deal)</label>
                <input type="text" value={form.BrokerFirm} onChange={(e) => setForm((f) => ({ ...f, BrokerFirm: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Rate Type</label>
                <select value={form.RateType} onChange={(e) => setForm((f) => ({ ...f, RateType: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                  <option value="Percentage">Percentage</option>
                  <option value="Amount">Fixed Amount</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Rate Value * ({form.RateType === "Percentage" ? "%" : "₹"})</label>
                <input type="number" value={form.RateValue} onChange={(e) => setForm((f) => ({ ...f, RateValue: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  TDS (Sec. 194H)
                  {selectedBroker && selectedBroker.IsTdsApplicable === false && (
                    <span className="ml-1.5 text-[10px] text-muted-foreground">· Not applicable per Broker Master</span>
                  )}
                </label>
                <select value={form.TDSId} onChange={(e) => setForm((f) => ({ ...f, TDSId: e.target.value }))}
                  disabled={selectedBroker?.IsTdsApplicable === false}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background disabled:opacity-50 disabled:cursor-not-allowed">
                  <option value="">None / Nil certificate</option>
                  {tdsRecords.filter((t) => t.status).map((t) => (
                    <option key={t.id} value={t.id}>{t.name} ({t.percentage}%)</option>
                  ))}
                </select>
              </div>
            </div>
            {editingId && (
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Approved Amount *</label>
                <input type="number" value={form.ComputedAmount} onChange={(e) => setForm((f) => ({ ...f, ComputedAmount: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Notes</label>
              <textarea value={form.Notes} onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))}
                rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setDialogOpen(false); setForm({ ...EMPTY_FORM }); setEditingId(null); setEditingStatus(null); }} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleSave} disabled={saving || approving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Saving..." : editingId ? "Save Changes" : "Add"}
            </button>
            {editingId && editingStatus === CrmStatus.PENDING && isApprover && (
              <button onClick={handleApprove} disabled={saving || approving}
                className="px-4 py-1.5 text-sm bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-40">
                {approving ? "Approving..." : "Approve & Send to Finance"}
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>
      </CrmShell>
    </>
  );
};

export default CrmBrokerage;
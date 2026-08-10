// CrmBookingVerify.tsx
//
// Dedicated, single-purpose screen for the Level-2 verification checklist —
// the second, independent re-check that happens once a Booking exists,
// mirroring CrmApplicationVerify.tsx's Level-1 pattern exactly (real data
// grouped into sections, each section's checklist control immediately
// underneath it, so ticking a box means looking at the thing next to it).
//
// Talks to crmBookings.js's own /:id/checklist/* routes, which share the
// exact same backend service/table as Level-1
// (crmApplicationChecklist.js — CrmApplicationVerificationChecklist keyed
// by ApplicationId + Level=2, since a Booking is always 1:1 with the
// Application it came from).
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import {
  ArrowLeft, CheckCircle2, Circle, AlertTriangle, Loader2,
  Building2, IndianRupee, ClipboardCheck, Car, IdCard, FileBadge, Users2, ShieldCheck,
} from "lucide-react";

const API = "/api/crm/bookings";
const BANK_DETAIL_API = "/api/crm/customer-bank-details";
const DOC_API = "/api/crm/booking-documents";
const PARKING_API = "/api/crm/parking";
const EXTRA_CHARGE_API = "/api/crm/extra-charges";
const BROKERAGE_API = "/api/crm/brokerage";

const CRM_APPROVER_ROLES = ["admin", "super_admin", "marketing_head"];

function getUserRoleFromToken(): string | null {
  try {
    const token = localStorage.getItem("token");
    if (!token) return null;
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.role ?? null;
  } catch {
    return null;
  }
}

const ITEM_ICON: Record<string, typeof Building2> = {
  BookingGenuine: Building2,
  BookingAmountReceived: IndianRupee,
  PaymentScheduleCompliance: ClipboardCheck,
  ParkingExtraCharges: Car,
  KycDocumentsComplete: IdCard,
  BrokerageTerms: Users2,
  CompanyRequirements: ShieldCheck,
};

type ChecklistItem = {
  ItemKey: string;
  ItemLabel: string;
  CheckStatus: "Pending" | "Checked" | "NeedsRecheck";
  Remarks: string | null;
};

function fmtInr(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  return `₹${n.toLocaleString("en-IN")}`;
}

function Field({ label, value, icon: Icon, warn }: { label: string; value: React.ReactNode; icon?: typeof Building2; warn?: boolean }) {
  return (
    <div className="flex items-start gap-1.5 min-w-0">
      {Icon && <Icon size={12} className="text-muted-foreground mt-0.5 shrink-0" />}
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`text-sm break-words ${warn ? "text-red-600 font-medium" : "text-foreground"}`}>
          {value === null || value === undefined || value === "" ? "—" : value}
        </div>
      </div>
    </div>
  );
}

export default function CrmBookingVerify() {
  const { id } = useParams<{ id: string }>();
  const bookingId = id ? parseInt(id, 10) : null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const role = getUserRoleFromToken();
  const isApprover = CRM_APPROVER_ROLES.includes((role || "").toLowerCase());

  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [flaggingKey, setFlaggingKey] = useState<string | null>(null);

  const { data: bkData, isLoading: bkLoading } = useQuery({
    queryKey: ["crm-booking-verify-detail", bookingId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/${bookingId}`);
      if (!r.ok) throw new Error("Failed to load booking");
      return r.json();
    },
    enabled: !!bookingId,
  });

  const { data: checklistData, isLoading: checklistLoading, refetch: refetchChecklist } = useQuery({
    queryKey: ["crm-booking-verify-checklist", bookingId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/${bookingId}/checklist`);
      if (!r.ok) throw new Error("Failed to load checklist");
      return r.json();
    },
    enabled: !!bookingId,
  });

  const { data: bankDetail } = useQuery({
    queryKey: ["crm-booking-verify-bank-detail", bookingId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${BANK_DETAIL_API}/booking/${bookingId}`);
      return r.ok ? r.json() : null;
    },
    enabled: !!bookingId,
  });

  const { data: docData } = useQuery({
    queryKey: ["crm-booking-verify-documents", bookingId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${DOC_API}/booking/${bookingId}`);
      return r.ok ? r.json() : { documents: [] };
    },
    enabled: !!bookingId,
  });

  const { data: parkingAllotments = [] } = useQuery({
    queryKey: ["crm-booking-verify-parking", bookingId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${PARKING_API}/${bookingId}`);
      return r.ok ? r.json() : [];
    },
    enabled: !!bookingId,
  });

  const { data: extraCharges = [] } = useQuery({
    queryKey: ["crm-booking-verify-extra-charges", bookingId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${EXTRA_CHARGE_API}/${bookingId}`);
      return r.ok ? r.json() : [];
    },
    enabled: !!bookingId,
  });

  // No bookingId filter on the brokerage list endpoint — filtered client
  // side, same as the rest of this page's small, per-record queries.
  const { data: allBrokerage = [] } = useQuery({
    queryKey: ["crm-booking-verify-brokerage"],
    queryFn: async () => {
      try { const r = await fetchWithAuth(BROKERAGE_API); return r.ok ? r.json() : []; } catch { return []; }
    },
  });

  const b = bkData?.booking;
  const milestones = bkData?.milestones || [];
  const paymentSummary = bkData?.paymentSummary;
  const items: ChecklistItem[] = checklistData?.items || [];
  const itemByKey: Record<string, ChecklistItem> = {};
  for (const it of items) itemByKey[it.ItemKey] = it;
  const checkedCount = items.filter((it) => it.CheckStatus === "Checked").length;
  const allChecked = checklistData?.allChecked;
  const bookingStatus = checklistData?.bookingStatus;
  const canVerify = isApprover && bookingStatus === "Pending";

  const brokerageRows = (allBrokerage as any[]).filter((r) => r.BookingId === bookingId);
  const documents = docData?.documents || [];
  const hasIdentityProof = documents.some((d: any) => d.DocumentType === "IdentityProof");
  const hasAddressProof = documents.some((d: any) => d.DocumentType === "AddressProof");
  const firstMilestone = milestones[0];
  const bookingAmountReceived = firstMilestone && Number(firstMilestone.AmountPaid || 0) >= Number(firstMilestone.AmountDue || 0) && Number(firstMilestone.AmountDue || 0) > 0;

  async function fireAction(itemKey: string, action: "check" | "uncheck" | "flag" | "resubmit", body?: object) {
    setBusyKey(itemKey);
    try {
      const res = await fetchWithAuth(`${API}/${bookingId}/checklist/${itemKey}/${action}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Action failed");

      if (action === "flag") {
        setRemarks((p) => ({ ...p, [itemKey]: "" }));
        setFlaggingKey(null);
      }
      await refetchChecklist();
      queryClient.invalidateQueries({ queryKey: ["approval-inbox"] });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusyKey(null);
    }
  }

  function handleToggle(it: ChecklistItem) {
    if (!canVerify || busyKey) return;
    if (it.CheckStatus === "Checked") {
      fireAction(it.ItemKey, "uncheck");
    } else {
      fireAction(it.ItemKey, "check");
    }
  }

  function ChecklistControl({ itemKey }: { itemKey: string }) {
    const it = itemByKey[itemKey];
    if (!it) return null;
    const Icon = ITEM_ICON[it.ItemKey] || Circle;
    const busy = busyKey === it.ItemKey;
    const isFlagging = flaggingKey === it.ItemKey;

    return (
      <div className="mt-3 pt-3 border-t border-dashed border-border">
        <div className="flex items-start gap-3">
          <button
            type="button"
            role="checkbox"
            aria-checked={it.CheckStatus === "Checked"}
            disabled={!canVerify || busy}
            onClick={() => handleToggle(it)}
            className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              it.CheckStatus === "Checked"
                ? "bg-green-600 border-green-600"
                : it.CheckStatus === "NeedsRecheck"
                  ? "border-red-400 bg-red-50"
                  : "border-border hover:border-primary"
            }`}
            title={it.CheckStatus === "Checked" ? "Click to uncheck" : "Click to mark checked"}
          >
            {busy ? (
              <Loader2 size={12} className="animate-spin text-white" />
            ) : it.CheckStatus === "Checked" ? (
              <CheckCircle2 size={14} className="text-white" />
            ) : null}
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
                <Icon size={12} className="text-muted-foreground shrink-0" />
                {it.ItemLabel}
              </p>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium shrink-0 ${
                it.CheckStatus === "Checked" ? "text-green-600 bg-green-50 border-green-200"
                : it.CheckStatus === "NeedsRecheck" ? "text-red-600 bg-red-50 border-red-200"
                : "text-muted-foreground bg-muted/50 border-border"
              }`}>
                {it.CheckStatus === "Checked" ? "Checked" : it.CheckStatus === "NeedsRecheck" ? "Needs Recheck" : "Pending"}
              </span>
            </div>

            {it.Remarks && (
              <p className="text-xs text-muted-foreground mt-1">
                {it.CheckStatus === "NeedsRecheck" ? "Reviewer note: " : "Remark: "}{it.Remarks}
              </p>
            )}

            {canVerify && it.CheckStatus !== "NeedsRecheck" && (
              isFlagging ? (
                <div className="mt-2 space-y-1.5">
                  <textarea
                    autoFocus
                    value={remarks[it.ItemKey] || ""}
                    onChange={(e) => setRemarks((p) => ({ ...p, [it.ItemKey]: e.target.value }))}
                    placeholder="What needs to be fixed? (required)"
                    rows={2}
                    className="w-full text-xs rounded-md border border-border px-2 py-1.5 bg-background"
                  />
                  <div className="flex gap-1.5">
                    <button
                      disabled={busy || !(remarks[it.ItemKey] || "").trim()}
                      onClick={() => fireAction(it.ItemKey, "flag", { remarks: remarks[it.ItemKey] })}
                      className="text-xs px-2.5 py-1 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-40"
                    >
                      {busy ? "…" : "Send for Recheck"}
                    </button>
                    <button
                      onClick={() => setFlaggingKey(null)}
                      className="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-muted"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setFlaggingKey(it.ItemKey)}
                  className="mt-1.5 text-[11px] text-red-600 hover:underline"
                >
                  Flag for Recheck
                </button>
              )
            )}

            {bookingStatus === "Pending" && it.CheckStatus === "NeedsRecheck" && (
              <button
                onClick={() => fireAction(it.ItemKey, "resubmit")}
                disabled={busy}
                className="mt-1.5 text-[11px] px-2 py-1 rounded-md bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 disabled:opacity-40"
              >
                {busy ? "…" : "I've revised this — resend for recheck"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  function Section({ title, icon: Icon, children, itemKey }: { title: string; icon: typeof Building2; children: React.ReactNode; itemKey: string }) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
          <Icon size={14} className="text-muted-foreground" /> {title}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
          {children}
        </div>
        <ChecklistControl itemKey={itemKey} />
      </div>
    );
  }

  if (!bookingId) {
    return <div className="p-8 text-center text-sm text-muted-foreground">No booking specified.</div>;
  }

  return (
    <SalesAutoShell
      title="Level 2 Verification"
      subtitle="A second, independent re-check of the confirmed Booking — check it because you looked, not because it's there"
      action={
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-border hover:bg-muted transition-colors"
        >
          <ArrowLeft size={14} /> Back
        </button>
      }
    >
      {(bkLoading || checklistLoading) && (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
          <Loader2 size={16} className="animate-spin" /> Loading booking…
        </div>
      )}

      {!bkLoading && !checklistLoading && b && (
        <div className="max-w-3xl mx-auto space-y-4">
          {/* ── Header: who/what, status, progress ── */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">{b.ApplicantName}</p>
                <p className="text-xs text-muted-foreground">{b.BookingNo} · {b.Mobile}{b.Email ? ` · ${b.Email}` : ""}</p>
              </div>
              <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium shrink-0 ${
                bookingStatus === "Pending" ? "text-blue-600 bg-blue-50 border-blue-200" : "text-muted-foreground bg-muted/50 border-border"
              }`}>
                {bookingStatus}
              </span>
            </div>
            <div className="pt-2 border-t border-border">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-foreground">Checklist progress</span>
                <span className="text-xs text-muted-foreground">{checkedCount}/{items.length} checked</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${items.length ? (checkedCount / items.length) * 100 : 0}%` }}
                />
              </div>
            </div>
            <button
              onClick={() => navigate(`/crm/bookings?id=${bookingId}`)}
              className="text-[11px] text-primary hover:underline"
            >
              View full booking details →
            </button>
          </div>

          {!canVerify && bookingStatus === "Pending" && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 flex items-center gap-2">
              <AlertTriangle size={14} className="shrink-0" />
              You're viewing this checklist read-only — verifying requires admin, super_admin, or marketing_head.
            </div>
          )}
          {bookingStatus !== "Pending" && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700 flex items-center gap-2">
              <CheckCircle2 size={14} className="shrink-0" />
              This booking is {String(bookingStatus).toLowerCase()} — verification is closed.
            </div>
          )}

          {/* ── 1. Booking Genuineness (vs Application) ── */}
          <Section title="Booking vs Application" icon={Building2} itemKey="BookingGenuine">
            <Field label="Project" value={b.ProjectName} />
            <Field label="Unit" value={b.UnitNo} />
            <Field label="Unit Type" value={b.UnitType} />
            <Field label="Area" value={b.AreaSqFt ? `${b.AreaSqFt} sqft` : "—"} />
            <Field label="Rate / SqFt" value={fmtInr(b.RatePerSqFt)} icon={IndianRupee} />
            <Field label="Total Value" value={fmtInr(b.TotalValue)} icon={IndianRupee} />
            <Field label="Grand Total" value={fmtInr(b.GrandTotal)} icon={IndianRupee} />
            <Field label="From Application" value={b.ApplicationNo} />
          </Section>

          {/* ── 2. Booking Amount Received ── */}
          <Section title="Booking Amount Payment" icon={IndianRupee} itemKey="BookingAmountReceived">
            <Field label="Booking Amount (Due)" value={fmtInr(firstMilestone?.AmountDue)} />
            <Field label="Received" value={fmtInr(firstMilestone?.AmountPaid)} warn={!bookingAmountReceived} />
            <Field label="Payment Mode" value={b.PaymentMode} />
            {!bookingAmountReceived && (
              <div className="col-span-2 sm:col-span-3">
                <p className="text-xs text-red-600 flex items-center gap-1.5">
                  <AlertTriangle size={12} className="shrink-0" /> Milestone #1 (Booking Amount) is not fully received yet — resolve before checking this off.
                </p>
              </div>
            )}
          </Section>

          {/* ── 3. Payment Schedule Compliance ── */}
          <Section title="Payment Plan & Milestone Schedule" icon={ClipboardCheck} itemKey="PaymentScheduleCompliance">
            <Field label="Payment Plan" value={b.PaymentPlanName} />
            <Field label="Total Due (all milestones)" value={fmtInr(paymentSummary?.totalDue)} />
            <Field label="Total Paid" value={fmtInr(paymentSummary?.totalPaid)} />
            <Field label="Balance" value={fmtInr(paymentSummary?.balance)} />
            <Field label="Milestone Count" value={milestones.length} />
          </Section>

          {/* ── 4. Parking & Extra Charges ── */}
          <Section title="Parking & Extra Charges" icon={Car} itemKey="ParkingExtraCharges">
            {parkingAllotments.length === 0 && extraCharges.length === 0 ? (
              <div className="col-span-2 sm:col-span-3">
                <p className="text-sm text-muted-foreground">None on this booking.</p>
              </div>
            ) : (
              <>
                {(parkingAllotments as any[]).map((p: any) => (
                  <Field key={p.Id} label={`Parking · ${p.ParkingSlotNo || "Slot"}`} value={fmtInr(p.TotalAmount)} />
                ))}
                {(extraCharges as any[]).map((c: any) => (
                  <Field key={c.Id} label={c.Description || c.MasterChargeName || "Extra Charge"} value={fmtInr(c.TotalAmount)} />
                ))}
              </>
            )}
          </Section>

          {/* ── 5. KYC & Documents ── */}
          <Section title="Customer KYC & Documents" icon={IdCard} itemKey="KycDocumentsComplete">
            <Field label="PAN" value={bankDetail?.PanNo || bkData?.customer?.PanNo} />
            <Field label="Aadhaar No." value={bankDetail?.AadhaarNo} />
            <Field label="Bank Account" value={bankDetail?.AccountNo ? `${bankDetail.BankName || ""} · ${bankDetail.AccountNo}` : "—"} />
            <Field label="Nominee" value={bankDetail?.NomineeName ? `${bankDetail.NomineeName} (${bankDetail.NomineeRelation || "—"})` : "—"} />
            <div className="col-span-2 sm:col-span-3 mt-1 pt-2 border-t border-border/60">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
                Documents {documents.length ? `(${documents.length})` : "— none uploaded"}
              </p>
              {documents.length > 0 && (
                <div className="space-y-1.5">
                  {documents.map((d: any) => (
                    <div key={d.Id} className="flex items-center gap-2 text-xs rounded-md bg-muted/30 px-2.5 py-1.5">
                      <FileBadge size={12} className="text-muted-foreground shrink-0" />
                      <span className="font-medium text-foreground">{d.DocumentType}</span>
                      <span className="text-muted-foreground truncate">— {d.FileName}</span>
                      {d.IsVerified && <CheckCircle2 size={11} className="text-green-600 shrink-0 ml-auto" />}
                    </div>
                  ))}
                </div>
              )}
              {(!hasIdentityProof || !hasAddressProof) && (
                <p className="mt-2 text-xs text-amber-700 flex items-center gap-1.5">
                  <AlertTriangle size={12} className="shrink-0" />
                  Missing: {[!hasIdentityProof && "Identity Proof", !hasAddressProof && "Address Proof"].filter(Boolean).join(", ")}
                </p>
              )}
            </div>
          </Section>

          {/* ── 6. Brokerage Terms ── */}
          <Section title="Brokerage" icon={Users2} itemKey="BrokerageTerms">
            {brokerageRows.length > 0 ? (
              brokerageRows.map((r: any) => (
                <Field key={r.Id} label={r.BrokerName} value={`${r.RateType === "Percentage" ? `${r.RateValue}%` : fmtInr(r.RateValue)} · ${fmtInr(r.ComputedAmount)} (${r.TrancheLabel || "Full"})`} />
              ))
            ) : (
              <div className="col-span-2 sm:col-span-3">
                <p className="text-sm text-muted-foreground">Direct — no broker on this booking.</p>
              </div>
            )}
          </Section>

          {/* ── 7. Company Requirements ── */}
          <Section title="Other Company Requirements" icon={ShieldCheck} itemKey="CompanyRequirements">
            <Field label="Assigned To" value={b.AssigneeName} />
            <Field label="Booking Date" value={b.BookingDate ? String(b.BookingDate).slice(0, 10) : "—"} />
            <Field label="Company" value={b.CompanyName} />
          </Section>

          {allChecked && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-700 flex items-center gap-2">
              <CheckCircle2 size={16} className="shrink-0" />
              All items verified — this booking is ready for the admin's final Approve action.
            </div>
          )}
        </div>
      )}
    </SalesAutoShell>
  );
}

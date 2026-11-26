// One refund — the web's refund record (src/pages/CRM/CrmRefunds.tsx RefundRecord) with every key it has: where it
// stands and the one step that moves it on; Submit (Draft / Rejected); Approve / Reject (CRM approver, crm-refunds);
// Raise Payout Voucher / Send Back to CRM (Finance approver, crm-refunds-finance); Edit Details (and Correct and Send
// Again); Withdraw; Payout Returned. The same routes (crmRefunds.js), dialogs, checks and messages.
// Endpoint: GET /api/crm/refunds/:id
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRoute, useNavigation, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { crmGet, crmSend, type Row } from "@/api/crmApi";
import { useAuth } from "@/auth/AuthContext";
import { OptionPickerModal, PickerRow } from "@/components/OptionPicker";
import { toast } from "@/components/Toast";
import { fonts } from "@/theme/fonts";
import { useBrand } from "@/theme/ThemeContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { ActionKey, Kv, Pill, Section, fmtDate, money } from "./ui";

const API = "/api/crm/refunds";
const STATUS_LABEL: Record<string, string> = {
  Draft: "Not sent yet", Pending: "Awaiting CRM approval", Approved: "Voucher not raised", FinancePending: "Voucher not raised", FinanceApproved: "With Finance",
};
const SOURCE_LABEL: Record<string, string> = { CancellationHeldCredit: "Cancelled booking", OverpaymentOnAccount: "Overpayment", Manual: "Manual" };
const EDITABLE = ["Draft", "Pending", "Rejected"];
const VOUCHER_NOT_RAISED = ["Approved", "FinancePending"];
const cleanNote = (n?: string | null) => String(n || "").replace(/^\[[^\]]*\]\s*/, "");
const bankLabel = (b: Row) => `${b.BName}${b.BBranch ? ` · ${b.BBranch}` : ""}${b.BAccountLast4 ? ` (••${b.BAccountLast4})` : ""}`;
const canAct = (module: string, id: number) => crmGet<{ canAct: boolean }>(`/api/approval-workflows/can-act?module=${module}&recordId=${id}`).then((d) => !!d.canAct).catch(() => false);

/** A bottom sheet with a title, a line under it, the body, and its two keys (the web's GridDialog). */
function Sheet({ open, title, sub, children, cancel, confirm, onConfirm, onClose, disabled, danger, busy }: {
  open: boolean; title: string; sub?: string; children?: ReactNode; cancel: string; confirm: string; onConfirm: () => void; onClose: () => void; disabled?: boolean; danger?: boolean; busy?: boolean;
}) {
  const b = useBrand();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={onClose} />
      <View style={{ maxHeight: "88%", backgroundColor: b.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: insets.bottom + 16 }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }} keyboardShouldPersistTaps="handled">
          <Text style={{ fontSize: 18, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{title}</Text>
          {sub ? <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>{sub}</Text> : null}
          {children}
        </ScrollView>
        <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 20 }}>
          <ActionKey outline label={cancel} onPress={onClose} />
          <ActionKey label={busy ? "…" : confirm} tone={danger ? b.danger : undefined} onPress={() => { if (!disabled && !busy) onConfirm(); }} />
        </View>
      </View>
    </Modal>
  );
}

function Field({ label, hint, required, value, onChange, multiline, caps }: { label: string; hint?: string; required?: boolean; value: string; onChange: (v: string) => void; multiline?: boolean; caps?: boolean }) {
  const b = useBrand();
  return (
    <View style={{ gap: 5 }}>
      <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textSecondary }}>{label}{required ? " *" : ""}</Text>
      <TextInput value={value} onChangeText={(v) => onChange(caps ? v.toUpperCase() : v)} multiline={multiline} placeholderTextColor={b.textFaint}
        style={{ minHeight: multiline ? 76 : 46, textAlignVertical: multiline ? "top" : "center", borderWidth: 1, borderColor: b.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
          fontSize: 14.5, fontFamily: fonts.body.regular, color: b.textPrimary, backgroundColor: b.surfaceCard }} />
      {hint ? <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.textFaint }}>{hint}</Text> : null}
    </View>
  );
}

/** New Refund — the web's NewRefundDialog: a held credit or overpayment, paid back (POST /api/crm/refunds) or moved
 * onto the same customer's other booking (POST /rebooking-transfer); its checks, its estimate, its messages. */
export function NewRefundScreen() {
  const b = useBrand();
  const qc = useQueryClient();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<"refund" | "rebook">("refund");
  const [picked, setPicked] = useState<Row | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [bankLHeadId, setBankLHeadId] = useState("");
  const [paymentMode, setPaymentMode] = useState("");
  const [acct, setAcct] = useState({ name: "", acc: "", ifsc: "" });
  const [toBookingId, setToBookingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [pick, setPick] = useState<null | "source" | "mode" | "bank" | "account" | "target">(null);
  const payModes = useQuery({ queryKey: ["crm-refund-pay-modes"], staleTime: 60 * 60_000, queryFn: () => crmGet<{ modes: string[]; transfer: string[] }>(`${API}/payment-modes`) }).data;
  const sourcesQ = useQuery({ queryKey: ["crm-refund-eligible-sources"], queryFn: () => crmGet<Row[]>(`${API}/eligible-sources`).then((d) => (Array.isArray(d) ? d : [])) });
  const offered = sourcesQ.data ?? [];
  const banks = useQuery({ queryKey: ["crm-refund-project-banks", picked?.ProjectId], enabled: picked?.ProjectId != null,
    queryFn: () => crmGet<Row[]>(`/api/crm/project-banks/for-project/${picked!.ProjectId}?excludeCash=1`).catch(() => []) }).data ?? [];
  const bookings = useQuery({ queryKey: ["crm-bookings-all"], enabled: mode === "rebook", staleTime: 5 * 60_000, queryFn: () => crmGet<Row[]>("/api/crm/bookings").catch(() => []) }).data ?? [];
  const saved = useQuery({ queryKey: ["crm-refund-customer-banks", picked?.BookingId], enabled: picked?.BookingId != null,
    queryFn: () => crmGet<Row | Row[]>(`/api/crm/customer-bank-details/booking/${picked!.BookingId}`).then((d) => (Array.isArray(d) ? d : d && (d.BankName || d.AccountNo) ? [d] : [])).catch(() => []) }).data ?? [];

  const remaining = picked ? Number(picked.Remaining) : 0;
  const amt = Number(amount) || 0;
  const dedPct = picked?.SourceType === "CancellationHeldCredit" ? Number(picked.DeductionPercent || 0) : 0;
  const deduction = mode === "refund" ? Math.round(((amt * dedPct) / 100) * 100) / 100 : 0;
  const net = Math.max(0, amt - deduction);
  const CLOSED = ["Cancelled", "Transferred", "Rejected", "Expired", "Withdrawn"];
  const targets = bookings.filter((x) => picked && x.IsActive !== false && String(x.CustomerId ?? "") === String(picked.CustomerId ?? "") && !CLOSED.includes(x.Status));
  const target = targets.find((x) => String(x.Id) === toBookingId);
  const tTotal = Number(target?.GrandTotal ?? target?.TotalValue ?? 0);
  const tCleared = Number(target?.TotalCleared || 0) + Number(target?.ApprovedOnAccount || 0);
  const tBefore = Math.max(0, tTotal - tCleared);
  const tAfter = Math.max(0, tBefore - amt);
  const excess = Math.max(0, amt - tBefore);
  const canRebook = picked?.SourceType === "CancellationHeldCredit";
  const transfer = !!payModes?.transfer.includes(paymentMode);
  const choose = (x: Row | null) => {
    setPicked(x); setAmount(x ? String(Number(x.Remaining)) : ""); setBankLHeadId(""); setAcct({ name: "", acc: "", ifsc: "" });
    if (x?.SourceType !== "CancellationHeldCredit") setMode("refund");
  };

  const submit = async () => {
    if (!picked) { toast.error("Pick a held credit or overpayment."); return; }
    if (amt <= 0) { toast.error("Enter the amount."); return; }
    if (amt > remaining + 0.005) { toast.error(`At most ${money(remaining)} is available from this source.`); return; }
    setSaving(true);
    try {
      if (mode === "rebook") {
        if (!toBookingId) throw new Error("Pick the booking the credit goes to.");
        const d = await crmSend<Row>(`${API}/rebooking-transfer`, "POST", { heldOnAccountId: picked.OnAccountId, toBookingId: Number(toBookingId), amount: amt });
        if (d.partialFailure && d.fundTransferId) toast.error(d.message || "The fund transfer is a draft: submit it when ready");
        else if (d.partialFailure) toast.error(d.message || "Credit applied, but the accounting follow-up is incomplete");
        else toast.success(d.crossCompany ? `Inter-company transfer ${d.fundTransferDocNo || ""} raised: the credit lands once Finance approves it` : "Held credit applied to the booking");
        ["crm", "crm-refund-eligible-sources"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
        nav.goBack();
      } else {
        const d = await crmSend<Row>(API, "POST", { GrossAmount: amt, Reason: reason || null, RefundBankLHeadId: bankLHeadId || null, CustomerBankName: acct.name || null,
          CustomerAccountNo: acct.acc || null, CustomerIfscCode: acct.ifsc || null, PreferredPaymentMode: paymentMode || null, SourceType: picked.SourceType, SourceOnAccountId: picked.OnAccountId });
        toast.success(`${d.RefundNo} raised: net ${money(d.NetAmount)}${d.DeductionAmount ? `, deduction ${money(d.DeductionAmount)}` : ""}`);
        ["crm", "crm-refund-eligible-sources"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
        const id = d.Id ?? d.id;
        if (id) nav.replace("CrmRefund", { refundId: Number(id), title: d.RefundNo || "Refund" }); else nav.goBack();
      }
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  const head = (t: string) => <Text style={{ fontSize: 16, fontFamily: fonts.heading.semibold, color: b.textPrimary, marginTop: 8 }}>{t}</Text>;
  const hint = (t: string) => <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.textFaint }}>{t}</Text>;
  const sourceLabel = (x: Row) => `${SOURCE_LABEL[x.SourceType]} · ${x.CustomerName} · ${x.BookingNo}${x.CancellationNo ? ` (${x.CancellationNo})` : ""} · ${money(x.Remaining)} left`;

  return (
    <View style={{ flex: 1, backgroundColor: b.surface }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: b.textSecondary }}>Pays back a cancelled booking's held credit or an overpayment, or moves held credit onto the customer's new booking.</Text>
        {head("Source of funds")}
        <PickerRow label="Held credit or overpayment" required value={picked ? sourceLabel(picked) : ""} placeholder={sourcesQ.isLoading ? "Loading…" : "Select a held credit or overpayment…"} onPress={() => setPick("source")} />
        {sourcesQ.isError ? hint((sourcesQ.error as Error).message) : !sourcesQ.isLoading && !offered.length ? hint("No held credit or unapplied overpayment right now: a refund can only be raised against one.") : null}
        {canRebook ? (
          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textSecondary }}>What to do with it</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {([["refund", "Refund to the customer"], ["rebook", "Apply to a re-booking"]] as const).map(([k, l]) => (
                <ActionKey key={k} outline={mode !== k} label={l} onPress={() => setMode(k)} />
              ))}
            </View>
          </View>
        ) : null}

        {head("Amount")}
        <Field label={mode === "rebook" ? "Credit to move *" : "Gross amount *"} value={amount} onChange={setAmount} hint={picked ? `${money(remaining)} available` : undefined} />
        {picked ? <View style={{ flexDirection: "row" }}><ActionKey outline label="Use All" onPress={() => setAmount(String(remaining))} /></View> : null}
        {mode === "refund" ? (
          <>
            <Kv label="Net to the customer" value={money(net)} strong />
            {hint(dedPct ? `${dedPct}% cancellation deduction: ${money(deduction)}` : "No deduction")}
          </>
        ) : null}

        {mode === "rebook" ? (
          <>
            {head("Apply to booking")}
            <PickerRow label="Booking (same customer)" required value={target ? `${target.BookingNo} · ${target.ProjectName || target.UnitNo || ""}` : ""} placeholder="Select the booking…" onPress={() => setPick("target")} />
            {hint("For another company, this records an inter-company transfer for Finance approval. Your team moves the money outside the ERP; no bank transfer is initiated here. The request stays pending until Finance confirms it.")}
            {target ? (
              <View style={{ borderWidth: 1, borderColor: b.border, borderRadius: 12, padding: 12, gap: 2 }}>
                <Kv label="Destination booking total" value={money(tTotal)} />
                <Kv label="Cleared plus available account credit" value={money(tCleared)} />
                <Kv label="Estimated balance before carry" value={money(tBefore)} />
                <Kv label="Credit amount selected" value={money(amt)} />
                <Kv label="Estimated balance after carry" value={money(tAfter)} />
                {excess > 0.009 ? <Kv label="Excess stays as destination account credit" value={money(excess)} tone={b.warning} /> : null}
                <Text style={{ fontSize: 11.5, color: b.textSecondary, marginTop: 4 }}>Finance-pending receipts are excluded. The carry creates destination on-account credit; it does not automatically apply that credit to milestones or refund any excess. Lower the amount if you want the unused source balance to remain available for a separate refund decision.</Text>
              </View>
            ) : null}
          </>
        ) : (
          <>
            {head("Payout")}
            <PickerRow label="Payment mode" value={paymentMode} placeholder="Not set yet" onPress={() => setPick("mode")} />
            {hint("Finance can set it later.")}
            <PickerRow label="Paid from (company bank)" value={banks.find((x) => String(x.BId) === bankLHeadId) ? bankLabel(banks.find((x) => String(x.BId) === bankLHeadId)!) : ""} placeholder="Finance picks it" onPress={() => setPick("bank")} />
            {hint("Finance picks it otherwise.")}
            {saved.length ? <PickerRow label={`Customer's account${transfer ? " *" : ""}`} value={acct.acc ? `${acct.name || "—"} · A/c ••${acct.acc.slice(-4)}` : ""} placeholder="Select the customer's bank account…" onPress={() => setPick("account")} /> : null}
            <Field label="Customer's bank" value={acct.name} onChange={(v) => setAcct((a) => ({ ...a, name: v }))} />
            <Field label="Account no." required={transfer} value={acct.acc} onChange={(v) => setAcct((a) => ({ ...a, acc: v }))} />
            <Field label="IFSC" caps value={acct.ifsc} onChange={(v) => setAcct((a) => ({ ...a, ifsc: v }))}
              hint={transfer ? "Needed: the payout is a bank transfer." : "Needed only for an NEFT, RTGS, IMPS or UPI refund; a cheque needs none."} />
            <Field label="Reason" value={reason} onChange={setReason} hint="Why this refund is raised" />
          </>
        )}
      </ScrollView>
      <View style={{ flexDirection: "row", gap: 10, padding: 12, paddingBottom: insets.bottom + 12, borderTopWidth: 1, borderTopColor: b.border }}>
        <ActionKey outline label="Cancel" onPress={() => nav.goBack()} />
        <ActionKey label={saving ? "Saving…" : mode === "rebook" ? "Apply Credit" : "Raise Refund"} onPress={() => { if (!saving && picked) void submit(); }} />
      </View>

      <OptionPickerModal visible={!!pick} title={pick === "source" ? "Held credit or overpayment" : pick === "target" ? "Booking (same customer)" : pick === "bank" ? "Company bank" : pick === "account" ? "Customer's account" : "Payment mode"}
        options={pick === "source" ? offered.map((x) => ({ key: String(x.OnAccountId), label: `${SOURCE_LABEL[x.SourceType]} · ${x.CustomerName}`, sublabel: `${x.BookingNo}${x.CancellationNo ? ` (${x.CancellationNo})` : ""} · ${money(x.Remaining)} left` }))
          : pick === "target" ? targets.map((x) => ({ key: String(x.Id), label: x.BookingNo, sublabel: `${x.ProjectName || x.UnitNo || ""} · ${x.CompanyId === picked?.CompanyId ? "same company" : "another company"}` }))
          : pick === "bank" ? [{ key: "", label: "Finance picks it" }, ...banks.map((x) => ({ key: String(x.BId), label: bankLabel(x), sublabel: x.BIfscCode ? `IFSC ${x.BIfscCode}` : undefined }))]
          : pick === "account" ? saved.map((x, i) => ({ key: String(i), label: `${x.BankName || "—"}${x.BranchName ? ` · ${x.BranchName}` : ""}`, sublabel: `A/c ${x.AccountNo ? `••${String(x.AccountNo).slice(-4)}` : "—"}${x.IfscCode ? ` · ${x.IfscCode}` : ""}` }))
          : [{ key: "", label: "Not set yet" }, ...(payModes?.modes ?? []).map((m) => ({ key: m, label: m }))]}
        searchable={pick === "source" || pick === "target"}
        selectedKey={pick === "source" ? (picked ? String(picked.OnAccountId) : null) : pick === "target" ? toBookingId : pick === "bank" ? bankLHeadId : pick === "mode" ? paymentMode : null}
        onSelect={(k) => {
          if (pick === "source") choose(offered.find((x) => String(x.OnAccountId) === k) ?? null);
          else if (pick === "target") setToBookingId(k ?? "");
          else if (pick === "bank") setBankLHeadId(k ?? "");
          else if (pick === "mode") setPaymentMode(k ?? "");
          else if (pick === "account") { const x = saved[Number(k)]; if (x) setAcct({ name: x.BankName || "", acc: x.AccountNo || "", ifsc: x.IfscCode || "" }); }
          setPick(null);
        }}
        onClose={() => setPick(null)} />
    </View>
  );
}

export default function CrmRefundScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmRefund">>();
  const { refundId } = params;
  const b = useBrand();
  const qc = useQueryClient();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { canAccessPage, canDoAction } = useAuth();
  const canEdit = canDoAction("crm-refunds", "edit");

  const q = useQuery<Row>({ queryKey: ["crm-refund", refundId], queryFn: () => crmGet(`${API}/${refundId}`) });
  const r = q.data;
  const notesQ = useQuery({ queryKey: ["crm-refund-notes", refundId], enabled: r?.Status === "Paid", queryFn: () => crmGet<Row[]>(`${API}/${refundId}/gst-notes`).catch(() => []) });
  const crmApprover = useQuery({ queryKey: ["can-act", "crm-refunds", refundId], enabled: r?.Status === "Pending", queryFn: () => canAct("crm-refunds", refundId) });
  const financeCan = useQuery({ queryKey: ["can-act", "crm-refunds-finance", refundId], enabled: !!r && VOUCHER_NOT_RAISED.includes(r.Status), queryFn: () => canAct("crm-refunds-finance", refundId) }).data;
  const payModes = useQuery({ queryKey: ["crm-refund-pay-modes"], staleTime: 60 * 60_000, queryFn: () => crmGet<{ modes: string[]; transfer: string[] }>(`${API}/payment-modes`) }).data;

  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<null | "reject" | "withdraw" | "returned" | "sendback" | "finance" | "edit" | "resend">(null);
  const [text, setText] = useState("");
  const [financeBank, setFinanceBank] = useState("");
  const [financeMode, setFinanceMode] = useState("");
  const [edit, setEdit] = useState({ mode: "", bank: "", name: "", acc: "", ifsc: "", reason: "" });
  const [pick, setPick] = useState<null | "financeBank" | "financeMode" | "editMode" | "editBank" | "account">(null);
  const banksQ = useQuery({ queryKey: ["crm-refund-project-banks", r?.ProjectId], enabled: r?.ProjectId != null && (sheet === "finance" || sheet === "edit" || sheet === "resend"),
    queryFn: () => crmGet<Row[]>(`/api/crm/project-banks/for-project/${r!.ProjectId}?excludeCash=1`).catch(() => []) });
  const savedQ = useQuery({ queryKey: ["crm-refund-customer-banks", r?.BookingId], enabled: r?.BookingId != null && (sheet === "edit" || sheet === "resend"),
    queryFn: () => crmGet<Row | Row[]>(`/api/crm/customer-bank-details/booking/${r!.BookingId}`).then((d) => (Array.isArray(d) ? d : d && (d.BankName || d.AccountNo) ? [d] : [])).catch(() => []) });
  const banks = banksQ.data ?? [];
  const saved = savedQ.data ?? [];

  const refresh = () => ["crm-refund", "crm", "crm-refund-notes"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const run = async (work: () => Promise<Row>, done: (d: Row) => string) => {
    setBusy(true);
    try { const d = await work(); toast.success(done(d)); refresh(); setSheet(null); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  const put = (path: string, body?: object) => crmSend<Row>(`${API}/${refundId}${path}`, "PUT", body ?? {});

  if (q.isLoading) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: b.surface }}><ActivityIndicator color={b.accent} /></View>;
  if (q.error || !r) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: b.surface, padding: 24 }}>
        <Text style={{ color: b.danger, fontFamily: fonts.body.medium, textAlign: "center" }}>{q.error ? (q.error as Error).message : "Refund not found"}</Text>
      </View>
    );
  }

  const editable = canEdit && EDITABLE.includes(r.Status);
  const note = cleanNote(r.RejectionNote);
  const fromFinance = /^\[Finance\]/.test(r.RejectionNote || "");
  const openEdit = (thenSubmit: boolean) => {
    setEdit({ mode: r.PreferredPaymentMode || "", bank: r.RefundBankLHeadId != null ? String(r.RefundBankLHeadId) : "", name: r.CustomerBankName || "", acc: r.CustomerAccountNo || "", ifsc: r.CustomerIfscCode || "", reason: r.Reason || "" });
    setSheet(thenSubmit ? "resend" : "edit");
  };
  const openFinance = () => { setFinanceBank(r.RefundBankLHeadId != null ? String(r.RefundBankLHeadId) : ""); setFinanceMode(r.PreferredPaymentMode || ""); setSheet("finance"); };
  const ask = (s: "reject" | "withdraw" | "returned" | "sendback") => { setText(""); setSheet(s); };

  // Where it stands, and the one step that moves it on (the web's).
  let next = ""; let action: { label: string; run: () => void } | null = null; let finished = false;
  if (r.Status === "Paid") { next = `Paid on ${fmtDate(r.PaidAt)}${r.PreferredPaymentMode ? ` by ${r.PreferredPaymentMode}` : ""}.`; finished = true; }
  else if (r.Status === "Withdrawn") { next = `Withdrawn${note ? `: ${note}` : ""}. Nothing was paid, and the money it claimed is free for a new refund or a re-booking.`; finished = true; }
  else if (r.NeedsAccount && EDITABLE.includes(r.Status)) { next = `A ${r.PreferredPaymentMode} refund needs the customer's bank account: add it, or change the mode to cheque`; action = editable ? { label: "Add Customer's Account", run: () => openEdit(false) } : null; }
  else if (r.Status === "Draft") { next = "Not sent for approval yet. No money has moved"; action = canEdit ? { label: "Send for Approval", run: () => run(() => put("/submit"), () => `${r.RefundNo} sent for approval`) } : null; }
  else if (r.Status === "Pending") { next = fromFinance ? `Finance sent it back: ${note}. Correct it if needed; the CRM approver approves it again` : "Waiting for CRM approval. No money has moved"; }
  else if (r.Status === "Rejected") { next = `Rejected${note ? `: ${note}` : ""}. Correct it, then send it again`; action = editable ? { label: "Correct and Send Again", run: () => openEdit(true) } : null; }
  else if (VOUCHER_NOT_RAISED.includes(r.Status)) {
    const returned = /^\[Payout returned\]/.test(r.RejectionNote || "");
    next = returned ? `The payout came back: ${note}. Finance raises a new payout voucher.` : note ? `Approved, but the payout voucher wasn't raised: ${note}` : "Approved: Finance raises the payout voucher";
    action = financeCan ? { label: "Raise Payout Voucher", run: openFinance } : null;
    if (!financeCan && !returned) next += " (Approval Setup: CRM Refunds Finance)";
  } else if (r.Status === "FinanceApproved") { next = "The payout voucher is with Finance in Payments. It is marked Paid once Finance approves the voucher"; }

  const trail = [
    { step: "Raised", by: r.RequestedByName, at: r.RequestedAt || r.CreatedAt },
    { step: "CRM approved", by: r.ApprovedByName, at: r.ApprovedAt },
    { step: "Payout voucher raised", by: r.FinanceClearedByName, at: r.FinanceClearedAt },
    { step: "Paid", by: null, at: r.PaidAt },
  ].filter((t) => t.at);
  const transfer = !!payModes?.transfer.includes(edit.mode);
  const sub = `${r.RefundNo} · ${r.CustomerName} · net ${money(r.NetAmount)}`;

  const saveEdit = async (thenSubmit: boolean) => {
    if (transfer && !edit.acc.trim()) { toast.error(`A ${edit.mode} refund needs the customer's account number, or choose Cheque.`); return; }
    setBusy(true);
    try {
      await put("", { Reason: edit.reason || null, PreferredPaymentMode: edit.mode, RefundBankLHeadId: edit.bank || null,
        CustomerBankName: edit.name || null, CustomerAccountNo: edit.acc || null, CustomerIfscCode: edit.ifsc || null });
      if (thenSubmit) {
        try { await put("/submit"); toast.success("Corrected and sent for approval"); }
        catch (e) { toast.error(`Saved, but not sent: ${(e as Error).message}`); }
      } else toast.success("Details saved");
      refresh(); setSheet(null);
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const figure = (label: string, value: string, noteText: string, alert?: boolean) => (
    <View style={{ flexGrow: 1, flexBasis: "45%", borderRadius: 14, padding: 12, backgroundColor: b.surfaceCard, borderWidth: 1, borderColor: alert ? `${b.danger}66` : b.border }}>
      <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: b.textSecondary }}>{label}</Text>
      <Text style={{ fontSize: 16, fontFamily: fonts.heading.semibold, color: alert ? b.danger : b.textPrimary, marginTop: 3 }}>{value}</Text>
      <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: alert ? b.danger : b.textFaint, marginTop: 2 }}>{noteText}</Text>
    </View>
  );

  return (
    <>
      <ScrollView style={{ flex: 1, backgroundColor: b.surface }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 56 }}>
        {/* Band */}
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: b.textSecondary }}>Refund · {r.RefundNo}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Text style={{ fontSize: 22, fontFamily: fonts.heading.semibold, color: b.textPrimary, textTransform: "capitalize" }}>{String(r.CustomerName || "").toLowerCase()}</Text>
            <Pill label={STATUS_LABEL[r.Status] || r.Status} />
          </View>
          <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>{[r.BookingNo, r.UnitNo, r.ProjectName, r.Mobile].filter(Boolean).join(" · ")}</Text>
          <Text style={{ fontSize: 28, fontFamily: fonts.heading.bold, color: b.textPrimary, marginTop: 6 }}>{money(r.NetAmount)}</Text>
          <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>
            {Number(r.DeductionAmount) > 0 ? `net payout · ${money(r.GrossAmount)} less ${r.DeductionPercent}%` : "net payout"}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            {r.BookingId != null && (canAccessPage("crm-bookings") || canAccessPage("crm-payments")) ? (
              <ActionKey half outline label="Open Booking" onPress={() => nav.navigate("CrmBooking", { bookingId: Number(r.BookingId), title: r.BookingNo || "Booking" })} />
            ) : null}
            {r.SourceCancellationId && canAccessPage("crm-cancellations") ? (
              <ActionKey half outline label="Open cancellation" onPress={() => nav.navigate("CrmCancellation", { cancellationId: Number(r.SourceCancellationId), title: r.CancellationNo || "Cancellation" })} />
            ) : null}
            {editable ? <ActionKey half outline label="Edit Details" onPress={() => openEdit(false)} /> : null}
            {editable && r.FinanceNewPaymentId == null ? <ActionKey half outline tone={b.danger} label="Withdraw" onPress={() => ask("withdraw")} /> : null}
            {canEdit && r.Status === "Paid" ? <ActionKey half outline tone={b.danger} label="Payout Returned" onPress={() => ask("returned")} /> : null}
          </View>
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {figure("Gross", money(r.GrossAmount), SOURCE_LABEL[r.SourceType] || r.SourceType)}
          {figure("Deduction", money(r.DeductionAmount), Number(r.DeductionAmount) > 0 ? `${r.DeductionPercent}% kept` : "None")}
          {figure("Paid by", r.PreferredPaymentMode || "Not set",
            r.NeedsAccount ? "Customer's account missing" : r.CustomerAccountNo ? `To A/c ••${String(r.CustomerAccountNo).slice(-4)}` : r.PreferredPaymentMode ? "No account needed" : "Finance chooses the mode", !!r.NeedsAccount)}
          {figure("RERA due", r.RefundDueDate ? fmtDate(r.RefundDueDate) : "—",
            r.Status === "Paid" || !r.RefundDueDate ? "No date running" : r.IsOverdue ? `${Math.abs(r.DaysRemaining)} days overdue` : `${r.DaysRemaining} days left`, !!r.IsOverdue)}
        </View>

        {/* Next */}
        <View style={{ borderRadius: 14, padding: 14, gap: 10, backgroundColor: finished ? b.successSoft : b.accentSoft }}>
          <Text style={{ fontSize: 13.5, fontFamily: fonts.body.medium, color: b.textPrimary }}>{next}</Text>
          {action ? <View style={{ flexDirection: "row" }}><ActionKey label={busy ? "…" : action.label} onPress={action.run} /></View> : null}
        </View>

        {/* Approval */}
        <Section title="Approval">
          {["Draft", "Rejected"].includes(r.Status) && canEdit ? (
            <View style={{ gap: 6, marginBottom: 8 }}>
              <View style={{ flexDirection: "row" }}><ActionKey label={busy ? "…" : "Submit"} onPress={() => run(() => put("/submit"), () => "Submitted for approval")} /></View>
              <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.textSecondary }}>
                {r.Status === "Rejected" ? "Correct the details first if needed (Edit Details)." : "Goes to the CRM approver set in Approval Setup (CRM Refunds)."}
              </Text>
            </View>
          ) : null}
          {r.Status === "Pending" ? (
            <View style={{ gap: 6, marginBottom: 8 }}>
              {crmApprover.data ? (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <ActionKey label={busy ? "…" : "Approve"} tone={b.success} onPress={() => run(() => put("/approve"), (d) => (d?.newStatus && d.newStatus !== "Approved" ? d.message || `Level ${d.level} of ${d.totalLevels} approved — awaiting further approval` : "Record approved"))} />
                  <ActionKey label="Reject" tone={b.danger} onPress={() => ask("reject")} />
                </View>
              ) : null}
              <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.textSecondary }}>Who approves is set in Approval Setup (CRM Refunds). Approving raises the payout voucher for Finance.</Text>
            </View>
          ) : null}
          {VOUCHER_NOT_RAISED.includes(r.Status) && financeCan ? (
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
              <ActionKey label="Raise Payout Voucher" onPress={openFinance} />
              <ActionKey outline tone={b.danger} label="Send Back to CRM" onPress={() => ask("sendback")} />
            </View>
          ) : null}
          {r.Status === "Withdrawn" ? <Kv label="Withdrawn" value={note || "No reason recorded"} /> : null}
          {r.Status === "Draft" ? <Text style={{ fontSize: 12, color: b.textSecondary }}>Not sent for approval yet.</Text> : null}
        </Section>

        <Section title="Amount and source">
          <Kv label="Comes from" value={SOURCE_LABEL[r.SourceType] || r.SourceType} />
          {r.CancellationNo ? <Kv label="Cancellation" value={r.CancellationNo} /> : null}
          {r.BookingNo ? <Kv label="Booking" value={r.BookingNo} /> : null}
          {r.CustomerNo ? <Kv label="Customer no" value={r.CustomerNo} /> : null}
          <Kv label="Gross" value={money(r.GrossAmount)} />
          {Number(r.DeductionAmount) > 0 ? <Kv label="Deduction" value={`${money(r.DeductionAmount)} (${r.DeductionPercent}%)`} /> : null}
          <Kv label="Net payout" value={money(r.NetAmount)} strong />
          {r.Reason ? <Kv label="Reason" value={r.Reason} /> : null}
        </Section>

        <Section title="Payout" right={editable ? <ActionKey outline label="Edit Details" onPress={() => openEdit(false)} /> : undefined}>
          <Kv label="Payment mode" value={r.PreferredPaymentMode || "Not set: Finance chooses"} />
          {r.CustomerBankName ? <Kv label="Customer's bank" value={r.CustomerBankName} /> : null}
          {r.CustomerAccountNo ? <Kv label="Customer's account" value={r.CustomerAccountNo} />
            : r.NeedsAccount ? <Kv label="Customer's account" value={`Missing: needed for ${r.PreferredPaymentMode}`} tone={b.danger} /> : null}
          {r.CustomerIfscCode ? <Kv label="IFSC" value={r.CustomerIfscCode} /> : null}
          {r.RefundBankName ? <Kv label="Paid from" value={r.RefundBankName} /> : null}
          {r.PaidAt ? <Kv label="Paid on" value={fmtDate(r.PaidAt)} /> : null}
        </Section>

        {r.Status === "Paid" ? (
          <Section title={`GST documents (${(notesQ.data ?? []).length})`}>
            {(notesQ.data ?? []).length === 0 ? <Text style={{ fontSize: 12.5, color: b.textSecondary }}>None: this booking charged no GST on the amount refunded.</Text>
              : (notesQ.data ?? []).map((n) => (
                <View key={n.Id} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: b.border, gap: 2 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                    <Text style={{ fontSize: 13.5, fontFamily: fonts.body.medium, color: b.textPrimary }}>{n.DocNo || "Certificate"} · {n.DocType === "RefundVoucher" ? "Refund voucher" : "Credit note"}</Text>
                    <Pill label={n.Status === "TimeBarred" ? "Time-barred" : n.Status} />
                  </View>
                  <Text style={{ fontSize: 12, color: b.textSecondary }}>{[n.AgainstRef || "—", fmtDate(n.DocDate), `GST ${money(n.GstAmount)}`, money(n.TotalAmount)].join(" · ")}</Text>
                </View>
              ))}
          </Section>
        ) : null}

        <Section title="History">
          {trail.length === 0 ? <Text style={{ fontSize: 12.5, color: b.textSecondary }}>No steps recorded.</Text> : trail.map((t) => (
            <Kv key={t.step} label={t.step} value={`${t.by || "—"} · ${fmtDate(t.at)}`} />
          ))}
        </Section>
      </ScrollView>

      {/* The web's dialogs */}
      <Sheet open={sheet === "reject"} title="Reject Record" cancel="Cancel" confirm="Confirm Rejection" danger busy={busy} onClose={() => setSheet(null)}
        onConfirm={() => run(() => put("/reject", { note: text, Remarks: text }), () => "Record rejected")}>
        <Field label="Reason for rejection (optional but recommended)" value={text} onChange={setText} multiline />
      </Sheet>
      <Sheet open={sheet === "withdraw"} title="Withdraw Refund" sub={sub} cancel="Keep It" confirm={busy ? "Withdrawing…" : "Withdraw Refund"} danger busy={busy} disabled={!text.trim()}
        onClose={() => setSheet(null)} onConfirm={() => run(() => put("/withdraw", { reason: text.trim() }), () => `${r.RefundNo} withdrawn: its money is free again`)}>
        <Text style={{ fontSize: 13, color: b.textSecondary }}>The refund stays on record as Withdrawn and can't be sent or approved again. Nothing has been paid; the money it claims becomes free for a new refund or a re-booking.</Text>
        <Field label="Why it is withdrawn" required hint="Kept with the refund and in its approval history." value={text} onChange={setText} multiline />
      </Sheet>
      <Sheet open={sheet === "returned"} title="Payout Returned" sub={sub} cancel="Keep It" confirm={busy ? "Saving…" : "Mark Payout Returned"} danger busy={busy} disabled={!text.trim()}
        onClose={() => setSheet(null)} onConfirm={() => run(() => put("/payout-returned", { reason: text.trim() }), () => "Payout Returned")}>
        <Text style={{ fontSize: 13, color: b.textSecondary }}>Use this when the bank transfer came back or the payout was approved by mistake. The payout voucher is cancelled and its ledger reversed; the refund goes back to Finance to pay again, and the customer's credit is restored.</Text>
        <Field label="What happened" required value={text} onChange={setText} multiline />
      </Sheet>
      <Sheet open={sheet === "sendback"} title="Send Back to CRM" sub={`${r.RefundNo} · ${r.CustomerName} · no payout voucher is raised`} cancel="Cancel" confirm={busy ? "Sending…" : "Send Back"} busy={busy} disabled={!text.trim()}
        onClose={() => setSheet(null)} onConfirm={() => run(() => put("/finance-reject", { note: text.trim() }), () => "Sent back to CRM")}>
        <Field label="What needs fixing" required hint="CRM sees this and can correct the refund; the CRM approver then approves it again." value={text} onChange={setText} multiline />
      </Sheet>
      <Sheet open={sheet === "finance"} title="Raise Payout Voucher" sub="Raises the payout voucher in Finance → Payments; the refund is marked Paid once Finance approves that voucher."
        cancel="Cancel" confirm={busy ? "Raising…" : "Raise Payout Voucher"} busy={busy} disabled={!financeBank} onClose={() => setSheet(null)}
        onConfirm={() => run(() => put("/finance-approve", { RefundBankLHeadId: financeBank || undefined, PaymentMode: financeMode || undefined }), (d) => `Payout voucher ${d.docNo || ""} raised: with Finance in Payments`)}>
        <Kv label="Customer" value={r.CustomerName} />
        <Kv label="Net payout" value={money(r.NetAmount)} strong />
        <Kv label="To" value={[r.CustomerBankName, r.CustomerAccountNo, r.CustomerIfscCode].filter(Boolean).join(" · ") || "No account on file"} />
        <PickerRow label="Paid from (company bank)" required value={banks.find((x) => String(x.BId) === financeBank) ? bankLabel(banks.find((x) => String(x.BId) === financeBank)!) : ""} placeholder="Select…" onPress={() => setPick("financeBank")} />
        <PickerRow label="Payment mode" value={financeMode} placeholder="Set later on the voucher" onPress={() => setPick("financeMode")} />
        <Text style={{ fontSize: 11.5, color: b.textFaint }}>Can be set later on the voucher.</Text>
      </Sheet>
      <Sheet open={sheet === "edit" || sheet === "resend"} title={sheet === "resend" ? "Correct and Send Again" : "Edit Refund Details"} sub={sub}
        cancel="Cancel" confirm={busy ? "Saving…" : sheet === "resend" ? "Save and Send Again" : "Save Details"} busy={busy}
        onClose={() => setSheet(null)} onConfirm={() => saveEdit(sheet === "resend")}>
        {r.Status === "Rejected" && r.RejectionNote ? <Text style={{ fontSize: 13, color: b.danger }}>Rejected: {cleanNote(r.RejectionNote)}</Text> : null}
        <PickerRow label="Payment mode" value={edit.mode} placeholder="Not set yet" onPress={() => setPick("editMode")} />
        <Text style={{ fontSize: 11.5, color: b.textFaint, marginTop: -6 }}>Not set: Finance chooses it on the voucher.</Text>
        <PickerRow label="Paid from (company bank)" value={banks.find((x) => String(x.BId) === edit.bank) ? bankLabel(banks.find((x) => String(x.BId) === edit.bank)!) : ""} placeholder="Finance picks it" onPress={() => setPick("editBank")} />
        {saved.length ? <PickerRow label={`Customer's account${transfer ? " *" : ""}`} value={edit.acc ? `${edit.name || "—"} · A/c ••${edit.acc.slice(-4)}` : ""} placeholder="Select the customer's bank account…" onPress={() => setPick("account")} /> : null}
        <Field label="Customer's bank" value={edit.name} onChange={(v) => setEdit((e) => ({ ...e, name: v }))} />
        <Field label="Account no." required={transfer} value={edit.acc} onChange={(v) => setEdit((e) => ({ ...e, acc: v }))} />
        <Field label="IFSC" caps value={edit.ifsc} onChange={(v) => setEdit((e) => ({ ...e, ifsc: v }))}
          hint={transfer ? "Needed: the payout is a bank transfer." : "Needed only for an NEFT, RTGS, IMPS or UPI refund; a cheque needs none."} />
        <Field label="Reason" value={edit.reason} onChange={(v) => setEdit((e) => ({ ...e, reason: v }))} />
        <Text style={{ fontSize: 12, color: b.textSecondary }}>The amount can't change here. For a different amount, leave this one rejected and raise a new refund: a rejected refund doesn't hold the money.</Text>
      </Sheet>

      <OptionPickerModal visible={!!pick} title={pick === "financeBank" || pick === "editBank" ? "Company bank" : pick === "account" ? "Customer's account" : "Payment mode"}
        options={pick === "financeBank" ? banks.map((x) => ({ key: String(x.BId), label: bankLabel(x), sublabel: x.BIfscCode ? `IFSC ${x.BIfscCode}` : undefined }))
          : pick === "editBank" ? [{ key: "", label: "Finance picks it" }, ...banks.map((x) => ({ key: String(x.BId), label: bankLabel(x), sublabel: x.BIfscCode ? `IFSC ${x.BIfscCode}` : undefined }))]
          : pick === "account" ? saved.map((x, i) => ({ key: String(i), label: `${x.BankName || "—"}${x.BranchName ? ` · ${x.BranchName}` : ""}`, sublabel: `A/c ${x.AccountNo ? `••${String(x.AccountNo).slice(-4)}` : "—"}${x.IfscCode ? ` · ${x.IfscCode}` : ""}` }))
          : [{ key: "", label: pick === "editMode" ? "Not set yet" : "Set later" }, ...(payModes?.modes ?? []).map((m) => ({ key: m, label: m }))]}
        selectedKey={pick === "financeBank" ? financeBank : pick === "editBank" ? edit.bank : pick === "financeMode" ? financeMode : pick === "editMode" ? edit.mode : null}
        onSelect={(k) => {
          if (pick === "financeBank") setFinanceBank(k ?? "");
          else if (pick === "financeMode") setFinanceMode(k ?? "");
          else if (pick === "editMode") setEdit((e) => ({ ...e, mode: k ?? "" }));
          else if (pick === "editBank") setEdit((e) => ({ ...e, bank: k ?? "" }));
          else if (pick === "account") { const x = saved[Number(k)]; if (x) setEdit((e) => ({ ...e, name: x.BankName || "", acc: x.AccountNo || "", ifsc: x.IfscCode || "" })); }
          setPick(null);
        }}
        onClose={() => setPick(null)} />
    </>
  );
}

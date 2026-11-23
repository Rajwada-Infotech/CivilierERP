// One booking on the phone: the buyer (Call / WhatsApp), the money first (price, paid, balance, overdue, on account),
// what can be done here (log a welcome call, take a payment, raise a ticket), the journey from booking to mutation,
// the payment milestones (Pay on the open ones), the booking's papers (money receipts, invoices, documents), its
// service tickets, the buyer and the agreement. Each part comes from the route the web page uses and shows only to
// staff with that page's right.
import { useState } from "react";
import { ActivityIndicator, Modal, RefreshControl, ScrollView, Text, View } from "react-native";
import { RemarksField, TextField } from "@/components/form/Form";
import { DateField } from "@/components/form/DateField";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { fetchWithAuth } from "@/services/fetchWithAuth";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { CheckCircle2, Circle, FileText, Lock, PhoneCall, Ticket, Wallet } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { crmGet, crmSend, getBooking, getBookingLifecycle, getBookingPayments, type Row } from "@/api/crmApi";
import { toast } from "@/components/Toast";
import { getTicketsForBooking } from "@/api/serviceTicketApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { ActionKey, CRM, ContactKeys, Empty, HeroSurface, Kv, LinkRow, ON_HERO, Section, Tap, fmtDate, joinDot, money, Pill, useCardStyle, words } from "./ui";
import { useCrmOpen } from "./CrmRegisterScreen";
import { ApplyOnAccountPrompt, ChangeUnitDialog, GenerateInvoiceDialog, Chips, NotePrompt, milestoneMissing, nextOpenMilestone } from "./CrmForms";

// A booking that no longer takes money here (the web's "closed" plan).
const CLOSED = ["Cancelled", "UnitChanged", "Rejected"];
const kb = (n: unknown) => { const b = Number(n) || 0; return b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b ? `${Math.max(1, Math.round(b / 1024))} KB` : ""; };

const STEP_ICON = { done: CheckCircle2, active: Circle, locked: Lock } as const;
const STEP_TONE: Record<string, string> = { done: "#10b981", active: CRM, locked: colors.mutedForeground };

export default function BookingDetailScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmBooking">>();
  const card = useCardStyle();
  const id = params.bookingId;
  const { canAccessPage, canDoAction } = useAuth();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const open = useCrmOpen();
  const seesBooking = canAccessPage("crm-bookings");
  const seesMoney = canAccessPage("crm-payments");
  const [refreshing, setRefreshing] = useState(false);

  const bookingQ = useQuery({ queryKey: ["crm-booking", id], queryFn: () => getBooking(id), enabled: seesBooking });
  const lifeQ = useQuery({ queryKey: ["crm-booking-life", id], queryFn: () => getBookingLifecycle(id), enabled: seesBooking });
  const payQ = useQuery({ queryKey: ["crm-booking-pay", id], queryFn: () => getBookingPayments(id), enabled: seesMoney });
  // The booking's papers and tickets, each behind the right its route checks.
  const seesReceipts = canAccessPage("crm-money-receipts") || seesMoney;
  const seesInvoices = seesBooking || canAccessPage("crm-invoices");
  const seesTickets = canAccessPage("crm-service-tickets");
  const receiptsQ = useQuery({ queryKey: ["crm-booking-receipts", id], queryFn: () => crmGet<Row[]>(`/api/crm/money-receipts?bookingId=${id}`), enabled: seesReceipts });
  const invoicesQ = useQuery({ queryKey: ["crm-booking-invoices", id], queryFn: () => crmGet<Row[]>(`/api/crm/bookings/${id}/invoices`), enabled: seesInvoices });
  const docsQ = useQuery({ queryKey: ["crm-booking-docs", id], queryFn: () => crmGet<Row[]>(`/api/crm/bookings/${id}/attachments`), enabled: seesBooking });
  const ticketsQ = useQuery({ queryKey: ["crm-booking-tickets", id], queryFn: () => getTicketsForBooking(id), enabled: seesTickets });

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([seesBooking && bookingQ.refetch(), seesBooking && lifeQ.refetch(), seesMoney && payQ.refetch(),
      seesReceipts && receiptsQ.refetch(), seesInvoices && invoicesQ.refetch(), seesBooking && docsQ.refetch(), seesTickets && ticketsQ.refetch()]);
    setRefreshing(false);
  };

  const b = bookingQ.data?.booking;
  const pb = payQ.data?.booking;
  const head = { ...(pb ?? {}), ...(b ?? {}) };
  const customer = bookingQ.data?.customer;
  const milestones = payQ.data?.milestones ?? bookingQ.data?.milestones ?? [];
  const sum = payQ.data?.summary ?? bookingQ.data?.paymentSummary;
  const moneyInfo = payQ.data?.money;
  const overdue = Number(payQ.data?.summary?.overdue) || 0;
  const loading = (seesBooking && bookingQ.isLoading) || (seesMoney && payQ.isLoading);
  const error = (bookingQ.error || payQ.error) as Error | null;
  const status = head.Status || head.BookingStatus;
  const live = !CLOSED.includes(status);
  const price = Number(head.GrandTotal ?? sum?.totalDue) || 0;
  const title = head.BookingNo || params.title || "Booking";
  const canPay = live && canDoAction("crm-payments", "edit");
  // Milestone actions, as the web's booking page (CrmBookingDetail.tsx) and Payment Milestones page offer them.
  const qc = useQueryClient();
  const [busyMs, setBusyMs] = useState<number | null>(null);
  const [waiveFor, setWaiveFor] = useState<Row | null>(null);
  const canEditReceipts = live && canDoAction("crm-money-receipts", "edit");
  const [bounceFor, setBounceFor] = useState<Row | null>(null);
  const [busyRc, setBusyRc] = useState<number | null>(null);
  const receiptAction = async (r: Row, path: "bounce" | "resubmit", body: object | undefined, done: string) => {
    setBusyRc(r.Id);
    try {
      await crmSend(`/api/crm/money-receipts/${r.Id}/${path}`, "PUT", body);
      toast.success(done); setBounceFor(null);
      ["crm-booking-receipts", "crm"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusyRc(null); }
  };
  // Booking approval, as the web's booking page runs it (CrmBookingDetail.tsx): the Data Review checklist and
  // "Verify & Send for Approval" for whoever Approval Setup names as data verifier, then Approve / Send back for
  // whoever may act at the current stage (stageState.CanActOnStage, decided on the server).
  const stageState = bookingQ.data?.stageState;
  const stage: string = b?.WorkflowStage || stageState?.WorkflowStage || "Review";
  const canEditBooking = live && canDoAction("crm-bookings", "edit");
  const inApproval = status === "Pending";
  const verifierQ = useQuery({ queryKey: ["approval-can-act", "crm-booking-verification", ""], enabled: canEditBooking && inApproval && stage === "Review",
    queryFn: () => crmGet<{ canAct: boolean }>(`/api/approval-workflows/can-act?module=crm-booking-verification`) });
  const canVerify = canEditBooking && !!verifierQ.data?.canAct;
  const checklistQ = useQuery({ queryKey: ["crm-booking-checklist", id], enabled: seesBooking && inApproval && stage === "Review",
    queryFn: () => crmGet<{ items: Row[]; allChecked: boolean }>(`/api/crm/bookings/${id}/checklist`) });
  const canActOnStage = inApproval && !!stageState?.CanActOnStage;
  const [busyStage, setBusyStage] = useState<string | null>(null);
  const [flagItem, setFlagItem] = useState<Row | null>(null);
  const [sendBack, setSendBack] = useState(false);
  const sendBackChoices: string[] = Array.isArray(stageState?.SendBackTo) ? stageState.SendBackTo : [];
  const [sendBackTo, setSendBackTo] = useState<string | null>(null);
  const refreshBooking = () => ["crm-booking", "crm-booking-life", "crm-booking-checklist", "crm-booking-receipts", "crm-booking-invoices", "crm", "crm-dashboard", "approvals"]
    .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const stageAction = async (key: string, fn: () => Promise<any>, done: (r: any) => string) => {
    setBusyStage(key);
    try {
      const r = await fn(); toast.success(done(r)); setFlagItem(null); setSendBack(false);
      if (r?.mrWarning) toast.error(`Money Receipt could not be auto-created. (${r.mrWarning})`);
    } catch (e) { toast.error((e as Error).message); }
    finally { refreshBooking(); setBusyStage(null); }
  };
  const checkItem = (it: Row, action: "check" | "uncheck" | "flag" | "resubmit", remarks?: string) =>
    stageAction(it.ItemKey, () => crmSend(`/api/crm/bookings/${id}/checklist/${it.ItemKey}/${action}`, "PUT", action === "check" || action === "flag" ? { remarks } : undefined),
      () => `${it.ItemLabel}: ${action === "check" ? "verified" : action === "uncheck" ? "unticked" : "sent for recheck"}`);
  // Civilier Home access, as the web booking page's Civilier Home tab: set up (once Confirmed), deactivate /
  // reactivate, reset the password back to the first one (crmBookings.js portal routes, crm-portal admin reset).
  const portalQ = useQuery({ queryKey: ["crm-booking-portal", id], enabled: seesBooking,
    queryFn: () => crmGet<Row>(`/api/crm/bookings/${id}/portal-status`) });
  const portal = portalQ.data;
  const [busyPortal, setBusyPortal] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const portalAction = async (fn: () => Promise<any>, done: (r: any) => string) => {
    setBusyPortal(true);
    try { const r = await fn(); toast.success(done(r)); setConfirmReset(false); }
    catch (e) { toast.error((e as Error).message); }
    finally { qc.invalidateQueries({ queryKey: ["crm-booking-portal", id] }); setBusyPortal(false); }
  };
  // Booking attachments, as the web booking page's Attachments tab: upload (POST /:id/attachments, field "files"),
  // no delete here (the server erases the row; deleting stays on the web).
  const [uploading, setUploading] = useState(false);
  const uploadDocs = async () => {
    const pick = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (pick.canceled || !pick.assets?.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      for (const a of pick.assets) {
        if (a.file) fd.append("files", a.file);
        else fd.append("files", { uri: a.uri, name: a.name, type: a.mimeType || "application/octet-stream" } as any);
      }
      const res = await fetchWithAuth(`/api/crm/bookings/${id}/attachments`, { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Upload failed");
      toast.success("File(s) uploaded");
      qc.invalidateQueries({ queryKey: ["crm-booking-docs", id] });
    } catch (e) { toast.error((e as Error).message); }
    finally { setUploading(false); }
  };
  // Change unit: the web booking page's menu item (staff who may edit bookings, not for a plot sale).
  const [changeUnit, setChangeUnit] = useState(false);
  // Home loan, as the web's Loan Tracking page keeps it (crm-loan-details; PUT /bookings/:id/loan).
  const seesLoan = canAccessPage("crm-loan-details");
  const loanQ = useQuery({ queryKey: ["crm-loan-summary"], enabled: seesLoan, staleTime: 60_000,
    queryFn: () => crmGet<Row[]>("/api/crm/loan-summary") });
  const loan = (loanQ.data ?? []).find((x) => Number(x.BookingId) === id) ?? null;
  const [loanForm, setLoanForm] = useState<Record<string, string> | null>(null);
  const openLoan = () => setLoanForm({
    BankName: loan?.BankName ?? "", BranchName: loan?.BranchName ?? "", LoanAmount: loan?.LoanAmount != null ? String(loan.LoanAmount) : "",
    SanctionStatus: loan?.SanctionStatus || "NotApplied", SanctionDate: loan?.SanctionDate ? String(loan.SanctionDate).slice(0, 10) : "",
    LoanAccountNo: loan?.LoanAccountNo ?? "", RmName: loan?.RmName ?? "", RmContact: loan?.RmContact ?? "", Notes: loan?.Notes ?? "" });
  const saveLoan = async () => {
    if (!loanForm) return;
    if (["Sanctioned", "Disbursed"].includes(loanForm.SanctionStatus) && !(Number(loanForm.LoanAmount) > 0)) return toast.error("Enter the sanctioned amount");
    if (["Applied", "Sanctioned", "Disbursed"].includes(loanForm.SanctionStatus) && !loanForm.BankName.trim()) return toast.error("Enter the bank");
    try { await crmSend(`/api/crm/bookings/${id}/loan`, "PUT", loanForm); toast.success("Loan details saved"); setLoanForm(null); qc.invalidateQueries({ queryKey: ["crm-loan-summary"] }); }
    catch (e) { toast.error((e as Error).message); }
  };
  // Invoices: generate (the web's Generate invoice dialog) and void with a reason — the right the server checks.
  const canInvoice = live && (canDoAction("crm-bookings", "edit") || canDoAction("crm-invoices", "edit"));
  const [genInvoice, setGenInvoice] = useState(false);
  const [voidFor, setVoidFor] = useState<Row | null>(null);
  const [applyTo, setApplyTo] = useState<Row | null>(null);
  const refreshMoney = () => ["crm-booking-oa", "crm-booking", "crm-booking-pay", "crm-booking-life", "crm", "crm-dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  // On-account deposits still holding money, and the web's gate for applying them by hand: the booking funded in
  // full, and only the next outstanding milestone, once its demand is raised (CrmPaymentMilestones.tsx canManuallyApplyOnAccount).
  const oaQ = useQuery({ queryKey: ["crm-booking-oa", id], queryFn: () => crmGet<{ payments: Row[]; availableBalance: number }>(`/api/crm/payments/booking/${id}/on-account`), enabled: canPay });
  const deposits = (oaQ.data?.payments ?? []).filter((d) => Number(d.AvailableBalance) > 0.005);
  const applyTarget = (() => {
    const ms = payQ.data?.milestones ?? [];
    const required = ms.length > 0 ? Number(payQ.data?.summary?.totalDue || 0) : Number(pb?.GrandTotal ?? pb?.TotalValue ?? 0);
    const onHand = Number(payQ.data?.summary?.totalPaid || 0) + Number(oaQ.data?.availableBalance || 0);
    if (required > 0 && onHand + 0.005 < required) return null;
    const next = [...ms].sort((a, b) => Number(a.MilestoneNo) - Number(b.MilestoneNo)).find((m) => m.Status !== "Paid" && m.Status !== "Waived");
    if (!next || Number(next.AmountDue) - Number(next.AmountPaid || 0) <= 0 || next.DemandStatus === "Pending") return null;
    return next;
  })();
  const msAction = async (m: Row, fn: () => Promise<any>, done: (r: any) => string) => {
    setBusyMs(m.Id);
    try { const r = await fn(); toast.success(done(r)); refreshMoney(); setWaiveFor(null); setApplyTo(null); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusyMs(null); }
  };
  const canDeposit = live && canDoAction("crm-payments", "create");
  const canCall = live && canDoAction("crm-welcome-calls", "create");
  const canTicket = live && canDoAction("crm-service-tickets", "create");
  const nextOpenId = nextOpenMilestone(milestones)?.Id;
  const receipts = receiptsQ.data ?? [];
  const invoices = invoicesQ.data ?? [];
  const docs = docsQ.data ?? [];
  const tickets = ticketsQ.data ?? [];

  if (!seesBooking && !seesMoney) {
    return <View style={{ flex: 1, backgroundColor: colors.background, padding: 16 }}><Empty text="You don't have a right on Bookings or Payment Milestones." /></View>;
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={CRM} />}
    >
      {loading ? (
        <ActivityIndicator color={colors.mutedForeground} style={{ paddingVertical: 60 }} />
      ) : error && !b && !pb ? (
        <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular }}>{error.message}</Text>
      ) : (
        <>
          {/* Who, what, and the money — the booking number is the header's, so it isn't repeated here */}
          <View style={{ marginBottom: 12 }}>
            <HeroSurface padding={20}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {status ? (
                  <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: ON_HERO.glass }}>
                    <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: ON_HERO.primary }}>{words(status)}</Text>
                  </View>
                ) : null}
                {overdue > 0 ? (
                  <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: "rgba(248,113,113,0.24)" }}>
                    <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: "#FECACA" }}>{overdue} overdue</Text>
                  </View>
                ) : null}
              </View>
              <Text numberOfLines={1} style={{ fontSize: 22, fontFamily: fonts.heading.semibold, color: ON_HERO.primary, letterSpacing: -0.3, marginTop: 14 }}>
                {customer?.CustomerName || head.ApplicantName || "—"}
              </Text>
              <Text style={{ fontSize: 13, lineHeight: 18, fontFamily: fonts.body.regular, color: ON_HERO.secondary, marginTop: 3 }}>
                {joinDot(head.ProjectName, [head.BlockName, head.FloorName, head.UnitNo].filter(Boolean).join(" / "), head.UnitType, head.BookingDate && `Booked ${fmtDate(head.BookingDate)}`)}
              </Text>
              {sum ? (
                <View style={{ marginTop: 18, gap: 8 }}>
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: ON_HERO.secondary }}>Balance</Text>
                  <Text style={{ fontSize: 30, fontFamily: fonts.heading.semibold, color: ON_HERO.primary, letterSpacing: -0.6, marginTop: -4 }}>{money(sum.balance)}</Text>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: ON_HERO.glass, overflow: "hidden" }}>
                    <View style={{ height: 6, borderRadius: 3, width: `${price ? Math.min(100, (Number(sum.totalPaid) / price) * 100) : 0}%`, backgroundColor: "#34D399" }} />
                  </View>
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: ON_HERO.secondary }}>Paid {money(sum.totalPaid)} of {money(price)}</Text>
                </View>
              ) : null}
              <View style={{ marginTop: 16 }}><ContactKeys mobile={customer?.Mobile || head.Mobile} /></View>
            </HeroSurface>
          </View>

          {canCall || canDeposit || canTicket ? (
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 12 }}>
              {[
                canCall && { key: "call", label: "Log welcome call", icon: PhoneCall, go: () => nav.navigate("CrmWelcomeCall", { bookingId: id, title }) },
                canDeposit && { key: "deposit", label: "Deposit on account", icon: Wallet, go: () => nav.navigate("CrmPayment", { bookingId: id, title }) },
                canTicket && { key: "ticket", label: "Raise ticket", icon: Ticket, go: () => nav.navigate("CrmTicketNew", { bookingId: id, title }) },
              ].filter((a): a is { key: string; label: string; icon: typeof Ticket; go: () => void } => !!a).map((a) => (
                <Tap key={a.key} onPress={a.go} accessibilityRole="button" accessibilityLabel={a.label}
                  style={({ pressed }) => ({ ...card, flex: 1, alignItems: "center", gap: 8, paddingVertical: 14, paddingHorizontal: 6, opacity: pressed ? 0.75 : 1 })}>
                  <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: `${CRM}24`, alignItems: "center", justifyContent: "center" }}>
                    <a.icon size={19} color={CRM} />
                  </View>
                  <Text numberOfLines={2} style={{ fontSize: 12.5, lineHeight: 16, textAlign: "center", fontFamily: fonts.heading.semibold, color: colors.foreground }}>{a.label}</Text>
                </Tap>
              ))}
            </View>
          ) : null}

          {inApproval && live ? (
            <Section title={`Approval · ${words(stage)}`}>
              {stage === "Review" ? (checklistQ.data?.items ?? []).map((it) => {
                const st = it.CheckStatus;
                const tone = st === "Checked" ? colors.primary : st === "NeedsRecheck" ? colors.destructive : colors.mutedForeground;
                return (
                  <View key={it.ItemKey} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 6 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                      <Text style={{ flex: 1, fontSize: 13.5, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{it.ItemLabel}</Text>
                      <Pill label={st === "Checked" ? "Verified" : st === "NeedsRecheck" ? "Flagged \u2014 fix needed" : "To verify"} tone={tone} />
                    </View>
                    {it.Remarks ? <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{st === "NeedsRecheck" ? "Flagged: " : "Remark: "}{it.Remarks}</Text> : null}
                    {canVerify && st !== "NeedsRecheck" ? (
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <ActionKey label={busyStage === it.ItemKey ? "Saving\u2026" : st === "Checked" ? "Untick" : "Verify"} outline={st === "Checked"}
                          onPress={() => checkItem(it, st === "Checked" ? "uncheck" : "check")} />
                        <ActionKey label="Flag for Recheck" outline tone={colors.destructive} onPress={() => setFlagItem(it)} />
                      </View>
                    ) : null}
                    {canEditBooking && st === "NeedsRecheck" ? (
                      <View style={{ flexDirection: "row" }}>
                        <ActionKey label={busyStage === it.ItemKey ? "Sending\u2026" : "I\u2019ve revised this \u2014 resend for recheck"} outline onPress={() => checkItem(it, "resubmit")} />
                      </View>
                    ) : null}
                  </View>
                );
              }) : null}
              {stage === "Review" && canVerify ? (
                <View style={{ flexDirection: "row", marginTop: 12 }}>
                  <ActionKey label={busyStage === "verify" ? "Submitting\u2026" : "Verify & Send for Approval"}
                    onPress={() => stageAction("verify", () => crmSend(`/api/crm/bookings/${id}/ready-for-approval`, "PUT"), (r) => `Data review complete — sent to ${r?.label || "Marketing Head Approval"}`)} />
                </View>
              ) : stage === "Review" && canEditBooking ? (
                <Text style={{ marginTop: 10, fontSize: 12.5, fontFamily: fonts.body.medium, color: colors.mutedForeground }}>Waiting for data verification</Text>
              ) : null}
              {stage !== "Review" && canActOnStage ? (
                <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                  <ActionKey label="Reject" outline tone={colors.destructive} onPress={() => { if (!sendBackTo) setSendBackTo(sendBackChoices[0] ?? null); setSendBack(true); }} />
                  <ActionKey label={busyStage === "approve" ? "Approving\u2026" : stage === "DirectorApproval" ? "Final Approve" : "Approve"}
                    onPress={() => stageAction("approve", () => crmSend(`/api/crm/bookings/${id}/approve`, "PUT"), (r) => r?.confirmed ? "Booking confirmed" : `Approved - moved to ${r?.label || "next stage"}`)} />
                </View>
              ) : null}
              {stage !== "Review" && canActOnStage && sendBackChoices.length > 1 ? (
                <Chips label="If sent back, it goes" options={sendBackChoices} value={sendBackTo ?? sendBackChoices[0]} onChange={setSendBackTo}
                  labelOf={(c) => (c === "Review" ? "To Data Review" : `To the ${words(c).replace(/ Approval$/, "")}`)} />
              ) : null}
            </Section>
          ) : null}

          {moneyInfo ? (
            <Section title="Money">
              <Kv label="On account (available)" value={money(pb?.OnAccountAvailable)} />
              <Kv label="With Finance for approval" value={Number(moneyInfo.inVerification) > 0 ? `${money(moneyInfo.inVerification)} (${moneyInfo.inVerificationCount})` : money(0)} />
              <Kv label="Still to collect" value={money(moneyInfo.toCollect)} strong />
              {Number(moneyInfo.excess) > 0 ? <Kv label="Paid over the price" value={money(moneyInfo.excess)} tone="#f59e0b" /> : null}
              {Number(payQ.data?.summary?.waivedDue) > 0 ? <Kv label={`Waived (${payQ.data?.summary?.waivedCount})`} value={money(payQ.data?.summary?.waivedDue)} /> : null}
            </Section>
          ) : null}

          {/* The journey */}
          {lifeQ.data?.steps?.length ? (
            <Section title="Journey">
              {lifeQ.data.steps.map((s) => {
                const Icon = STEP_ICON[s.status as keyof typeof STEP_ICON] ?? Circle;
                const tone = STEP_TONE[s.status] ?? colors.mutedForeground;
                return (
                  <View key={s.key} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 7 }}>
                    <Icon size={15} color={tone} style={{ marginTop: 1 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 12.5, fontFamily: s.status === "active" ? fonts.heading.semibold : fonts.body.medium, color: s.status === "locked" ? colors.mutedForeground : colors.foreground }}>{s.label}</Text>
                      {s.blockedBy ? <Text style={{ fontSize: 10.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 1 }}>{s.blockedBy}</Text> : null}
                    </View>
                    {s.date ? <Text style={{ fontSize: 10.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{fmtDate(s.date)}</Text> : null}
                  </View>
                );
              })}
            </Section>
          ) : null}

          {/* Milestones */}
          <Section title={`Payment Milestones (${milestones.length})`}>
            {milestones.length === 0 ? <Empty text="No milestones." /> : milestones.map((m) => {
              const status = m.IsOverdue ? "Overdue" : m.DemandStatus || m.Status;
              return (
                <View key={m.Id} style={{ paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text numberOfLines={2} style={{ flex: 1, fontSize: 12.5, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{`${m.MilestoneNo}. ${m.MilestoneName}`}</Text>
                    {status ? <Pill label={status} /> : null}
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
                    <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>
                      {joinDot(m.Percent && `${m.Percent}%`, m.DueDate && `Due ${fmtDate(m.DueDate)}`, m.DemandNo)}
                    </Text>
                    <Text style={{ fontSize: 11.5, fontFamily: fonts.body.medium, color: colors.foreground, fontVariant: ["tabular-nums"] }}>
                      {money(m.AmountPaid)} / {money(m.AmountDue)}
                    </Text>
                  </View>
                  {Number(m.PendingVerificationAmount) > 0 ? (
                    <Text style={{ fontSize: 10.5, fontFamily: fonts.body.regular, color: "#f59e0b", marginTop: 2 }}>{money(m.PendingVerificationAmount)} with Finance for approval</Text>
                  ) : null}
                  {canPay && payQ.data && m.Status !== "Waived" && m.Status !== "Paid" && milestoneMissing(m) > 0 ? (
                    <View style={{ gap: 8, marginTop: 10 }}>
                      <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: colors.mutedForeground }}>Balance {money(milestoneMissing(m))}</Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                        <ActionKey half label="Pay" outline={m.Id !== nextOpenId} onPress={() => nav.navigate("CrmPayment", { bookingId: id, milestoneId: m.Id, title })} />
                        {m.DemandStatus === "Pending" ? (
                          <ActionKey half label={busyMs === m.Id ? "Raising…" : "Raise demand"} outline
                            onPress={() => msAction(m, () => crmSend(`/api/crm/payments/${m.Id}/demand`, "POST", {}), (r) => `Demand ${r?.DemandNo ?? ""} raised`)} />
                        ) : m.DemandStatus === "Demanded" ? (
                          <ActionKey half label={busyMs === m.Id ? "Undoing…" : "Undo demand"} outline tone={colors.mutedForeground}
                            onPress={() => msAction(m, () => crmSend(`/api/crm/payments/${m.Id}/demand/undo`, "PATCH"), () => "Demand reverted to Not Raised")} />
                        ) : null}
                        {applyTarget?.Id === m.Id && deposits.length > 0 ? (
                          <ActionKey half label="Apply on account" outline onPress={() => setApplyTo(m)} />
                        ) : null}
                        <ActionKey half label="Waive" outline tone={colors.mutedForeground} onPress={() => setWaiveFor(m)} />
                      </View>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </Section>

          {/* Papers */}
          {seesReceipts || seesInvoices || seesBooking ? (
            <Section title="Papers">
              {seesReceipts ? receipts.map((r) => (
                <View key={`r${r.Id}`}>
                  <LinkRow icon={FileText} title={`Money receipt ${r.ReceiptNo}`} sub={joinDot(money(r.Amount), fmtDate(r.ReceivedDate), r.PaymentMode, r.Status)}
                    onPress={() => open({ to: "document", path: `/api/crm/money-receipts/${r.Id}/pdf`, name: r.ReceiptNo || "Money Receipt" })} />
                  {/* The web's Money Receipts actions: bounce a pending one, put a bounced one back (CrmMoneyReceipts.tsx). */}
                  {canEditReceipts && r.ReceivedPaymentId == null && (r.Status === "Pending" || r.Status === "Bounced") ? (
                    <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
                      {r.Status === "Pending" ? (
                        <ActionKey label="Bounce" outline tone={colors.destructive} onPress={() => setBounceFor(r)} />
                      ) : (
                        <ActionKey label={busyRc === r.Id ? "Putting back…" : "Put back"} outline
                          onPress={() => receiptAction(r, "resubmit", undefined, `${r.ReceiptNo} put back`)} />
                      )}
                    </View>
                  ) : null}
                </View>
              )) : null}
              {seesInvoices ? invoices.map((v) => (
                <View key={`i${v.Id}`}>
                  <LinkRow icon={FileText} tone="#3b82f6" title={`Invoice ${v.InvoiceNo ?? v.Id}`}
                    sub={joinDot(v.InvoiceType, money(v.TotalAmount ?? v.GrandTotal ?? v.Amount), fmtDate(v.InvoiceDate ?? v.CreatedAt), v.Status)}
                    onPress={() => open({ to: "document", path: `/api/crm/bookings/${id}/invoices/${v.Id}/pdf`, name: v.InvoiceNo || "Invoice" })} />
                  {canInvoice && v.Status !== "Void" ? (
                    <View style={{ flexDirection: "row", marginBottom: 8 }}>
                      <ActionKey label="Void" outline tone={colors.destructive} onPress={() => setVoidFor(v)} />
                    </View>
                  ) : null}
                </View>
              )) : null}
              {canInvoice ? (
                <View style={{ flexDirection: "row", marginTop: 8 }}>
                  <ActionKey outline label="Generate invoice" onPress={() => setGenInvoice(true)} />
                </View>
              ) : null}
              {seesBooking ? docs.map((d) => (
                <View key={`${d.Source}${d.Id}`}>
                  <LinkRow icon={FileText} tone="#8b5cf6" title={d.Label || d.FileName}
                    sub={joinDot(d.FileName !== d.Label && d.FileName, kb(d.FileSize), fmtDate(d.CreatedAt), d.UploaderName, d.Source === "application" && "From Application")}
                    onPress={() => open({ to: "document", name: d.FileName || "Document",
                      path: d.Source === "booking" ? `/api/crm/bookings/${id}/attachments/file/${d.Id}` : `/api/crm/booking-documents/file/${d.Id}` })} />
                </View>
              )) : null}
              {canEditBooking ? (
                <View style={{ flexDirection: "row", marginTop: 8 }}>
                  <ActionKey outline label={uploading ? "Uploading\u2026" : "Upload files"} onPress={uploadDocs} />
                </View>
              ) : null}
              {receiptsQ.isLoading || invoicesQ.isLoading || docsQ.isLoading ? <ActivityIndicator color={colors.mutedForeground} style={{ paddingVertical: 10 }} />
                : !receipts.length && !invoices.length && !docs.length ? <Empty text="No receipts, invoices or documents yet." /> : null}
            </Section>
          ) : null}

          {/* Service tickets */}
          {seesTickets && (tickets.length || canTicket) ? (
            <Section title={`Service Tickets (${tickets.length})`}>
              {tickets.length === 0 ? <Empty text="No service tickets." /> : tickets.map((t) => (
                <LinkRow key={t.Id} title={t.Subject || t.TicketNo} sub={joinDot(t.TicketNo, t.Category, fmtDate(t.CreatedAt), t.AssigneeName)}
                  right={<Pill label={t.Status} />} onPress={() => open({ to: "ticket", ticketId: t.Id })} />
              ))}
            </Section>
          ) : null}

          {/* Buyer */}
          {customer ? (
            <Section title="Buyer">
              <LinkRow
                title={customer.CustomerNo || customer.CustomerName}
                sub={joinDot(customer.Mobile, customer.Email)}
                onPress={canAccessPage("crm-customer-360") ? () => open({ to: "customer", customerId: Number(customer.Id), title: customer.CustomerName }) : undefined}
              />
              <Kv label="PAN" value={customer.PanNo} />
              <Kv label="Address" value={joinDot(customer.Address, customer.City, customer.State, customer.Pincode)} />
              {customer.CoApplicantName ? <Kv label="Co-applicant" value={joinDot(customer.CoApplicantName, customer.CoApplicantRelation)} /> : null}
            </Section>
          ) : null}

          {/* Unit and price */}
          {b ? (
            <Section title="Unit & Price">
              <Kv label="Area" value={b.AreaSqFt ? `${b.AreaSqFt} sq ft` : null} />
              <Kv label="Carpet area" value={b.CarpetAreaSqFt ? `${b.CarpetAreaSqFt} sq ft` : null} />
              <Kv label="Rate" value={b.RatePerSqFt ? `${money(b.RatePerSqFt)} / sq ft` : null} />
              <Kv label="Unit value" value={money(b.TotalValue)} />
              {pb ? <Kv label="Parking" value={money(pb.ParkingTotal)} /> : null}
              {pb ? <Kv label="Extra charges" value={money(pb.ExtraChargesTotal)} /> : null}
              <Kv label="Booking amount" value={money(b.BookingAmount)} />
            </Section>
          ) : null}

          {["crm-pre-possession", "crm-possession-notice", "crm-handover"].some((pg) => canAccessPage(pg)) && status === "Approved" ? (
            <Section title="Possession">
              <LinkRow icon={FileText} title="Possession & Handover" sub="Checklist, notice, handover and snags" onPress={() => nav.navigate("CrmPossession", { bookingId: id, title })} />
            </Section>
          ) : null}
          {seesLoan && loanQ.data ? (
            <Section title="Home Loan">
              <Kv label="Status" value={!loan?.SanctionStatus || loan.SanctionStatus === "NotApplied" ? "Not applied" : loan.SanctionStatus} />
              {loan?.BankName ? <Kv label="Bank" value={joinDot(loan.BankName, loan.BranchName)} /> : null}
              {Number(loan?.LoanAmount) > 0 ? <Kv label="Loan amount" value={money(loan?.LoanAmount)} /> : null}
              {loan?.SanctionDate ? <Kv label="Sanction date" value={fmtDate(loan.SanctionDate)} /> : null}
              {Number(loan?.DisbursedAmount) > 0 ? <Kv label="Disbursed (home-loan receipts)" value={money(loan?.DisbursedAmount)} /> : null}
              {live && canDoAction("crm-loan-details", "edit") ? (
                <View style={{ flexDirection: "row", marginTop: 8 }}><ActionKey outline label={loan?.LoanId != null ? "Edit loan" : "Record loan"} onPress={openLoan} /></View>
              ) : null}
            </Section>
          ) : null}
          {canEditBooking && b && !b.IsPlotSale ? (
            <Section title="Unit">
              <LinkRow icon={FileText} title="Change unit" sub="Move this booking to another unit; it goes for approval" onPress={() => setChangeUnit(true)} />
            </Section>
          ) : null}
          {changeUnit && b ? <ChangeUnitDialog booking={{ ...pb, ...b }} onClose={() => setChangeUnit(false)} /> : null}

          {/* Civilier Home */}
          {portal ? (
            <Section title="Civilier Home">
              {portal.hasPortal ? (
                <>
                  <Kv label="Access" value={portal.isActive ? "Access Active" : "Access Deactivated"} />
                  <Kv label="Mobile login" value={portal.loginMobile || "No 10-digit mobile on file"} />
                  <Kv label="Password" value={portal.mustChangePassword ? "First password" : "Own password"} />
                  <Kv label="Last sign-in" value={portal.lastLoginAt ? fmtDate(portal.lastLoginAt) : "Never"} />
                  {portal.firstPassword ? <Kv label="First password" value={`${portal.firstPassword} (${portal.passwordRule})`} /> : null}
                  {canEditBooking ? (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                      <ActionKey half outline tone={portal.isActive ? colors.destructive : undefined}
                        label={busyPortal && !confirmReset ? "Updating\u2026" : portal.isActive ? "Deactivate Access" : "Reactivate Access"}
                        onPress={() => portalAction(() => crmSend(`/api/crm/bookings/${id}/portal/${portal.isActive ? "deactivate" : "reactivate"}`, "PUT"),
                          () => (portal.isActive ? "Portal access deactivated" : "Portal access reactivated"))} />
                      {portal.isActive ? (
                        <ActionKey half outline tone={confirmReset ? colors.destructive : undefined}
                          label={confirmReset ? (busyPortal ? "Resetting\u2026" : "Confirm reset") : "Reset password"}
                          onPress={() => confirmReset
                            ? portalAction(() => crmSend("/api/crm-portal/admin/reset-password", "POST", { customerId: portal.customerId }), (r) => r?.message || "Password reset")
                            : setConfirmReset(true)} />
                      ) : null}
                    </View>
                  ) : null}
                </>
              ) : (
                <>
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>
                    {portal.workflowStage !== "Confirmed"
                      ? "Civilier Home access is set up automatically once this booking reaches Confirmed status."
                      : "This booking is Confirmed but has no Civilier Home account yet. Set it up below."}
                  </Text>
                  {canEditBooking && portal.workflowStage === "Confirmed" ? (
                    <View style={{ flexDirection: "row", marginTop: 10 }}>
                      <ActionKey label={busyPortal ? "Setting up\u2026" : "Set up Civilier Home"}
                        onPress={() => portalAction(() => crmSend(`/api/crm/bookings/${id}/provision-portal`, "POST"), () => "Civilier Home access created")} />
                    </View>
                  ) : null}
                </>
              )}
            </Section>
          ) : null}

          {/* Welcome call and agreement */}
          {bookingQ.data ? (
            <Section title="Welcome Call & Agreement">
              {bookingQ.data.welcomeCalls?.[0] ? (
                <Kv label="Welcome call" value={joinDot(bookingQ.data.welcomeCalls[0].Outcome, fmtDate(bookingQ.data.welcomeCalls[0].CallDate))} />
              ) : <Kv label="Welcome call" value="Not done yet" />}
              {canAccessPage("crm-welcome-calls") ? (
                <LinkRow icon={CheckCircle2} title="Welcome checklist" sub="Verify each fact confirmed on the call, then submit"
                  onPress={() => nav.navigate("CrmWelcomeChecklist", { bookingId: id, title })} />
              ) : null}
              {bookingQ.data.agreement ? (
                <>
                  <Kv label="Agreement" value={joinDot(bookingQ.data.agreement.AgreementNo, bookingQ.data.agreement.Status)} />
                  <Kv label="Agreement date" value={fmtDate(bookingQ.data.agreement.AgreementDate)} />
                </>
              ) : <Kv label="Agreement" value="Not drafted yet" />}
            </Section>
          ) : null}
        </>
      )}
      <ApplyOnAccountPrompt milestone={applyTo} deposits={deposits} busy={busyMs != null} onClose={() => setApplyTo(null)}
        onApply={(d, amount) => applyTo && msAction(applyTo, () => crmSend(`/api/crm/payments/on-account/${d.Id}/apply`, "PUT", { MilestoneId: applyTo.Id, Amount: amount }), () => `${money(amount)} applied from ${d.ReceiptNo}`)} />
      {loanForm ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setLoanForm(null)}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 16 }}>
            <View style={{ maxHeight: "90%", backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.border }}>
              <ScrollView contentContainerStyle={{ padding: 18, gap: 6 }} keyboardShouldPersistTaps="handled">
                <Text style={{ fontSize: 16, fontFamily: fonts.heading.bold, color: colors.foreground }}>Loan details</Text>
                <Chips label="Sanction status" options={["NotApplied", "Applied", "Sanctioned", "Disbursed", "Rejected"] as const}
                  value={loanForm.SanctionStatus as "NotApplied"} onChange={(v) => setLoanForm((x) => x && { ...x, SanctionStatus: v })}
                  labelOf={(v) => (v === "NotApplied" ? "Not applied" : v)} />
                {([["BankName", "Bank"], ["BranchName", "Branch"], ["LoanAmount", "Sanctioned amount (₹)"], ["LoanAccountNo", "Loan account no."], ["RmName", "Bank RM"], ["RmContact", "RM contact"]] as const).map(([k, lbl]) => (
                  <TextField key={k} label={lbl} value={loanForm[k]} keyboardType={k === "LoanAmount" || k === "RmContact" ? "numeric" : "default"}
                    onChangeText={(v) => setLoanForm((x) => x && { ...x, [k]: v })} />
                ))}
                <DateField label="Sanction date" value={loanForm.SanctionDate} onChange={(v: string) => setLoanForm((x) => x && { ...x, SanctionDate: v })} />
                <RemarksField label="Notes" value={loanForm.Notes} onChangeText={(v) => setLoanForm((x) => x && { ...x, Notes: v })} />
                <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                  <ActionKey label="Cancel" outline tone={colors.mutedForeground} onPress={() => setLoanForm(null)} />
                  <ActionKey label="Save" onPress={saveLoan} />
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}
      {genInvoice ? <GenerateInvoiceDialog bookingId={id} onClose={() => setGenInvoice(false)} /> : null}
      <NotePrompt open={!!voidFor} danger title={`Void ${voidFor?.InvoiceNo ?? "invoice"}?`} hint="The invoice stays on record as Void; its milestone can then be invoiced again."
        placeholder="Reason for voiding (required)" submitLabel="Void invoice" busy={busyRc != null}
        onSubmit={async (reason) => {
          if (!voidFor) return;
          try { await crmSend(`/api/crm/bookings/${id}/invoices/${voidFor.Id}/void`, "PUT", { reason }); toast.success(`${voidFor.InvoiceNo} voided`); setVoidFor(null);
            ["crm-booking-invoices", "crm-booking", "crm"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); }
          catch (e) { toast.error((e as Error).message); }
        }}
        onClose={() => setVoidFor(null)} />
      <NotePrompt open={!!flagItem} danger title={`Flag ${flagItem?.ItemLabel ?? ""} for recheck`} hint="The preparer corrects it, then resends it for recheck."
        placeholder="What needs to be fixed? (required)" submitLabel="Send for Recheck" busy={busyStage != null}
        onSubmit={(text) => flagItem && checkItem(flagItem, "flag", text)} onClose={() => setFlagItem(null)} />
      <NotePrompt open={sendBack} danger title="Send Back for Correction"
        hint={sendBackTo ? (sendBackTo === "Review" ? "To Data Review" : `To the ${words(sendBackTo).replace(/ Approval$/, "")}`) : ""}
        placeholder="What needs to be corrected? (required)" submitLabel="Send Back" busy={busyStage != null}
        onSubmit={(note) => stageAction("reject", () => crmSend(`/api/crm/bookings/${id}/reject`, "PUT", { note, toStage: sendBackTo }), (r) => `Sent back to ${r?.label || "previous stage"}`)}
        onClose={() => setSendBack(false)} />
      <NotePrompt open={!!bounceFor} danger title={`Bounce ${bounceFor?.ReceiptNo ?? ""}?`}
        hint={bounceFor ? joinDot(money(bounceFor.Amount), bounceFor.PaymentMode, bounceFor.ChequeNo ? `cheque ${bounceFor.ChequeNo}` : null) : ""}
        placeholder="Why this receipt bounced…" submitLabel="Bounce receipt" busy={busyRc != null}
        onSubmit={(reason) => bounceFor && receiptAction(bounceFor, "bounce", { reason }, `${bounceFor.ReceiptNo} marked as bounced`)}
        onClose={() => setBounceFor(null)} />
      <NotePrompt open={!!waiveFor} title={`Waive ${waiveFor ? `${waiveFor.MilestoneNo}. ${waiveFor.MilestoneName}` : ""}`}
        hint="Say why this milestone is being waived. It goes for approval and stays due until approved."
        placeholder="Reason for the waiver…" submitLabel="Send for approval" busy={busyMs != null}
        onSubmit={(text) => {
          if (text.length < 10) { toast.error("Write at least 10 characters for the reason."); return; }
          if (waiveFor) msAction(waiveFor, () => crmSend(`/api/crm/payments/${waiveFor.Id}/waive`, "PUT", { Reason: text }), () => "Waiver sent for approval. The milestone stays due until it is approved.");
        }}
        onClose={() => setWaiveFor(null)} />
    </ScrollView>
  );
}

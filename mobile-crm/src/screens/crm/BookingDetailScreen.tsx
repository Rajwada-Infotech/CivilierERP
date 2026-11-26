// One booking on the phone: the buyer (Call / WhatsApp), the money first (price, paid, balance, overdue, on account),
// what can be done here (log a welcome call, take a payment, raise a ticket), the journey from booking to mutation,
// the payment milestones (Pay on the open ones), the booking's papers (money receipts, invoices, documents), its
// service tickets, the buyer and the agreement. Each part comes from the route the web page uses and shows only to
// staff with that page's right.
import { useState } from "react";
import { ActivityIndicator, Modal, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { RemarksField, TextField } from "@/components/form/Form";
import { DateField } from "@/components/form/DateField";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { fetchWithAuth } from "@/services/fetchWithAuth";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ArrowLeftRight, Banknote, Car, Check, CheckCircle2, ChevronRight, FileText, Handshake, KeyRound, Landmark, Lock, PhoneCall, RefreshCw, Scale, Smartphone, Ticket, UserCheck, Wallet, XCircle } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { crmGet, crmSend, getBooking, getBookingLifecycle, getBookingPayments, type Row } from "@/api/crmApi";
import { toast } from "@/components/Toast";
import { formatCompactINR } from "@/utils/formatCurrency";
import { getTicketsForBooking } from "@/api/serviceTicketApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { ActionKey, CRM, ContactKeys, Empty, HeroSurface, Kv, LinkRow, ON_HERO, Section, Tap, fmtDate, joinDot, money, Pill, useCardStyle, words } from "./ui";
import { useCrmOpen } from "./CrmRegisterScreen";
import { ApplyOnAccountPrompt, ChangeUnitDialog, GenerateInvoiceDialog, Chips, NotePrompt, OwnershipChangeDialog, ResaleDealDialog, milestoneMissing, nextOpenMilestone } from "./CrmForms";

// A booking that no longer takes money here (the web's "closed" plan).
const CLOSED = ["Cancelled", "UnitChanged", "Rejected"];
const kb = (n: unknown) => { const b = Number(n) || 0; return b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b ? `${Math.max(1, Math.round(b / 1024))} KB` : ""; };


const APPROVAL_PATH = ["Review", "MarketingHeadApproval", "DirectorApproval"] as const;
const initials = (n?: string | null) => (n || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

export default function BookingDetailScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmBooking">>();
  const card = useCardStyle();
  const id = params.bookingId;
  // "money": the web's Payment Milestones record — the money at a glance, the account, the plan and its waivers only.
  const moneyOnly = params.focus === "money";
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
      seesReceipts && receiptsQ.refetch(), seesInvoices && invoicesQ.refetch(), seesBooking && docsQ.refetch(), seesTickets && ticketsQ.refetch(),
      seesLegalMil && legalMilQ.refetch()]);
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
  const [reversing, setReversing] = useState<Row | null>(null);
  const [reverseText, setReverseText] = useState("");
  const [reverseBusy, setReverseBusy] = useState(false);
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
  // Resale / buy-back: open a case on this booking (crm-resales create right).
  const canResale = live && canDoAction("crm-resales", "create");
  const [resaleDialog, setResaleDialog] = useState(false);
  // Ownership change: transfer ownership after registered deed (crm-ownership-changes create right).
  const canOwnership = canDoAction("crm-ownership-changes", "create");
  const [ownershipDialog, setOwnershipDialog] = useState(false);
  // Cancellation: raise a cancellation request on this booking (crm-cancellations create right).
  const canCancelBooking = live && canDoAction("crm-cancellations", "create");
  const [cancelDialog, setCancelDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelPct, setCancelPct] = useState("");
  const [busyCancel, setBusyCancel] = useState(false);
  const submitCancel = async () => {
    if (!cancelReason.trim()) return toast.error("Enter the reason for cancellation");
    const pct = cancelPct.trim() ? parseFloat(cancelPct) : undefined;
    if (pct !== undefined && (isNaN(pct) || pct < 0 || pct > 100)) return toast.error("Cancellation charge must be 0 – 100%");
    setBusyCancel(true);
    try {
      await crmSend("/api/crm/cancellations", "POST", { BookingId: id, Reason: cancelReason.trim(), ...(pct !== undefined ? { DeductionPercent: pct } : {}) });
      toast.success("Cancellation request raised");
      setCancelDialog(false); setCancelReason(""); setCancelPct("");
      ["crm-booking", "crm"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusyCancel(false); }
  };
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
  const seesLegalMil = canAccessPage("crm-legal-milestones");
  const legalMilQ = useQuery({ queryKey: ["crm-booking-legal-mil", id], enabled: seesLegalMil,
    queryFn: () => crmGet<Row | null>(`/api/crm/legal-milestones/booking/${id}`) });
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
  // The milestone showing its keys: the one tapped, else the next one due (-1 = none open).
  const [openMs, setOpenMs] = useState<number | null>(null);
  const shownMs = openMs ?? nextOpenId;
  const receipts = receiptsQ.data ?? [];
  const invoices = invoicesQ.data ?? [];
  const docs = docsQ.data ?? [];
  const tickets = ticketsQ.data ?? [];


  // The Data Review items, and the facts each one asks the verifier to check (from the booking, buyer and papers on file).
  const checkItems = checklistQ.data?.items ?? [];
  const checkedN = checkItems.filter((x) => x.CheckStatus === "Checked").length;
  const coApps: Row[] = bookingQ.data?.coApplicants ?? [];
  const reviewFacts = (key: string): [string, string | null][] => {
    const c = customer;
    switch (key) {
      case "ApplicantKyc": return [["Name", c?.CustomerName ?? head.ApplicantName ?? null], ["Mobile", c?.Mobile ?? null], ["Email", c?.Email ?? null], ["PAN", c?.PanNo ?? null],
        ["Address", joinDot(c?.Address, c?.City, c?.State, c?.Pincode) || null], ["Co-applicants", coApps.length ? coApps.map((x) => x.Name).join(", ") : "None"]];
      case "ProjectUnitRate": return [["Project", head.ProjectName ?? null], ["Unit", joinDot([b?.BlockName, b?.UnitNo].filter(Boolean).join(" / "), b?.FloorName, b?.UnitType) || null],
        ["Area", b?.AreaSqFt ? `${b.AreaSqFt} sq ft` : null], ["Rate", b?.RatePerSqFt ? `${money(b.RatePerSqFt)}/sq ft${b.ListRatePerSqFt && Number(b.ListRatePerSqFt) !== Number(b.RatePerSqFt) ? ` (list ${money(b.ListRatePerSqFt)})` : ""}` : null],
        ["Unit value", money(b?.TotalValue)], ["Price (incl. GST)", money(price)]];
      case "PaymentPlanAmounts": return [["Plan", b?.PaymentPlanName ?? (b?.IsPlotSale ? "Booking, then balance" : null)], ["Booking amount", money(b?.BookingAmount)], ["Milestones", String(milestones.length)]];
      case "BankDepositMode": return [["Payment mode", b?.PaymentMode ?? null], ["Bank/KYC on file", b?.BankDetailsComplete ? "Complete" : null]];
      case "SourceAssignment": return [["Salesperson", b?.AssigneeName ?? null], ["Came from", b?.LeadId ? "A converted lead" : "Direct"]];
      case "Documents": return [["Papers on file", docs.length ? `${docs.length}: ${docs.map((d) => d.Label || d.DocumentType || d.FileName).slice(0, 4).join(", ")}${docs.length > 4 ? "…" : ""}` : null]];
      default: return [];
    }
  };
  // ── The page's parts ──
  const steps = lifeQ.data?.steps ?? [];
  const stepIndex = Math.max(0, steps.findIndex((s) => s.status === "active"));
  const nextStep = steps.find((s) => s.status === "active") ?? null;
  const doneCount = steps.filter((s) => s.status === "done").length;
  const nextKeys = [
    nextStep?.key === "welcome_call" && canCall && { label: "Log welcome call", go: () => nav.navigate("CrmWelcomeCall", { bookingId: id, title }) },
    nextStep?.key === "welcome_call" && canAccessPage("crm-welcome-calls") && { label: "Checklist", go: () => nav.navigate("CrmWelcomeChecklist", { bookingId: id, title }) },
    nextStep?.key === "handover" && ["crm-pre-possession", "crm-possession-notice", "crm-handover"].some((pg) => canAccessPage(pg)) && { label: "Possession & Handover", go: () => nav.navigate("CrmPossession", { bookingId: id, title }) },
  ].filter((k): k is { label: string; go: () => void } => !!k);
  const quick = [
    canPay && nextOpenId != null && { key: "pay", label: "Payment", icon: Banknote, go: () => nav.navigate("CrmPayment", { bookingId: id, milestoneId: nextOpenId, title }) },
    canDeposit && { key: "deposit", label: "On account", icon: Wallet, go: () => nav.navigate("CrmPayment", { bookingId: id, title }) },
    canInvoice && { key: "invoice", label: "Invoice", icon: FileText, go: () => setGenInvoice(true) },
    canTicket && { key: "ticket", label: "Ticket", icon: Ticket, go: () => nav.navigate("CrmTicketNew", { bookingId: id, title }) },
  ].filter((a): a is { key: string; label: string; icon: typeof Ticket; go: () => void } => !!a);
  const pct = (n: unknown) => `${price ? Math.min(100, (Number(n) || 0) / price * 100) : 0}%` as `${number}%`;
  const demanded = milestones.filter((m) => m.DemandStatus && m.DemandStatus !== "Pending").reduce((t, m) => t + (Number(m.AmountDue) || 0), 0);
  const paidCount = milestones.filter((m) => m.Status === "Paid").length;
  // The schedule shows what is done, the next one due and two after it; the rest fold into "+ n more" until asked for.
  const [allMs, setAllMs] = useState(false);
  const nextIdx = Math.max(0, milestones.findIndex((m) => m.Id === nextOpenId));
  const shownList = allMs ? milestones : milestones.filter((m, i) => i <= nextIdx + 2 || shownMs === m.Id);
  const hiddenCount = milestones.length - shownList.length;
  const hiddenTotal = milestones.filter((m) => !shownList.includes(m)).reduce((t, m) => t + (Number(m.AmountDue) || 0), 0);
  const [afterOpen, setAfterOpen] = useState<string | null>(null);
  const call = bookingQ.data?.welcomeCalls?.[0];
  const openTickets = tickets.filter((t) => !["Closed", "Resolved"].includes(t.Status)).length;
  const afterRows: { key: string; label: string; icon: typeof Ticket; badge?: string; tone?: string; go?: () => void; body?: React.ReactNode }[] = [
    bookingQ.data && { key: "welcome", label: "Welcome call and agreement", icon: PhoneCall, badge: call ? words(call.Outcome) : "Not done", tone: call?.Outcome === "Welcomed" ? "#10b981" : undefined,
      body: <>
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
                  {canAccessPage("crm-agreements") ? (
                    <View style={{ flexDirection: "row", marginTop: 8 }}>
                      <ActionKey outline label="Open agreement" onPress={() => nav.navigate("CrmAgreement", { bookingId: id, title })} />
                    </View>
                  ) : null}
                </>
              ) : (
                <>
                  <Kv label="Agreement" value="Not drafted yet" />
                  {canDoAction("crm-agreements", "create") ? (
                    <View style={{ flexDirection: "row", marginTop: 8 }}>
                      <ActionKey label="Draft agreement" onPress={() => nav.navigate("CrmAgreement", { bookingId: id, title })} />
                    </View>
                  ) : null}
                </>
              )}
      </> },
    (seesLegalMil || bookingQ.data?.agreement) && (() => {
      const lm = legalMilQ.data;
      const agr = bookingQ.data?.agreement;
      // Colour and label for the dot next to a legal step status
      const dotColor = (status: string | null | undefined) => {
        if (!status) return colors.border;
        const s = status.toLowerCase();
        if (["executed","completed","issued","received","registered","confirmed","approved","done"].some((x) => s.includes(x))) return "#10b981";
        if (["rejected","cancelled"].some((x) => s.includes(x))) return colors.destructive;
        return "#f59e0b";
      };
      type LStep = { key: string; label: string; status: string | null | undefined; note?: string | null; show: boolean };
      const steps: LStep[] = lm ? [
        { key: "agreement",  label: "Agreement",        status: lm.AgreementStatus,    note: lm.AgreementNo,  show: true },
        { key: "afs-qp",     label: "AFS Query Payment",status: lm.AfsQPStatus,        note: lm.AfsQPNo,      show: !!lm.AfsQPId },
        { key: "afs-reg",    label: "AFS Registration", status: lm.AfsRegistryStatus,  note: lm.AfsRegNo,     show: !!(lm.AfsRegistryId || lm.AfsQPId) },
        { key: "noc",        label: `NOC (${lm.NocResolvedType || "Organisation"})`, status: lm.BankNocStatus || lm.OrgNocStatus, note: lm.BankNocNo || lm.OrgNocNo, show: true },
        { key: "occc",       label: "OC / CC",          status: lm.OcCcReceived ? "Received" : null,           note: null,           show: true },
        { key: "possession", label: "Possession",       status: lm.HandoverStatus || lm.PossessionNoticeStatus || lm.PrePossessionStatus, note: null, show: true },
        { key: "sale-deed",  label: "Sale Deed",        status: lm.SalesDeedId ? (lm.RegistryStatus || "In Progress") : null, note: lm.DeedNo, show: true },
        { key: "registry",   label: "Registry",         status: lm.RegistryStatus,     note: lm.RegNo,        show: !!(lm.SalesDeedId || lm.QueryPaymentId) },
        { key: "mutation",   label: "Mutation",         status: lm.MutationStatus,     note: lm.MutationNo,   show: lm.RegistryStatus === "Completed" || !!lm.MutationId },
      ].filter((s) => s.show) : agr ? [
        { key: "agreement",  label: "Agreement",        status: agr.Status,            note: agr.AgreementNo, show: true },
      ] : [];
      // Badge = furthest meaningful step
      const badge = (() => {
        if (!lm && !agr) return null;
        if (lm?.MutationStatus) return lm.MutationStatus === "Completed" ? "Mutation Done" : "Mutation";
        if (lm?.RegistryStatus === "Completed") return "Deed Registered";
        if (lm?.SalesDeedId) return "Sale Deed";
        if (lm?.HandoverStatus) return words(lm.HandoverStatus);
        if (lm?.BankNocStatus || lm?.OrgNocStatus) return "NOC";
        const agrStatus = lm?.AgreementStatus || agr?.Status;
        if (agrStatus) return agrStatus === "Executed" || agrStatus === "Registered" ? "Agreement Executed" : words(agrStatus);
        return "Not started";
      })();
      const badgeTone = (() => {
        const s = badge?.toLowerCase() ?? "";
        if (["registered","done","executed","received"].some((x) => s.includes(x))) return "#10b981";
        if (!badge || badge === "Not started") return undefined;
        return "#f59e0b";
      })();
      return steps.length ? {
        key: "legal",
        label: "Legal journey",
        icon: Scale,
        badge,
        tone: badgeTone,
        body: (
          <View style={{ gap: 0 }}>
            {steps.map((s, i) => (
              <View key={s.key} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: dotColor(s.status), borderWidth: s.status ? 0 : 1, borderColor: colors.mutedForeground }} />
                <Text style={{ flex: 1, fontSize: 13, fontFamily: fonts.body.medium, color: colors.foreground }}>{s.label}</Text>
                <Text numberOfLines={1} style={{ maxWidth: 140, fontSize: 12, fontFamily: fonts.body.regular, color: s.status ? (dotColor(s.status) === "#10b981" ? "#10b981" : dotColor(s.status) === colors.destructive ? colors.destructive : "#f59e0b") : colors.mutedForeground, textAlign: "right" }}>
                  {s.status ? joinDot(words(s.status), s.note) : "—"}
                </Text>
              </View>
            ))}
          </View>
        ),
      } : null;
    })(),
    canAccessPage("crm-noc") && { key: "noc", label: "NOC", icon: FileText,
      go: () => nav.navigate("CrmNoc", { bookingId: id, title: `NOC — ${title}` }) },
    canAccessPage("crm-sales-deed") && { key: "sale-deed", label: "Sale Deed", icon: Scale,
      go: () => nav.navigate("CrmSaleDeed", { bookingId: id, title: `Sale Deed — ${title}` }) },
    canAccessPage("crm-mutation") && { key: "mutation", label: "Mutation", icon: FileText,
      go: () => nav.navigate("CrmMutation", { bookingId: id, title: `Mutation — ${title}` }) },
    seesLoan && loanQ.data && { key: "loan", label: "Home loan", icon: Landmark, badge: !loan?.SanctionStatus || loan.SanctionStatus === "NotApplied" ? "Not applied" : loan.SanctionStatus,
      tone: loan?.SanctionStatus === "Sanctioned" || loan?.SanctionStatus === "Disbursed" ? "#10b981" : loan?.SanctionStatus === "Applied" ? "#f59e0b" : undefined,
      body: <>
              <Kv label="Status" value={!loan?.SanctionStatus || loan.SanctionStatus === "NotApplied" ? "Not applied" : loan.SanctionStatus} />
              {loan?.BankName ? <Kv label="Bank" value={joinDot(loan.BankName, loan.BranchName)} /> : null}
              {Number(loan?.LoanAmount) > 0 ? <Kv label="Loan amount" value={money(loan?.LoanAmount)} /> : null}
              {loan?.SanctionDate ? <Kv label="Sanction date" value={fmtDate(loan.SanctionDate)} /> : null}
              {Number(loan?.DisbursedAmount) > 0 ? <Kv label="Disbursed (home-loan receipts)" value={money(loan?.DisbursedAmount)} /> : null}
              {live && canDoAction("crm-loan-details", "edit") ? (
                <View style={{ flexDirection: "row", marginTop: 8 }}><ActionKey outline label={loan?.LoanId != null ? "Edit loan" : "Record loan"} onPress={openLoan} /></View>
              ) : null}
      </> },
    seesBooking && { key: "charges", label: "Parking & Extra Charges", icon: Car,
      go: () => nav.navigate("CrmBookingCharges", { bookingId: id, title }) },
    canAccessPage("crm-brokerage") && b?.BrokerName && {
      key: "brokerage", label: "Brokerage", icon: Handshake,
      badge: b.BrokerName as string,
      body: <>
              <Kv label="Broker" value={b.BrokerName as string} />
              {Number(b.BrokerageTotal) > 0 ? <Kv label="Total commission" value={money(b.BrokerageTotal)} /> : null}
              {Number(b.BrokeragePaid) > 0 ? <Kv label="Paid" value={money(b.BrokeragePaid)} /> : null}
              {Number(b.BrokerageTotal) > 0 && Number(b.BrokerageTotal) > Number(b.BrokeragePaid) ? (
                <Kv label="Balance" value={money(Number(b.BrokerageTotal) - Number(b.BrokeragePaid))} />
              ) : null}
              <View style={{ flexDirection: "row", marginTop: 8 }}>
                <ActionKey outline label="View brokerage" onPress={() => nav.navigate("CrmRegister", { register: "brokerage" })} />
              </View>
      </> },
    ["crm-pre-possession", "crm-possession-notice", "crm-handover"].some((pg) => canAccessPage(pg)) && status === "Approved" &&
      { key: "possession", label: "Possession and handover", icon: KeyRound, go: () => nav.navigate("CrmPossession", { bookingId: id, title }) },
    seesTickets && { key: "tickets", label: "Service tickets", icon: Ticket, badge: `${openTickets} open`, tone: openTickets ? "#f59e0b" : undefined,
      body: <>
              {tickets.length === 0 ? <Empty text="No service tickets." /> : tickets.map((t) => (
                <LinkRow key={t.Id} title={t.Subject || t.TicketNo} sub={joinDot(t.TicketNo, t.Category, fmtDate(t.CreatedAt), t.AssigneeName)}
                  right={<Pill label={t.Status} />} onPress={() => open({ to: "ticket", ticketId: t.Id })} />
              ))}
      </> },
    portal && { key: "home", label: "Civilier Home", icon: Smartphone, badge: portal.hasPortal ? (portal.isActive ? "Active" : "Deactivated") : "Not set up",
      tone: portal.hasPortal && portal.isActive ? "#10b981" : undefined,
      body: <>
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
      </> },
    canEditBooking && b && !b.IsPlotSale && { key: "unit", label: "Change unit", icon: ArrowLeftRight, go: () => setChangeUnit(true) },
    canResale && { key: "resale", label: "Resale / Buy-back", icon: RefreshCw, go: () => setResaleDialog(true) },
    canOwnership && { key: "ownership", label: "Ownership change", icon: UserCheck, go: () => setOwnershipDialog(true) },
    canCancelBooking && { key: "cancel", label: "Cancel booking", icon: XCircle, tone: colors.destructive, go: () => setCancelDialog(true) },
  ].filter(Boolean) as never;
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
          {/* 1. Who and the money at a glance */}
          <View style={{ marginBottom: 12 }}>
            <HeroSurface padding={18}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: ON_HERO.glass, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontSize: 16, fontFamily: fonts.heading.semibold, color: ON_HERO.primary }}>{initials(customer?.CustomerName || head.ApplicantName)}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontSize: 18, fontFamily: fonts.heading.semibold, color: ON_HERO.primary }}>{customer?.CustomerName || head.ApplicantName || "—"}</Text>
                  <Text numberOfLines={2} style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: ON_HERO.secondary, marginTop: 2 }}>
                    {joinDot([head.BlockName, head.UnitNo].filter(Boolean).join(" / "), head.UnitType, head.ProjectName)}
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
                {[status && words(status), head.BookingDate && `Booked ${fmtDate(head.BookingDate)}`, customer?.InvoiceMode && (customer.InvoiceMode === "NonInvoice" ? "Non-invoice customer" : "Invoice customer"),
                  overdue > 0 ? `${overdue} overdue` : "No overdue"].filter(Boolean).map((t) => (
                  <View key={String(t)} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: String(t).includes(" overdue") && overdue > 0 ? "rgba(248,113,113,0.28)" : ON_HERO.glass }}>
                    <Text style={{ fontSize: 11.5, fontFamily: fonts.heading.semibold, color: ON_HERO.primary }}>{t}</Text>
                  </View>
                ))}
              </View>
              {sum ? (
                <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
                  {[
                    { label: "Price", value: `₹${formatCompactINR(price)}` },
                    { label: "Collected", value: `₹${formatCompactINR(sum.totalPaid)}`, sub: `${price ? Math.round((Number(sum.totalPaid) / price) * 100) : 0}%` },
                    { label: "Balance", value: `₹${formatCompactINR(moneyInfo?.toCollect ?? sum.balance)}`, strong: true },
                  ].map((f) => (
                    <View key={f.label} style={{ flex: 1, borderRadius: 12, padding: 10, backgroundColor: f.strong ? "rgba(255,255,255,0.18)" : ON_HERO.glass }}>
                      <Text style={{ fontSize: 11, fontFamily: fonts.body.medium, color: ON_HERO.secondary }}>{f.label}</Text>
                      <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: 15, fontFamily: fonts.heading.semibold, color: ON_HERO.primary, marginTop: 2 }}>{f.value}</Text>
                      {f.sub ? <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: ON_HERO.secondary }}>{f.sub}</Text> : null}
                    </View>
                  ))}
                </View>
              ) : null}
              <View style={{ marginTop: 14 }}><ContactKeys mobile={customer?.Mobile || head.Mobile} /></View>
            </HeroSurface>
          </View>

          {head.IsFrozen ? (
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: 12, borderWidth: 1, borderColor: `${colors.destructive}4d`, backgroundColor: `${colors.destructive}0d`, padding: 14, marginBottom: 12 }}>
              <Lock size={14} color={colors.destructive} style={{ marginTop: 1 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: colors.destructive }}>{"Booking Frozen"}{head.FreezeReason ? ` — ${head.FreezeReason}` : ""}</Text>
                {head.FreezeExpiresAt ? <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.destructive, marginTop: 2 }}>{`Freeze expires ${fmtDate(head.FreezeExpiresAt)}`}</Text> : null}
                <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 2 }}>{"All changes are blocked — contact an admin to unfreeze."}</Text>
              </View>
            </View>
          ) : null}

          {!moneyOnly ? <>
          {/* 2. Where it stands: the journey's current step, in the server's own words, with its key */}
          {nextStep && live && !inApproval ? (
            <View style={{ ...card, padding: 14, marginBottom: 12, borderColor: `${CRM}66`, backgroundColor: `${CRM}14` }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 11.5, fontFamily: fonts.heading.semibold, color: CRM }}>Next step</Text>
                <Text style={{ fontSize: 11.5, fontFamily: fonts.body.medium, color: CRM }}>{`Step ${stepIndex + 1} of ${steps.length}`}</Text>
              </View>
              <Text style={{ fontSize: 16.5, fontFamily: fonts.heading.semibold, color: colors.foreground, marginTop: 3 }}>{nextStep.label}</Text>
              {nextStep.todo || nextStep.blockedBy ? (
                <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 3 }}>{nextStep.todo || nextStep.blockedBy}</Text>
              ) : null}
              {nextKeys.length ? (
                <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                  {nextKeys.map((k, i) => <ActionKey key={k.label} label={k.label} outline={i > 0} onPress={k.go} />)}
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Booking approval: the path (Data review → Marketing Head → Director), and at Data review each item with the
              facts it asks to check, so the verifier compares them with the papers right here. */}
          {inApproval && live ? (
            <View style={{ ...card, padding: 14, marginBottom: 12 }}>
              <Text style={{ fontSize: 15, fontFamily: fonts.heading.semibold, color: colors.foreground }}>Booking approval</Text>
              <View style={{ flexDirection: "row", alignItems: "center", marginTop: 12, marginBottom: 4 }}>
                {APPROVAL_PATH.map((st, i) => {
                  const at = APPROVAL_PATH.indexOf(stage as (typeof APPROVAL_PATH)[number]);
                  const done = i < at;
                  const now = i === at;
                  return (
                    <View key={st} style={{ flex: 1, alignItems: "center" }}>
                      <View style={{ flexDirection: "row", alignItems: "center", width: "100%" }}>
                        <View style={{ flex: 1, height: 2, backgroundColor: i === 0 ? "transparent" : done || now ? CRM : colors.border }} />
                        <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: done ? CRM : now ? `${CRM}26` : colors.background, borderWidth: now ? 1.5 : 0, borderColor: CRM }}>
                          {done ? <Check size={13} color="#fff" /> : <Text style={{ fontSize: 11.5, fontFamily: fonts.heading.semibold, color: now ? CRM : colors.mutedForeground }}>{i + 1}</Text>}
                        </View>
                        <View style={{ flex: 1, height: 2, backgroundColor: i === APPROVAL_PATH.length - 1 ? "transparent" : done ? CRM : colors.border }} />
                      </View>
                      <Text style={{ fontSize: 11.5, fontFamily: now ? fonts.heading.semibold : fonts.body.medium, color: now ? colors.foreground : colors.mutedForeground, marginTop: 5, textAlign: "center" }}>{st === "Review" ? "Data review" : words(st).replace(/ Approval$/, "")}</Text>
                    </View>
                  );
                })}
              </View>
              {stageState?.StageRemarks && stageState?.RejectedFromStage ? (
                <View style={{ marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: `${colors.destructive}14` }}>
                  <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: colors.destructive }}>{`Sent back by the ${words(stageState.RejectedFromStage).replace(/ Approval$/, "")}`}</Text>
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.foreground, marginTop: 2 }}>{stageState.StageRemarks}</Text>
                </View>
              ) : null}

              {stage === "Review" ? (
                <>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 14 }}>
                    <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: colors.mutedForeground }}>Check each item against the papers</Text>
                    <Text style={{ fontSize: 12.5, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{`${checkedN} of ${checkItems.length} verified`}</Text>
                  </View>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden", marginTop: 6, marginBottom: 6 }}>
                    <View style={{ width: `${checkItems.length ? (checkedN / checkItems.length) * 100 : 0}%`, height: 6, backgroundColor: "#10b981" }} />
                  </View>
                  {checkItems.map((it, n) => {
                    const st = it.CheckStatus;
                    const ok = st === "Checked";
                    const flagged = st === "NeedsRecheck";
                    const facts = reviewFacts(it.ItemKey);
                    return (
                      <View key={it.ItemKey} style={{ marginTop: 10, borderRadius: 12, borderWidth: 1, borderColor: flagged ? `${colors.destructive}66` : ok ? "#10b98155" : colors.border, padding: 12,
                        backgroundColor: flagged ? `${colors.destructive}0d` : ok ? "#10b9810d" : "transparent" }}>
                        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                          <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: ok ? "#10b981" : flagged ? colors.destructive : colors.background, marginTop: 1 }}>
                            {ok ? <Check size={13} color="#fff" /> : <Text style={{ fontSize: 11, fontFamily: fonts.heading.semibold, color: flagged ? "#fff" : colors.mutedForeground }}>{flagged ? "!" : n + 1}</Text>}
                          </View>
                          <Text style={{ flex: 1, fontSize: 13.5, lineHeight: 19, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{it.ItemLabel}</Text>
                        </View>
                        {facts.length ? (
                          <View style={{ marginTop: 8, marginLeft: 32, padding: 10, borderRadius: 10, backgroundColor: colors.background, gap: 4 }}>
                            {facts.map(([k, v]) => (
                              <View key={k} style={{ flexDirection: "row", gap: 10 }}>
                                <Text style={{ width: 92, fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{k}</Text>
                                <Text style={{ flex: 1, fontSize: 12.5, fontFamily: fonts.body.medium, color: v ? colors.foreground : colors.destructive }}>{v || "Not on file"}</Text>
                              </View>
                            ))}
                          </View>
                        ) : null}
                        {it.Remarks ? <Text style={{ marginTop: 8, marginLeft: 32, fontSize: 12, fontFamily: fonts.body.regular, color: flagged ? colors.destructive : colors.mutedForeground }}>{flagged ? "Flagged: " : "Remark: "}{it.Remarks}</Text> : null}
                        {canVerify && !flagged ? (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginTop: 10, marginLeft: 32 }}>
                            <View style={{ flex: 1, flexDirection: "row" }}>
                              <ActionKey label={busyStage === it.ItemKey ? "Saving\u2026" : ok ? "Untick" : "Verify"} outline={ok} onPress={() => checkItem(it, ok ? "uncheck" : "check")} />
                            </View>
                            {!ok ? (
                              <Tap onPress={() => setFlagItem(it)} accessibilityRole="button" style={{ paddingVertical: 6 }}>
                                <Text style={{ fontSize: 12.5, fontFamily: fonts.heading.semibold, color: colors.destructive, textDecorationLine: "underline" }}>Flag for Recheck</Text>
                              </Tap>
                            ) : null}
                          </View>
                        ) : null}
                        {canEditBooking && flagged ? (
                          <View style={{ flexDirection: "row", marginTop: 10, marginLeft: 32 }}>
                            <ActionKey label={busyStage === it.ItemKey ? "Sending\u2026" : "I\u2019ve revised this \u2014 resend for recheck"} outline onPress={() => checkItem(it, "resubmit")} />
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                  {canVerify ? (
                    <View style={{ flexDirection: "row", marginTop: 14 }}>
                      <ActionKey label={busyStage === "verify" ? "Submitting\u2026" : "Verify & Send for Approval"} outline={checkedN < checkItems.length}
                        onPress={() => stageAction("verify", () => crmSend(`/api/crm/bookings/${id}/ready-for-approval`, "PUT"), (r) => `Data review complete — sent to ${r?.label || "Marketing Head Approval"}`)} />
                    </View>
                  ) : canEditBooking ? (
                    <Text style={{ marginTop: 12, fontSize: 12.5, fontFamily: fonts.body.medium, color: colors.mutedForeground }}>Waiting for data verification</Text>
                  ) : null}
                </>
              ) : (
                <>
                  <Text style={{ marginTop: 12, fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>
                    {canActOnStage ? `Data review is complete. Approve, or send it back with what needs correcting.` : `Waiting for the ${words(stage).replace(/ Approval$/, "")}`}
                  </Text>
                  {canActOnStage && sendBackChoices.length > 1 ? (
                    <Chips label="If sent back, it goes" options={sendBackChoices} value={sendBackTo ?? sendBackChoices[0]} onChange={setSendBackTo}
                      labelOf={(c) => (c === "Review" ? "To Data Review" : `To the ${words(c).replace(/ Approval$/, "")}`)} />
                  ) : null}
                  {canActOnStage ? (
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                      <ActionKey label="Reject" outline tone={colors.destructive} onPress={() => { if (!sendBackTo) setSendBackTo(sendBackChoices[0] ?? null); setSendBack(true); }} />
                      <ActionKey label={busyStage === "approve" ? "Approving\u2026" : stage === "DirectorApproval" ? "Final Approve" : "Approve"}
                        onPress={() => stageAction("approve", () => crmSend(`/api/crm/bookings/${id}/approve`, "PUT"), (r) => r?.confirmed ? "Booking confirmed" : `Approved - moved to ${r?.label || "next stage"}`)} />
                    </View>
                  ) : null}
                </>
              )}
            </View>
          ) : null}

          {/* 3. Quick actions */}
          {quick.length ? (
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
              {quick.map((a) => (
                <Tap key={a.key} onPress={a.go} accessibilityRole="button" accessibilityLabel={a.label} style={({ pressed }) => ({ flex: 1, alignItems: "center", gap: 5, opacity: pressed ? 0.7 : 1 })}>
                  <View style={{ ...card, width: "100%", height: 48, alignItems: "center", justifyContent: "center", padding: 0 }}>
                    <a.icon size={20} color={CRM} />
                  </View>
                  <Text numberOfLines={1} style={{ fontSize: 11.5, fontFamily: fonts.body.medium, color: colors.foreground }}>{a.label}</Text>
                </Tap>
              ))}
            </View>
          ) : null}

          </> : null}

          {/* 4. Account, in accounting terms */}
          {moneyInfo && sum ? (
            <Section title="Account">
              <View style={{ flexDirection: "row", height: 10, borderRadius: 5, overflow: "hidden", backgroundColor: colors.border, marginBottom: 6 }}>
                <View style={{ width: pct(moneyInfo.collected ?? sum.totalPaid), backgroundColor: "#10b981" }} />
                <View style={{ width: pct(moneyInfo.inVerification), backgroundColor: "#f59e0b" }} />
              </View>
              <View style={{ flexDirection: "row", gap: 12, marginBottom: 8 }}>
                {[["#10b981", "Cleared"], ["#f59e0b", "With Finance"], [colors.border, "To collect"]].map(([c, t]) => (
                  <View key={t} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: c }} />
                    <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{t}</Text>
                  </View>
                ))}
              </View>
              <Kv label="Sale value (incl. GST)" value={money(price)} />
              <Kv label="Demanded so far" value={money(demanded)} />
              <Kv label="Received and cleared" value={money(sum.totalPaid)} />
              <Kv label="With Finance for approval" value={Number(moneyInfo.inVerification) > 0 ? `${money(moneyInfo.inVerification)} (${moneyInfo.inVerificationCount})` : money(0)} tone={Number(moneyInfo.inVerification) > 0 ? "#f59e0b" : undefined} />
              <Kv label="On account, unapplied" value={money(pb?.OnAccountAvailable)} />
              {Number(payQ.data?.summary?.waivedDue) > 0 ? <Kv label={`Waived (${payQ.data?.summary?.waivedCount})`} value={money(payQ.data?.summary?.waivedDue)} /> : null}
              {Number(moneyInfo.excess) > 0 ? <Kv label="Paid over the price" value={money(moneyInfo.excess)} tone="#f59e0b" /> : null}
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderTopColor: colors.border, marginTop: 6, paddingTop: 10 }}>
                <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: colors.foreground }}>Balance receivable</Text>
                <Text style={{ fontSize: 17, fontFamily: fonts.heading.semibold, color: colors.foreground, fontVariant: ["tabular-nums"] }}>{money(moneyInfo.toCollect)}</Text>
              </View>
            </Section>
          ) : null}

          {/* 5. Payment schedule: a timeline; the next one due (or the one tapped) shows its keys */}
          <Section title="Payment schedule" right={<Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: colors.mutedForeground }}>{`${paidCount} of ${milestones.length} paid`}</Text>}>
            {milestones.length === 0 ? <Empty text="No milestones." /> : (
              <View style={{ paddingLeft: 18 }}>
                <View style={{ position: "absolute", left: 5, top: 10, bottom: 10, width: 1, backgroundColor: colors.border }} />
                {shownList.map((m) => {
                  const isOpen = shownMs === m.Id;
                  const paid = m.Status === "Paid" || m.Status === "Waived";
                  const dot = paid ? "#10b981" : Number(m.PendingVerificationAmount) > 0 ? "#f59e0b" : m.IsOverdue ? colors.destructive : m.Id === nextOpenId ? CRM : null;
                  const state = m.Status === "Waived" ? "Waived" : m.Status === "Paid" ? "Paid" : m.IsOverdue ? "Overdue"
                    : Number(m.PendingVerificationAmount) > 0 ? `${money(m.PendingVerificationAmount)} with Finance`
                    : m.DemandStatus === "Demanded" ? `Demanded${m.DemandNo ? ` · ${m.DemandNo}` : ""}` : "Demand not raised";
                  return (
                    <View key={m.Id} style={{ marginBottom: 6, marginLeft: isOpen ? -8 : 0, padding: isOpen ? 10 : 0, paddingVertical: isOpen ? 10 : 6, borderRadius: 12, backgroundColor: isOpen ? colors.background : "transparent" }}>
                      <View style={{ position: "absolute", left: isOpen ? -12 : -18 + 0, top: isOpen ? 15 : 11, width: 11, height: 11, borderRadius: 6, backgroundColor: dot ?? colors.card, borderWidth: dot ? 0 : 1, borderColor: colors.mutedForeground }} />
                      <Tap onPress={() => setOpenMs(isOpen ? -1 : m.Id)} accessibilityRole="button" accessibilityLabel={`${m.MilestoneName}, actions`}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                          <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, fontFamily: isOpen || m.Id === nextOpenId ? fonts.heading.semibold : fonts.body.medium, color: paid ? colors.mutedForeground : colors.foreground }}>
                            {`${m.MilestoneNo}. ${m.MilestoneName}${m.Percent ? ` · ${m.Percent}%` : ""}`}
                          </Text>
                          <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: paid ? colors.mutedForeground : colors.foreground, fontVariant: ["tabular-nums"] }}>{money(m.AmountDue)}</Text>
                        </View>
                        <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: m.IsOverdue && !paid ? colors.destructive : colors.mutedForeground, marginTop: 2 }}>
                          {joinDot(m.DueDate && `Due ${fmtDate(m.DueDate)}`, state, Number(m.AmountPaid) > 0 && !paid && `${money(m.AmountPaid)} paid`)}
                        </Text>
                      </Tap>
                      {isOpen && canPay && payQ.data && !paid && milestoneMissing(m) > 0 ? (
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                          {m.DemandStatus === "Pending" ? (
                            <ActionKey half label={busyMs === m.Id ? "Raising\u2026" : "Raise demand"}
                              onPress={() => msAction(m, () => crmSend(`/api/crm/payments/${m.Id}/demand`, "POST", {}), (r) => `Demand ${r?.DemandNo ?? ""} raised`)} />
                          ) : null}
                          <ActionKey half label="Record payment" outline={m.DemandStatus === "Pending"} onPress={() => nav.navigate("CrmPayment", { bookingId: id, milestoneId: m.Id, title })} />
                          {applyTarget?.Id === m.Id && deposits.length > 0 ? <ActionKey half label="Apply on account" outline onPress={() => setApplyTo(m)} /> : null}
                          {m.DemandStatus === "Demanded" ? (
                            <ActionKey half label={busyMs === m.Id ? "Undoing\u2026" : "Undo demand"} outline tone={colors.mutedForeground}
                              onPress={() => msAction(m, () => crmSend(`/api/crm/payments/${m.Id}/demand/undo`, "PATCH"), () => "Demand reverted to Not Raised")} />
                          ) : null}
                          <ActionKey half label="Waive" outline tone={colors.mutedForeground} onPress={() => setWaiveFor(m)} />
                        </View>
                      ) : null}
                    </View>
                  );
                })}
                {hiddenCount > 0 ? (
                  <Tap onPress={() => setAllMs(true)} accessibilityRole="button" style={{ paddingVertical: 8 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ fontSize: 12.5, fontFamily: fonts.heading.semibold, color: CRM }}>{`+ ${hiddenCount} more`}</Text>
                      <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: colors.mutedForeground }}>{money(hiddenTotal)}</Text>
                    </View>
                  </Tap>
                ) : null}
              </View>
            )}
          </Section>

          {/* Waivers — the web's WaiverSection (payments/parts.tsx): who asked, who decided, why; Reverse an approved one. */}
          {(payQ.data?.waivers ?? []).length ? (
            <Section title={`Waivers (${payQ.data!.waivers!.length})`}>
              {payQ.data!.waivers!.map((w: Row) => {
                const st = w.Status === "Pending" ? { label: "Awaiting approval", rev: false } : w.Status === "Rejected" ? { label: "Rejected", rev: false }
                  : w.ReversalStatus === "Approved" ? { label: "Reversed", rev: false } : w.ReversalStatus === "Pending" ? { label: "Reversal awaiting approval", rev: false }
                  : { label: "Waived", rev: true };
                return (
                  <View key={w.Id} style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border, gap: 3 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                      <Text style={{ flex: 1, fontSize: 14, fontFamily: fonts.body.medium, color: colors.foreground }}>{w.MilestoneNo} {w.MilestoneName}</Text>
                      <Pill label={st.label} />
                    </View>
                    <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Taxable value {money(w.TaxableValue)} · GST {money(w.GstAmount)} · Amount {money(w.Amount)}</Text>
                    {w.Reason ? <Text style={{ fontSize: 12.5, color: colors.foreground }}>{w.Reason}</Text> : null}
                    {w.RejectionNote ? <Text style={{ fontSize: 12, color: colors.destructive }}>Rejected: {w.RejectionNote}</Text> : null}
                    {w.ReversalReason ? <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Reversal: {w.ReversalReason}{w.ReversalRejectionNote ? ` (rejected: ${w.ReversalRejectionNote})` : ""}</Text> : null}
                    <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Asked by {w.RequestedByName || "—"} · {fmtDate(w.RequestedAt)}{w.DecidedAt ? ` · Decided by ${w.DecidedByName || "—"} · ${fmtDate(w.DecidedAt)}` : ""}</Text>
                    {canDoAction("crm-payments", "edit") && st.rev ? (
                      w.ReversalBlock ? <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{w.ReversalBlock}</Text> : (
                        <View style={{ flexDirection: "row", marginTop: 4 }}>
                          <ActionKey outline label="Reverse" onPress={() => { setReverseText(""); setReversing(w); }} />
                        </View>
                      )
                    ) : null}
                  </View>
                );
              })}
            </Section>
          ) : null}

          {!moneyOnly ? <>
          {/* 6. Journey: steps as chips — done, now, then the rest */}
          {steps.length ? (
            <Section title="Journey" right={<Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: colors.mutedForeground }}>{`${doneCount} of ${steps.length} done`}</Text>}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {steps.map((s) => {
                  const done = s.status === "done";
                  const now = s.status === "active";
                  return (
                    <View key={s.key} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
                      backgroundColor: done ? "#10b98122" : now ? `${CRM}22` : colors.background, borderWidth: now ? 1 : 0, borderColor: CRM }}>
                      {done ? <Check size={12} color="#10b981" /> : null}
                      <Text style={{ fontSize: 12, fontFamily: now ? fonts.heading.semibold : fonts.body.medium, color: done ? "#10b981" : now ? CRM : colors.mutedForeground }}>{s.label}</Text>
                      {done && s.date ? <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{s.date}</Text> : null}
                    </View>
                  );
                })}
              </View>
            </Section>
          ) : null}

          {/* 7. Papers */}
          {seesReceipts || seesInvoices || seesBooking ? (
            <Section title="Papers">
              {seesReceipts ? receipts.map((r) => (
                <View key={`r${r.Id}`}>
                  <LinkRow icon={FileText} title={`Money receipt ${r.ReceiptNo}`} sub={joinDot(money(r.Amount), fmtDate(r.ReceivedDate), r.PaymentMode, r.Status)}
                    onPress={() => nav.navigate("CrmMoneyReceipt", { receiptId: Number(r.Id), title: r.ReceiptNo || "Money Receipt" })} />
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
              {/* The web Payment & Invoice tab's Money Receipt card when none exists yet. */}
              {seesReceipts && !receiptsQ.isLoading && receipts.length === 0 ? (
                <View style={{ gap: 6, marginBottom: 8 }}>
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>
                    {stage === "Review" ? "Auto-generated when this booking is submitted for approval (Verify & Send for Approval)."
                      : "No money receipt yet — it is auto-created on submission. If it's missing, use the payment form above or click Retry."}
                  </Text>
                  {stage !== "Review" && canDoAction("crm-bookings", "edit") ? (
                    <View style={{ flexDirection: "row" }}>
                      <ActionKey outline label="Retry Auto-Create" onPress={async () => {
                        try {
                          const d = await crmSend<Row>(`/api/crm/bookings/${id}/trigger-money-receipt`, "POST");
                          toast.success(d.existing ? "Money receipt already exists — refreshed." : `Money Receipt ${d.ReceiptNo || ""} created.`);
                          qc.invalidateQueries({ queryKey: ["crm-booking-receipts", id] });
                        } catch (e) { toast.error((e as Error).message); }
                      }} />
                    </View>
                  ) : null}
                </View>
              ) : null}
              {seesInvoices ? invoices.map((v) => (
                <View key={`i${v.Id}`}>
                  <LinkRow icon={FileText} tone="#3b82f6" title={`Invoice ${v.InvoiceNo ?? v.Id}`}
                    sub={joinDot(v.InvoiceType, money(v.TotalAmount ?? v.GrandTotal ?? v.Amount), fmtDate(v.InvoiceDate ?? v.CreatedAt), v.Status)}
                    onPress={() => nav.navigate("CrmInvoice", { invoiceId: Number(v.Id), title: v.InvoiceNo || "Invoice" })} />
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
                  {/* The web Attachments tab's Delete: the booking's own files, while the booking isn't Approved. */}
                  {canEditBooking && status !== "Approved" && d.Source !== "application" ? (
                    <View style={{ flexDirection: "row", marginBottom: 8 }}>
                      <ActionKey outline tone={colors.destructive} label="Delete" onPress={async () => {
                        try { await crmSend(`/api/crm/bookings/${id}/attachments/${d.Id}`, "DELETE"); toast.success("Attachment removed"); qc.invalidateQueries({ queryKey: ["crm-booking-docs", id] }); }
                        catch (e) { toast.error((e as Error).message); }
                      }} />
                    </View>
                  ) : null}
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

          {/* 8. Buyer and unit */}
          {customer || b ? (
            <Section title="Buyer and unit">
              {customer ? (
                <LinkRow title={customer.CustomerName || customer.CustomerNo} sub={joinDot(customer.CustomerNo, customer.Mobile, customer.Email)}
                  onPress={canAccessPage("crm-customer-360") ? () => open({ to: "customer", customerId: Number(customer.Id), title: customer.CustomerName }) : undefined} />
              ) : null}
              {customer?.PanNo ? <Kv label="PAN" value={customer.PanNo} /> : null}
              {customer ? <Kv label="Address" value={joinDot(customer.Address, customer.City, customer.State, customer.Pincode)} /> : null}
              {customer ? <Kv label="Co-applicant" value={customer.CoApplicantName ? joinDot(customer.CoApplicantName, customer.CoApplicantRelation) : "None"} /> : null}
              {b ? <Kv label="Area · rate" value={joinDot(b.AreaSqFt && `${b.AreaSqFt} sq ft`, b.RatePerSqFt && `${money(b.RatePerSqFt)}/sq ft`)} /> : null}
              {b?.CarpetAreaSqFt ? <Kv label="Carpet area" value={`${b.CarpetAreaSqFt} sq ft`} /> : null}
              {b ? <Kv label="Unit value" value={money(b.TotalValue)} /> : null}
              {pb ? <Kv label="Parking · extras" value={`${money(pb.ParkingTotal)} · ${money(pb.ExtraChargesTotal)}`} /> : null}
              {b ? <Kv label="Booking amount" value={money(b.BookingAmount)} /> : null}
            </Section>
          ) : null}

          {/* 9. After-sales: one list, each line its status; tap to open */}
          {afterRows.length ? (
            <Section title="After-sales">
              {afterRows.map((r) => (
                <View key={r.key} style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
                  <Tap onPress={r.go ?? (() => setAfterOpen(afterOpen === r.key ? null : r.key))} accessibilityRole="button" accessibilityLabel={r.label}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 }}>
                      <r.icon size={17} color={colors.mutedForeground} />
                      <Text style={{ flex: 1, fontSize: 13.5, fontFamily: fonts.body.medium, color: colors.foreground }}>{r.label}</Text>
                      {r.badge ? <Pill label={r.badge} tone={r.tone} /> : null}
                      <ChevronRight size={16} color={colors.mutedForeground} style={{ transform: [{ rotate: !r.go && afterOpen === r.key ? "90deg" : "0deg" }] }} />
                    </View>
                  </Tap>
                  {!r.go && afterOpen === r.key ? <View style={{ paddingBottom: 12 }}>{r.body}</View> : null}
                </View>
              ))}
            </Section>
          ) : null}
          </> : null}
          {changeUnit && b ? <ChangeUnitDialog booking={{ ...pb, ...b }} onClose={() => setChangeUnit(false)} /> : null}
      {resaleDialog ? <ResaleDealDialog bookingId={id} sellerId={customer ? Number(customer.Id) : undefined} onClose={() => setResaleDialog(false)} /> : null}
      {ownershipDialog ? <OwnershipChangeDialog bookingId={id} fromCustomerId={customer ? Number(customer.Id) : undefined} onClose={() => setOwnershipDialog(false)} /> : null}
      {cancelDialog ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setCancelDialog(false)}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 16 }}>
            <View style={{ backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.border }}>
              <ScrollView contentContainerStyle={{ padding: 18, gap: 10 }} keyboardShouldPersistTaps="handled">
                <Text style={{ fontSize: 16, fontFamily: fonts.heading.bold, color: colors.destructive }}>Cancel booking</Text>
                <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginBottom: 4 }}>
                  A cancellation request is raised and goes for approval. The booking is not cancelled until it is approved.
                </Text>
                <RemarksField label="Reason (required)" value={cancelReason} onChangeText={setCancelReason} />
                <TextField label="Cancellation charge %" value={cancelPct} keyboardType="numeric"
                  placeholder="Leave blank for default from policy" onChangeText={setCancelPct} />
                <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                  <ActionKey label="Close" outline tone={colors.mutedForeground} onPress={() => setCancelDialog(false)} />
                  <ActionKey label={busyCancel ? "Raising…" : "Raise request"} tone={colors.destructive} onPress={submitCancel} />
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}
        </>
      )}
      <Modal visible={!!reversing} transparent animationType="fade" onRequestClose={() => { if (!reverseBusy) setReversing(null); }}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 16 }}>
          <View style={{ backgroundColor: colors.card, borderRadius: 18, padding: 18, gap: 10 }}>
            <Text style={{ fontSize: 17, fontFamily: fonts.heading.semibold, color: colors.foreground }}>Reverse this waiver?</Text>
            <Text style={{ fontSize: 12.5, color: colors.mutedForeground }}>{reversing?.MilestoneName}: {money(reversing?.Amount)} becomes due again once the reversal is approved.</Text>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: colors.mutedForeground }}>Reason</Text>
            <TextInput value={reverseText} onChangeText={setReverseText} multiline
              style={{ minHeight: 72, textAlignVertical: "top", borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, color: colors.foreground, fontFamily: fonts.body.regular }} />
            {reverseText.trim().length < 10 ? <Text style={{ fontSize: 11.5, color: colors.mutedForeground }}>Say why: at least 10 characters</Text> : null}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <ActionKey outline label="Cancel" onPress={() => { if (!reverseBusy) setReversing(null); }} />
              <ActionKey label={reverseBusy ? "Sending…" : "Send for approval"} onPress={async () => {
                if (reverseBusy || !reversing || reverseText.trim().length < 10) return;
                setReverseBusy(true);
                try {
                  await crmSend(`/api/crm/payments/waivers/${reversing.Id}/reverse`, "PUT", { Reason: reverseText.trim() });
                  toast.success("Reversal sent for approval"); setReversing(null); void payQ.refetch();
                } catch (e) { toast.error((e as Error).message || "Could not send the reversal"); }
                finally { setReverseBusy(false); }
              }} />
            </View>
          </View>
        </View>
      </Modal>
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

// The CRM jobs staff do from the phone — each one the web's own form, sent to the same server route with the same
// fields, so the rules, rights and approvals stay the server's:
//   WelcomeCallScreen  log a welcome call (crmWelcomeCalls.js POST /) — the web's Welcome Calls "Log call"
//   PaymentScreen      a payment against a milestone (crmPayments.js PUT /:id) or an on-account deposit
//                      (POST /booking/:id/on-account) — both go to Finance, then the Directors, before they count
//   NewTicketScreen    raise a service ticket on a booking (crmServiceTickets.js POST /)
// NotePrompt is the small "why / what was done" box the ticket screen uses.
import { useEffect, useRef, useState, useCallback } from "react";
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Check, FileText, Phone, Search, Square, User } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { fetchWithAuth } from "@/services/fetchWithAuth";
import { crmGet, crmSend, getBookingPayments, type Row } from "@/api/crmApi";
import { createServiceTicket, getAssignableStaff, TICKET_CATEGORIES, TICKET_PRIORITIES, type TicketCategory, type TicketPriority } from "@/api/serviceTicketApi";
import { FormScaffold, FormSection, NumberField, RemarksField, TextField } from "@/components/form/Form";
import { DateField } from "@/components/form/DateField";
import { OptionPickerModal, PickerRow } from "@/components/OptionPicker";
import { statusText } from "@/components/list/DataList";
import { toast } from "@/components/Toast";
import { openDocument } from "@/utils/documents";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { CERT_STATUS_LABEL, CERT_TYPE_LABEL, OUTCOME_LABEL, WELCOME_OUTCOMES } from "./crmRegisters";
import { ActionKey, CRM, Empty, Kv, LinkRow, Pill, Section, fmtDate, joinDot, money, words } from "./ui";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";

type Nav = NativeStackNavigationProp<MainStackParamList>;

/** Today, YYYY-MM-DD, where the person is (toISOString would give the UTC date, a day behind before 05:30 IST). */
const localDay = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const send = (url: string, method: "POST" | "PUT", body: object) => crmSend(url, method, body);

/** One choice from a few, as chips. */
export function Chips<T extends string>({ label, options, value, onChange, labelOf = statusText, required }: {
  label: string; options: readonly T[]; value: T | null; onChange: (v: T) => void; labelOf?: (v: T) => string; required?: boolean;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: fonts.body.medium, marginBottom: 8 }}>
        {label}{required ? <Text style={{ color: colors.destructive }}> *</Text> : null}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((o) => {
          const active = o === value;
          return (
            <Pressable key={o} onPress={() => onChange(o)}
              style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: active ? CRM : colors.border, backgroundColor: active ? `${CRM}26` : colors.card }}>
              <Text style={{ fontSize: 12.5, fontFamily: active ? fonts.heading.semibold : fonts.body.medium, color: active ? colors.foreground : colors.mutedForeground }}>{labelOf(o)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const Hint = ({ children }: { children: string }) => (
  <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, lineHeight: 17, marginBottom: 14 }}>{children}</Text>
);

/** A short required note (resolution notes, reopen reason) in a sheet. */
export function NotePrompt({ open, title, hint, placeholder, submitLabel, busy, danger, onSubmit, onClose }: {
  open: boolean; title: string; hint: string; placeholder: string; submitLabel: string; busy?: boolean; danger?: boolean;
  onSubmit: (text: string) => void; onClose: () => void;
}) {
  const [text, setText] = useState("");
  useEffect(() => { if (open) setText(""); }, [open]);
  const tone = danger ? colors.destructive : CRM;
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 20 }}>
        <View style={{ backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 18 }}>
          <Text style={{ fontSize: 16, fontFamily: fonts.heading.bold, color: colors.foreground }}>{title}</Text>
          <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 4, marginBottom: 12 }}>{hint}</Text>
          <TextInput value={text} onChangeText={setText} placeholder={placeholder} placeholderTextColor={`${colors.mutedForeground}99`} multiline autoFocus
            style={{ minHeight: 96, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13.5, textAlignVertical: "top" }} />
          <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
            <Pressable onPress={onClose} style={{ flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: colors.foreground }}>Cancel</Text>
            </Pressable>
            <Pressable disabled={busy || !text.trim()} onPress={() => onSubmit(text.trim())}
              style={{ flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 12, backgroundColor: tone, opacity: busy || !text.trim() ? 0.5 : 1 }}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: "#fff" }}>{submitLabel}</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Welcome call ─────────────────────────────────────────────────────────────
// Outcomes that mean the customer wasn't reached: the web pre-fills the next call for tomorrow (IntakeDialog.tsx).
const NOT_REACHED = ["NotReachable", "Busy", "SwitchedOff", "VoiceMail"];
type Outcome = (typeof WELCOME_OUTCOMES)[number];
type PlanAnswer = "yes" | "no" | "skip";
const PLAN_LABEL: Record<PlanAnswer, string> = { yes: "Agreed", no: "Not agreed", skip: "Not discussed" };

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function WelcomeCallScreen() {
  const nav = useNavigation<Nav>();
  const qc = useQueryClient();
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmWelcomeCall">>();
  const { canDoAction } = useAuth();
  const queue = useQuery({ queryKey: ["crm", "welcome-calls", ""], queryFn: async () => (await (await fetchWithAuth("/api/crm/welcome-calls/queue")).json()) as Row[] });
  const row = (queue.data ?? []).find((r) => Number(r.BookingId) === params.bookingId);

  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [minutes, setMinutes] = useState("");
  const [nextCall, setNextCall] = useState("");
  const [agreementDate, setAgreementDate] = useState("");
  const [plan, setPlan] = useState<PlanAnswer>("skip");
  const [dispute, setDispute] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The call timer: Call opens the dialler and starts it; Stop fills the duration.
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);
  const startCall = () => {
    if (row?.Mobile) Linking.openURL(`tel:${String(row.Mobile).replace(/\s/g, "")}`).catch(() => {});
    setSeconds(0);
    setRunning(true);
    timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  };
  const stopCall = () => {
    if (timer.current) clearInterval(timer.current);
    setRunning(false);
    setMinutes((seconds / 60).toFixed(1).replace(/\.0$/, ""));
  };

  const pickOutcome = (o: Outcome) => {
    setOutcome(o);
    setError(null);
    if (NOT_REACHED.includes(o) && !nextCall) setNextCall(localDay(1));
  };

  const submit = async () => {
    setError(null);
    if (!outcome) return setError("Select an outcome before logging the call.");
    if (plan === "no" && !dispute.trim()) return setError("Describe the customer's objection — required when the payment plan is not agreed.");
    const durationSeconds = running ? seconds : minutes ? Math.round(Number(minutes) * 60) : null;
    setBusy(true);
    try {
      await send("/api/crm/welcome-calls", "POST", {
        BookingId: params.bookingId,
        DurationSeconds: durationSeconds && durationSeconds > 0 ? String(durationSeconds) : null,
        Outcome: outcome,
        NextCallDate: nextCall || null,
        Notes: notes.trim() || null,
        PreferredAgreementDate: agreementDate || null,
        PaymentPlanConfirmed: plan === "yes" ? true : plan === "no" ? false : null,
        PaymentPlanDisputeReason: plan === "no" ? dispute.trim() : null,
      });
      if (timer.current) clearInterval(timer.current);
      ["crm", "crm-booking", "crm-booking-life", "crm-dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(outcome === "Welcomed" ? "Welcome call logged. Finish the verification checklist on the web." : "Welcome call logged");
      nav.goBack();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!canDoAction("crm-welcome-calls", "create")) {
    return <View style={{ flex: 1, backgroundColor: colors.background, padding: 16 }}><Empty text="You don't have the right to log welcome calls." /></View>;
  }

  return (
    <FormScaffold tone={CRM} toneInk="#fff" onSubmit={submit} submitLabel="Log call" onCancel={() => nav.goBack()} submitting={busy}>
      <Section title="Customer">
        <Kv label="Name" value={row?.ApplicantName ?? params.title} strong />
        <Kv label="Booking" value={row ? [row.BookingNo, row.UnitNo].filter(Boolean).join(" · ") : null} />
        <Kv label="Mobile" value={row?.Mobile} />
        {row?.LastOutcome ? <Kv label="Last call" value={OUTCOME_LABEL[row.LastOutcome] ?? row.LastOutcome} /> : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 }}>
          {running ? (
            <Pressable onPress={stopCall} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.destructive }}>
              <Square size={14} color="#fff" />
              <Text style={{ color: "#fff", fontFamily: fonts.heading.semibold, fontSize: 13 }}>End call · {mmss(seconds)}</Text>
            </Pressable>
          ) : (
            <Pressable onPress={startCall} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: "#3b82f6" }}>
              <Phone size={14} color="#fff" />
              <Text style={{ color: "#fff", fontFamily: fonts.heading.semibold, fontSize: 13 }}>Call and time it</Text>
            </Pressable>
          )}
        </View>
      </Section>

      <FormSection title="The call">
        <Chips label="Outcome" required options={WELCOME_OUTCOMES} value={outcome} onChange={pickOutcome} labelOf={(o) => OUTCOME_LABEL[o] ?? o} />
        <NumberField label="Duration (minutes)" value={running ? (seconds / 60).toFixed(1) : minutes} onChangeText={setMinutes} disabled={running} placeholder="e.g. 4.5" />
        <DateField label="Next call" value={nextCall} onChange={setNextCall} />
        {outcome === "Welcomed" ? <DateField label="Preferred agreement date" value={agreementDate} onChange={setAgreementDate} /> : null}
      </FormSection>

      {outcome === "Welcomed" ? (
        <FormSection title="Payment plan">
          <Chips label="Did the customer agree to the payment plan?" options={["yes", "no", "skip"] as const} value={plan} onChange={setPlan} labelOf={(p) => PLAN_LABEL[p]} />
          {plan === "no" ? <RemarksField label="Customer's objection" required value={dispute} onChangeText={setDispute} placeholder="What the customer disagrees with…" /> : null}
        </FormSection>
      ) : null}

      <FormSection title="Notes">
        <RemarksField label="Notes" value={notes} onChangeText={setNotes} placeholder="What was discussed…" />
        <Hint>The verification checklist, documents and co-applicants are completed on the web (CRM → Welcome Calls).</Hint>
      </FormSection>
      {error ? <Text style={{ color: colors.destructive, fontSize: 12.5, fontFamily: fonts.body.medium, marginBottom: 12 }}>{error}</Text> : null}
    </FormScaffold>
  );
}

// ── Payment ──────────────────────────────────────────────────────────────────
// The web's payment modes, and the ones that came out of a bank account (src/pages/CRM/payments/config.tsx).
const PAY_MODES = ["Cash", "Cheque", "NEFT", "RTGS", "UPI", "Home Loan", "Other"] as const;
const MODES_WITH_BANK = ["Cheque", "NEFT", "RTGS", "UPI", "Home Loan"];
type PayMode = (typeof PAY_MODES)[number];

/** What a milestone still misses: its due less what is settled, held on account, with Finance or recorded — the web's
 * milestoneFill (src/pages/CRM/payments/config.tsx), on the server's own figures. */
export const milestoneMissing = (m: Row) => {
  const due = Number(m.AmountDue) || 0;
  const settled = Math.min(due, Number(m.AmountPaid) || 0);
  const covered = (Number(m.HeldOnAccount) || 0) + (Number(m.WithFinanceCover) || 0) + (Number(m.RecordedCover) || 0);
  return Math.max(0, Math.round((due - settled - covered) * 100) / 100);
};
/** Apply an approved on-account deposit to the next outstanding milestone (the web's "Apply on-account to a milestone"
 *  dialog, CrmPaymentMilestones.tsx): pick the deposit, the amount defaults to what both allow; PUT /on-account/:id/apply. */
export function ApplyOnAccountPrompt({ milestone, deposits, busy, onApply, onClose }: {
  milestone: Row | null; deposits: Row[]; busy?: boolean;
  onApply: (deposit: Row, amount: number) => void; onClose: () => void;
}) {
  const [pick, setPick] = useState<Row | null>(null);
  const [amount, setAmount] = useState("");
  const balance = milestone ? Math.max(0, Number(milestone.AmountDue) - Number(milestone.AmountPaid || 0)) : 0;
  const choose = (d: Row) => { setPick(d); setAmount(String(Math.min(Number(d.AvailableBalance) || 0, balance))); };
  useEffect(() => { if (milestone) { setPick(null); setAmount(""); if (deposits.length === 1) choose(deposits[0]); } }, [milestone]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = parseFloat(amount);
  const ok = !!pick && n > 0;
  return (
    <Modal visible={!!milestone} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 20 }}>
        <View style={{ backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 18, gap: 10 }}>
          <Text style={{ fontSize: 16, fontFamily: fonts.heading.bold, color: colors.foreground }}>Apply on-account to a milestone</Text>
          <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>
            {milestone ? `${milestone.MilestoneName} · ${money(balance)} outstanding` : ""}
          </Text>
          {deposits.map((d) => {
            const on = pick?.Id === d.Id;
            return (
              <Pressable key={d.Id} onPress={() => choose(d)}
                style={{ flexDirection: "row", justifyContent: "space-between", padding: 12, borderRadius: 12, borderWidth: 1, borderColor: on ? CRM : colors.border, backgroundColor: on ? `${CRM}14` : "transparent" }}>
                <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{d.ReceiptNo}</Text>
                <Text style={{ fontSize: 13, fontFamily: fonts.body.medium, color: colors.mutedForeground }}>Available {money(d.AvailableBalance)}</Text>
              </Pressable>
            );
          })}
          <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: colors.mutedForeground }}>Amount to apply</Text>
          <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0"
            placeholderTextColor={`${colors.mutedForeground}99`}
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 14 }} />
          {ok && n >= balance ? <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: colors.foreground }}>Adjusts this milestone in full</Text> : null}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
            <Pressable onPress={onClose} style={{ flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: colors.foreground }}>Cancel</Text>
            </Pressable>
            <Pressable disabled={busy || !ok} onPress={() => pick && onApply(pick, n)}
              style={{ flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 12, backgroundColor: CRM, opacity: busy || !ok ? 0.5 : 1 }}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: "#fff" }}>Apply</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** The milestone a payment goes to next: the first not waived, not paid, still missing money (the web's nextOpenMilestone). */
export const nextOpenMilestone = (plan: Row[]) => plan.find((m) => m.Status !== "Waived" && m.Status !== "Paid" && milestoneMissing(m) > 0) ?? null;

export function PaymentScreen() {
  const nav = useNavigation<Nav>();
  const qc = useQueryClient();
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmPayment">>();
  const { canDoAction } = useAuth();
  const toMilestone = params.milestoneId != null;
  const allowed = canDoAction("crm-payments", toMilestone ? "edit" : "create");
  const payQ = useQuery({ queryKey: ["crm-booking-pay", params.bookingId], queryFn: () => getBookingPayments(params.bookingId), enabled: allowed });
  const milestone = toMilestone ? (payQ.data?.milestones ?? []).find((m) => m.Id === params.milestoneId) : null;
  const missing = milestone ? milestoneMissing(milestone) : 0;

  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(localDay());
  const [mode, setMode] = useState<PayMode | null>(null);
  const [bank, setBank] = useState("");
  const [ref, setRef] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A milestone payment starts at what is still due there (the web's handleOpenPayment).
  useEffect(() => { if (milestone && !amount && missing > 0) setAmount(String(missing)); }, [milestone?.Id]);

  const submit = async () => {
    setError(null);
    const value = Number(amount);
    if (!(value > 0)) return setError("Enter the amount received.");
    if (date > localDay()) return setError("The received date can't be in the future.");
    const bankName = mode && MODES_WITH_BANK.includes(mode) ? bank.trim() || null : null;
    setBusy(true);
    try {
      const data = toMilestone
        ? await send(`/api/crm/payments/${params.milestoneId}`, "PUT", {
            AmountPaid: value, PaidDate: date, PaymentMode: mode || undefined, BankName: bankName || undefined,
            TransactionRef: ref.trim() || undefined, Remarks: notes.trim() || undefined,
          })
        : await send(`/api/crm/payments/booking/${params.bookingId}/on-account`, "POST", {
            Amount: value, ReceivedDate: date, PaymentMode: mode, BankName: bankName, TransactionRef: ref.trim() || null, Notes: notes.trim() || null,
          });
      ["crm", "crm-booking", "crm-booking-pay", "crm-dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(`Sent to Finance for approval${data?.RPDocNo ? ` — ${data.RPDocNo}` : ""}. It counts as paid once approved.`);
      nav.goBack();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!allowed) {
    return <View style={{ flex: 1, backgroundColor: colors.background, padding: 16 }}><Empty text="You don't have the right to record payments." /></View>;
  }
  if (payQ.isLoading) return <View style={{ flex: 1, backgroundColor: colors.background }}><ActivityIndicator color={colors.mutedForeground} style={{ paddingVertical: 60 }} /></View>;

  const b = payQ.data?.booking;
  return (
    <FormScaffold tone={CRM} toneInk="#fff" onSubmit={submit} submitLabel="Submit for approval" onCancel={() => nav.goBack()} submitting={busy}>
      <Section title={toMilestone ? "Milestone" : "Booking"}>
        <Kv label="Booking" value={b ? [b.BookingNo, b.UnitNo].filter(Boolean).join(" · ") : params.title} strong />
        <Kv label="Buyer" value={b?.ApplicantName} />
        {milestone ? (
          <>
            <Kv label="Milestone" value={`${milestone.MilestoneNo}. ${milestone.MilestoneName}`} />
            <Kv label="Amount due" value={money(milestone.AmountDue)} />
            <Kv label="Balance" value={money(missing)} strong />
          </>
        ) : (
          <>
            <Kv label="Still to collect" value={money(payQ.data?.money?.toCollect)} strong />
            <Kv label="On account now" value={money(b?.OnAccountAvailable)} />
          </>
        )}
      </Section>
      <Hint>{toMilestone
        ? "Goes to Finance's Received Payment queue, then to the Directors. It counts as paid only once approved."
        : "Goes to Finance's Received Payment queue, then to the Directors. Once approved it's held as credit and applied to the next due milestone, in order."}</Hint>

      <FormSection title="Money received">
        <NumberField label="Amount (₹)" required value={amount} onChangeText={setAmount} />
        {Number(amount) > missing && toMilestone && missing > 0 ? (
          <Hint>{`${money(Number(amount) - missing)} more than this milestone's balance — the extra stays on account for the next milestone.`}</Hint>
        ) : null}
        <DateField label="Received date" required value={date} onChange={setDate} />
        <Chips label="Payment mode" options={PAY_MODES} value={mode} onChange={(m) => { setMode(m); if (!MODES_WITH_BANK.includes(m)) setBank(""); }} labelOf={(m) => m} />
        {mode && MODES_WITH_BANK.includes(mode) ? <TextField label="Customer's bank" value={bank} onChangeText={setBank} placeholder="Bank of customer" /> : null}
        <TextField label="Transaction ref" value={ref} onChangeText={setRef} placeholder="UTR / cheque / reference no." autoCapitalize="characters" />
        <RemarksField label="Notes" value={notes} onChangeText={setNotes} placeholder="Optional note for Finance…" />
        <Hint>Deposit bank — Accounts assigns it on the Received Payment before approving.</Hint>
      </FormSection>
      {error ? <Text style={{ color: colors.destructive, fontSize: 12.5, fontFamily: fonts.body.medium, marginBottom: 12 }}>{error}</Text> : null}
    </FormScaffold>
  );
}

// ── New service ticket ───────────────────────────────────────────────────────
export function NewTicketScreen() {
  const nav = useNavigation<Nav>();
  const qc = useQueryClient();
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmTicketNew">>();
  const { canDoAction } = useAuth();
  const allowed = canDoAction("crm-service-tickets", "create");
  const staffQ = useQuery({ queryKey: ["sa-users"], queryFn: getAssignableStaff, staleTime: 5 * 60_000, enabled: allowed });

  const [category, setCategory] = useState<TicketCategory>("ServiceRequest");
  const [priority, setPriority] = useState<TicketPriority>("Normal");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState<{ Id: number; Name: string } | null>(null);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!subject.trim()) return setError("Enter a subject.");
    setBusy(true);
    try {
      await createServiceTicket({ BookingId: params.bookingId, Category: category, Priority: priority, Subject: subject.trim(), Description: description.trim() || undefined, AssignedTo: assignee?.Id });
      ["crm", "crm-booking-tickets", "maint-service-requests"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success("Service ticket raised");
      nav.goBack();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!allowed) return <View style={{ flex: 1, backgroundColor: colors.background, padding: 16 }}><Empty text="You don't have the right to raise service tickets." /></View>;

  return (
    <FormScaffold tone={CRM} toneInk="#fff" onSubmit={submit} submitLabel="Raise ticket" onCancel={() => nav.goBack()} submitting={busy}>
      <Section title="Booking"><Kv label="Booking" value={params.title} strong /></Section>
      <FormSection title="Ticket">
        <Chips label="Category" options={TICKET_CATEGORIES} value={category} onChange={setCategory} />
        <Chips label="Priority" options={TICKET_PRIORITIES} value={priority} onChange={setPriority} labelOf={(p) => p} />
        <TextField label="Subject" required value={subject} onChangeText={setSubject} />
        <RemarksField label="Description" value={description} onChangeText={setDescription} />
        <PickerRow label="Assign to" value={assignee?.Name ?? ""} placeholder="— Unassigned —" onPress={() => setPicker(true)} />
      </FormSection>
      {error ? <Text style={{ color: colors.destructive, fontSize: 12.5, fontFamily: fonts.body.medium, marginBottom: 12 }}>{error}</Text> : null}
      <OptionPickerModal visible={picker} title="Assign to" searchable clearable loading={staffQ.isLoading}
        options={(staffQ.data ?? []).map((u) => ({ key: String(u.Id), label: u.Name }))}
        selectedKey={assignee ? String(assignee.Id) : null}
        onSelect={(k) => { setAssignee(k ? (staffQ.data ?? []).find((u) => String(u.Id) === k) ?? null : null); setPicker(false); }}
        onClose={() => setPicker(false)} />
    </FormScaffold>
  );
}

// ── Customer: new / edit ─────────────────────────────────────────────────────
// The web's New customer and open-customer forms (src/pages/crm/customers): the same fields in the same order,
// POST /api/crm/customers or PUT /:id. The server checks every field (mobile, PAN, GSTIN, Aadhaar, email, pincode,
// duplicates) and its message is shown as it is.
const CUSTOMER_FIELDS: { key: string; label: string; required?: boolean; keyboard?: "numeric" | "email-address"; caps?: "characters" | "none" | "words" }[] = [
  { key: "CustomerName", label: "Customer name", required: true, caps: "words" },
  { key: "Mobile", label: "Mobile", keyboard: "numeric" },
  { key: "AltMobile", label: "Alternate mobile", keyboard: "numeric" },
  { key: "Email", label: "Email", keyboard: "email-address", caps: "none" },
  { key: "PanNo", label: "PAN", caps: "characters" },
  { key: "GstNo", label: "GSTIN (if GST-registered)", caps: "characters" },
  { key: "AadhaarNo", label: "Aadhaar number", keyboard: "numeric" },
  { key: "Occupation", label: "Occupation" },
  { key: "AnnualIncome", label: "Annual income", keyboard: "numeric" },
];
const ADDRESS_PARTS = ["Address", "City", "State", "Pincode"] as const;

export function CustomerFormScreen() {
  const nav = useNavigation<Nav>();
  const qc = useQueryClient();
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmCustomerForm">>();
  const editId = params?.customerId;
  const { canDoAction } = useAuth();
  const allowed = canDoAction("crm-customers", editId ? "edit" : "create");
  const existing = useQuery({ queryKey: ["crm-customer", editId], enabled: allowed && !!editId,
    queryFn: () => crmGet<Row>(`/api/crm/customers/${editId}`) });
  // From a lead (CRM Leads → Create customer): its name and contacts, and the link the server checks.
  const lead = editId ? undefined : params?.lead;
  const [form, setForm] = useState<Row>(() => ({
    IsCurrentSameAsPermanent: true, InvoiceMode: "NonInvoice",
    ...(lead ? { LeadId: lead.Id, CustomerName: lead.CustomerName ?? "", Mobile: lead.Mobile ?? "", AltMobile: lead.AltMobile ?? "", Email: lead.Email ?? "" } : {}),
  }));
  const loaded = useRef(false);
  useEffect(() => {
    if (existing.data && !loaded.current) {
      loaded.current = true;
      const d = existing.data;
      setForm({ ...d, DateOfBirth: d.DateOfBirth ? String(d.DateOfBirth).slice(0, 10) : "", IsCurrentSameAsPermanent: d.IsCurrentSameAsPermanent !== false });
    }
  }, [existing.data]);
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const str = (k: string) => (form[k] == null ? "" : String(form[k]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!str("CustomerName").trim()) return setError("Enter the customer's name.");
    setBusy(true);
    try {
      const body = { ...form, DateOfBirth: str("DateOfBirth") || null, LeadId: form.LeadId || null };
      const r = editId ? await crmSend(`/api/crm/customers/${editId}`, "PUT", body) : await crmSend("/api/crm/customers", "POST", body);
      ["crm", "crm-customer", "crm-customer-360"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(editId ? "Customer updated" : `Customer ${r?.CustomerNo ?? ""} created`);
      nav.goBack();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  if (!allowed) return <View style={{ flex: 1, backgroundColor: colors.background, padding: 16 }}><Empty text={`You don't have the right to ${editId ? "edit" : "add"} customers.`} /></View>;
  if (editId && existing.isLoading) return <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: "center" }}><ActivityIndicator color={colors.mutedForeground} /></View>;

  const address = (prefix: "Permanent" | "Current") => ADDRESS_PARTS.map((part) => (
    <TextField key={prefix + part} label={part === "Address" ? (prefix === "Permanent" ? "Permanent address" : "Current address") : part}
      value={str(prefix + part)} onChangeText={(v) => set(prefix + part, v)} multiline={part === "Address"}
      keyboardType={part === "Pincode" ? "numeric" : "default"} />
  ));

  return (
    <FormScaffold tone={CRM} toneInk="#fff" onSubmit={submit} submitLabel={editId ? "Save" : "Add customer"} onCancel={() => nav.goBack()} submitting={busy}>
      <FormSection title="Person">
        {lead ? <Kv label="From lead" value={[lead.LeadUid, lead.CustomerName].filter(Boolean).join(" · ")} /> : null}
        {CUSTOMER_FIELDS.map((f) => (
          <TextField key={f.key} label={f.label} required={f.required} value={str(f.key)} onChangeText={(v) => set(f.key, v)}
            keyboardType={f.keyboard ?? "default"} autoCapitalize={f.caps ?? "sentences"} />
        ))}
        <DateField label="Date of birth" value={str("DateOfBirth")} onChange={(v: string) => set("DateOfBirth", v)} />
      </FormSection>
      <FormSection title="Address">
        {address("Permanent")}
        <Chips label="Current address is the same" options={["Yes", "No"] as const} value={form.IsCurrentSameAsPermanent ? "Yes" : "No"}
          onChange={(v) => set("IsCurrentSameAsPermanent", v === "Yes")} labelOf={(v) => v} />
        {form.IsCurrentSameAsPermanent ? null : address("Current")}
      </FormSection>
      <FormSection title="Billing">
        <Chips label="Non-invoice customers never get an invoice, here or in Accounts' Sale Invoice" options={["NonInvoice", "Invoice"] as const}
          value={form.InvoiceMode === "Invoice" ? "Invoice" : "NonInvoice"} onChange={(v) => set("InvoiceMode", v)}
          labelOf={(v) => (v === "NonInvoice" ? "Non-invoice" : "Invoice")} />
      </FormSection>
      <FormSection title="Notes">
        <RemarksField label="Notes" value={str("Notes")} onChangeText={(v) => set("Notes", v)} />
      </FormSection>
      {error ? <Text style={{ color: colors.destructive, fontSize: 12.5, fontFamily: fonts.body.medium, marginBottom: 12 }}>{error}</Text> : null}
    </FormScaffold>
  );
}

// ── Bank and KYC (one approved booking) ─────────────────────────────────────
// The web's Customer Bank Details dialog (src/pages/CRM/CrmCustomerBankDetails.tsx BankDetailDialog), the same in every
// part: opens read-only; Edit (the page's edit right, and the booking's assigned salesperson or an approver for
// crm-bank-details-edit in Approval Setup) unlocks it; Cancel puts back what is on file and locks again; Save sends the
// form to PUT /api/crm/customer-bank-details/booking/:id, locks again and says what happens next. The KYC bar, the
// welcome call / agreement line and the "no loan on file" note are the web's.
const BANK_EMPTY = {
  BankName: "", BranchName: "", AccountNo: "", IfscCode: "", AccountHolderName: "",
  PanNo: "", AadhaarNo: "", Occupation: "", AnnualIncome: "", Notes: "",
  FinancingType: "",
};
type BankForm = typeof BANK_EMPTY;
const BANK_REQUIRED: (keyof BankForm)[] = ["BankName", "AccountNo", "IfscCode", "AccountHolderName", "PanNo", "AadhaarNo", "Occupation", "FinancingType"];
const BANK_UPPER: (keyof BankForm)[] = ["PanNo", "IfscCode"];
function bankErrors(form: BankForm) {
  const e: Partial<Record<keyof BankForm, string>> = {};
  if (form.IfscCode && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.IfscCode.toUpperCase())) e.IfscCode = "IFSC looks like HDFC0001234.";
  if (form.PanNo && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(form.PanNo.toUpperCase())) e.PanNo = "PAN looks like ABCDE1234F.";
  if (form.AadhaarNo && !/^\d{12}$/.test(form.AadhaarNo.replace(/\s+/g, ""))) e.AadhaarNo = "Aadhaar is exactly 12 digits.";
  if (form.AccountNo && !/^\d{6,20}$/.test(form.AccountNo)) e.AccountNo = "Account number is 6 to 20 digits.";
  return e;
}
const toBankForm = (d: Row | null | undefined): BankForm => (d ? {
  BankName: d.BankName || "", BranchName: d.BranchName || "", AccountNo: d.AccountNo || "",
  IfscCode: d.IfscCode || "", AccountHolderName: d.AccountHolderName || "",
  PanNo: d.PanNo || "", AadhaarNo: d.AadhaarNo || "",
  Occupation: d.Occupation || "", AnnualIncome: d.AnnualIncome != null ? String(d.AnnualIncome) : "",
  Notes: d.Notes || "", FinancingType: d.FinancingType || "",
} : { ...BANK_EMPTY });
const orNull = (url: string) => crmGet<Row>(url).catch(() => null);

export function BankDetailsScreen() {
  const nav = useNavigation<Nav>();
  const qc = useQueryClient();
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmBankDetails">>();
  const { bookingId, row } = params;
  const { currentUser, canDoAction } = useAuth();
  const [form, setForm] = useState<BankForm>({ ...BANK_EMPTY });
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  const approverQ = useQuery({ queryKey: ["can-act", "crm-bank-details-edit"], staleTime: 5 * 60_000,
    queryFn: () => crmGet<{ canAct: boolean }>("/api/approval-workflows/can-act?module=crm-bank-details-edit").then((d) => !!d.canAct).catch(() => false) });
  const isAssigned = row.AssignedTo != null && currentUser?.id != null && Number(currentUser.id) === Number(row.AssignedTo);
  const hasRight = canDoAction("crm-customer-bank-details", "edit");
  const canEdit = hasRight && (!!approverQ.data || isAssigned);
  const [uiLocked, setUiLocked] = useState(true);
  const locked = !canEdit || uiLocked;

  const savedQ = useQuery({ queryKey: ["crm-bank-detail", bookingId], queryFn: () => orNull(`/api/crm/customer-bank-details/booking/${bookingId}`) });
  useEffect(() => { if (uiLocked) setForm(toBankForm(savedQ.data)); }, [savedQ.data, uiLocked]);
  const checklistQ = useQuery({ queryKey: ["crm-welcome-checklist", bookingId], queryFn: () => orNull(`/api/crm/welcome-calls/${bookingId}/checklist`) });
  const loanQ = useQuery({ queryKey: ["crm-loan-detail", bookingId], enabled: form.FinancingType === "LoanFinanced",
    queryFn: () => orNull(`/api/crm/bookings/${bookingId}/loan`) });

  const errors = bankErrors(form);
  const hasErrors = Object.keys(errors).length > 0;
  const filled = BANK_REQUIRED.filter((k) => String(form[k]).trim()).length;
  const pct = Math.round((filled / BANK_REQUIRED.length) * 100);
  const isComplete = filled === BANK_REQUIRED.length && !hasErrors;
  const checklist = checklistQ.data;
  const welcomed = !!checklist?.welcomeCall?.done;

  const save = async () => {
    if (locked) return;
    setTouched(true);
    if (hasErrors) { toast.error("Fix the marked fields first."); return; }
    setSaving(true);
    try {
      await crmSend(`/api/crm/customer-bank-details/booking/${bookingId}`, "PUT", { ...form, AadhaarNo: form.AadhaarNo.replace(/\s+/g, "") });
      toast.success(isComplete ? (welcomed ? "KYC complete; agreement prep will go ahead" : "KYC complete; waiting on the welcome call") : "Bank details saved");
      ["crm-bank-detail", "crm-welcome-checklist"].forEach((k) => qc.invalidateQueries({ queryKey: [k, bookingId] }));
      qc.invalidateQueries({ queryKey: ["crm", "customer-bank-details"] });
      setUiLocked(true);
    } catch (e) { toast.error((e as Error).message || "Could not save the bank details."); }
    finally { setSaving(false); }
  };

  const field = (key: keyof BankForm, label: string, numeric = false) => (
    <TextField key={key} label={label} value={form[key]} disabled={locked}
      onChangeText={(v) => setForm((f) => ({ ...f, [key]: BANK_UPPER.includes(key) ? v.toUpperCase() : v }))} onBlur={() => setTouched(true)}
      keyboardType={numeric ? "decimal-pad" : "default"} autoCapitalize={BANK_UPPER.includes(key) ? "characters" : "words"}
      error={touched ? errors[key] ?? null : null} />
  );
  const mark = (text: string, done: boolean) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: done ? "#10b981" : "#f59e0b" }} />
      <Text style={{ fontSize: 12.5, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{text}</Text>
    </View>
  );

  const body = (
    <>
      <Section title={locked ? "Bank and KYC" : "Editing bank and KYC"}>
        <Kv label="Customer" value={row.ApplicantName} strong />
        <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, paddingBottom: 6 }}>
          {[row.BookingNo, row.Mobile, row.ProjectName, row.UnitNo && `Unit ${row.UnitNo}`].filter(Boolean).join(" · ")}
        </Text>
        {canEdit && uiLocked ? (
          <View style={{ flexDirection: "row", marginTop: 4 }}><ActionKey label="Edit" onPress={() => setUiLocked(false)} /></View>
        ) : null}
      </Section>

      {locked ? (
        <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginBottom: 12, paddingHorizontal: 4 }}>
          {canEdit ? "Read-only. Edit unlocks it; saving locks it again."
            : !hasRight ? "Read-only: you don't have the edit right on this page."
            : "Read-only: only the booking's assigned salesperson or an admin can change these details."}
        </Text>
      ) : null}

      <Section title={isComplete ? "KYC complete" : `KYC ${pct}%`}>
        <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{filled} of {BANK_REQUIRED.length} captured · none needed to save</Text>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden", marginVertical: 10 }}>
          <View style={{ height: "100%", width: `${pct}%`, backgroundColor: isComplete ? "#10b981" : CRM }} />
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
          {mark("Welcome call", welcomed)}
          {mark("Bank and KYC", isComplete)}
        </View>
        {checklist?.agreement ? (
          <LinkRow title={`Agreement: ${checklist.agreement.Status}`} onPress={() => nav.navigate("CrmAgreement", { bookingId, title: row.BookingNo })} />
        ) : isComplete && !welcomed ? (
          <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 8 }}>The welcome call starts agreement prep.</Text>
        ) : null}
      </Section>

      {savedQ.isLoading ? <ActivityIndicator color={colors.mutedForeground} style={{ paddingVertical: 24 }} /> : (
        <>
          <FormSection title="Bank">
            {field("BankName", "Bank")}
            {field("BranchName", "Branch")}
            {field("AccountNo", "Account number", true)}
            {field("IfscCode", "IFSC")}
            {field("AccountHolderName", "Account holder")}
          </FormSection>
          <FormSection title="Identity">
            {field("PanNo", "PAN")}
            {field("AadhaarNo", "Aadhaar number", true)}
          </FormSection>
          <FormSection title="Occupation and income">
            {field("Occupation", "Occupation")}
            {field("AnnualIncome", "Annual income (₹)", true)}
          </FormSection>
          <FormSection title="Financing">
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginBottom: 8 }}>How is this purchase paid for?</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {(["SelfFunded", "LoanFinanced"] as const).map((opt) => {
                const on = form.FinancingType === opt;
                return (
                  <Pressable key={opt} disabled={locked} onPress={() => setForm((f) => ({ ...f, FinancingType: opt }))}
                    style={{ flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: on ? CRM : colors.border,
                      backgroundColor: on ? CRM : "transparent", opacity: locked ? 0.7 : 1 }}>
                    <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: on ? "#fff" : colors.foreground }}>{opt === "SelfFunded" ? "Self-funded" : "Loan-financed"}</Text>
                  </Pressable>
                );
              })}
            </View>
            {form.FinancingType === "LoanFinanced" && !loanQ.data?.HasLoanRecord ? (
              <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 10 }}>
                No loan on file yet: capture it on Home Loan Tracking once the bank and sanction are known.
              </Text>
            ) : null}
          </FormSection>
          {!locked && hasErrors ? <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: colors.destructive }}>Fix the marked fields before saving.</Text> : null}
        </>
      )}
    </>
  );

  if (locked) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {body}
      </ScrollView>
    );
  }
  return (
    <FormScaffold tone={CRM} toneInk="#fff" onSubmit={save} submitLabel={saving ? "Saving…" : "Save"} submitting={saving}
      onCancel={() => { setTouched(false); setUiLocked(true); }}>
      {body}
    </FormScaffold>
  );
}

// ── Customers: import the converted leads ───────────────────────────────────
// The web's Import Customers (src/pages/CRM/CrmCustomerImportDialog.tsx) with its "Converted Leads Pool" source: the
// leads (GET /api/sa/leads?status=Converted) as rows — name, mobile, alternate mobile, email, remarks as notes, the
// default invoice mode; Check (POST /api/crm/customers/import/preview) with its counts and per-row result; rows to
// exclude; what to do with matched customers; Import (POST /import/apply) and its result. Spreadsheet upload and
// column matching stay on the web.
type ImportPreviewRow = { rowNo: number; status: "new" | "existing" | "duplicate" | "error"; data: Row; errors?: string[]; warnings?: string[]; match?: { customerNo: string; name: string; by: string[] } };
export function CustomerImportScreen() {
  const qc = useQueryClient();
  const nav = useNavigation<Nav>();
  const [step, setStep] = useState<1 | 3 | 4>(1);
  const [invoiceMode, setInvoiceMode] = useState<"NonInvoice" | "Invoice">("NonInvoice");
  const [rows, setRows] = useState<{ rowNo: number; cells: Row }[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ rows: ImportPreviewRow[]; summary: Row } | null>(null);
  const [filter, setFilter] = useState<"all" | "new" | "existing" | "duplicate" | "error" | "warnings">("all");
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [existingMode, setExistingMode] = useState<"skip" | "fill" | "update">("skip");
  const [applied, setApplied] = useState<Row | null>(null);

  const loadLeads = async () => {
    setBusy(true);
    try {
      const leads = await crmGet<Row[]>("/api/sa/leads?status=Converted");
      if (!leads.length) { toast.error("No converted leads found in Sales Automation pool."); return; }
      setRows(leads.map((l, i) => ({ rowNo: i + 2, cells: { CustomerName: l.CustomerName || "", Mobile: l.Mobile || "", AltMobile: l.AltMobile || "", Email: l.Email || "", Notes: l.CustomerRemarks || "", InvoiceMode: invoiceMode } })));
      toast.success(`Loaded ${leads.length} converted leads into the import staging grid.`);
    } catch (e) { toast.error((e as Error).message || "Could not load leads pool."); }
    finally { setBusy(false); }
  };
  const check = async () => {
    const payload = rows.map((r) => ({ ...r, cells: { ...r.cells, InvoiceMode: invoiceMode } as Row })).filter((r) => String(r.cells.CustomerName || "").trim());
    if (!payload.length) { toast.error("No valid customer data rows found."); return; }
    setBusy(true);
    try {
      const d = await crmSend<{ rows: ImportPreviewRow[]; summary: Row }>("/api/crm/customers/import/preview", "POST", { rows: payload });
      setPreview(d); setExcluded(new Set()); setStep(3);
    } catch (e) { toast.error((e as Error).message || "Could not inspect records."); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const d = await crmSend<Row>("/api/crm/customers/import/apply", "POST", {
        rows: preview.rows.map((r) => ({ rowNo: r.rowNo, cells: r.data })), existing: existingMode, fileName: "SaLeads_Pool",
        sourceTag: "Converted Leads Pool Migration", excludedRowNos: Array.from(excluded),
      });
      setApplied(d); setStep(4);
      toast.success(`Import complete: ${d.summary.created || 0} created, ${d.summary.updated || 0} updated, ${d.summary.skipped || 0} skipped.`);
      qc.invalidateQueries({ queryKey: ["crm"] });
    } catch (e) { toast.error((e as Error).message || "Could not execute customer import."); }
    finally { setBusy(false); }
  };

  const stat = (label: string, value: number, key?: typeof filter) => (
    <Pressable key={label} onPress={key ? () => setFilter(key) : undefined} style={{ flexGrow: 1, flexBasis: "30%", padding: 10, borderRadius: 12, borderWidth: 1,
      borderColor: key && filter === key ? CRM : colors.border, backgroundColor: colors.card }}>
      <Text style={{ fontSize: 11.5, color: colors.mutedForeground }}>{label}</Text>
      <Text style={{ fontSize: 18, fontFamily: fonts.heading.bold, color: colors.foreground }}>{value ?? 0}</Text>
    </Pressable>
  );
  const shown = (preview?.rows ?? []).filter((r) => filter === "all" || (filter === "warnings" ? (r.warnings?.length ?? 0) > 0 : r.status === filter));
  const willCreate = (preview?.rows ?? []).filter((r) => !excluded.has(r.rowNo) && r.status === "new").length;
  const willTouch = existingMode !== "skip" ? (preview?.rows ?? []).filter((r) => !excluded.has(r.rowNo) && r.status === "existing").length : 0;
  const MODES = [
    { k: "skip" as const, t: "1. Leave existing customers as they are", s: "Matched customers are not touched; only brand-new customers will be created." },
    { k: "fill" as const, t: "2. Fill in their blank details only", s: "Only fills fields that are currently empty on their profile. Existing data stays safe." },
    { k: "update" as const, t: "3. Update their details from the file", s: "Replaces contact, address and profile details with the file's values. Name, mobile, PAN, Aadhaar and email of a customer who already has an application are never changed here — use the customer's own edit for those." },
  ];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }}>
      <Text style={{ fontSize: 12.5, color: colors.mutedForeground }}>{step === 1 ? "1. Choose source" : step === 3 ? "3. Check & confirm" : "4. Result"}</Text>
      {step === 1 ? (
        <>
          <Section title="Converted Leads Pool">
            <Text style={{ fontSize: 12.5, color: colors.mutedForeground, marginBottom: 10 }}>Loads every lead marked Converted in Sales Automation. Spreadsheet files and links are imported on the web.</Text>
            <Chips label="Default invoice mode" options={["NonInvoice", "Invoice"] as const} value={invoiceMode} onChange={setInvoiceMode} labelOf={(v) => (v === "NonInvoice" ? "Non-invoice" : "Invoice")} />
            <ActionKey outline label={busy && !rows.length ? "Loading…" : rows.length ? `Reload leads (${rows.length})` : "Load converted leads"} onPress={() => { if (!busy) void loadLeads(); }} />
          </Section>
          {rows.length ? (
            <Section title={`${rows.length} rows ready`}>
              {rows.slice(0, 5).map((r) => <Kv key={r.rowNo} label={`#${r.rowNo}`} value={joinDot(r.cells.CustomerName, r.cells.Mobile)} />)}
              {rows.length > 5 ? <Text style={{ fontSize: 12, color: colors.mutedForeground }}>and {rows.length - 5} more</Text> : null}
              <View style={{ marginTop: 10 }}><ActionKey label={busy ? "Checking…" : "Check records"} onPress={() => { if (!busy) void check(); }} /></View>
            </Section>
          ) : null}
        </>
      ) : step === 3 && preview ? (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {stat("Total Rows", preview.summary.total, "all")}
            {stat("New Customers", preview.summary.new, "new")}
            {stat("Existing Matches", preview.summary.existing, "existing")}
            {stat("File Duplicates", preview.summary.duplicate, "duplicate")}
            {stat("Errors", preview.summary.error, "error")}
            {stat("Warnings", preview.summary.warnings, "warnings")}
          </View>
          {MODES.map((m) => (
            <Pressable key={m.k} onPress={() => setExistingMode(m.k)} style={{ padding: 12, borderRadius: 12, borderWidth: 1, borderColor: existingMode === m.k ? CRM : colors.border, backgroundColor: existingMode === m.k ? `${CRM}14` : colors.card }}>
              <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: existingMode === m.k ? CRM : colors.foreground }}>{m.t}</Text>
              <Text style={{ fontSize: 11.5, color: colors.mutedForeground, marginTop: 2 }}>{m.s}</Text>
            </Pressable>
          ))}
          <Text style={{ fontSize: 12.5, color: colors.mutedForeground }}>
            {willCreate} new customer{willCreate === 1 ? "" : "s"} to create{willTouch ? ` · ${willTouch} existing to ${existingMode === "fill" ? "fill in" : "update"}` : ""} · errors and repeats are not saved ({excluded.size} excluded by you)
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}><ActionKey outline label="Include All" onPress={() => setExcluded(new Set())} /></View>
          {shown.map((r) => {
            const out = excluded.has(r.rowNo);
            return (
              <View key={r.rowNo} style={{ padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, opacity: out ? 0.5 : 1, gap: 4 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ flex: 1, fontSize: 13.5, fontFamily: fonts.body.medium, color: colors.foreground }}>#{r.rowNo} {r.data.CustomerName}</Text>
                  <Pill label={r.status === "new" ? "New" : r.status === "existing" ? "Existing" : r.status === "duplicate" ? "Duplicate" : "Error"} />
                </View>
                <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{joinDot(r.data.Mobile, r.data.Email, r.data.PanNo)}</Text>
                {r.match ? <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Matched {r.match.customerNo} ({r.match.name}) via {r.match.by.join(", ")}</Text> : null}
                {(r.errors ?? []).map((e, i) => <Text key={`e${i}`} style={{ fontSize: 12, color: colors.destructive }}>{e}</Text>)}
                {(r.warnings ?? []).map((w, i) => <Text key={`w${i}`} style={{ fontSize: 12, color: "#f59e0b" }}>{w}</Text>)}
                {r.status !== "error" ? (
                  <Pressable onPress={() => setExcluded((s) => { const n = new Set(s); if (n.has(r.rowNo)) n.delete(r.rowNo); else n.add(r.rowNo); return n; })}>
                    <Text style={{ fontSize: 12.5, fontFamily: fonts.heading.semibold, color: CRM }}>{out ? "Include" : "Exclude"}</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <ActionKey outline label="Back" onPress={() => setStep(1)} />
            <ActionKey label={busy ? "Importing…" : "Import"} onPress={() => { if (!busy && (willCreate || willTouch)) void apply(); }} />
          </View>
        </>
      ) : step === 4 && applied ? (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {stat("Customers Created", applied.summary.created)}
            {stat("Customers Updated", applied.summary.updated)}
            {stat("Skipped", applied.summary.skipped)}
            {stat("Failed", applied.summary.failed)}
          </View>
          <ActionKey label="Done" onPress={() => nav.goBack()} />
        </>
      ) : null}
    </ScrollView>
  );
}

// ── AFS: Query Payment record, and starting a tracker / registry ────────────
// The web's AFS Query Payment detail (src/pages/CRM/CrmAfsQueryPayment.tsx): the fees (editable while Pending,
// PUT /:id), step 1 Send to Customer (files as base64, POST /:id/info, after "Send N files to customer?"), step 2
// Confirm Payment Received (amount, remarks, optional proof; POST /:id/confirm), the attachments; and its two Start
// dialogs (Start Registration Fee Tracker / Start AFS Registry — POST with the booking).
const AFS_FILE_MAX = 4 * 1024 * 1024;
const AFS_TOTAL_MAX = 6 * 1024 * 1024;
type StagedFile = { name: string; type: string; size: number; base64: string };
async function stageFiles(multiple: boolean): Promise<StagedFile[]> {
  const pick = await DocumentPicker.getDocumentAsync({ multiple, copyToCacheDirectory: true });
  if (pick.canceled || !pick.assets?.length) return [];
  const out: StagedFile[] = [];
  for (const a of pick.assets) {
    const size = a.size ?? a.file?.size ?? 0;
    if (size > AFS_FILE_MAX) { toast.error(`${a.name} is too large (max ${(AFS_FILE_MAX / 1024 / 1024).toFixed(0)}MB per file)`); return []; }
    let base64: string;
    if (a.file) {
      base64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] ?? ""); r.onerror = rej; r.readAsDataURL(a.file!); });
    } else {
      base64 = await new File(a.uri).base64();
    }
    out.push({ name: a.name, type: a.mimeType || "application/octet-stream", size, base64 });
  }
  return out;
}

export function AfsQueryPaymentScreen() {
  const qc = useQueryClient();
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmAfsQueryPayment">>();
  const id = params.id;
  const { canDoAction } = useAuth();
  const canEdit = canDoAction("crm-afs-query-payment", "edit");
  const q = useQuery({ queryKey: ["crm-afs-qp", id], queryFn: () => crmGet<Row>(`/api/crm/afs-query-payment/${id}`) });
  const dt = q.data;
  const [step, setStep] = useState<1 | 2>(1);
  const [editing, setEditing] = useState(false);
  const [amt, setAmt] = useState({ stamp: "", fee: "", remarks: "" });
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [askSend, setAskSend] = useState(false);
  const [confirmAmount, setConfirmAmount] = useState("");
  const [confirmRemarks, setConfirmRemarks] = useState("");
  const [proof, setProof] = useState<StagedFile | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (dt) setStep(dt.Status === "Pending" ? 1 : 2); }, [dt?.Status]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => { void q.refetch(); qc.invalidateQueries({ queryKey: ["crm"] }); };
  const run = async (fn: () => Promise<unknown>, done: string, after?: () => void) => {
    setBusy(true);
    try { await fn(); toast.success(done); after?.(); refresh(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  if (q.isLoading || !dt) return <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: "center" }}>{q.error ? <Empty text={(q.error as Error).message} /> : <ActivityIndicator color={colors.mutedForeground} />}</View>;
  const attachments: Row[] = dt.attachments || [];
  const info = attachments.filter((a) => a.DocType === "Info");
  const attachRow = (a: Row) => (
    <LinkRow key={a.AttachmentId} icon={FileText} title={a.FileName} sub={joinDot(a.FileSize ? `${Math.round(a.FileSize / 1024)} KB` : "", a.UploadedAt ? String(a.UploadedAt).slice(0, 10) : "")}
      onPress={() => openDocument(`/api/crm/afs-query-payment/attachment/${a.AttachmentId}`, a.FileName).catch((e: Error) => toast.error(e.message))} />
  );
  const addFiles = async () => {
    const staged = await stageFiles(true);
    if (!staged.length) return;
    const total = [...files, ...staged].reduce((s, f) => s + f.size, 0);
    if (total > AFS_TOTAL_MAX) { toast.error(`Total attached files can't exceed ${(AFS_TOTAL_MAX / 1024 / 1024).toFixed(0)}MB — send in a separate batch`); return; }
    setFiles((p) => [...p, ...staged]);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <Section title={dt.AfsQPNo} right={<Pill label={dt.Status === "InfoSent" ? "Info Sent" : dt.Status} />}>
        <Text style={{ fontSize: 12.5, color: colors.mutedForeground, marginBottom: 6 }}>{dt.ApplicantName} · {dt.BookingNo}</Text>
        <Kv label="Stamp duty" value={dt.StampDuty != null ? money(dt.StampDuty) : "—"} />
        <Kv label="Registration fee" value={dt.RegistrationFee != null ? money(dt.RegistrationFee) : "—"} />
        {dt.RequiredAmount != null ? <Kv label="Total" value={money(dt.RequiredAmount)} strong /> : null}
        {dt.Remarks ? <Kv label="Remarks" value={dt.Remarks} /> : null}
        {canEdit && dt.Status === "Pending" && !editing ? (
          <View style={{ flexDirection: "row", marginTop: 6 }}><ActionKey outline label="Edit" onPress={() => { setAmt({ stamp: dt.StampDuty != null ? String(dt.StampDuty) : "", fee: dt.RegistrationFee != null ? String(dt.RegistrationFee) : "", remarks: dt.Remarks || "" }); setEditing(true); }} /></View>
        ) : null}
        {editing ? (
          <View style={{ marginTop: 10 }}>
            <NumberField label="Stamp Duty (₹)" value={amt.stamp} placeholder="Optional" onChangeText={(v) => setAmt({ ...amt, stamp: v })} />
            <NumberField label="Registration Fee (₹)" value={amt.fee} placeholder="Optional" onChangeText={(v) => setAmt({ ...amt, fee: v })} />
            <TextField label="Remarks" value={amt.remarks} placeholder="Optional" onChangeText={(v) => setAmt({ ...amt, remarks: v })} />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <ActionKey outline label="Cancel" onPress={() => setEditing(false)} />
              <ActionKey label={busy ? "Saving…" : "Save"} onPress={() => run(() => crmSend(`/api/crm/afs-query-payment/${id}`, "PUT", {
                StampDuty: amt.stamp !== "" ? amt.stamp : undefined, RegistrationFee: amt.fee !== "" ? amt.fee : undefined, Remarks: amt.remarks }), "Amounts updated", () => setEditing(false))} />
            </View>
          </View>
        ) : null}
      </Section>

      {dt.Status === "Confirmed" ? (
        <Section title="Government payment confirmed">
          <Text style={{ fontSize: 12.5, color: colors.mutedForeground }}>{joinDot(dt.ConfirmedAt ? String(dt.ConfirmedAt).slice(0, 10) : "", dt.ConfirmedAmount ? money(dt.ConfirmedAmount) : "")}</Text>
          {dt.Remarks ? <Text style={{ fontSize: 12.5, fontStyle: "italic", color: colors.mutedForeground }}>“{dt.Remarks}”</Text> : null}
          {attachments.length ? <><Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: colors.mutedForeground, marginTop: 10 }}>ATTACHMENTS</Text>{attachments.map(attachRow)}</> : null}
        </Section>
      ) : (
        <>
          <Chips label="Step" options={["1", "2"] as const} value={String(step) as "1" | "2"} labelOf={(v) => (v === "1" ? "1 · Send info" : "2 · Confirm payment")}
            onChange={(v) => setStep(v === "1" ? 1 : (dt.Status !== "Pending" ? 2 : 1))} />
          {step === 1 ? (
            <Section title="Send to Customer">
              {info.length ? <><Text style={{ fontSize: 12, color: colors.mutedForeground }}>Previously sent</Text>{info.map(attachRow)}</> : null}
              {files.length ? <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 8 }}>Ready to send ({files.length})</Text> : null}
              {files.map((f, i) => (
                <View key={`${f.name}-${i}`} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 }}>
                  <FileText size={14} color={colors.mutedForeground} />
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: colors.foreground }}>{f.name}</Text>
                  <Pressable onPress={() => setFiles((p) => p.filter((_, j) => j !== i))}><Text style={{ color: colors.destructive, fontSize: 13 }}>Remove</Text></Pressable>
                </View>
              ))}
              {canEdit ? (
                <View style={{ gap: 8, marginTop: 8 }}>
                  <ActionKey outline label="Choose Files" onPress={() => { void addFiles(); }} />
                  {askSend ? (
                    <View style={{ gap: 8 }}>
                      <Text style={{ fontSize: 12.5, color: colors.mutedForeground }}>Send {files.length} file{files.length !== 1 ? "s" : ""} to customer?</Text>
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <ActionKey outline label="Cancel" onPress={() => setAskSend(false)} />
                        <ActionKey label={busy ? "Sending…" : "Confirm"} onPress={() => run(() => crmSend(`/api/crm/afs-query-payment/${id}/info`, "POST", {
                          files: files.map((f) => ({ fileName: f.name, mimeType: f.type, base64: f.base64 })) }), "Sent to customer", () => { setFiles([]); setAskSend(false); })} />
                      </View>
                    </View>
                  ) : <ActionKey label="Send to Customer" onPress={() => { if (files.length) setAskSend(true); }} />}
                </View>
              ) : null}
            </Section>
          ) : (
            <Section title="Confirm payment">
              <Text style={{ fontSize: 12.5, color: colors.mutedForeground, marginBottom: 10 }}>Once the customer has paid at the Sub-Registrar, confirm receipt here to advance the record.</Text>
              <NumberField label="Amount paid (optional)" value={confirmAmount} placeholder="e.g. 16500" onChangeText={setConfirmAmount} />
              <TextField label="Remarks" value={confirmRemarks} placeholder="Optional" onChangeText={setConfirmRemarks} />
              {proof ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <FileText size={14} color={colors.mutedForeground} /><Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: colors.foreground }}>{proof.name}</Text>
                  <Pressable onPress={() => setProof(null)}><Text style={{ color: colors.destructive }}>Remove</Text></Pressable>
                </View>
              ) : <View style={{ marginBottom: 10 }}><ActionKey outline label="Attach proof (optional)" onPress={async () => { const s = await stageFiles(false); if (s[0]) setProof(s[0]); }} /></View>}
              {canEdit ? <ActionKey label={busy ? "Confirming…" : "Confirm Payment Received"} onPress={() => run(() => crmSend(`/api/crm/afs-query-payment/${id}/confirm`, "POST", {
                ConfirmedAmount: confirmAmount || undefined, Remarks: confirmRemarks || undefined,
                proof: proof ? { fileName: proof.name, mimeType: proof.type, base64: proof.base64 } : undefined,
              }), "Registration fees confirmed. Next: start the registry (both parties at the Sub-Registrar's office).", () => { setConfirmAmount(""); setConfirmRemarks(""); setProof(null); })} /> : null}
            </Section>
          )}
        </>
      )}
    </ScrollView>
  );
}

export function AfsStartScreen() {
  const nav = useNavigation<Nav>();
  const qc = useQueryClient();
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmAfsStart">>();
  const qp = params.kind === "qp";
  const base = qp ? "/api/crm/afs-query-payment" : "/api/crm/afs-registry";
  const elig = useQuery({ queryKey: ["crm-afs-eligible", params.kind], queryFn: () => crmGet<Row[]>(`${base}/eligible-bookings`).then((d) => (Array.isArray(d) ? d : [])) });
  const list = elig.data ?? [];
  const [bookingId, setBookingId] = useState("");
  const [fees, setFees] = useState({ StampDuty: "", RegistrationFee: "" });
  const [locked, setLocked] = useState(false);
  const [pick, setPick] = useState(false);
  const [saving, setSaving] = useState(false);
  const bk = list.find((x) => String(x.Id) === bookingId);
  const start = async () => {
    if (!bookingId) { toast.error("Booking is required"); return; }
    setSaving(true);
    try {
      const d = await crmSend<Row>(base, "POST", qp ? { BookingId: parseInt(bookingId), StampDuty: fees.StampDuty || undefined, RegistrationFee: fees.RegistrationFee || undefined } : { BookingId: parseInt(bookingId) });
      toast.success(`${qp ? d.AfsQPNo : d.AfsRegNo} started`);
      qc.invalidateQueries({ queryKey: ["crm"] });
      nav.goBack();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };
  return (
    <FormScaffold tone={CRM} toneInk="#fff" submitting={saving} submitLabel={saving ? "Starting…" : qp ? "Start Tracker" : "Start"} disabled={!bookingId} onSubmit={start} onCancel={() => nav.goBack()}>
      <Text style={{ fontSize: 17, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{qp ? "Start Registration Fee Tracker" : "Start AFS Registry"}</Text>
      <Text style={{ fontSize: 12.5, color: colors.mutedForeground, marginBottom: 14 }}>
        {qp ? "Select a booking whose Agreement for Sale is Executed, then enter the government-calculated stamp duty and registration fees." : "Requires AFS Query Payment to be Confirmed for this booking first."}
      </Text>
      {elig.isLoading ? <Text style={{ fontSize: 12.5, color: colors.mutedForeground }}>Loading eligible bookings…</Text> : list.length === 0 ? (
        <Text style={{ fontSize: 12.5, color: colors.foreground }}>{qp ? "No eligible bookings — Agreement for Sale must be Executed first. Go to Documents → Agreements."
          : "No eligible bookings. To start an AFS Registry visit, the booking's AFS Query Payment must be Confirmed first."}</Text>
      ) : <PickerRow label="Booking" required value={bk ? `${bk.BookingNo} · ${bk.ApplicantName} (${qp ? bk.AgreementStatus : bk.UnitNo})` : ""} placeholder={qp ? "Select booking…" : "Select booking"} onPress={() => setPick(true)} />}
      {qp ? (
        <FormSection title="Government Fees">
          {locked ? <Text style={{ fontSize: 12, color: colors.foreground, marginBottom: 8 }}>Pre-filled from Agreement record — verify and edit if needed</Text> : null}
          <NumberField label="Stamp Duty (₹)" value={fees.StampDuty} placeholder="Optional" disabled={locked} onChangeText={(v) => setFees({ ...fees, StampDuty: v })} />
          <NumberField label="Registration Fee (₹)" value={fees.RegistrationFee} placeholder="Optional" disabled={locked} onChangeText={(v) => setFees({ ...fees, RegistrationFee: v })} />
          {locked ? <View style={{ flexDirection: "row" }}><ActionKey outline label="Edit" onPress={() => setLocked(false)} /></View>
            : fees.StampDuty !== "" || fees.RegistrationFee !== "" ? <View style={{ flexDirection: "row" }}><ActionKey outline label="Lock" onPress={() => setLocked(true)} /></View> : null}
        </FormSection>
      ) : null}
      <OptionPickerModal visible={pick} searchable title="Booking"
        options={list.map((x) => ({ key: String(x.Id), label: `${x.BookingNo} · ${x.ApplicantName}`, sublabel: qp ? x.AgreementStatus : x.UnitNo }))}
        selectedKey={bookingId}
        onSelect={(k) => {
          const b2 = list.find((x) => String(x.Id) === k);
          setBookingId(k ?? "");
          if (qp) {
            const stamp = b2?.AfsStampDuty != null ? String(b2.AfsStampDuty) : "";
            const fee = b2?.AfsRegistrationFee != null ? String(b2.AfsRegistrationFee) : "";
            setFees({ StampDuty: stamp, RegistrationFee: fee }); setLocked(stamp !== "" || fee !== "");
          }
          setPick(false);
        }}
        onClose={() => setPick(false)} />
    </FormScaffold>
  );
}

// ── OC / CC: one certificate, or a new one ──────────────────────────────────
// The web OC / CC page (src/pages/CRM/CrmOcCc.tsx): a certificate opens read-only (status, what it means for possession,
// its facts) with Edit and, while filed, Mark as Issued; File Application / Record Certificate records a new one — the
// web's OcccForm (project and scope when creating; status when editing; date of issue and number once issued), its
// checkForm, and its messages. POST /api/crm/oc-cc, PUT /api/crm/oc-cc/:id.
const OCCC_TYPES = ["OC", "CC", "OC+CC"];
const occcCheck = (f: Row, recording: boolean): string | null => {
  if (recording && !f.ProjectId) return "Select the project.";
  if (recording && f.Scope === "block" && !f.BlockId) return "Select the block.";
  if (f.Status === "Received" && !f.ReceivedDate) return "Enter the date of issue.";
  if (f.Status === "Received" && !String(f.CertificateNo || "").trim()) return "Enter the certificate number.";
  if (f.ApplicationDate && f.ReceivedDate && f.ReceivedDate < f.ApplicationDate) return "The date of issue cannot be before the application date.";
  return null;
};
export function OcCcCertificateScreen() {
  const nav = useNavigation<Nav>();
  const qc = useQueryClient();
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmOcCcCert">>();
  const cert = params?.cert;
  const { canDoAction } = useAuth();
  const canEdit = canDoAction("crm-oc-cc", "edit");
  const formOf = (r: Row): Row => ({
    ProjectId: String(r.ProjectId), BlockId: r.BlockId != null ? String(r.BlockId) : "", Scope: r.BlockId != null ? "block" : "project",
    CertType: r.CertType, Status: r.Status, ApplicationDate: r.ApplicationDate ? String(r.ApplicationDate).slice(0, 10) : "",
    ReceivedDate: r.ReceivedDate ? String(r.ReceivedDate).slice(0, 10) : "", CertificateNo: r.CertificateNo || "", IssuedBy: r.IssuedBy || "", Remarks: r.Remarks || "",
  });
  const [mode, setMode] = useState<"view" | "edit" | "issue" | "create">(cert ? "view" : "create");
  const [form, setForm] = useState<Row>(cert ? formOf(cert) : { ProjectId: "", BlockId: "", Scope: "project", CertType: "OC", Status: params?.status ?? "Applied", ApplicationDate: "", ReceivedDate: "", CertificateNo: "", IssuedBy: "", Remarks: "" });
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<null | "project" | "block" | "type" | "status">(null);
  const projects = useQuery({ queryKey: ["unit-master-projects"], staleTime: 5 * 60_000, enabled: mode === "create", queryFn: () => crmGet<Row[]>("/api/unit-master/projects").catch(() => []) }).data ?? [];
  const blocksQ = useQuery({ queryKey: ["oc-cc-blocks-for-project", form.ProjectId], enabled: mode === "create" && !!form.ProjectId,
    queryFn: () => crmGet<Row[]>(`/api/unit-master/blocks?projectId=${form.ProjectId}`).catch(() => []) });
  const blocks = blocksQ.data ?? [];
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const refresh = () => ["crm", "crm-oc-cc-board", "crm-dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const typeLabel = (t: string) => CERT_TYPE_LABEL[t] ?? t;
  const scope = cert ? (cert.BlockName ? `Block ${cert.BlockName}` : "Entire project") : "";
  const clearedNote = `Once saved, ${form.BlockId ? "the bookings in this block are" : "every booking in this project is"} cleared for the Pre-Possession check.`;

  const save = async () => {
    const problem = occcCheck(form, mode === "create");
    if (problem) { toast.error(problem); return; }
    setBusy(true);
    try {
      if (mode === "create") {
        await crmSend("/api/crm/oc-cc", "POST", {
          ProjectId: parseInt(form.ProjectId), BlockId: form.BlockId ? parseInt(form.BlockId) : undefined, CertType: form.CertType, Status: form.Status,
          ApplicationDate: form.ApplicationDate || undefined, ReceivedDate: form.ReceivedDate || undefined,
          CertificateNo: form.CertificateNo || undefined, IssuedBy: form.IssuedBy || undefined, Remarks: form.Remarks || undefined,
        });
        toast.success(form.Status === "Received" ? `Certificate recorded. Bookings in this ${form.BlockId ? "block" : "project"} are cleared for the Pre-Possession check.` : "Application recorded");
      } else {
        await crmSend(`/api/crm/oc-cc/${cert!.Id}`, "PUT", {
          CertType: form.CertType || undefined, Status: form.Status || undefined, ApplicationDate: form.ApplicationDate || undefined,
          ReceivedDate: form.ReceivedDate || undefined, CertificateNo: form.CertificateNo, IssuedBy: form.IssuedBy, Remarks: form.Remarks,
        });
        toast.success(mode === "issue" ? `Marked as issued. Bookings in this ${form.BlockId ? "block" : "project"} are cleared for the Pre-Possession check.` : "Certificate saved");
      }
      refresh(); nav.goBack();
    } catch (e) { toast.error((e as Error).message || "Could not save the certificate."); }
    finally { setBusy(false); }
  };

  if (mode === "view" && cert) {
    const issued = cert.Status === "Received";
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <Section title={typeLabel(cert.CertType)}>
          <Text style={{ fontSize: 12.5, color: colors.mutedForeground, marginBottom: 8 }}>{cert.ProjectName} · {scope}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
            <Pill label={CERT_STATUS_LABEL[cert.Status] ?? cert.Status} />
            <Text style={{ fontSize: 13, fontFamily: fonts.body.medium, color: colors.foreground }}>{issued ? "Cleared for possession" : "Not cleared for possession"}</Text>
          </View>
          {Number(cert.BookingCount) > 0 ? (
            <Text style={{ fontSize: 12.5, color: colors.mutedForeground, marginBottom: 6 }}>
              {cert.BookingCount} active booking{Number(cert.BookingCount) === 1 ? "" : "s"} {cert.BlockName ? "in this block" : "in this project"}.
              {Number(cert.BookingsAwaitingPossession) > 0 ? (issued ? ` ${cert.BookingsAwaitingPossession} can go on to the Pre-Possession check.` : ` ${cert.BookingsAwaitingPossession} on hold at Pre-Possession until this is issued.`) : ""}
            </Text>
          ) : null}
          <Kv label="Application date" value={cert.ApplicationDate ? fmtDate(cert.ApplicationDate) : "—"} />
          <Kv label="Date of issue" value={issued && cert.ReceivedDate ? fmtDate(cert.ReceivedDate) : "—"} />
          <Kv label="Certificate number" value={cert.CertificateNo || "—"} />
          <Kv label="Issuing authority" value={cert.IssuedBy || "—"} />
          <Kv label="Remarks" value={cert.Remarks || "—"} />
          <Kv label="Recorded by" value={cert.CreatedByName || "—"} />
          <Kv label="Last changed by" value={cert.UpdatedByName || "—"} />
        </Section>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {canEdit ? <ActionKey outline label="Edit" onPress={() => { setForm(formOf(cert)); setMode("edit"); }} /> : null}
          {canEdit && cert.Status === "Applied" ? <ActionKey label="Mark as Issued" onPress={() => { setForm({ ...formOf(cert), Status: "Received", ReceivedDate: "" }); setMode("issue"); }} /> : null}
        </View>
      </ScrollView>
    );
  }

  const issued = form.Status === "Received";
  return (
    <FormScaffold tone={CRM} toneInk="#fff" submitting={busy}
      submitLabel={busy ? "Saving…" : mode === "create" ? (issued ? "Record Certificate" : "File Application") : mode === "issue" ? "Mark as Issued" : "Save Changes"}
      disabled={mode === "create" && !form.ProjectId}
      onCancel={() => (cert ? setMode("view") : nav.goBack())} onSubmit={save}>
      <Text style={{ fontSize: 17, fontFamily: fonts.heading.semibold, color: colors.foreground, marginBottom: 4 }}>
        {mode === "create" ? (issued ? "Record Certificate" : "File Application") : mode === "issue" ? "Mark as Issued" : `Edit ${typeLabel(cert!.CertType)}`}
      </Text>
      <Text style={{ fontSize: 12.5, color: colors.mutedForeground, marginBottom: 14 }}>
        {mode === "create" ? (issued ? "Record an occupancy or completion certificate issued by the competent authority." : "Record an application filed with the competent authority for an occupancy or completion certificate.")
          : `${cert!.ProjectName} · ${scope}${mode === "issue" ? ` · ${typeLabel(cert!.CertType)}` : ""}`}
      </Text>

      {mode === "create" ? (
        <FormSection title="Project and scope">
          <PickerRow label="Project" required value={projects.find((p) => String(p.Id) === form.ProjectId)?.Name ?? ""} placeholder={projects.length ? "Select project" : "No project you can see"} onPress={() => setPick("project")} />
          <Chips label="Scope of certificate" options={["project", "block"] as const} value={form.Scope} labelOf={(v) => (v === "project" ? "Entire project" : "Single block")}
            onChange={(v) => setForm((f) => ({ ...f, Scope: v, BlockId: v === "project" ? "" : f.BlockId }))} />
          <Text style={{ fontSize: 11.5, color: colors.mutedForeground, marginTop: -6, marginBottom: 12 }}>{form.Scope === "project" ? "Applies to every booking in the project." : "Applies only to bookings in the selected block."}</Text>
          {form.Scope === "block" ? (
            <PickerRow label="Block" required value={blocks.find((x) => String(x.Id) === form.BlockId)?.Name ?? ""}
              placeholder={!form.ProjectId ? "Select the project first" : blocksQ.isLoading ? "Loading blocks…" : blocks.length ? "Select block" : "No block in this project"} onPress={() => setPick("block")} disabled={!form.ProjectId} />
          ) : null}
        </FormSection>
      ) : null}

      <FormSection title="Certificate details">
        {mode !== "issue" ? <PickerRow label="Certificate type" required value={typeLabel(form.CertType)} onPress={() => setPick("type")} /> : null}
        {mode === "edit" ? <PickerRow label="Status" value={CERT_STATUS_LABEL[form.Status] ?? form.Status} onPress={() => setPick("status")} /> : null}
        {mode !== "issue" ? <DateField label="Application date" value={form.ApplicationDate} onChange={(v: string) => set("ApplicationDate", v)} /> : null}
        {issued ? (
          <>
            <DateField label="Date of issue *" value={form.ReceivedDate} onChange={(v: string) => set("ReceivedDate", v)} />
            <TextField label="Certificate number" required value={form.CertificateNo} placeholder="As printed on the certificate" onChangeText={(v) => set("CertificateNo", v)} />
          </>
        ) : null}
        <TextField label="Issuing authority" value={form.IssuedBy} placeholder="e.g. Municipal Corporation, Development Authority" onChangeText={(v) => set("IssuedBy", v)} />
        {mode !== "issue" ? <RemarksField label="Remarks" value={form.Remarks} onChangeText={(v) => set("Remarks", v)} /> : null}
      </FormSection>
      {issued ? <Text style={{ fontSize: 12.5, color: colors.foreground, marginBottom: 12 }}>{clearedNote}</Text> : null}

      <OptionPickerModal visible={!!pick} searchable={pick === "project" || pick === "block"}
        title={pick === "project" ? "Project" : pick === "block" ? "Block" : pick === "type" ? "Certificate type" : "Status"}
        options={pick === "project" ? projects.map((p) => ({ key: String(p.Id), label: p.Name })) : pick === "block" ? blocks.map((x) => ({ key: String(x.Id), label: x.Name }))
          : pick === "type" ? OCCC_TYPES.map((t) => ({ key: t, label: typeLabel(t) })) : ["Applied", "Received"].map((s) => ({ key: s, label: CERT_STATUS_LABEL[s] }))}
        selectedKey={pick === "project" ? form.ProjectId : pick === "block" ? form.BlockId : pick === "type" ? form.CertType : form.Status}
        onSelect={(k) => {
          if (pick === "project") setForm((f) => ({ ...f, ProjectId: k ?? "", BlockId: "" }));
          else if (pick === "block") set("BlockId", k ?? "");
          else if (pick === "type") set("CertType", k ?? "OC");
          else set("Status", k ?? "Applied");
          setPick(null);
        }}
        onClose={() => setPick(null)} />
    </FormScaffold>
  );
}

// ── Parking Bookings: one allotment, and a new standalone sale ──────────────
// The web Parking Booking page (src/pages/CRM/CrmParkingBooking.tsx): an allotment's DetailDialog — type, slot, rate,
// GST, total; with a booking: its collection and the way to it; standalone: Record payment (mode, date → PUT
// /api/crm/parking/:id/mark-paid) or the receipt; Release for the approvers of crm-parking-release (a reason and
// RELEASE typed → DELETE /:id?reason=). And "New standalone parking sale" (POST /api/crm/parking/standalone).
const PARKING_PAY_MODES = ["Cash", "Cheque", "NEFT", "RTGS", "UPI", "Bank Transfer", "DD"];
export function ParkingAllotmentScreen() {
  const nav = useNavigation<Nav>();
  const qc = useQueryClient();
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmParkingAllotment">>();
  const a = params.allotment;
  const { canDoAction } = useAuth();
  const canPay = canDoAction("crm-parking-booking", "edit");
  const canRelease = !!useQuery({ queryKey: ["can-act", "crm-parking-release"], staleTime: 5 * 60_000,
    queryFn: () => crmGet<{ canAct: boolean }>("/api/approval-workflows/can-act?module=crm-parking-release").then((d) => !!d.canAct).catch(() => false) }).data;
  const [mode, setMode] = useState("");
  const [date, setDate] = useState(localDay());
  const [paying, setPaying] = useState(false);
  const [modePick, setModePick] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const linked = a.BookingId != null;
  const paid = a.PaymentStatus === "Paid";
  const total = Number(a.BookingGrandTotal || 0);
  const pct = total > 0 ? Math.min(100, Math.round((Number(a.BookingTotalPaid || 0) / total) * 100)) : 0;
  const done = () => { qc.invalidateQueries({ queryKey: ["crm"] }); nav.goBack(); };

  const pay = async () => {
    setPaying(true);
    try {
      const d = await crmSend<Row>(`/api/crm/parking/${a.Id}/mark-paid`, "PUT", { PaymentMode: mode || null, ReceivedDate: date || null });
      toast.success(`Payment recorded — receipt ${d.ReceiptNo}`); done();
    } catch (e) { toast.error((e as Error).message || "Could not record the payment"); }
    finally { setPaying(false); }
  };
  const release = async () => {
    if (!reason.trim()) { toast.error("A reason is required"); return; }
    if (confirm.toUpperCase() !== "RELEASE") { toast.error("Type RELEASE to confirm"); return; }
    setBusy(true);
    try {
      const d = await crmSend<Row>(`/api/crm/parking/${a.Id}?reason=${encodeURIComponent(reason.trim())}`, "DELETE");
      toast.success(d.pending ? "Amendment queued — the legal documents are under verification, so it needs sign-off before the slot is released." : "Parking released and the slot returned to inventory");
      setReleasing(false); done();
    } catch (e) { toast.error((e as Error).message || "Release failed"); }
    finally { setBusy(false); }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <Section title={a.ApplicantName || "—"} right={<Pill label={linked ? "With booking" : paid ? "Paid" : "Payment pending"} />}>
        <Kv label="Mobile" value={a.Mobile || "—"} />
        <Kv label="Type" value={a.CurrentParkingType} />
        <Kv label="Slot" value={a.SlotNo || a.ParkingSlotNo || "—"} />
        <Kv label="Base rate" value={money(a.RateSnapshot)} />
        <Kv label={`GST${a.GstRateSnapshot ? ` (${a.GstRateSnapshot}%)` : ""}`} value={money(a.GstAmount)} />
        <Kv label="Total" value={money(a.TotalAmount)} strong />
        {a.Notes ? <Kv label="Notes" value={a.Notes} /> : null}
        <Kv label="Allotted on" value={fmtDate(a.CreatedAt)} />
      </Section>

      {linked ? (
        <Section title={a.BookingNo || "Booking"} right={a.BookingStatus ? <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{a.BookingStatus}</Text> : undefined}>
          {total > 0 ? (
            <>
              <Kv label="Booking collected" value={`${money(a.BookingTotalPaid)} of ${money(total)}`} />
              <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden", marginVertical: 6 }}>
                <View style={{ height: "100%", width: `${pct}%`, backgroundColor: colors.foreground }} />
              </View>
            </>
          ) : null}
          <Text style={{ fontSize: 12.5, color: colors.mutedForeground, marginBottom: 8 }}>Parking is in this booking's grand total and is collected through its milestones — open the booking to see or record payments.</Text>
          <View style={{ flexDirection: "row" }}><ActionKey outline label="Open booking" onPress={() => nav.navigate("CrmBooking", { bookingId: Number(a.BookingId), title: a.BookingNo })} /></View>
        </Section>
      ) : paid ? (
        <Section title="Payment received">
          <Kv label="Receipt" value={a.ReceiptNo || "—"} />
          <Kv label="Mode" value={a.PaymentMode || "—"} />
          <Kv label="Received" value={fmtDate(a.PaymentReceivedDate)} />
        </Section>
      ) : canPay ? (
        <Section title="Record payment">
          <Kv label="Amount due" value={money(a.TotalAmount)} strong />
          <PickerRow label="Payment mode" required value={mode} placeholder="Select mode" onPress={() => setModePick(true)} />
          <DateField label="Received on *" value={date} onChange={(v: string) => setDate(v)} />
          <ActionKey label={paying ? "Recording…" : `Record payment — ${money(a.TotalAmount)}`} onPress={() => { if (!paying && mode && date) void pay(); }} />
          <Text style={{ fontSize: 11.5, color: colors.mutedForeground, textAlign: "center", marginTop: 6 }}>A receipt number is given on recording.</Text>
        </Section>
      ) : (
        <Section title="Payment"><Text style={{ fontSize: 13, color: colors.mutedForeground }}>Payment pending — {money(a.TotalAmount)}.</Text></Section>
      )}

      {canRelease ? (
        <Section title="Release">
          <Text style={{ fontSize: 12.5, color: colors.mutedForeground, marginBottom: 8 }}>
            Frees the slot back to inventory.{linked ? " The booking's grand total and milestones are recalculated." : ""}{paid ? " This allotment is paid — release is blocked." : ""}
          </Text>
          {!paid ? <View style={{ flexDirection: "row" }}><ActionKey outline tone={colors.destructive} label="Release…" onPress={() => { setReason(""); setConfirm(""); setReleasing(true); }} /></View> : null}
        </Section>
      ) : null}

      <OptionPickerModal visible={modePick} title="Payment mode" options={PARKING_PAY_MODES.map((m) => ({ key: m, label: m }))} selectedKey={mode}
        onSelect={(k) => { setMode(k ?? ""); setModePick(false); }} onClose={() => setModePick(false)} />
      <Modal visible={releasing} transparent animationType="fade" onRequestClose={() => setReleasing(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 16 }}>
          <View style={{ backgroundColor: colors.card, borderRadius: 18, padding: 18, gap: 10 }}>
            <Text style={{ fontSize: 17, fontFamily: fonts.heading.semibold, color: colors.foreground }}>Release slot {a.SlotNo || a.ParkingSlotNo || "—"}?</Text>
            <Text style={{ fontSize: 12.5, color: colors.mutedForeground }}>
              {a.CurrentParkingType} allotted to {a.ApplicantName}.{linked ? " The booking's grand total and milestones are recalculated." : ""} It can't be undone without allotting again.
            </Text>
            <TextField label="Reason" required value={reason} onChangeText={setReason} placeholder="Recorded in the audit trail." multiline />
            <TextField label="Type RELEASE to confirm" value={confirm} onChangeText={setConfirm} placeholder="RELEASE" autoCapitalize="characters" />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <ActionKey outline label="Cancel" onPress={() => setReleasing(false)} />
              <ActionKey tone={colors.destructive} label={busy ? "Releasing…" : "Release"}
                onPress={() => { if (!busy && reason.trim() && confirm.toUpperCase() === "RELEASE") void release(); }} />
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

export function ParkingSaleScreen() {
  const nav = useNavigation<Nav>();
  const qc = useQueryClient();
  const [form, setForm] = useState({ ApplicationId: "", BlockId: "", ParkingMasterId: "", ParkingSlotId: "", Notes: "", RateOverride: "" });
  const [saving, setSaving] = useState(false);
  const [pick, setPick] = useState<null | "app" | "block" | "type" | "slot">(null);
  const appsQ = useQuery({ queryKey: ["crm-applications-dropdown"], staleTime: 60_000, queryFn: () => crmGet<Row[]>("/api/crm/applications?includeConverted=1") });
  const blocks = useQuery({ queryKey: ["block-master"], staleTime: 5 * 60_000, queryFn: () => crmGet<Row[]>("/api/block-master").catch(() => []) }).data ?? [];
  const app = (appsQ.data ?? []).find((x) => String(x.Id) === form.ApplicationId);
  const projectId: number | null = app?.ProjectId ?? null;
  const ratesQ = useQuery({ queryKey: ["crm-parking-available", projectId, form.BlockId], enabled: projectId != null,
    queryFn: () => crmGet<Row[] | { rates: Row[] }>(`/api/crm/parking/available?projectId=${projectId}${form.BlockId ? `&blockId=${form.BlockId}` : ""}`).then((d) => (Array.isArray(d) ? d : d.rates ?? [])) });
  const sellable = (ratesQ.data ?? []).filter((r) => r.ParkingMasterId != null);
  const rate = sellable.find((r) => String(r.ParkingMasterId) === form.ParkingMasterId);
  const blocksFor = blocks.filter((x) => projectId != null && String(x.ProjectId) === String(projectId));
  const effRate = rate ? (form.RateOverride !== "" ? Number(form.RateOverride) || 0 : Number(rate.Charge || 0)) : 0;
  const gst = rate ? Math.round(effRate * rate.GstRate) / 100 : 0;

  const create = async () => {
    if (!form.ApplicationId) { toast.error("Select the customer's application"); return; }
    if (!form.ParkingMasterId) { toast.error("Select a parking type"); return; }
    if (!form.ParkingSlotId) { toast.error("Select a slot"); return; }
    if (form.RateOverride !== "" && !(Number(form.RateOverride) >= 0)) { toast.error("Enter a valid rate"); return; }
    setSaving(true);
    try {
      const d = await crmSend<Row>("/api/crm/parking/standalone", "POST", { ApplicationId: form.ApplicationId, ParkingMasterId: form.ParkingMasterId, ParkingSlotId: parseInt(form.ParkingSlotId, 10),
        Quantity: 1, Notes: form.Notes || null, Immediate: true, ...(form.RateOverride ? { RateOverride: form.RateOverride } : {}) });
      toast.success(`Parking allotted — ${money(d.TotalAmount)}`);
      ["crm", "crm-parking-available"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      nav.goBack();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  return (
    <FormScaffold tone={CRM} toneInk="#fff" onCancel={() => nav.goBack()} submitting={saving} submitLabel={saving ? "Allotting…" : "Allot parking"}
      disabled={!form.ApplicationId || !form.ParkingMasterId || !form.ParkingSlotId} onSubmit={create}>
      <Text style={{ fontSize: 12.5, color: colors.mutedForeground, marginBottom: 12 }}>Sells parking to a customer with no unit booking. To add parking to a unit booking, open that booking's Details tab.</Text>
      <PickerRow label="Customer's application" required value={app ? `${app.ApplicantName || "—"} — ${app.Mobile || "—"} (${app.ApplicationNo})` : ""} placeholder="Select application" onPress={() => setPick("app")} />
      {appsQ.isError ? <Text style={{ fontSize: 12, color: colors.destructive }}>{(appsQ.error as Error).message}</Text> : null}
      {app ? (
        <>
          <Kv label="Project" value={app.ProjectMasterName || (projectId != null ? `Project #${projectId}` : "— (the application has no project)")} />
          <PickerRow label="Block" value={blocksFor.find((x) => String(x.Id) === form.BlockId)?.Name || blocksFor.find((x) => String(x.Id) === form.BlockId)?.BlockName || ""} placeholder="Any block" onPress={() => setPick("block")} disabled={projectId == null} />
        </>
      ) : null}
      {projectId != null ? (
        ratesQ.isError ? <Text style={{ fontSize: 12, color: colors.destructive }}>{(ratesQ.error as Error).message}</Text>
          : ratesQ.isLoading ? <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Loading parking types…</Text>
          : sellable.length === 0 ? <Text style={{ fontSize: 12.5, color: colors.foreground, marginBottom: 12 }}>No parking rate is set for this project{form.BlockId ? " / block" : ""}. Set one up in Parking Master before selling.</Text>
          : (
            <>
              <PickerRow label="Parking type" required value={rate ? rate.ParkingType : ""} placeholder="Select type" onPress={() => setPick("type")} />
              <PickerRow label="Slot" required value={(rate?.AvailableSlots ?? []).find((s: Row) => String(s.Id) === form.ParkingSlotId)?.SlotNo ?? ""} placeholder={rate ? "Select slot" : "Pick a type first"} onPress={() => setPick("slot")} disabled={!rate} />
            </>
          )
      ) : null}
      {rate ? (
        <>
          <NumberField label="Rate (₹)" value={form.RateOverride} onChangeText={(v) => setForm((f) => ({ ...f, RateOverride: v }))} placeholder={String(rate.Charge ?? "")} />
          <Text style={{ fontSize: 11.5, color: colors.mutedForeground, marginTop: -10, marginBottom: 12 }}>The master rate is {money(rate.Charge)}; change it only for a price agreed with this customer.</Text>
          <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, marginBottom: 14 }}>
            <Kv label="Base amount" value={money(effRate)} />
            <Kv label={`GST (${rate.GstRate}%)`} value={money(gst)} />
            <Kv label="Total payable" value={money(effRate + gst)} strong />
          </View>
        </>
      ) : null}
      <RemarksField label="Notes" value={form.Notes} onChangeText={(v) => setForm((f) => ({ ...f, Notes: v }))} />

      <OptionPickerModal visible={!!pick} searchable={pick === "app"} title={pick === "app" ? "Customer's application" : pick === "block" ? "Block" : pick === "type" ? "Parking type" : "Slot"}
        options={pick === "app" ? (appsQ.data ?? []).filter((x) => !x.IsPlotSale).map((x) => ({ key: String(x.Id), label: `${x.ApplicantName || "—"} — ${x.Mobile || "—"}`, sublabel: x.ApplicationNo }))
          : pick === "block" ? [{ key: "", label: "Any block" }, ...blocksFor.map((x) => ({ key: String(x.Id), label: x.Name || x.BlockName }))]
          : pick === "type" ? sellable.map((r) => ({ key: String(r.ParkingMasterId), label: r.ParkingType, disabled: !r.AvailableSlots?.length,
              sublabel: `${money(r.Charge)} + ${r.GstRate}% GST ${r.AvailableSlots?.length ? `(${r.AvailableSlots.length} free)` : "— full"}` }))
          : (rate?.AvailableSlots ?? []).map((s: Row) => ({ key: String(s.Id), label: s.SlotNo }))}
        selectedKey={pick === "app" ? form.ApplicationId : pick === "block" ? form.BlockId : pick === "type" ? form.ParkingMasterId : form.ParkingSlotId}
        onSelect={(k) => {
          if (pick === "app") setForm((f) => ({ ApplicationId: k ?? "", BlockId: "", ParkingMasterId: "", ParkingSlotId: "", RateOverride: "", Notes: f.Notes }));
          else if (pick === "block") setForm((f) => ({ ...f, BlockId: k ?? "", ParkingMasterId: "", ParkingSlotId: "", RateOverride: "" }));
          else if (pick === "type") { const r = sellable.find((x) => String(x.ParkingMasterId) === k); if (!r?.AvailableSlots?.length) return;
            setForm((f) => ({ ...f, ParkingMasterId: k ?? "", ParkingSlotId: "", RateOverride: r?.Charge != null ? String(r.Charge) : "" })); }
          else setForm((f) => ({ ...f, ParkingSlotId: k ?? "" }));
          setPick(null);
        }}
        onClose={() => setPick(null)} />
    </FormScaffold>
  );
}

// ── Booking: Parking & Extra Charges ─────────────────────────────────────────
// The web booking page's "Parking & Extra Charges" tab (src/pages/CRM/CrmBookingDetail.tsx), part for part: the
// pending amendments; the parking / extras / grand-total chips; Parking Allotments — + Add Parking (type with its
// rate and free count, slot, rate, qty, live total), Edit (rate, qty, live total), Release; Extra Charges — the charge
// type, description and amount, GST preview at the booking's rate, Add, Edit, Remove. Once the agreement is Executed /
// Registered every change needs a reason and goes as an amendment for approval (the server decides; its words shown).
export function BookingChargesScreen() {
  const qc = useQueryClient();
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmBookingCharges">>();
  const bookingId = params.bookingId;
  const { canDoAction } = useAuth();
  const canEdit = canDoAction("crm-bookings", "edit");
  const bkQ = useQuery({ queryKey: ["crm-booking", bookingId], queryFn: () => crmGet<{ booking: Row; agreement: Row | null }>(`/api/crm/bookings/${bookingId}`) });
  const booking = bkQ.data?.booking;
  const legalWorkStarted = !!(bkQ.data?.agreement && ["Executed", "Registered"].includes(bkQ.data.agreement.Status));
  const isPlotSale = !!booking?.IsPlotSale;
  const approved = booking?.Status === "Approved";
  const parkingQ = useQuery({ queryKey: ["crm-parking", bookingId], queryFn: () => crmGet<Row[]>(`/api/crm/parking/${bookingId}`) });
  const extrasQ = useQuery({ queryKey: ["crm-extra-charges", bookingId], queryFn: () => crmGet<Row[]>(`/api/crm/extra-charges/${bookingId}`) });
  const typesQ = useQuery({ queryKey: ["extra-charge-master-all"], staleTime: 5 * 60_000, queryFn: () => crmGet<Row[]>("/api/extra-charge-master") });
  const amendQ = useQuery({ queryKey: ["crm-booking-amendments", bookingId], staleTime: 15_000, queryFn: () => crmGet<Row[]>(`/api/crm/booking-amendments/booking/${bookingId}`) });
  const rateQ = useQuery({ queryKey: ["crm-extra-work-rate", bookingId], staleTime: 5 * 60_000,
    queryFn: () => crmGet<{ rate: number }>(`/api/crm/extra-charges/${bookingId}/gst-rate`).then((d) => Number(d.rate) || 0) });
  const parking = parkingQ.data ?? [];
  const extras = extrasQ.data ?? [];
  const amendments = amendQ.data ?? [];

  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState({ ParkingType: "", ParkingMasterId: "", ParkingSlotId: "", Quantity: "1", Reason: "", RateOverride: "" });
  const availQ = useQuery({ queryKey: ["crm-parking-available", booking?.ProjectId, booking?.BlockId], staleTime: 30_000, enabled: adding && !!booking?.ProjectId,
    queryFn: () => crmGet<{ rates: Row[] }>(`/api/crm/parking/available?projectId=${booking!.ProjectId}${booking!.BlockId ? `&blockId=${booking!.BlockId}` : ""}`) });
  const rates = availQ.data?.rates ?? [];
  const [editP, setEditP] = useState<number | null>(null);
  const [pForm, setPForm] = useState({ Quantity: "1", RateOverride: "" });
  const [pReason, setPReason] = useState("");
  const [editX, setEditX] = useState<number | null>(null);
  const [xForm, setXForm] = useState({ ExtraChargeMasterId: "", Description: "", Amount: "" });
  const [xReason, setXReason] = useState("");
  const [typePick, setTypePick] = useState<null | "ptype" | "slot" | "xtype">(null);
  const [reasonFor, setReasonFor] = useState<null | { title: string; label: string; go: (reason: string) => Promise<void> }>(null);
  const [reasonText, setReasonText] = useState("");

  const changed = () => ["crm-parking", "crm-extra-charges", "crm-booking", "crm-booking-amendments"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const run = async (fn: () => Promise<Row>, done: (r: Row) => string) => {
    setBusy(true);
    try { const r = await fn(); toast.success(done(r)); changed(); return true; }
    catch (e) { toast.error((e as Error).message); return false; }
    finally { setBusy(false); }
  };
  const inr = (n: unknown) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

  const addParking = async () => {
    if (!addForm.ParkingType) { toast.error("Select a parking type"); return; }
    if (legalWorkStarted && !addForm.Reason.trim()) { toast.error("A reason is required — legal documents are already under verification"); return; }
    const rate = rates.find((r) => r.ParkingType === addForm.ParkingType);
    const unrated = rate?.NeedsRate;
    if (unrated && (!addForm.RateOverride || Number(addForm.RateOverride) <= 0)) { toast.error("Enter a price for this parking type"); return; }
    const payload: Row = { Quantity: parseInt(addForm.Quantity) || 1 };
    if (unrated) { payload.ParkingType = addForm.ParkingType; payload.Charge = addForm.RateOverride; }
    else { payload.ParkingMasterId = parseInt(addForm.ParkingMasterId); if (addForm.RateOverride) payload.RateOverride = addForm.RateOverride; }
    if (addForm.ParkingSlotId) payload.ParkingSlotId = parseInt(addForm.ParkingSlotId);
    if (addForm.Reason.trim()) payload.Reason = addForm.Reason.trim();
    if (addForm.RateOverride) payload.RateOverride = addForm.RateOverride;
    if (await run(() => crmSend(`/api/crm/parking/${bookingId}`, "POST", payload), (r) => (r.pending ? "Amendment request submitted — pending approval" : "Parking allotment added"))) {
      setAdding(false); setAddForm({ ParkingType: "", ParkingMasterId: "", ParkingSlotId: "", Quantity: "1", Reason: "", RateOverride: "" });
    }
  };
  const saveParking = async () => {
    if (!editP) return;
    if (legalWorkStarted && !pReason.trim()) { toast.error("A reason is required — legal documents are already under verification for this booking"); return; }
    if (await run(() => crmSend(`/api/crm/parking/${editP}`, "PUT", { Quantity: parseInt(pForm.Quantity) || 1, ...(pForm.RateOverride ? { RateOverride: pForm.RateOverride } : {}), Reason: legalWorkStarted ? pReason.trim() : undefined }),
      (r) => (r.pending ? "Amendment request submitted — pending approval" : `Parking updated — ${inr(r.TotalAmount)}`))) { setEditP(null); setPForm({ Quantity: "1", RateOverride: "" }); setPReason(""); }
  };
  const releaseParking = (pid: number) => {
    if (!legalWorkStarted) { void run(() => crmSend(`/api/crm/parking/${pid}`, "DELETE"), () => "Parking allotment released"); return; }
    setReasonText("");
    setReasonFor({ title: "Release Parking Allotment", label: "Agreement is already executed — this will queue an amendment for approval. State the reason:",
      go: async (reason) => { await run(() => crmSend(`/api/crm/parking/${pid}?reason=${encodeURIComponent(reason.trim())}`, "DELETE"),
        (r) => (r.pending ? "Amendment queued — needs sign-off before the slot is released" : "Parking allotment released")); } });
  };
  const saveExtra = async () => {
    if (!xForm.Description.trim() || !xForm.Amount) { toast.error("Description and Amount are required"); return; }
    if (legalWorkStarted && !xReason.trim()) { toast.error("A reason is required — legal documents are already under verification for this booking"); return; }
    const isEdit = editX != null;
    if (await run(() => crmSend(isEdit ? `/api/crm/extra-charges/${editX}` : `/api/crm/extra-charges/${bookingId}`, isEdit ? "PUT" : "POST", {
      ExtraChargeMasterId: xForm.ExtraChargeMasterId || null, Description: xForm.Description.trim(), Amount: parseFloat(xForm.Amount), Reason: legalWorkStarted ? xReason.trim() : undefined,
    }), (r) => (r.pending ? "Amendment request submitted — pending approval" : isEdit ? `Charge updated — ${inr(r.TotalAmount)}` : `Charge added — ${inr(r.TotalAmount)}`))) {
      setEditX(null); setXForm({ ExtraChargeMasterId: "", Description: "", Amount: "" }); setXReason("");
    }
  };
  const removeExtra = (xid: number) => {
    if (!legalWorkStarted) { void run(() => crmSend(`/api/crm/extra-charges/${xid}`, "DELETE"), () => "Charge removed"); return; }
    setReasonText("");
    setReasonFor({ title: "Remove Extra Charge", label: "Legal documents are already under verification. Enter a reason for removing this charge:",
      go: async (reason) => { await run(() => crmSend(`/api/crm/extra-charges/${xid}?reason=${encodeURIComponent(reason.trim())}`, "DELETE"),
        (r) => (r.pending ? "Amendment request submitted — pending approval" : "Charge removed")); } });
  };

  const parkingAmt = parking.reduce((s, p) => s + Number(p.TotalAmount || 0), 0);
  const extrasAmt = extras.reduce((s, c) => s + Number(c.TotalAmount || 0), 0);
  const grandTotal = Number(booking?.GrandTotal ?? 0) > 0 ? Number(booking?.GrandTotal)
    : [booking?.TotalValue, booking?.UnitGstAmount, booking?.ParkingTotal, booking?.ExtraChargesTotal].reduce((s: number, v) => s + (Number(v) || 0), 0);
  const selRate = rates.find((r) => r.ParkingType === addForm.ParkingType);
  const chip = (label: string, value: string) => (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 }}>
      <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{label} <Text style={{ fontFamily: fonts.body.medium, color: colors.foreground }}>{value}</Text></Text>
    </View>
  );
  const totalBox = (lines: [string, string][], total: [string, string]) => (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, gap: 3, marginBottom: 12 }}>
      {lines.map(([l, v]) => (
        <View key={l} style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{l}</Text>
          <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{v}</Text>
        </View>
      ))}
      <View style={{ flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 4, marginTop: 2 }}>
        <Text style={{ fontSize: 12.5, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{total[0]}</Text>
        <Text style={{ fontSize: 12.5, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{total[1]}</Text>
      </View>
    </View>
  );

  if (bkQ.isLoading) return <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: "center" }}><ActivityIndicator color={colors.mutedForeground} /></View>;
  const addEffRate = addForm.RateOverride ? Number(addForm.RateOverride) : selRate?.Charge != null ? Number(selRate.Charge) : 0;
  const addGst = selRate ? Math.round(addEffRate * Number(selRate.GstRate) / 100 * 100) / 100 : 0;
  const xGst = rateQ.data != null && Number(xForm.Amount) > 0 ? Math.round(Number(xForm.Amount) * rateQ.data) / 100 : null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      {amendments.length > 0 ? (
        <Section title={`Pending Amendments (${amendments.length})`}>
          {amendments.map((a) => (
            <View key={a.Id} style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Text style={{ fontSize: 13, fontFamily: fonts.body.medium, color: colors.foreground }}>
                {a.ChangeType === "ParkingAllotment" ? "Parking" : a.ChangeType === "ExtraCharge" ? "Extra Charge" : a.ChangeType} — {a.Action}
                <Text style={{ fontFamily: fonts.body.regular, color: colors.mutedForeground }}> by {a.RequestedByName || "—"}{a.RequestedAt ? ` · ${fmtDate(a.RequestedAt)}` : ""}</Text>
              </Text>
              {a.Reason ? <Text style={{ fontSize: 12, fontStyle: "italic", fontFamily: fonts.body.regular, color: colors.mutedForeground }}>"{a.Reason}"</Text> : null}
            </View>
          ))}
        </Section>
      ) : null}

      {parking.length || extras.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {parking.length ? chip("Parking:", `${parking.length} slot${parking.length > 1 ? "s" : ""} (${money(parkingAmt)})`) : null}
          {extras.length ? chip("Extra charges:", `${extras.length} item${extras.length > 1 ? "s" : ""} (${money(extrasAmt)})`) : null}
          {grandTotal > 0 ? chip("Grand total:", money(grandTotal)) : null}
        </View>
      ) : null}

      {!isPlotSale ? (
        <Section title="Parking Allotments" right={parking.length ? <Text style={{ fontSize: 12.5, fontFamily: fonts.heading.semibold, color: colors.foreground }}>Total {money(parkingAmt)}</Text> : undefined}>
          {canEdit && !approved && !parkingQ.isLoading && !adding ? (
            <View style={{ flexDirection: "row", marginBottom: 8 }}><ActionKey outline label="+ Add Parking" onPress={() => setAdding(true)} /></View>
          ) : null}
          {adding ? (
            <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, marginBottom: 10 }}>
              <Text style={{ fontSize: 13, fontFamily: fonts.body.medium, color: colors.foreground, marginBottom: 8 }}>Add Parking Allotment</Text>
              {availQ.isError ? <Text style={{ color: colors.destructive, fontSize: 12.5 }}>{(availQ.error as Error).message || "Could not load available parking."}</Text>
                : availQ.isLoading ? <Text style={{ fontSize: 12.5, color: colors.mutedForeground }}>Loading available parking…</Text>
                : rates.length === 0 ? <Text style={{ fontSize: 12.5, color: colors.mutedForeground, marginBottom: 8 }}>No parking configured for this project.</Text>
                : (
                  <>
                    <PickerRow label="Parking type" value={addForm.ParkingType} placeholder="— Select parking type —" onPress={() => setTypePick("ptype")} />
                    {selRate?.AvailableSlots?.length ? (
                      <PickerRow label="Slot" value={selRate.AvailableSlots.find((s: Row) => String(s.Id) === addForm.ParkingSlotId)?.SlotNo ?? ""} placeholder="— Any available slot —" onPress={() => setTypePick("slot")} />
                    ) : null}
                    {addForm.ParkingType ? (
                      <>
                        <NumberField label={`Rate (₹)${selRate?.NeedsRate ? " *" : ""}`} value={addForm.RateOverride} onChangeText={(v) => setAddForm((f) => ({ ...f, RateOverride: v }))}
                          placeholder={selRate?.NeedsRate ? "Enter price…" : selRate ? String(selRate.Charge) : undefined} />
                        <Text style={{ fontSize: 11.5, color: colors.mutedForeground, marginTop: -10, marginBottom: 12 }}>{selRate?.NeedsRate ? "No master rate — enter agreed price." : `Master: ${money(selRate?.Charge)}`}</Text>
                        <NumberField label="Qty" value={addForm.Quantity} onChangeText={(v) => setAddForm((f) => ({ ...f, Quantity: v }))} />
                        {addEffRate > 0 && Number(addForm.Quantity) > 0 ? totalBox([
                          [`Base (${addForm.Quantity} × ${money(addEffRate)})`, money(addEffRate * Number(addForm.Quantity))],
                          ...(!selRate?.NeedsRate && addGst > 0 ? [[`GST (${selRate?.GstRate}%)`, money(addGst * Number(addForm.Quantity))] as [string, string]] : []),
                        ], ["Total payable", money((addEffRate + addGst) * Number(addForm.Quantity))]) : null}
                      </>
                    ) : null}
                    {legalWorkStarted ? <TextField label="Reason for amendment (required)" value={addForm.Reason} onChangeText={(v) => setAddForm((f) => ({ ...f, Reason: v }))} /> : null}
                  </>
                )}
              <View style={{ flexDirection: "row", gap: 8 }}>
                {rates.length ? <ActionKey label={busy ? "Saving…" : "Save"} onPress={addParking} /> : null}
                <ActionKey outline label="Cancel" onPress={() => { setAdding(false); setAddForm({ ParkingType: "", ParkingMasterId: "", ParkingSlotId: "", Quantity: "1", Reason: "", RateOverride: "" }); }} />
              </View>
            </View>
          ) : null}
          {parkingQ.isLoading && !parking.length ? <Text style={{ fontSize: 12.5, color: colors.mutedForeground }}>Loading parking allotments…</Text>
            : parkingQ.isError ? <Text style={{ fontSize: 12.5, color: colors.destructive }}>{(parkingQ.error as Error).message || "Could not load parking allotments."}</Text>
            : !parking.length ? <Text style={{ fontSize: 12.5, color: colors.mutedForeground }}>No parking allotments linked to this booking.</Text>
            : parking.map((p) => (
              <View key={p.Id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, marginBottom: 8, gap: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Text style={{ fontSize: 14, fontFamily: fonts.body.medium, color: colors.foreground }}>{p.SlotNo || p.ParkingSlotNo || `Slot #${p.ParkingSlotId ?? "—"}`}</Text>
                  {p.CurrentParkingType ? <Pill label={p.CurrentParkingType} /> : null}
                  <Pill label="With Booking" />
                </View>
                {editP === p.Id ? (
                  <>
                    <NumberField label="Rate (₹)" value={pForm.RateOverride} onChangeText={(v) => setPForm((f) => ({ ...f, RateOverride: v }))} placeholder={String(p.RateSnapshot ?? "")} />
                    <Text style={{ fontSize: 11.5, color: colors.mutedForeground, marginTop: -10, marginBottom: 12 }}>Master rate: {money(p.RateSnapshot)}</Text>
                    <NumberField label="Qty" value={pForm.Quantity} onChangeText={(v) => setPForm((f) => ({ ...f, Quantity: v }))} />
                    {pForm.RateOverride && Number(pForm.Quantity) > 0 ? (() => {
                      const rate = Number(pForm.RateOverride);
                      const gstRate = p.GstRateSnapshot != null ? Number(p.GstRateSnapshot) : booking?.UnitParkingGstRate != null ? Number(booking.UnitParkingGstRate) : 0;
                      const base = rate * Number(pForm.Quantity);
                      const gst = Math.round(base * gstRate / 100 * 100) / 100;
                      return totalBox([[`Base (${pForm.Quantity} × ${money(rate)})`, money(base)], [`GST (${gstRate}%)`, money(gst)]], ["Total", money(base + gst)]);
                    })() : null}
                    {legalWorkStarted ? <TextField label="Reason for amendment (required)" value={pReason} onChangeText={setPReason} /> : null}
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <ActionKey label={busy ? "Saving…" : "Save changes"} onPress={saveParking} />
                      <ActionKey outline label="Cancel" onPress={() => { setEditP(null); setPForm({ Quantity: "1", RateOverride: "" }); setPReason(""); }} />
                    </View>
                  </>
                ) : (
                  <>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 4 }}>
                      <Kv label="Qty" value={String(p.Quantity)} />
                      <Kv label="Rate" value={money(p.RateSnapshot)} />
                      <Kv label="GST" value={p.GstRateSnapshot != null ? `${p.GstRateSnapshot}% (${money(p.GstAmount)})` : "—"} />
                      <Kv label="Total" value={money(p.TotalAmount)} strong />
                      <Kv label="Receipt" value={p.ReceiptNo || "—"} />
                    </View>
                    {canEdit ? (
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <ActionKey outline label="Edit" onPress={() => { setEditP(p.Id); setPForm({ Quantity: String(p.Quantity), RateOverride: String(p.RateSnapshot ?? "") }); }} />
                        <ActionKey outline tone={colors.destructive} label="Release" onPress={() => releaseParking(p.Id)} />
                      </View>
                    ) : null}
                  </>
                )}
              </View>
            ))}
        </Section>
      ) : null}

      <Section title="Extra Charges">
        {extrasQ.isLoading && !extras.length ? <Text style={{ fontSize: 12.5, color: colors.mutedForeground }}>Loading extra charges…</Text>
          : extrasQ.isError ? <Text style={{ fontSize: 12.5, color: colors.destructive }}>{(extrasQ.error as Error).message || "Could not load extra charges."}</Text>
          : !extras.length ? <Text style={{ fontSize: 12.5, color: colors.mutedForeground }}>No extra charges added yet.</Text>
          : extras.map((c) => (
            <View key={c.Id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, marginBottom: 8, gap: 6 }}>
              {editX === c.Id ? (
                <>
                  <TextField label="Description" value={xForm.Description} onChangeText={(v) => setXForm((f) => ({ ...f, Description: v }))} />
                  <NumberField label="Amount" value={xForm.Amount} onChangeText={(v) => setXForm((f) => ({ ...f, Amount: v }))} />
                  {legalWorkStarted ? <TextField label="Reason for amendment (required)" value={xReason} onChangeText={setXReason} /> : null}
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <ActionKey label={busy ? "Saving…" : "Save"} onPress={saveExtra} />
                    <ActionKey outline label="Cancel" onPress={() => { setEditX(null); setXForm({ ExtraChargeMasterId: "", Description: "", Amount: "" }); setXReason(""); }} />
                  </View>
                </>
              ) : (
                <>
                  <Text style={{ fontSize: 14, fontFamily: fonts.body.medium, color: colors.foreground }}>{c.Description}</Text>
                  <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{money(c.Amount)}   GST: {c.GstRate}%   Total: {money(c.TotalAmount)}</Text>
                  {canEdit ? (
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <ActionKey outline label="Edit" onPress={() => { setEditX(c.Id); setXForm({ ExtraChargeMasterId: c.ExtraChargeMasterId ? String(c.ExtraChargeMasterId) : "", Description: c.Description || "", Amount: c.Amount != null ? String(c.Amount) : "" }); }} />
                      <ActionKey outline tone={colors.destructive} label="Remove" onPress={() => removeExtra(c.Id)} />
                    </View>
                  ) : null}
                </>
              )}
            </View>
          ))}
        {canEdit && !editX && !approved && !extrasQ.isLoading && !extrasQ.isError ? (
          <View style={{ marginTop: 6 }}>
            {legalWorkStarted ? <TextField label="Reason for amendment (required)" value={xReason} onChangeText={setXReason} /> : null}
            {typesQ.isError ? <Text style={{ fontSize: 12, color: colors.destructive, marginBottom: 8 }}>Couldn’t load charge types.</Text> : null}
            <PickerRow label="Charge type" value={(typesQ.data ?? []).find((t) => String(t.Id) === xForm.ExtraChargeMasterId)?.ChargeName ?? ""}
              placeholder="— Select charge type —" onPress={() => setTypePick("xtype")} />
            <TextField label="Description" value={xForm.Description} onChangeText={(v) => setXForm((f) => ({ ...f, Description: v }))} />
            <NumberField label="Amount" value={xForm.Amount} onChangeText={(v) => setXForm((f) => ({ ...f, Amount: v }))} />
            {xGst != null ? (
              <View style={{ flexDirection: "row", justifyContent: "space-between", borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12 }}>
                <Text style={{ fontSize: 12.5, color: colors.foreground }}>GST ({rateQ.data}%)</Text>
                <Text style={{ fontSize: 12.5, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{inr(xGst)} → Total {inr(Math.round((Number(xForm.Amount) + xGst) * 100) / 100)}</Text>
              </View>
            ) : null}
            <View style={{ flexDirection: "row" }}><ActionKey label={busy ? "Adding…" : "Add"} onPress={saveExtra} /></View>
          </View>
        ) : null}
      </Section>

      <OptionPickerModal visible={!!typePick} title={typePick === "ptype" ? "Parking type" : typePick === "slot" ? "Slot" : "Charge type"}
        options={typePick === "ptype" ? rates.map((r) => ({ key: r.ParkingType, label: r.ParkingType, disabled: !!r.SoldOutProjectWide,
            sublabel: `${r.NeedsRate ? "price required" : `${money(r.Charge)} + ${r.GstRate}% GST`}${r.SoldOutProjectWide ? " (sold out)" : r.FreeCountProjectWide > 0 ? ` (${r.FreeCountProjectWide} free)` : ""}` }))
          : typePick === "slot" ? [{ key: "", label: "— Any available slot —" }, ...(selRate?.AvailableSlots ?? []).map((s: Row) => ({ key: String(s.Id), label: s.SlotNo }))]
          : (typesQ.data ?? []).map((t) => ({ key: String(t.Id), label: t.ChargeName, sublabel: t.DefaultAmount ? money(t.DefaultAmount) : undefined }))}
        selectedKey={typePick === "ptype" ? addForm.ParkingType : typePick === "slot" ? addForm.ParkingSlotId : xForm.ExtraChargeMasterId}
        onSelect={(k) => {
          if (typePick === "ptype") { const r = rates.find((x) => x.ParkingType === k); if (r?.SoldOutProjectWide) return;
            setAddForm((f) => ({ ...f, ParkingType: k ?? "", ParkingMasterId: r?.ParkingMasterId != null ? String(r.ParkingMasterId) : "", ParkingSlotId: "", RateOverride: "" })); }
          else if (typePick === "slot") setAddForm((f) => ({ ...f, ParkingSlotId: k ?? "" }));
          else { const t = (typesQ.data ?? []).find((x) => String(x.Id) === k);
            setXForm((f) => ({ ...f, ExtraChargeMasterId: k ?? "", Description: t?.ChargeName || f.Description, Amount: t?.DefaultAmount ? String(t.DefaultAmount) : f.Amount })); }
          setTypePick(null);
        }}
        onClose={() => setTypePick(null)} />

      <Modal visible={!!reasonFor} transparent animationType="fade" onRequestClose={() => setReasonFor(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 16 }}>
          <View style={{ backgroundColor: colors.card, borderRadius: 18, padding: 18, gap: 12 }}>
            <Text style={{ fontSize: 17, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{reasonFor?.title}</Text>
            <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{reasonFor?.label}</Text>
            <TextInput value={reasonText} onChangeText={setReasonText} multiline
              style={{ minHeight: 72, textAlignVertical: "top", borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, color: colors.foreground, fontFamily: fonts.body.regular }} />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <ActionKey outline label="Cancel" onPress={() => setReasonFor(null)} />
              <ActionKey label="Confirm" onPress={() => {
                if (!reasonText.trim()) { toast.error("A reason is required"); return; }
                const r = reasonFor; setReasonFor(null); void r?.go(reasonText);
              }} />
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

// ── On Account: Adjust a deposit ─────────────────────────────────────────────
// The web On Account page's Adjust dialog (src/pages/CRM/CrmOnAccount.tsx AdjustDialog), part for part: Deposited /
// Applied / Available; the "Held on account" bar while the booking isn't fully funded; the bounced and "raise the
// Demand first" notes; only the next unpaid milestone, once its Demand is raised; the amount (blank = the most it can
// take); Apply manually → PUT /api/crm/payments/on-account/:id/apply; the web's messages.
export function OnAccountAdjustScreen() {
  const nav = useNavigation<Nav>();
  const qc = useQueryClient();
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmOnAccountAdjust">>();
  const deposit = params.deposit;
  const [selId, setSelId] = useState<number | null>(null);
  const [amt, setAmt] = useState("");
  const [busy, setBusy] = useState(false);
  const bkQ = useQuery({ queryKey: ["bk-milestones", deposit.BookingId], staleTime: 30_000,
    queryFn: () => crmGet<{ booking: Row; milestones: Row[]; summary: Row }>(`/api/crm/payments/booking/${deposit.BookingId}`) });
  const bk = bkQ.data;

  const nextMilestone = [...(bk?.milestones ?? [])].sort((a, b) => Number(a.MilestoneNo) - Number(b.MilestoneNo))
    .find((m) => m.Status !== "Paid" && m.Status !== "Waived");
  const outstanding = nextMilestone && Number(nextMilestone.AmountDue) - Number(nextMilestone.AmountPaid) > 0 && nextMilestone.DemandStatus !== "Pending" ? [nextMilestone] : [];
  const required = bk?.milestones?.length ? Number(bk.summary.totalDue || 0) : Number(bk?.booking?.GrandTotal) || 0;
  const funded = Number(bk?.summary?.totalPaid || 0) + Number(bk?.booking?.OnAccountAvailable || 0);
  const notFullyPaid = required > 0 && funded + 0.005 < required;
  const shortfall = Math.max(0, Math.round((required - funded) * 100) / 100);
  const bounced = deposit.Status === "Bounced";
  const sel = outstanding.find((m) => m.Id === selId);
  const maxAmt = sel ? Math.max(0, Math.min(Number(deposit.AvailableBalance), Number(sel.AmountDue) - Number(sel.AmountPaid))) : Number(deposit.AvailableBalance);

  const apply = async () => {
    if (bounced) { toast.error("This deposit was bounced and cannot be applied"); return; }
    if (notFullyPaid) { toast.error(`${money(shortfall)} more must be received before adjustment`); return; }
    if (!outstanding.length) { toast.error("The next milestone must be eligible and have its Demand raised before adjustment"); return; }
    if (selId == null) { toast.error("Select a milestone first"); return; }
    if (!sel) { toast.error("The selected milestone is no longer eligible. Refresh and select the next outstanding milestone."); return; }
    const n = amt ? parseFloat(amt) : undefined;
    if (n !== undefined && (isNaN(n) || n <= 0)) { toast.error("Enter a valid amount"); return; }
    if (n && n > maxAmt) { toast.error(`At most ${money(maxAmt)}`); return; }
    setBusy(true);
    try {
      const data = await crmSend<Row>(`/api/crm/payments/on-account/${deposit.Id}/apply`, "PUT", { MilestoneId: selId, ...(n ? { Amount: n } : {}) });
      toast.success(`${money(data.applied)} applied · ${money(data.remaining)} left`);
      for (const k of ["crm", "bk-milestones", "crm-booking-on-account", "crm-booking-detail"]) qc.invalidateQueries({ queryKey: [k] });
      nav.goBack();
    } catch (e) { toast.error((e as Error).message || "Apply failed"); }
    finally { setBusy(false); }
  };

  const note = (text: string, danger = false) => (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderLeftWidth: 3, borderLeftColor: danger ? colors.destructive : colors.foreground, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 }}>
      <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: danger ? colors.destructive : colors.foreground }}>{text}</Text>
    </View>
  );

  return (
    <FormScaffold tone={CRM} toneInk="#fff" onCancel={() => nav.goBack()} submitting={busy}
      submitLabel={notFullyPaid ? "Settles once fully funded" : busy ? "Applying…" : "Apply manually"}
      disabled={notFullyPaid || selId == null || !sel || bounced || outstanding.length === 0} onSubmit={apply}>
      <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginBottom: 12 }}>
        {[deposit.ApplicantName, deposit.BookingNo, deposit.ProjectName, deposit.UnitNo].filter(Boolean).join(" · ")}
      </Text>
      <View style={{ flexDirection: "row", borderWidth: 1, borderColor: colors.border, borderRadius: 12, marginBottom: 12 }}>
        {[["Deposited", deposit.Amount], ["Applied", deposit.AppliedAmount], ["Available", deposit.AvailableBalance]].map(([label, val], i) => (
          <View key={String(label)} style={{ flex: 1, paddingHorizontal: 10, paddingVertical: 8, borderLeftWidth: i ? 1 : 0, borderLeftColor: colors.border }}>
            <Text style={{ fontSize: 11, fontFamily: fonts.body.medium, color: colors.mutedForeground }}>{label}</Text>
            <Text style={{ marginTop: 3, fontSize: 14, fontFamily: fonts.heading.bold, color: colors.foreground, fontVariant: ["tabular-nums"] }}>{money(val)}</Text>
          </View>
        ))}
      </View>

      {notFullyPaid ? (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderLeftWidth: 3, borderLeftColor: colors.foreground, borderRadius: 10, padding: 12, gap: 8, marginBottom: 12 }}>
          <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: colors.foreground }}>Held on account — settles itself once the booking is fully funded</Text>
          <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground, fontVariant: ["tabular-nums"] }}>{money(funded)} of {money(required)}</Text>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden" }}>
            <View style={{ height: "100%", width: `${required > 0 ? Math.min(100, (funded / required) * 100) : 0}%`, backgroundColor: colors.foreground }} />
          </View>
          <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>
            {money(shortfall)} more in valid payments funds the remaining dues; eligible milestones then settle in order. Manual apply is only a fallback.
          </Text>
        </View>
      ) : null}
      {bounced ? note("This deposit bounced — it can't be applied.", true) : null}
      {!notFullyPaid && !bounced && nextMilestone?.DemandStatus === "Pending" ? note(`Raise the Demand for ${nextMilestone.MilestoneName} before applying on-account money.`) : null}

      <FormSection title="Milestone to apply against (manual fallback)">
        {bkQ.isError ? <Text style={{ color: colors.destructive, fontFamily: fonts.body.medium, fontSize: 13 }}>{(bkQ.error as Error).message || "Could not load the booking's milestones."}</Text>
          : bkQ.isLoading ? <ActivityIndicator color={colors.mutedForeground} style={{ paddingVertical: 16 }} />
          : outstanding.length === 0 ? (
            <Text style={{ textAlign: "center", paddingVertical: 16, fontSize: 13, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>
              {nextMilestone ? "The next milestone isn't open to adjustment yet." : "No outstanding milestones on this booking."}
            </Text>
          ) : outstanding.map((m) => {
            const due = Number(m.AmountDue) - Number(m.AmountPaid);
            const on = selId === m.Id;
            return (
              <Pressable key={m.Id} disabled={notFullyPaid || bounced} onPress={() => { setSelId(m.Id); setAmt(String(Math.min(Number(deposit.AvailableBalance), due))); }}
                style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: on ? CRM : colors.border,
                  borderLeftWidth: 3, borderLeftColor: on ? CRM : "transparent", backgroundColor: on ? `${CRM}14` : "transparent", opacity: notFullyPaid || bounced ? 0.5 : 1 }}>
                <Text style={{ width: 22, fontSize: 12, fontFamily: fonts.heading.semibold, color: colors.mutedForeground }}>{m.MilestoneNo}</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontSize: 14, fontFamily: fonts.body.medium, color: colors.foreground }}>{m.MilestoneName}</Text>
                  <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{m.DueDate ? `Due ${fmtDate(m.DueDate)}` : "No due date"}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: colors.foreground, fontVariant: ["tabular-nums"] }}>{money(due)}</Text>
                  <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>of {money(m.AmountDue)}</Text>
                </View>
              </Pressable>
            );
          })}
      </FormSection>
      {selId !== null && !notFullyPaid && !bounced ? (
        <NumberField label={`Amount to apply (blank = ${money(maxAmt)})`} value={amt} onChangeText={setAmt} />
      ) : null}
    </FormScaffold>
  );
}

// ── Application: step 1 (customer, project, unit or plots, plan, rate) ───────
// The web Application wizard's first step (src/pages/crm/CrmApplication.tsx): the same lists, the same "free to sell"
// rule (no live booking or hold, land only as plots), the same plan cascade (the unit's tags, else its block's, else
// its project's, else every active plan) and the server's own price quote (POST /applications/price-quote). Saves with
// POST /api/crm/applications (new) or PUT /:id (an existing draft), exactly the fields the web's step 1 sends.
type Pick = { key: string; label: string; sublabel?: string };
/** The web's Bank/KYC and co-applicant fields, in its order and with its labels (BankDetailsStep / CoApplicantStep). */
const BANK_FIELDS: [string, string][] = [
  ["BankName", "Bank Name"], ["BranchName", "Branch"], ["AccountNo", "Account No"], ["IfscCode", "IFSC Code"],
  ["AccountHolderName", "Account Holder Name"], ["PanNo", "PAN (Permanent Account Number)"], ["AadhaarNo", "Aadhaar No"],
  ["Occupation", "Occupation"], ["AnnualIncome", "Annual Income"],
];
const CO_FIELDS: [string, string][] = [
  ["Name", "Name"], ["Relation", "Relation"], ["Mobile", "Mobile"], ["Email", "Email"], ["PanNo", "PAN"], ["AadhaarNo", "Aadhaar"],
  ["DateOfBirth", "Date of birth"], ["Gender", "Gender"], ["Occupation", "Occupation"], ["AnnualIncome", "Annual income"],
  ["Address", "Address"], ["City", "City"], ["State", "State"], ["Pincode", "Pincode"], ["Notes", "Notes"],
];
const ids = (csv: unknown) => String(csv ?? "").split(",").filter(Boolean);

export function ApplicationFormScreen() {
  const nav = useNavigation<Nav>();
  const qc = useQueryClient();
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmApplicationForm">>();
  const [editId, setEditId] = useState<number | undefined>(params?.applicationId);
  const [step, setStep] = useState(1);
  const scrollRef = useRef<{ scrollTo: (o: { y: number; animated?: boolean }) => void } | null>(null);
  // The step strip keeps the step in view.
  const stripRef = useRef<{ scrollTo: (o: { x: number; animated?: boolean }) => void } | null>(null);
  useEffect(() => { stripRef.current?.scrollTo({ x: Math.max(0, (step - 2) * 120), animated: true }); }, [step]);
  const { canDoAction } = useAuth();
  const allowed = canDoAction("crm-applications", editId ? "edit" : "create");

  const existing = useQuery({ queryKey: ["crm-application", editId], enabled: allowed && !!editId, queryFn: () => crmGet<{ application: Row }>(`/api/crm/applications/${editId}`).then((d) => d.application) });
  const companiesQ = useQuery({ queryKey: ["business-dropdown"], enabled: allowed, staleTime: 5 * 60_000, queryFn: () => crmGet<{ companies: { id: number; name: string }[] }>("/api/business/dropdown") });
  const projectsQ = useQuery({ queryKey: ["unit-projects"], enabled: allowed, staleTime: 5 * 60_000, queryFn: () => crmGet<Row[]>("/api/unit-master/projects") });
  const unitsQ = useQuery({ queryKey: ["unit-master"], enabled: allowed, staleTime: 60_000, queryFn: () => crmGet<Row[]>("/api/unit-master?isActive=1") });
  const plotsQ = useQuery({ queryKey: ["plot-master"], enabled: allowed, staleTime: 60_000, queryFn: () => crmGet<Row[]>("/api/plot-master?available=1") });
  const plansQ = useQuery({ queryKey: ["crm-payment-plans"], enabled: allowed, staleTime: 5 * 60_000, queryFn: () => crmGet<Row[]>("/api/crm/payment-plans") });
  const blocksQ = useQuery({ queryKey: ["block-master"], enabled: allowed, staleTime: 5 * 60_000, queryFn: () => crmGet<Row[]>("/api/block-master") });

  const [customer, setCustomer] = useState<{ Id: number; Name: string } | null>(params?.customer ?? null);
  const [custQuery, setCustQuery] = useState("");
  const [picker, setPicker] = useState<null | "customer" | "company" | "project" | "block" | "floor" | "unit" | "plot" | "plan" | "parkType" | "slot" | "broker" | "coCustomer">(null);
  const custQ = useQuery({ queryKey: ["crm-customer-pick", custQuery], enabled: allowed && (!editId || picker === "coCustomer"),
    queryFn: () => crmGet<{ rows: Row[] }>(`/api/crm/customers?pageSize=30&page=1${custQuery ? `&search=${encodeURIComponent(custQuery)}` : ""}`) });

  // A unit or plot picked on the Unit Matrix starts a new application on it.
  const pick = params?.applicationId ? undefined : params?.pick;
  const [f, setF] = useState({ CompanyId: "", ProjectId: pick ? String(pick.ProjectId) : "", BlockId: "", FloorNo: "",
    UnitId: pick?.UnitId != null ? String(pick.UnitId) : "", PlotIds: pick?.PlotId != null ? [String(pick.PlotId)] : [] as string[], PaymentPlanId: "", RatePerSqFt: "", DateOfApply: new Date().toISOString().slice(0, 10),
    ViaBroker: false, BrokerId: "", BrokerageRatePercent: "", BrokeragePaymentPlan: "OneTime" });
  // The broker (the web's "Via Broker" block): Broker Master's own record, the deal's override % and payout plan.
  const brokersQ = useQuery({ queryKey: ["account-head-br"], enabled: allowed && f.ViaBroker, staleTime: 5 * 60_000, queryFn: () => crmGet<Row[]>("/api/account-head?type=BR") });
  const tiersQ = useQuery({ queryKey: ["crm-brokerage-rate-tiers"], enabled: allowed && f.ViaBroker, staleTime: 5 * 60_000, queryFn: () => crmGet<Row[]>("/api/crm/brokerage-rate-tiers") });
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const loaded = useRef(false);
  useEffect(() => {
    const a = existing.data;
    if (!a || loaded.current) return;
    loaded.current = true;
    // A draft reopens at the step it reached (the web's Resume).
    if (a.Status === "Draft" && Number(a.CurrentStep) > 1) setStep(Math.min(7, Number(a.CurrentStep)));
    setCustomer(a.CustomerId ? { Id: a.CustomerId, Name: a.ApplicantName || a.CustomerName } : null);
    setF({
      CompanyId: a.CompanyId != null ? String(a.CompanyId) : "", ProjectId: a.ProjectId != null ? String(a.ProjectId) : "",
      BlockId: "", FloorNo: "", UnitId: a.PreferredUnitId != null ? String(a.PreferredUnitId) : "", PlotIds: ids(a.PreferredPlotIdsCsv),
      PaymentPlanId: a.PaymentPlanId != null ? String(a.PaymentPlanId) : "", RatePerSqFt: a.RatePerSqFt != null ? String(a.RatePerSqFt) : "",
      DateOfApply: a.DateOfApply ? String(a.DateOfApply).slice(0, 10) : f.DateOfApply,
      ViaBroker: a.BrokerId != null, BrokerId: a.BrokerId != null ? String(a.BrokerId) : "",
      BrokerageRatePercent: a.BrokerageRatePercent != null ? String(a.BrokerageRatePercent) : "", BrokeragePaymentPlan: a.BrokeragePaymentPlan || "OneTime",
    });
  }, [existing.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // A unit picked on the matrix takes its rate, as picking it here does.
  useEffect(() => {
    if (pick?.UnitId == null || f.RatePerSqFt || f.UnitId !== String(pick.UnitId)) return;
    const u = (unitsQ.data ?? []).find((x) => String(x.Id) === f.UnitId);
    if (u?.RatePerSqFt != null) set({ RatePerSqFt: String(u.RatePerSqFt) });
  }, [unitsQ.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const projects = (projectsQ.data ?? []).filter((p) => !f.CompanyId || String(p.CompanyId) === f.CompanyId);
  const freeUnits = (unitsQ.data ?? []).filter((u) => String(u.ProjectId) === f.ProjectId && !u.IsLand && (!(u.LockBookingNo || u.LockHoldId) || String(u.Id) === f.UnitId));
  const freePlots = (plotsQ.data ?? []).filter((p) => String(p.ProjectId) === f.ProjectId && (!(p.LockBookingNo || p.LockApplicationNo || p.LockHoldId) || f.PlotIds.includes(String(p.Id))));
  const blocks = Array.from(new Map([...freePlots, ...freeUnits].filter((u) => u.BlockId).map((u) => [String(u.BlockId), String(u.BlockName ?? u.BlockId)])), ([key, label]) => ({ key, label }));
  const unitsInBlock = freeUnits.filter((u) => !f.BlockId || String(u.BlockId) === f.BlockId);
  const floors = Array.from(new Set(unitsInBlock.filter((u) => u.FloorNo != null).map((u) => String(u.FloorNo)))).sort((a, b) => Number(a) - Number(b));
  const unitChoices = unitsInBlock.filter((u) => !f.FloorNo || String(u.FloorNo) === f.FloorNo);
  const plotChoices = freePlots.filter((p) => !f.BlockId || String(p.BlockId) === f.BlockId);
  const unit = (unitsQ.data ?? []).find((u) => String(u.Id) === f.UnitId) ?? null;
  const plots = (plotsQ.data ?? []).filter((p) => f.PlotIds.includes(String(p.Id)));
  const picked = unit || plots[0] || null;
  const isPlotSale = f.PlotIds.length > 0;

  const activePlans = (plansQ.data ?? []).filter((p) => p.IsActive);
  const tagged = (csv: unknown) => activePlans.filter((p) => ids(csv).includes(String(p.Id)));
  const blockRow = (blocksQ.data ?? []).find((b) => picked && String(b.Id) === String(picked.BlockId));
  const plans = [tagged(picked?.PaymentPlanIds), tagged(blockRow?.PaymentPlanIds),
    picked ? activePlans.filter((p) => ids(p.ProjectIds).includes(String(picked.ProjectId))) : [], activePlans].find((l) => l.length) ?? [];

  // Steps 2 and 3 of the web wizard (ParkingSelectionStep / ExtraWorkSelectionStep), once the application exists:
  // what is picked (crmParking.js GET /application/:id, crmExtraCharges.js GET /application/:id), what is free.
  const parkingQ = useQuery({ queryKey: ["crm-app-parking", editId], enabled: allowed && !!editId, queryFn: () => crmGet<Row[]>(`/api/crm/parking/application/${editId}`) });
  const extrasQ = useQuery({ queryKey: ["crm-app-extra-charges", editId], enabled: allowed && !!editId, queryFn: () => crmGet<Row[]>(`/api/crm/extra-charges/application/${editId}`) });
  const freeParkingQ = useQuery({ queryKey: ["crm-parking-available", f.ProjectId, f.BlockId || String(picked?.BlockId ?? ""), editId], enabled: allowed && !!editId && !!f.ProjectId && !isPlotSale,
    queryFn: () => crmGet<{ rates: Row[]; unratedTypesWithInventory: string[] }>(`/api/crm/parking/available?projectId=${f.ProjectId}&applicationId=${editId}${picked?.BlockId ? `&blockId=${picked.BlockId}` : ""}`) });
  // Steps 4-6 (BankDetailsStep / CoApplicantStep / AttachmentsStep): bank & KYC (filled from the customer until changed),
  // co-applicants (removing one only marks it inactive), papers by type (the server's own list of types).
  const bankQ = useQuery({ queryKey: ["crm-app-bank", editId], enabled: allowed && !!editId, queryFn: () => crmGet<Row>(`/api/crm/customer-bank-details/application/${editId}`) });
  const coQ = useQuery({ queryKey: ["crm-app-co-applicants", editId], enabled: allowed && !!editId, queryFn: () => crmGet<Row[]>(`/api/crm/co-applicants/application/${editId}`) });
  const appDocsQ = useQuery({ queryKey: ["crm-app-documents", editId], enabled: allowed && !!editId,
    queryFn: () => crmGet<{ documents: Row[]; standardTypes: string[] }>(`/api/crm/booking-documents/application/${editId}`) });
  const parking = parkingQ.data ?? [];
  const extras = extrasQ.data ?? [];

  const quoteQ = useQuery({
    queryKey: ["crm-price-quote", f.UnitId, f.PlotIds.join(","), f.RatePerSqFt, f.PaymentPlanId, customer?.Id, parking.length, extras.length],
    enabled: allowed && (!!f.UnitId || f.PlotIds.length > 0), placeholderData: (prev) => prev, staleTime: 30_000,
    queryFn: () => crmSend<Row>("/api/crm/applications/price-quote", "POST", {
      unitIds: f.UnitId ? [f.UnitId] : [], plotIds: f.PlotIds, ratePerSqFt: f.RatePerSqFt || null,
      paymentPlanId: isPlotSale ? null : f.PaymentPlanId || null, customerId: customer?.Id ?? null,
      parkingBases: parking.map((pk) => (Number(pk.RateSnapshot) || 0) * (Number(pk.Quantity) || 1)),
      extraAmounts: extras.map((c) => Number(c.Amount) || 0),
    }),
  });
  // The last price worked out stays on screen if a newer request fails (a busy server), with the reason under it.
  const lastQuote = useRef<Row | undefined>(undefined);
  if (quoteQ.data) lastQuote.current = quoteQ.data;
  const quote = quoteQ.data ?? lastQuote.current;

  // Add parking: type, then slot, the master's price unless changed (an unrated type must be priced) — POST /parking/standalone.
  const [parkType, setParkType] = useState<Row | null>(null);
  const [slotId, setSlotId] = useState("");
  const [parkRate, setParkRate] = useState("");
  const [extraDesc, setExtraDesc] = useState("");
  const [extraAmt, setExtraAmt] = useState("");
  const [stepBusy, setStepBusy] = useState(false);
  const stepRun = async (fn: () => Promise<any>, done: (r: any) => string) => {
    setStepBusy(true);
    try {
      const r = await fn(); toast.success(done(r));
      ["crm-app-parking", "crm-app-extra-charges", "crm-parking-available"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    } catch (e) { toast.error((e as Error).message); }
    finally { setStepBusy(false); }
  };
  const addParking = () => {
    if (!parkType) return;
    if (!parkType.HasSlots) return toast.error("No slots available for this parking type");
    if (!slotId) return toast.error("Select a slot");
    if (parkType.NeedsRate && !(Number(parkRate) > 0)) return toast.error("Enter a price for this parking type");
    const body: Row = { ApplicationId: editId, ParkingSlotId: Number(slotId), Quantity: 1 };
    if (parkType.NeedsRate) { body.ParkingType = parkType.ParkingType; body.RateOverride = parkRate; }
    else { body.ParkingMasterId = parkType.ParkingMasterId; if (parkRate && Number(parkRate) !== Number(parkType.Charge)) body.RateOverride = parkRate; }
    const base = Number(parkRate || parkType.Charge) || 0;
    stepRun(() => crmSend("/api/crm/parking/standalone", "POST", body), () => `${parkType.ParkingType} added — ${money(base)} before GST`)
      .then(() => { setParkType(null); setSlotId(""); setParkRate(""); });
  };
  const [bank, setBank] = useState<Row>({});
  const bankLoaded = useRef(false);
  useEffect(() => { if (bankQ.data && !bankLoaded.current) { bankLoaded.current = true; setBank(bankQ.data); } }, [bankQ.data]);
  const [co, setCo] = useState<Row | null>(null); // the co-applicant being added (Id "new") or edited
  const saveCo = () => {
    if (!co) return;
    if (!String(co.Name ?? "").trim()) return toast.error("Name is required");
    const isNew = co.Id === "new";
    const { Id, ...body } = co;
    stepRun(() => crmSend(isNew ? `/api/crm/co-applicants/application/${editId}` : `/api/crm/co-applicants/${Id}`, isNew ? "POST" : "PUT", body),
      () => (isNew ? "Co-applicant added" : "Co-applicant updated")).then(() => { setCo(null); qc.invalidateQueries({ queryKey: ["crm-app-co-applicants"] }); });
  };
  const [docType, setDocType] = useState<string | null>(null);
  const uploadAppDocs = async () => {
    if (!docType) return toast.error("Select a document type before uploading");
    const pick = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (pick.canceled || !pick.assets?.length) return;
    const fd = new FormData();
    fd.append("DocumentType", docType);
    for (const a of pick.assets) {
      if (a.file) fd.append("files", a.file);
      else fd.append("files", { uri: a.uri, name: a.name, type: a.mimeType || "application/octet-stream" } as any);
    }
    stepRun(async () => {
      const res = await fetchWithAuth(`/api/crm/booking-documents/application/${editId}/upload`, { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || "Upload failed");
      return d;
    }, (d) => `${d?.count ?? ""} file(s) uploaded`).then(() => { setDocType(null); qc.invalidateQueries({ queryKey: ["crm-app-documents"] }); });
  };
  // Step 7, Details (the web's handleFinalSave): booking amount, payment mode and its reference, notes; then Submit
  // (PUT /:id/submit), which also creates the booking when it can. Create booking is the web's retry for a submitted
  // application whose booking did not open; Cancel releases its holds (PUT /:id/cancel).
  const [det, setDet] = useState({ TokenValue: "", PaymentMode: "", ChequeNo: "", ChequeDate: "", TransactionRef: "", Notes: "" });
  const detLoaded = useRef(false);
  useEffect(() => {
    const a = existing.data;
    if (!a || !bankQ.data || detLoaded.current) return;
    detLoaded.current = true;
    const b = bankQ.data;
    setDet({ TokenValue: a.TokenValue != null ? String(a.TokenValue) : "", PaymentMode: a.PaymentMode || "", Notes: a.Notes || "",
      ChequeNo: b.ChequeNo || "", ChequeDate: b.ChequeDate ? String(b.ChequeDate).slice(0, 10) : "", TransactionRef: b.TransactionRef || "" });
  }, [existing.data, bankQ.data]);
  const status = existing.data?.Status as string | undefined;
  const [cancelOpen, setCancelOpen] = useState(false);
  const afterApp = () => ["crm", "crm-application", "unit-master", "plot-master", "crm-dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const submitApplication = async () => {
    setStepBusy(true);
    try {
      await crmSend(`/api/crm/applications/${editId}`, "PUT", {
        Notes: det.Notes || null, TokenType: isPlotSale ? "Amount" : existing.data?.TokenType || "Amount", TokenValue: det.TokenValue || null,
        ...(isPlotSale ? { BookingAmount: det.TokenValue || 0 } : {}), PaymentMode: det.PaymentMode || null, DepositBankId: null,
      });
      if (det.PaymentMode && det.PaymentMode !== "Cash" && (det.ChequeNo || det.ChequeDate || det.TransactionRef)) {
        await crmSend(`/api/crm/customer-bank-details/application/${editId}`, "PUT", { ChequeNo: det.ChequeNo || null, ChequeDate: det.ChequeDate || null, TransactionRef: det.TransactionRef || null }).catch(() => null);
      }
      const d = await crmSend<Row>(`/api/crm/applications/${editId}/submit`, "PUT");
      if (d?.unitChange) toast.success(d.unitChange.message);
      // The server answers with bookingNo (crmApplications.js PUT /:id/submit); booking.BookingNo is the older shape.
      else if (d?.bookingNo || d?.booking?.BookingNo) toast.success(d?.booking?.alreadyExists ? "Application changes saved" : `Booking ${d.bookingNo ?? d.booking.BookingNo} created — payment milestones auto-generated`);
      else if (d?.bookingError) toast.error(`Application submitted, but the booking couldn't be created automatically: ${d.bookingError}`);
      else toast.success("Application submitted");
      afterApp(); nav.goBack();
    } catch (e) { toast.error((e as Error).message); }
    finally { setStepBusy(false); }
  };
  const createBooking = () => {
    const a = existing.data;
    if (!a) return;
    if (!a.PreferredUnitId) return toast.error("This application has no unit selected — edit it and pick a unit before a booking can be created");
    stepRun(() => crmSend<Row>("/api/crm/bookings", "POST", {
      ApplicationId: a.Id, UnitId: a.PreferredUnitId, RatePerSqFt: a.RatePerSqFt, PaymentPlanId: a.PaymentPlanId, BookingDate: a.DateOfApply,
      TokenType: a.TokenType, TokenValue: a.TokenValue, BookingAmount: a.BookingAmount, PaymentMode: a.PaymentMode, DepositBankId: a.DepositBankId,
      AssignedTo: a.AssignedTo, Notes: a.Notes, BrokerId: a.BrokerId, BrokerageRatePercent: a.BrokerageRatePercent, BrokeragePaymentPlan: a.BrokeragePaymentPlan,
    }), (d) => `Booking ${d?.BookingNo ?? ""} created — payment milestones auto-generated`).then(() => { afterApp(); nav.goBack(); });
  };
  const addExtra = () => {
    if (!extraDesc.trim()) return toast.error("Description is required");
    const amt = parseFloat(extraAmt);
    if (!Number.isFinite(amt) || amt <= 0) return toast.error("Enter a valid amount");
    stepRun(() => crmSend<Row>(`/api/crm/extra-charges/application/${editId}`, "POST", { Description: extraDesc.trim(), Amount: amt }), (r) => `${extraDesc.trim()} added — ${money(r?.TotalAmount)}`)
      .then(() => { setExtraDesc(""); setExtraAmt(""); });
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<number | false> => {
    setError(null);
    const stop = (m: string): false => { setError(m); toast.error(m); return false; };
    if (!customer) return stop("Select the customer.");
    if (!f.CompanyId || !f.ProjectId) return stop("Select a company and project");
    if (!f.UnitId && !f.PlotIds.length) return stop("Select a unit or plots.");
    // Once a unit is on the application a plan must be picked (the web's rule; a plot sale has none).
    if (f.UnitId && !f.PaymentPlanId) return stop("Select the payment plan.");
    let newId: number | undefined;
    setBusy(true);
    try {
      const body = {
        CompanyId: f.CompanyId || null, ProjectId: f.ProjectId || null,
        PreferredUnitIds: f.UnitId ? [f.UnitId] : [], PreferredPlotIds: f.PlotIds,
        PaymentPlanId: isPlotSale ? null : f.PaymentPlanId || null, RatePerSqFt: f.RatePerSqFt || null, DateOfApply: f.DateOfApply || null,
        BrokerId: f.ViaBroker && f.BrokerId ? Number(f.BrokerId) : null,
        BrokerageRatePercent: f.ViaBroker && f.BrokerageRatePercent !== "" ? f.BrokerageRatePercent : null,
        BrokeragePaymentPlan: f.ViaBroker ? f.BrokeragePaymentPlan : "OneTime",
      };
      if (editId) {
        const r = await crmSend<Row>(`/api/crm/applications/${editId}`, "PUT", body);
        toast.success("Project/Unit selection updated");
        if (r?.parkingWarning) toast.error(r.parkingWarning);
        newId = editId;
      } else {
        const r = await crmSend<Row>("/api/crm/applications", "POST", { CustomerId: customer.Id, ...body });
        toast.success(`Application ${r?.ApplicationNo ?? ""} created`);
        if (r?.id) { newId = Number(r.id); setEditId(newId); nav.setParams({ applicationId: newId }); }
      }
      ["crm", "crm-application", "unit-master", "plot-master", "crm-dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      return newId || false;
    } catch (e) { const m = (e as Error).message; setError(m); toast.error(m); return false; }
    finally { setBusy(false); }
  };

  if (!allowed) return <View style={{ flex: 1, backgroundColor: colors.background, padding: 16 }}><Empty text={`You don't have the right to ${editId ? "edit" : "file"} applications.`} /></View>;
  if (editId && existing.isLoading) return <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: "center" }}><ActivityIndicator color={colors.mutedForeground} /></View>;

  const options: Record<NonNullable<typeof picker>, Pick[]> = {
    customer: (custQ.data?.rows ?? []).map((c) => ({ key: String(c.Id), label: c.CustomerName, sublabel: joinDot(c.CustomerNo, c.Mobile) })),
    company: (companiesQ.data?.companies ?? []).map((c) => ({ key: String(c.id), label: c.name })),
    project: projects.map((p) => ({ key: String(p.Id), label: p.Name ?? p.ProjectName })),
    block: blocks,
    floor: floors.map((x) => ({ key: x, label: `Floor ${x}` })),
    unit: unitChoices.map((u) => ({ key: String(u.Id), label: joinDot(u.BlockName, u.UnitName), sublabel: joinDot(u.UnitType, u.AreaSqFt && `${u.AreaSqFt} sq ft`) })),
    plot: plotChoices.map((p) => ({ key: String(p.Id), label: joinDot(p.BlockName, p.PlotNo), sublabel: joinDot(p.AreaSqFt && `${p.AreaSqFt} sq ft`, f.PlotIds.includes(String(p.Id)) && "Selected") })),
    plan: plans.map((p) => ({ key: String(p.Id), label: p.PlanName ?? p.Name })),
    parkType: (freeParkingQ.data?.rates ?? []).map((r) => ({ key: r.ParkingType, label: r.ParkingType,
      sublabel: joinDot(r.NeedsRate ? "No master price" : money(r.Charge), r.HasSlots ? `${(r.AvailableSlots ?? []).length} available` : "No slots") })),
    slot: (parkType?.AvailableSlots ?? []).map((s: Row) => ({ key: String(s.Id), label: `Slot ${s.SlotNo}` })),
    coCustomer: (custQ.data?.rows ?? []).filter((c) => c.Id !== customer?.Id).map((c) => ({ key: String(c.Id), label: c.CustomerName, sublabel: joinDot(c.CustomerNo, c.Mobile) })),
    broker: (brokersQ.data ?? []).map((b) => ({ key: String(b.LHeadId), label: b.LHeadName, sublabel: b.LHeadPhone ?? undefined })),
  };
  const choose = (k: string | null) => {
    const kind = picker;
    if (kind !== "plot") setPicker(null);
    if (kind === "customer") { const c = (custQ.data?.rows ?? []).find((x) => String(x.Id) === k); setCustomer(c ? { Id: c.Id, Name: c.CustomerName } : null); }
    if (kind === "company") set({ CompanyId: k ?? "", ProjectId: "", BlockId: "", FloorNo: "", UnitId: "", PlotIds: [] });
    if (kind === "project") set({ ProjectId: k ?? "", BlockId: "", FloorNo: "", UnitId: "", PlotIds: [] });
    if (kind === "block") set({ BlockId: k ?? "", FloorNo: "", UnitId: "" });
    if (kind === "floor") set({ FloorNo: k ?? "", UnitId: "" });
    if (kind === "unit") { const u = (unitsQ.data ?? []).find((x) => String(x.Id) === k); set({ UnitId: k ?? "", PlotIds: [], PaymentPlanId: "", RatePerSqFt: f.RatePerSqFt || (u?.RatePerSqFt != null ? String(u.RatePerSqFt) : "") }); }
    if (kind === "plot" && k) set({ UnitId: "", PaymentPlanId: "", PlotIds: f.PlotIds.includes(k) ? f.PlotIds.filter((x) => x !== k) : [...f.PlotIds, k] });
    if (kind === "plan") set({ PaymentPlanId: k ?? "" });
    if (kind === "parkType") { const r = (freeParkingQ.data?.rates ?? []).find((x) => x.ParkingType === k) ?? null; setParkType(r); setSlotId(""); setParkRate(r?.Charge != null ? String(r.Charge) : ""); }
    if (kind === "slot") setSlotId(k ?? "");
    if (kind === "broker") set({ BrokerId: k ?? "" });
    if (kind === "coCustomer") {
      const c = (custQ.data?.rows ?? []).find((x) => String(x.Id) === k);
      const t = (v: unknown) => (v == null ? "" : String(v));
      setCo((x) => (!c ? { ...x, CustomerId: null } : { ...x, CustomerId: c.Id, Name: t(c.CustomerName), Mobile: t(c.Mobile), Email: t(c.Email), PanNo: t(c.PanNo), AadhaarNo: t(c.AadhaarNo),
        Occupation: t(c.Occupation) || x?.Occupation, DateOfBirth: c.DateOfBirth ? String(c.DateOfBirth).slice(0, 10) : x?.DateOfBirth,
        Address: t(c.CurrentAddress || c.PermanentAddress) || x?.Address, City: t(c.CurrentCity || c.PermanentCity) || x?.City,
        State: t(c.CurrentState || c.PermanentState) || x?.State, Pincode: t(c.CurrentPincode || c.PermanentPincode) || x?.Pincode }));
    }
  };
  const label = (kind: NonNullable<typeof picker>, key: string) => options[kind].find((o) => o.key === key)?.label ?? "";

  // The web wizard's steps, in its order and with its names; a plot sale has no parking.
  const STEPS = [isPlotSale ? "Project/Plots" : "Project/Unit", "Parking", "Extra Charges", "Bank/KYC", "Co-Applicant", "Attachments", "Details"];
  const goStep = (n: number, id = editId) => {
    const to = isPlotSale && n === 2 ? (step > 2 ? 1 : 3) : n;
    setStep(to);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    // How far the application got, so Resume (here and on the web) opens at that step.
    if (id && to > Number(existing.data?.CurrentStep || 1)) crmSend(`/api/crm/applications/${id}`, "PUT", { CurrentStep: to }).catch(() => null);
  };
  const next = async () => {
    if (step === 1) { const id = await submit(); if (id) goStep(2, id); return; }
    if (step === 4) {
      setStepBusy(true);
      try { await crmSend(`/api/crm/customer-bank-details/application/${editId}`, "PUT", Object.fromEntries(BANK_FIELDS.map(([k]) => [k, bank[k] == null ? "" : String(bank[k])]))); }
      catch (e) { toast.error((e as Error).message); return; }
      finally { setStepBusy(false); }
    }
    if (step === 5 && co) return toast.error("Save or cancel the co-applicant first.");
    if (step < 7) return goStep(step + 1);
    if (status === "Draft") return submitApplication();
    if (status && status !== "Cancelled" && !existing.data?.BookingId) return createBooking();
    nav.goBack();
  };
  const nextLabel = step < 7 ? "Next"
    : status === "Draft" ? (existing.data?.UnitChangeNo ? "Send Unit Change for Approval" : "Submit Application")
    : status && status !== "Cancelled" && !existing.data?.BookingId ? "Create Booking" : existing.data?.BookingId ? "Submit Edits" : "Done";
  const reached = Math.max(step, Number(existing.data?.CurrentStep) || 1);
  const shownSteps = STEPS.map((lbl, i) => ({ lbl, n: i + 1 })).filter((x) => !(isPlotSale && x.n === 2));
  const pos = shownSteps.findIndex((x) => x.n === step);
  const head = (
    <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.background }}>
      {editId && existing.data ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 12 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 15, fontFamily: fonts.heading.bold, color: colors.foreground }}>{customer?.Name ?? existing.data.ApplicantName}</Text>
            <Text numberOfLines={1} style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 2 }}>
              {joinDot(existing.data.ApplicationNo, unit ? joinDot(unit.BlockName, unit.UnitName) : plots.map((x) => x.PlotNo || x.PlotName).join(", "))}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            {Number(quote?.grandTotal) > 0 ? <Text style={{ fontSize: 15, fontFamily: fonts.heading.bold, color: colors.foreground }}>{money(quote?.grandTotal)}</Text> : null}
            {status ? <Text style={{ fontSize: 11.5, fontFamily: fonts.heading.semibold, color: CRM }}>{status}</Text> : null}
          </View>
        </View>
      ) : null}
      <ScrollView ref={stripRef as never} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 16, paddingTop: 10 }}>
        {shownSteps.map(({ lbl, n }, i) => {
          const on = n === step;
          const done = !!editId && n < reached && !on;
          const reachable = n === 1 || !!editId;
          return (
            <Pressable key={lbl} disabled={!reachable} onPress={() => goStep(n)}
              style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1,
                borderColor: on || done ? CRM : colors.border, backgroundColor: on ? CRM : done ? `${CRM}1a` : "transparent", opacity: reachable ? 1 : 0.45 }}>
              <View style={{ width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: on ? "#ffffff33" : done ? CRM : colors.border }}>
                {done ? <Check size={11} color="#fff" /> : <Text style={{ fontSize: 10.5, fontFamily: fonts.heading.bold, color: on ? "#fff" : colors.mutedForeground }}>{i + 1}</Text>}
              </View>
              <Text style={{ fontSize: 12.5, fontFamily: fonts.heading.semibold, color: on ? "#fff" : colors.foreground }}>{lbl}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, gap: 6 }}>
        <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: "hidden" }}>
          <View style={{ width: `${((pos + 1) / shownSteps.length) * 100}%`, height: 4, backgroundColor: CRM }} />
        </View>
        <Text style={{ fontSize: 11.5, fontFamily: fonts.body.medium, color: colors.mutedForeground }}>{`Step ${pos + 1} of ${shownSteps.length} · ${STEPS[step - 1]}`}</Text>
      </View>
    </View>
  );

  return (
    <FormScaffold tone={CRM} toneInk="#fff" header={head} scrollRef={scrollRef} onSubmit={next} submitLabel={nextLabel}
      cancelLabel={step === 1 ? "Cancel" : "Back"} onCancel={() => (step === 1 ? nav.goBack() : goStep(step - 1))} submitting={busy || stepBusy}>
      {step === 1 ? (
        <>
      <FormSection title="Customer">
        <PickerRow label="Customer" required value={customer?.Name ?? ""} disabled={!!editId} onPress={() => setPicker("customer")} />
      </FormSection>
      <FormSection title="Project / Unit">
        <PickerRow label="Company" required value={label("company", f.CompanyId)} onPress={() => setPicker("company")} />
        <PickerRow label="Project" required value={label("project", f.ProjectId)} disabled={!f.CompanyId} onPress={() => setPicker("project")} />
        <PickerRow label="Block / Tower" value={label("block", f.BlockId)} placeholder="— Any —" disabled={!f.ProjectId} onPress={() => setPicker("block")} />
        {freeUnits.length ? (
          <>
            <PickerRow label="Floor" value={f.FloorNo ? `Floor ${f.FloorNo}` : ""} placeholder="— Any —" disabled={!f.ProjectId} onPress={() => setPicker("floor")} />
            <PickerRow label="Unit" value={unit ? joinDot(unit.BlockName, unit.UnitName) : ""} disabled={!f.ProjectId} onPress={() => setPicker("unit")} />
          </>
        ) : null}
        {freePlots.length ? (
          <PickerRow label="Plots" value={plots.map((p) => p.PlotNo || p.PlotName).join(", ")} disabled={!f.ProjectId} onPress={() => setPicker("plot")} />
        ) : null}
        <DateField label="Date of Apply" value={f.DateOfApply} onChange={(v: string) => set({ DateOfApply: v })} />
        <NumberField label="Rate (₹/sqft)" value={f.RatePerSqFt} onChangeText={(v) => set({ RatePerSqFt: v })} placeholder={picked?.RatePerSqFt ? String(picked.RatePerSqFt) : undefined} />
        {isPlotSale ? null : <PickerRow label="Payment Plan" required={!!picked} value={label("plan", f.PaymentPlanId)} disabled={!picked} onPress={() => setPicker("plan")} />}
      </FormSection>
      <FormSection title="Broker">
        <Chips label="Via Broker" options={["No", "Yes"] as const} value={f.ViaBroker ? "Yes" : "No"} labelOf={(v) => v}
          onChange={(v) => set(v === "Yes" ? { ViaBroker: true } : { ViaBroker: false, BrokerId: "", BrokerageRatePercent: "" })} />
        {f.ViaBroker ? (() => {
          const br = (brokersQ.data ?? []).find((b) => String(b.LHeadId) === f.BrokerId);
          const total = Number(quote?.grandTotal) || 0;
          const tier = [...(tiersQ.data ?? []).filter((t) => t.IsActive !== false)].reverse()
            .find((t) => total >= Number(t.MinDealValue) && (t.MaxDealValue == null || total < Number(t.MaxDealValue)));
          const def = tier ? Number(tier.RatePercent) : 2;
          return (
            <>
              <PickerRow label="Broker (from Broker Master)" value={br?.LHeadName ?? ""} placeholder="Select broker" onPress={() => setPicker("broker")} />
              {br ? (
                <View style={{ marginBottom: 10 }}>
                  {br.LHeadPhone ? <Kv label="Phone" value={br.LHeadPhone} /> : null}
                  {br.LHeadPan ? <Kv label="PAN" value={br.LHeadPan} /> : null}
                  {br.LHeadRera ? <Kv label="RERA No." value={br.LHeadRera} /> : null}
                  {br.LHeadPaymentTerms ? <Kv label="Payment Terms" value={br.LHeadPaymentTerms} /> : null}
                </View>
              ) : null}
              <Kv label="Default Rate (Preview)" value={`${def}%`} />
              <NumberField label="Commission Override %" value={f.BrokerageRatePercent} placeholder={String(def)} onChangeText={(v) => set({ BrokerageRatePercent: v })} />
              <Chips label="Payout Plan" options={["OneTime", "TwoPart", "AgreementOnly"] as const} value={f.BrokeragePaymentPlan as "OneTime" | "TwoPart" | "AgreementOnly"}
                onChange={(v) => set({ BrokeragePaymentPlan: v })} labelOf={(v) => (v === "OneTime" ? "One-time" : v === "TwoPart" ? "Two-part" : "Agreement-only")} />
              <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginBottom: 8 }}>
                {f.BrokeragePaymentPlan === "TwoPart" ? "Half the commission is released as soon as the Booking Amount is paid; the other half is held until the Agreement is Executed."
                  : f.BrokeragePaymentPlan === "AgreementOnly" ? "The full commission is held until the Agreement is Executed — nothing is released at booking."
                  : "The full commission is released as soon as the Booking Amount is paid — no further tranches."}
              </Text>
            </>
          );
        })() : null}
      </FormSection>
        </>
      ) : null}
      {step === 1 || step === 7 ? (
        <>
      {quote ? (
        <Section title="Price">
          <Kv label="Area" value={`${quote.areaSqFt} sq ft`} />
          <Kv label={quote.isLandSale ? "Land value" : "Unit value"} value={money(quote.unitValue)} />
          {Number(quote.totalGstAmount) > 0 ? <Kv label={`GST (${quote.gstRate}%)`} value={money(quote.totalGstAmount)} /> : null}
          {Number(quote.parkingTotal) > 0 ? <Kv label="Parking" value={money(quote.parkingTotal)} /> : null}
          {Number(quote.extraChargesTotal) > 0 ? <Kv label="Extra charges" value={money(quote.extraChargesTotal)} /> : null}
          <Kv label="Total Value" value={money(quote.grandTotal)} strong />
          {(quote.schedule ?? []).map((m: Row) => <Kv key={m.no} label={`${m.no}. ${m.name}${m.pct != null ? ` (${m.pct}%)` : ""}`} value={money(m.amount)} />)}
        </Section>
      ) : null}
      {quoteQ.error ? <Text style={{ color: colors.destructive, fontSize: 12.5, fontFamily: fonts.body.medium, marginBottom: 12 }}>{`The price could not be updated: ${(quoteQ.error as Error).message}`}</Text> : null}
        </>
      ) : null}
      {step === 2 && editId ? (
        <Section title="Parking">
          {parking.map((a, i) => (
            <View key={`${a.Kind}-${a.Id}`} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ flex: 1, fontSize: 13.5, fontFamily: fonts.body.medium, color: colors.foreground }}>
                {joinDot(a.CurrentParkingType, a.SlotNo ? `Slot ${a.SlotNo}` : `× ${a.Quantity}`, money(quote?.parking?.[i]?.total ?? (Number(a.RateSnapshot) || 0) * (Number(a.Quantity) || 1)), a.Kind === "Hold" && "On hold")}
              </Text>
              <ActionKey label="Remove" outline tone={colors.destructive}
                onPress={() => stepRun(() => crmSend(a.Kind === "Hold" ? `/api/crm/parking/hold/${a.Id}` : `/api/crm/parking/${a.Id}`, "DELETE"), () => `${a.CurrentParkingType} removed`)} />
            </View>
          ))}
          {(freeParkingQ.data?.unratedTypesWithInventory ?? []).length ? (
            <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 6 }}>
              {`Slots without a price in Parking Rate Master: ${(freeParkingQ.data?.unratedTypesWithInventory ?? []).join(", ")}`}
            </Text>
          ) : null}
          {parking.length === 0 && freeParkingQ.data && (freeParkingQ.data.rates ?? []).length === 0 ? (
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>No parking is free for this unit's block. Go on to the next step.</Text>
          ) : null}
          {(freeParkingQ.data?.rates ?? []).length ? <View style={{ marginTop: 10, gap: 4 }}>
            <PickerRow label="Parking type" value={parkType?.ParkingType ?? ""} onPress={() => setPicker("parkType")} />
            {parkType?.HasSlots ? <PickerRow label="Slot" value={slotId ? `Slot ${(parkType.AvailableSlots ?? []).find((s: Row) => String(s.Id) === slotId)?.SlotNo ?? ""}` : ""} onPress={() => setPicker("slot")} /> : null}
            {parkType ? <NumberField label={parkType.NeedsRate ? "Price (required)" : "Price before GST"} value={parkRate} onChangeText={setParkRate} /> : null}
            {parkType ? <View style={{ flexDirection: "row" }}><ActionKey label={stepBusy ? "Adding…" : "Add parking"} onPress={addParking} /></View> : null}
          </View> : null}
        </Section>
      ) : null}
      {step === 3 && editId ? (
        <Section title="Extra Charges">
          {extras.map((c) => (
            <View key={c.Id} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ flex: 1, fontSize: 13.5, fontFamily: fonts.body.medium, color: colors.foreground }}>{joinDot(c.Description, money(c.TotalAmount))}</Text>
              <ActionKey label="Remove" outline tone={colors.destructive}
                onPress={() => stepRun(() => crmSend(`/api/crm/extra-charges/${c.Id}`, "DELETE"), () => `${c.Description} removed`)} />
            </View>
          ))}
          <View style={{ marginTop: 10, gap: 4 }}>
            <TextField label="Description" value={extraDesc} onChangeText={setExtraDesc} />
            <NumberField label="Amount before GST" value={extraAmt} onChangeText={setExtraAmt} />
            <View style={{ flexDirection: "row" }}><ActionKey label={stepBusy ? "Adding…" : "Add extra charge"} onPress={addExtra} /></View>
          </View>
        </Section>
      ) : null}
      {step === 4 && editId ? (
        <Section title="KYC / Bank Details">
          {BANK_FIELDS.map(([k, lbl]) => (
            <TextField key={k} label={lbl} value={bank[k] == null ? "" : String(bank[k])} autoCapitalize={k === "IfscCode" || k === "PanNo" ? "characters" : "sentences"}
              keyboardType={k === "AccountNo" || k === "AadhaarNo" || k === "AnnualIncome" ? "numeric" : "default"}
              onChangeText={(v) => setBank((b) => ({ ...b, [k]: k === "IfscCode" || k === "PanNo" ? v.toUpperCase() : v }))} />
          ))}
          {bankQ.data?._prefilledFrom === "customer" ? <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginBottom: 8 }}>(auto-fetched from customer)</Text> : null}
        </Section>
      ) : null}
      {step === 5 && editId ? (
        <Section title={`Co-Applicants (${(coQ.data ?? []).length})`}>
          {(coQ.data ?? []).map((c) => (
            <View key={c.Id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 6 }}>
              <Text style={{ fontSize: 13.5, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{joinDot(c.Name, c.Relation, c.Mobile)}</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <ActionKey label="Edit" outline onPress={() => setCo({ ...Object.fromEntries(CO_FIELDS.map(([k]) => [k, c[k] == null ? "" : k === "DateOfBirth" ? String(c[k]).slice(0, 10) : String(c[k])])), CustomerId: c.CustomerId ?? null, Id: c.Id })} />
                <ActionKey label="Remove" outline tone={colors.destructive}
                  onPress={() => stepRun(() => crmSend(`/api/crm/co-applicants/${c.Id}`, "DELETE"), (rr) => rr?.message || `${c.Name} removed`).then(() => qc.invalidateQueries({ queryKey: ["crm-app-co-applicants"] }))} />
              </View>
            </View>
          ))}
          {co ? (
            <View style={{ marginTop: 10, gap: 4 }}>
              {/* The web's two helpers: an existing customer filled in and linked (never duplicated; the server refuses the
                  main applicant or someone already on it), and the applicant's address copied in. */}
              <PickerRow label="Existing customer (optional)" value={co.CustomerId ? String(co.Name ?? "") : ""} placeholder="— Type the details below —" onPress={() => setPicker("coCustomer")} />
              {existing.data?.CustomerAddress ? (
                <Chips label="Address" options={["Own", "Same"] as const} value={co.Address === existing.data.CustomerAddress ? "Same" : "Own"}
                  labelOf={(v) => (v === "Same" ? "Same as applicant's address" : "Own address")}
                  onChange={(v) => setCo((x) => (v === "Same" ? { ...x, Address: existing.data?.CustomerAddress ?? "", City: existing.data?.CustomerCity ?? "", State: existing.data?.CustomerState ?? "", Pincode: existing.data?.CustomerPincode ?? "" }
                    : { ...x, Address: "", City: "", State: "", Pincode: "" }))} />
              ) : null}
              {CO_FIELDS.map(([k, lbl]) => k === "DateOfBirth"
                ? <DateField key={k} label={lbl} value={String(co.DateOfBirth ?? "")} onChange={(v: string) => setCo((x) => ({ ...x, DateOfBirth: v }))} />
                : <TextField key={k} label={lbl} required={k === "Name"} value={String(co[k] ?? "")} multiline={k === "Address" || k === "Notes"}
                    autoCapitalize={k === "PanNo" ? "characters" : k === "Email" ? "none" : "sentences"}
                    keyboardType={k === "Mobile" || k === "AadhaarNo" || k === "Pincode" || k === "AnnualIncome" ? "numeric" : k === "Email" ? "email-address" : "default"}
                    onChangeText={(v) => setCo((x) => ({ ...x, [k]: k === "PanNo" ? v.toUpperCase() : v }))} />)}
              <View style={{ flexDirection: "row", gap: 8 }}>
                <ActionKey label="Cancel" outline tone={colors.mutedForeground} onPress={() => setCo(null)} />
                <ActionKey label={stepBusy ? "Saving…" : "Save co-applicant"} onPress={saveCo} />
              </View>
            </View>
          ) : (
            <View style={{ flexDirection: "row", marginTop: 10 }}>
              <ActionKey label="Add co-applicant" outline onPress={() => setCo({ ...Object.fromEntries(CO_FIELDS.map(([k]) => [k, ""])), Id: "new" })} />
            </View>
          )}
        </Section>
      ) : null}
      {step === 6 && editId ? (
        <Section title="Attachments">
          {(appDocsQ.data?.documents ?? []).map((d) => (
            <Text key={d.Id} style={{ fontSize: 13, fontFamily: fonts.body.medium, color: colors.foreground, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              {joinDot(d.DocumentType, d.FileName)}
            </Text>
          ))}
          <Chips label="Document type" options={appDocsQ.data?.standardTypes ?? []} value={docType} onChange={setDocType} labelOf={words} />
          <View style={{ flexDirection: "row" }}><ActionKey label={stepBusy ? "Uploading…" : "Upload files"} outline onPress={uploadAppDocs} /></View>
        </Section>
      ) : null}
      {step === 7 && editId ? (
        <Section title="Payment Details">
          <Kv label="Token Type" value="Amount" />
          <NumberField label="Token (Booking) Amount (₹)" value={det.TokenValue} onChangeText={(v) => setDet((d) => ({ ...d, TokenValue: v }))}
            placeholder={(() => { const pl = plans.find((x) => String(x.Id) === f.PaymentPlanId); return pl?.BookingAmount ? String(pl.BookingAmount) : undefined; })()} />
          <Chips label="Payment Mode" options={PAY_MODES} value={(det.PaymentMode || null) as PayMode | null}
            onChange={(m) => setDet((d) => ({ ...d, PaymentMode: m, ChequeNo: "", ChequeDate: "", TransactionRef: "" }))} labelOf={(m) => m} />
          {det.PaymentMode === "Cheque" ? (
            <>
              <TextField label="Cheque Number" value={det.ChequeNo} onChangeText={(v) => setDet((d) => ({ ...d, ChequeNo: v }))} />
              <DateField label="Cheque Date" value={det.ChequeDate} onChange={(v: string) => setDet((d) => ({ ...d, ChequeDate: v }))} />
            </>
          ) : det.PaymentMode && det.PaymentMode !== "Cash" ? (
            <TextField label={det.PaymentMode === "Home Loan" ? "Loan Disbursement Ref" : det.PaymentMode === "Other" ? "Reference / Details" : "Transaction Ref / UTR"}
              value={det.TransactionRef} onChangeText={(v) => setDet((d) => ({ ...d, TransactionRef: v }))} />
          ) : null}
          <RemarksField label="Notes / Remarks" value={det.Notes} onChangeText={(v) => setDet((d) => ({ ...d, Notes: v }))} />
          {status && !existing.data?.BookingId && status !== "Cancelled" ? (
            <View style={{ flexDirection: "row", marginTop: 8 }}><ActionKey outline tone={colors.destructive} label="Cancel application" onPress={() => setCancelOpen(true)} /></View>
          ) : null}
        </Section>
      ) : null}
      <NotePrompt open={cancelOpen} danger title={`Cancel ${existing.data?.ApplicationNo ?? "application"}?`}
        hint="Any unit or parking hold is released. This cannot be undone." placeholder="Remarks" submitLabel="Cancel application" busy={stepBusy}
        onSubmit={(text) => stepRun(() => crmSend(`/api/crm/applications/${editId}/cancel`, "PUT", { Remarks: text || null }), () => "Application cancelled — any unit/parking hold has been released")
          .then(() => { setCancelOpen(false); afterApp(); nav.goBack(); })}
        onClose={() => setCancelOpen(false)} />
      {error ? <Text style={{ color: colors.destructive, fontSize: 12.5, fontFamily: fonts.body.medium, marginBottom: 12 }}>{error}</Text> : null}
      <OptionPickerModal visible={!!picker} title={picker === "plot" ? "Plots (tap to add or remove)" : picker ? ({ customer: "Customer", company: "Company", project: "Project", block: "Block / Tower", floor: "Floor", unit: "Unit", plan: "Payment Plan", parkType: "Parking type", slot: "Slot", broker: "Broker", coCustomer: "Existing customer" } as Record<string, string>)[picker] : ""}
        searchable clearable={picker === "block" || picker === "floor" || picker === "coCustomer"}
        loading={picker === "customer" ? custQ.isFetching : picker === "unit" ? unitsQ.isLoading : false}
        query={picker === "customer" || picker === "coCustomer" ? custQuery : undefined} onQueryChange={picker === "customer" || picker === "coCustomer" ? setCustQuery : undefined}
        options={picker ? options[picker] : []}
        selectedKey={picker === "customer" ? (customer ? String(customer.Id) : null) : picker === "company" ? f.CompanyId : picker === "project" ? f.ProjectId : picker === "block" ? f.BlockId : picker === "floor" ? f.FloorNo : picker === "unit" ? f.UnitId : picker === "plan" ? f.PaymentPlanId : picker === "parkType" ? parkType?.ParkingType ?? null : picker === "slot" ? slotId : picker === "broker" ? f.BrokerId : picker === "coCustomer" ? (co?.CustomerId ? String(co.CustomerId) : null) : null}
        onSelect={choose} onClose={() => setPicker(null)} />
    </FormScaffold>
  );
}

// ── Welcome call checklist ───────────────────────────────────────────────────
// The web's welcome-call verification checklist (src/pages/crm/welcomeCalls/Checklist.tsx, crmWelcomeChecklist.js):
// each fact confirmed on the call is ticked (saved at once) with a remark, a mismatch is sent back for recheck and
// resolved, then the whole checklist is submitted and locked (it needs a logged "Welcomed" call), or reopened.
export function WelcomeChecklistScreen() {
  const qc = useQueryClient();
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmWelcomeChecklist">>();
  const { canDoAction } = useAuth();
  const canEdit = canDoAction("crm-welcome-calls", "edit");
  const q = useQuery({ queryKey: ["crm-welcome-checklist", params.bookingId], queryFn: () => crmGet<Row>(`/api/crm/welcome-checklist/${params.bookingId}`) });
  const vc = q.data;
  const locked = !!vc?.submission?.IsLocked;
  const [busy, setBusy] = useState<string | null>(null);
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [recheckFor, setRecheckFor] = useState<Row | null>(null);
  const run = async (key: string, fn: () => Promise<any>, done?: string) => {
    setBusy(key);
    try { await fn(); if (done) toast.success(done); setRecheckFor(null); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); qc.invalidateQueries({ queryKey: ["crm-welcome-checklist", params.bookingId] }); qc.invalidateQueries({ queryKey: ["crm"] }); }
  };
  const base = `/api/crm/welcome-checklist/${params.bookingId}`;
  const remarkOf = (it: Row) => remarks[it.ItemKey] ?? it.Remarks ?? "";

  if (q.isLoading) return <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: "center" }}><ActivityIndicator color={colors.mutedForeground} /></View>;
  if (!vc) return <View style={{ flex: 1, backgroundColor: colors.background, padding: 16 }}><Empty text={(q.error as Error)?.message || "No checklist for this booking."} /></View>;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 96 }}>
      <Section title={params.title || "Welcome call checklist"}>
        <Kv label="Verified" value={`${vc.checkedCount} of ${vc.totalCount}`} strong />
        {vc.openRecheckCount ? <Kv label="Open rechecks" value={String(vc.openRecheckCount)} /> : null}
        <Kv label="Status" value={locked ? `Submitted and locked${vc.submission?.SubmittedAt ? ` · ${fmtDateShort(vc.submission.SubmittedAt)}` : ""}` : "Open"} />
        {!vc.hasWelcomedCall && !locked ? <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 6 }}>Log a welcome call with the outcome Welcomed before submitting.</Text> : null}
      </Section>
      {(vc.sections ?? []).map((sec: Row) => (
        <Section key={sec.section} title={sec.label}>
          {(sec.items ?? []).map((it: Row) => {
            const open = it.RecheckStatus === "Open";
            return (
              <View key={it.ItemKey} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Text style={{ flex: 1, fontSize: 13.5, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{it.Label}</Text>
                  <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: open ? colors.destructive : it.IsChecked ? CRM : colors.mutedForeground }}>
                    {open ? "Recheck open" : it.IsChecked ? "Verified" : "To verify"}
                  </Text>
                </View>
                {open && it.RecheckReason ? <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.destructive }}>Recheck: {it.RecheckReason}</Text> : null}
                {canEdit && !locked ? (
                  <>
                    <TextInput value={remarkOf(it)} onChangeText={(v) => setRemarks((r) => ({ ...r, [it.ItemKey]: v }))} placeholder="Remarks"
                      placeholderTextColor={`${colors.mutedForeground}99`}
                      style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13 }} />
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      {open ? (
                        <ActionKey half label={busy === it.ItemKey ? "Saving…" : "Resolve"} onPress={() => run(it.ItemKey, () => crmSend(`${base}/items/${it.ItemKey}/resolve`, "POST"), "Recheck resolved — please re-verify and tick the item")} />
                      ) : (
                        <ActionKey half outline={!!it.IsChecked} label={busy === it.ItemKey ? "Saving…" : it.IsChecked ? "Untick" : "Verify"}
                          onPress={() => run(it.ItemKey, () => crmSend(`${base}/items/${it.ItemKey}`, "PUT", { IsChecked: !it.IsChecked, Remarks: remarkOf(it) }))} />
                      )}
                      {remarks[it.ItemKey] != null && remarks[it.ItemKey] !== (it.Remarks ?? "") ? (
                        <ActionKey half outline label="Save remarks" onPress={() => run(it.ItemKey, () => crmSend(`${base}/items/${it.ItemKey}`, "PUT", { IsChecked: !!it.IsChecked, Remarks: remarkOf(it) }), "Remarks saved")} />
                      ) : null}
                      {!open ? <ActionKey half outline tone={colors.destructive} label="Send for recheck" onPress={() => setRecheckFor(it)} /> : null}
                    </View>
                  </>
                ) : it.Remarks ? <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>Remark: {it.Remarks}</Text> : null}
              </View>
            );
          })}
        </Section>
      ))}
      {canEdit ? (
        <View style={{ flexDirection: "row", marginTop: 4 }}>
          {locked ? (
            <ActionKey outline label={busy === "reopen" ? "Reopening…" : "Reopen checklist"} onPress={() => run("reopen", () => crmSend(`${base}/reopen`, "POST"), "Checklist reopened for edits")} />
          ) : (
            <ActionKey label={busy === "submit" ? "Submitting…" : "Submit & lock"}
              onPress={() => run("submit", () => crmSend(`${base}/submit`, "POST"), "Welcome call verification submitted and locked")} />
          )}
        </View>
      ) : null}
      <NotePrompt open={!!recheckFor} danger title={`Recheck: ${recheckFor?.Label ?? ""}`} hint="The assigned salesperson is notified to correct it."
        placeholder="Describe the mismatch or conflict" submitLabel="Send for recheck" busy={busy != null}
        onSubmit={(reason) => recheckFor && run(recheckFor.ItemKey, () => crmSend(`${base}/items/${recheckFor.ItemKey}/recheck`, "POST", { Reason: reason }), "Sent for recheck — assigned salesperson notified")}
        onClose={() => setRecheckFor(null)} />
    </ScrollView>
  );
}
const fmtDateShort = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

// ── Change unit (dialog) ─────────────────────────────────────────────────────
// The web booking page's Change Unit dialog (src/pages/crm/bookings/ChangeUnitDialog.tsx): pick the project and a
// free unit (crmBookings.js GET /:id/unit-change-units), see old against new and anything blocking it
// (GET /:id/unit-change-options), give the reason, start it (POST /:id/unit-change) and carry on in the buyer's new
// application. A unit change already open is continued there, or withdrawn with a reason.
export function ChangeUnitDialog({ booking, onClose }: { booking: Row; onClose: () => void }) {
  const nav = useNavigation<Nav>();
  const qc = useQueryClient();
  const id = Number(booking.Id);
  const [projectId, setProjectId] = useState(String(booking.ProjectId ?? ""));
  const [unitId, setUnitId] = useState("");
  const [reason, setReason] = useState("");
  const [picker, setPicker] = useState<null | "project" | "unit">(null);
  const [busy, setBusy] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const projectsQ = useQuery({ queryKey: ["unit-projects"], staleTime: 5 * 60_000, queryFn: () => crmGet<Row[]>("/api/unit-master/projects") });
  const freeQ = useQuery({ queryKey: ["crm-unit-change-units", id, projectId], enabled: !!projectId, staleTime: 60_000,
    queryFn: () => crmGet<{ units: Row[]; currentUnitValue: number | null }>(`/api/crm/bookings/${id}/unit-change-units?projectId=${projectId}`) });
  const oQ = useQuery({ queryKey: ["crm-unit-change-options", id, unitId], placeholderData: (p) => p,
    queryFn: () => crmGet<Row>(`/api/crm/bookings/${id}/unit-change-options${unitId ? `?unitId=${unitId}` : ""}`) });
  const o = oQ.data;
  const cur = o?.current;
  const next = unitId && o?.next?.unitId === Number(unitId) ? o.next : null;
  const open = o?.open as { id: number; requestNo: string; status: string; applicationId: number } | null | undefined;
  const blockers: string[] = open ? [] : (o?.blockers ?? []).filter((b: string) => unitId || !/new unit|own unit|booking amount of plan|tag a company bank|no rate/i.test(b));
  const missing = open ? "" : !next ? "Pick the new unit." : blockers.length ? blockers[0] : !reason.trim() ? "Enter the reason." : "";
  const free = freeQ.data?.units ?? [];
  const refresh = () => ["crm-booking", "crm", "crm-unit-change-options", "crm-unit-change-units", "unit-master"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const start = async () => {
    setBusy(true);
    try {
      const d = await crmSend<Row>(`/api/crm/bookings/${id}/unit-change`, "POST", { TargetUnitId: Number(unitId), Reason: reason.trim() });
      toast.success(d?.message || "Unit change started");
      refresh(); onClose();
      if (d?.applicationId) nav.navigate("CrmApplicationForm", { applicationId: Number(d.applicationId) });
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  const row = (label: string, now: unknown, nx: unknown) => (
    <View key={label} style={{ flexDirection: "row", gap: 8, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Text style={{ flex: 1.1, fontSize: 12, fontFamily: fonts.body.medium, color: colors.mutedForeground }}>{label}</Text>
      <Text style={{ flex: 1, fontSize: 12, fontFamily: fonts.body.regular, color: colors.foreground }}>{String(now ?? "—")}</Text>
      <Text style={{ flex: 1, fontSize: 12, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{String(nx ?? "—")}</Text>
    </View>
  );

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 16 }}>
        <View style={{ maxHeight: "92%", backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.border }}>
          <ScrollView contentContainerStyle={{ padding: 18, gap: 10 }} keyboardShouldPersistTaps="handled">
            <Text style={{ fontSize: 16, fontFamily: fonts.heading.bold, color: colors.foreground }}>Change unit</Text>
            {open ? (
              <>
                <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: colors.foreground }}>
                  {`Unit change ${open.requestNo} is ${open.status}.`}{open.status === "Draft" ? " Carry on in its application, then submit it for approval." : " It is with the approvers."}
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {open.status === "Draft" ? <ActionKey half label="Continue application" onPress={() => { onClose(); nav.navigate("CrmApplicationForm", { applicationId: open.applicationId }); }} /> : null}
                  <ActionKey half outline tone={colors.destructive} label="Withdraw" onPress={() => setWithdrawOpen(true)} />
                </View>
              </>
            ) : (
              <>
                <PickerRow label="Project" value={(projectsQ.data ?? []).find((p) => String(p.Id) === projectId)?.Name ?? booking.ProjectName ?? ""} onPress={() => setPicker("project")} />
                <PickerRow label="New unit" value={(() => { const u = free.find((x) => String(x.id) === unitId); return u ? joinDot(u.blockName, u.unitNo) : ""; })()}
                  placeholder={freeQ.isLoading ? "Loading…" : free.length ? "— Select —" : "No free unit in this project"} onPress={() => setPicker("unit")} />
                {cur && next ? (
                  <View>
                    {row("", "Now", "New")}
                    {row("Unit", joinDot(cur.blockName, cur.unitNo), joinDot(next.blockName, next.unitNo))}
                    {row("Project", cur.projectName, next.projectName)}
                    {row("Saleable area", cur.areaSqFt && `${cur.areaSqFt} sq ft`, next.areaSqFt && `${next.areaSqFt} sq ft`)}
                    {row("Rate per sq ft", money(cur.ratePerSqFt), money(next.ratePerSqFt))}
                    {row("Unit value", money(cur.totalValue), money(next.unitPrice))}
                    {row("Parking", money(cur.parkingTotal), money(next.parkingTotal))}
                    {row("Extra charges", money(cur.extraChargesTotal), money(next.extraChargesTotal))}
                    {row("GST", money(cur.gstAmount), money(next.gstAmount))}
                    {row("Price (incl. GST)", money(cur.grandTotal), money(next.grandTotal))}
                    {o?.money ? row("Received", money(o.money.Received), "moves in full") : null}
                  </View>
                ) : null}
                {blockers.map((b) => <Text key={b} style={{ fontSize: 12, fontFamily: fonts.body.medium, color: colors.destructive }}>{b}</Text>)}
                <TextField label="Reason" required value={reason} onChangeText={setReason} multiline />
                {missing ? <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{missing}</Text> : null}
              </>
            )}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
              <ActionKey label="Close" outline tone={colors.mutedForeground} onPress={onClose} />
              {open ? null : <ActionKey label={busy ? "Starting…" : "Start unit change"} onPress={() => (missing ? toast.error(missing) : start())} />}
            </View>
          </ScrollView>
        </View>
      </View>
      <OptionPickerModal visible={!!picker} title={picker === "project" ? "Project" : "New unit"} searchable loading={picker === "unit" && freeQ.isLoading}
        options={picker === "project" ? (projectsQ.data ?? []).map((p) => ({ key: String(p.Id), label: p.Name }))
          : free.map((u) => ({ key: String(u.id), label: joinDot(u.blockName, u.unitNo), sublabel: joinDot(u.unitType, u.floorNo != null && `Floor ${u.floorNo}`, u.unitValue != null && money(u.unitValue)) }))}
        selectedKey={picker === "project" ? projectId : unitId}
        onSelect={(k) => { if (picker === "project") { setProjectId(k ?? ""); setUnitId(""); } else setUnitId(k ?? ""); setPicker(null); }}
        onClose={() => setPicker(null)} />
      <NotePrompt open={withdrawOpen} danger title={`Withdraw ${open?.requestNo ?? ""}?`} hint="The buyer stays on the current unit." placeholder="Reason" submitLabel="Withdraw" busy={busy}
        onSubmit={async (text) => {
          if (!open) return;
          setBusy(true);
          try { await crmSend(`/api/crm/bookings/unit-changes/${open.id}/withdraw`, "PUT", { reason: text }); toast.success("Unit change withdrawn"); setWithdrawOpen(false); refresh(); onClose(); }
          catch (e) { toast.error((e as Error).message); }
          finally { setBusy(false); }
        }}
        onClose={() => setWithdrawOpen(false)} />
    </Modal>
  );
}

// ── Possession & Handover (one booking) ──────────────────────────────────────
// The web's Possession & Handover record (src/pages/crm/CrmPossession.tsx): the Pre-Possession checklist, the Possession
// Notice and the Handover with its snags, each behind its own page right, each step the server's own (it refuses any
// step whose conditions are not met, with the reason). The labels and order follow the web.
const POSS_MANUAL = [["DocumentationCheck", "Documentation complete"], ["QualityInspectionCheck", "Quality inspection passed"], ["UtilityReadinessCheck", "Utilities ready"]] as const;
const DELIVERY_MODES = ["Portal", "Email", "Post", "Courier", "InPerson"] as const;
const MODE_LABEL: Record<string, string> = { Portal: "Civilier Home", Email: "Email", Post: "Post", Courier: "Courier", InPerson: "In person" };
const PROXY_METHODS = ["Phone", "InPerson", "Email", "WhatsApp", "Other"] as const;
const HANDOVER_NEXT: Record<string, string[]> = { Scheduled: ["SnagInspection"], SnagInspection: ["SnagPending", "Completed"], SnagPending: ["Completed"] };
const HANDOVER_LABEL: Record<string, string> = { Scheduled: "Scheduled", SnagInspection: "Inspecting", SnagPending: "Snags to fix", Completed: "Completed", Cancelled: "Cancelled" };
const HANDOVER_ACTION: Record<string, string> = { SnagInspection: "Start Inspection", SnagPending: "Inspection Done", Completed: "Complete Handover" };
const SNAG_CATEGORIES = ["Electrical", "Plumbing", "Civil", "Paint", "Carpentry", "Other"] as const;
const dayAhead = (n = 0) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const day = (d: unknown) => (d ? String(d).slice(0, 10) : "");
const showDate = (d: unknown) => (d ? new Date(String(d)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

export function PossessionScreen() {
  const qc = useQueryClient();
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmPossession">>();
  const { canDoAction, canAccessPage } = useAuth();
  const right = (page: string, r: "create" | "edit") => canDoAction(page, r);
  const boardQ = useQuery({ queryKey: ["crm-possession", "row", params.bookingId],
    queryFn: () => crmGet<{ rows: Row[] }>(`/api/crm/pre-possession/board?bookingId=${params.bookingId}&page=1&pageSize=1`).then((d) => d.rows?.[0] ?? null) });
  const r = boardQ.data;
  const closed = r?.Stage === "Closed";
  const checkQ = useQuery({ queryKey: ["crm-possession", "check", r?.CheckId], enabled: !!r?.CheckId && canAccessPage("crm-pre-possession"), queryFn: () => crmGet<Row>(`/api/crm/pre-possession/${r!.CheckId}`) });
  const noticeQ = useQuery({ queryKey: ["crm-possession", "notice", r?.NoticeId], enabled: !!r?.NoticeId && canAccessPage("crm-possession-notice"), queryFn: () => crmGet<Row>(`/api/crm/possession-notice/${r!.NoticeId}`) });
  const hoQ = useQuery({ queryKey: ["crm-possession", "handover", r?.HandoverId], enabled: !!r?.HandoverId && canAccessPage("crm-handover"), queryFn: () => crmGet<Row>(`/api/crm/handover/${r!.HandoverId}`) });
  const staffQ = useQuery({ queryKey: ["sa-users"], queryFn: getAssignableStaff, staleTime: 5 * 60_000 });
  const c = checkQ.data, n = noticeQ.data, h = hoQ.data?.handover, snags: Row[] = hoQ.data?.snags ?? [];
  const openSnags = snags.filter((s) => s.Status !== "Resolved").length;

  // Signed copies (the web's SignedDocuments): the booking's possession papers, uploaded by notice / handover editors.
  const docsKey = ["crm-possession", "documents", params.bookingId];
  const docsQ = useQuery({ queryKey: docsKey, queryFn: () => crmGet<{ documents: Row[]; types: string[] }>(`/api/crm/booking-documents/booking/${params.bookingId}/possession`) });
  const [docType, setDocType] = useState("");
  const [typePick, setTypePick] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadSigned = async () => {
    const types = docsQ.data?.types ?? [];
    const pick = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
    if (pick.canceled || !pick.assets?.length) return;
    const a = pick.assets[0];
    const fd = new FormData();
    if (a.file) fd.append("files", a.file); else fd.append("files", { uri: a.uri, name: a.name, type: a.mimeType || "application/octet-stream" } as any);
    fd.append("DocumentType", docType || types[0]);
    setUploading(true);
    try {
      const res = await fetchWithAuth(`/api/crm/booking-documents/booking/${params.bookingId}/possession-upload`, { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || "Could not upload the file.");
      toast.success("Document uploaded");
      qc.invalidateQueries({ queryKey: docsKey });
    } catch (e) { toast.error((e as Error).message); }
    finally { setUploading(false); }
  };
  const [busy, setBusy] = useState(false);
  const [dlg, setDlg] = useState<null | "start" | "notice" | "noticeEdit" | "sent" | "dispute" | "retract" | "proxyAck" | "proxyDispute" | "schedule" | "snag" | "complete" | "cancelHo" | "ack">(null);
  const [form, setForm] = useState<Row>({});
  const setF = (k: string, v: unknown) => setForm((x) => ({ ...x, [k]: v }));
  const run = async (fn: () => Promise<any>, done: string) => {
    setBusy(true);
    try { await fn(); toast.success(done); setDlg(null); return true; }
    catch (e) { toast.error((e as Error).message); return false; }
    finally { setBusy(false); ["crm-possession", "crm", "crm-booking", "crm-booking-life", "crm-dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); }
  };
  const open = (d: NonNullable<typeof dlg>, f: Row = {}) => { setForm(f); setDlg(d); };
  const nUrl = r?.NoticeId ? `/api/crm/possession-notice/${r.NoticeId}` : "";
  const hUrl = r?.HandoverId ? `/api/crm/handover/${r.HandoverId}` : "";
  const keys = (list: (false | null | undefined | { label: string; go: () => void; danger?: boolean; outline?: boolean })[]) => {
    const l = list.filter(Boolean) as { label: string; go: () => void; danger?: boolean; outline?: boolean }[];
    return l.length ? (
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        {l.map((k) => <ActionKey key={k.label} half label={k.label} outline={k.outline || k.danger} tone={k.danger ? colors.destructive : undefined} onPress={k.go} />)}
      </View>
    ) : null;
  };

  if (boardQ.isLoading) return <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: "center" }}><ActivityIndicator color={colors.mutedForeground} /></View>;
  if (!r) return <View style={{ flex: 1, backgroundColor: colors.background, padding: 16 }}><Empty text={(boardQ.error as Error)?.message || "This booking is not on the possession board."} /></View>;
  const liveHo = !!r.HandoverId && r.HandoverStatus !== "Cancelled";
  const hoActive = h && !["Completed", "Cancelled"].includes(h.Status);
  const moves = h && right("crm-handover", "edit") && !closed ? (HANDOVER_NEXT[h.Status] ?? []) : [];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 96 }}>
      <Section title={params.title || r.BookingNo}>
        <Kv label="Buyer" value={r.ApplicantName} strong />
        <Kv label="Unit" value={joinDot(r.ProjectName, r.BlockName, r.UnitNo)} />
        <Kv label="Stage" value={words(r.Stage)} />
        <Kv label="Balance due" value={Number(r.Balance) > 0 ? money(r.Balance) : "Nil"} />
      </Section>

      <Section title="Pre-Possession Checklist">
        {!r.CheckId ? (
          <>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>
              {closed ? "This booking is closed." : r.Stage === "NotReady" ? "Not ready yet: the booking must be approved, its agreement registered and the occupancy certificate issued." : "No checklist started yet."}
            </Text>
            {keys([right("crm-pre-possession", "create") && !closed && r.Stage !== "NotReady" && { label: "Start Checklist", go: () => open("start", { date: "" }) }])}
          </>
        ) : !c ? <ActivityIndicator color={colors.mutedForeground} /> : (
          <>
            <Kv label="Status" value={c.Status ?? r.CheckStatus} />
            <Kv label="Dues cleared" value={c.DuesClearedCheck ? "Automatic" : `${c.OutstandingDemandCount ?? 0} outstanding`} />
            {POSS_MANUAL.map(([k, lbl]) => (
              <Pressable key={k} disabled={!right("crm-pre-possession", "edit") || closed || busy}
                onPress={() => run(() => crmSend(`/api/crm/pre-possession/${c.Id}`, "PUT", { [k]: !c[k] }), `${lbl}: ${c[k] ? "unticked" : "ticked"}`)}
                style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <Square size={16} color={c[k] ? CRM : colors.mutedForeground} fill={c[k] ? CRM : "transparent"} />
                <Text style={{ fontSize: 13.5, fontFamily: fonts.body.medium, color: c[k] ? colors.foreground : colors.mutedForeground }}>{lbl}</Text>
              </Pressable>
            ))}
            <Kv label="Inspection scheduled" value={showDate(c.ScheduledInspectionDate)} />
            <Kv label="Inspection completed" value={showDate(c.InspectionCompletedDate)} />
            <Kv label="Notes" value={c.Notes || "—"} />
            {keys([right("crm-pre-possession", "edit") && !closed && { label: "Edit dates & notes", outline: true,
              go: () => open("start", { edit: true, ScheduledInspectionDate: day(c.ScheduledInspectionDate), InspectionCompletedDate: day(c.InspectionCompletedDate), Notes: c.Notes ?? "" }) }])}
          </>
        )}
      </Section>

      <Section title="Possession Notice">
        {!r.NoticeId ? (
          <>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{r.CheckStatus === "Ready" ? "No notice created yet." : "Available once the checklist is Ready."}</Text>
            {keys([right("crm-possession-notice", "create") && r.CheckStatus === "Ready" && !!r.Gate2_OcCcReceived && !closed && { label: "Create Notice",
              go: () => open("notice", { OfferedDate: dayAhead(), ResponseDeadline: dayAhead(15), DeliveryMode: "Courier", Notes: "" }) }])}
          </>
        ) : !n ? <ActivityIndicator color={colors.mutedForeground} /> : (
          <>
            <Kv label="Notice number" value={n.NoticeNo} strong />
            <Kv label="Status" value={n.Status} />
            <Kv label="Offered on" value={showDate(n.OfferedDate)} />
            <Kv label="Respond by" value={`${showDate(n.ResponseDeadline)}${r.NoticeOverdue ? " (overdue)" : ""}`} />
            <Kv label="Delivery" value={MODE_LABEL[n.DeliveryMode] ?? n.DeliveryMode ?? "—"} />
            <Kv label="Sent on" value={showDate(n.SentAt)} />
            <Kv label="Acknowledged on" value={showDate(n.AcknowledgedAt)} />
            {n.DisputeReason ? <Kv label="Customer's objection" value={n.DisputeReason} /> : null}
            <Kv label="Notes" value={n.Notes || "—"} />
            <LinkRow icon={FileText} title="View Letter" sub={`${n.NoticeNo}.pdf`} onPress={() => openDocument(`${nUrl}/pdf`, `${n.NoticeNo}.pdf`).catch((e: Error) => toast.error(e.message))} />
            {right("crm-possession-notice", "edit") && !closed ? keys(n.Status === "Draft" ? [
              { label: "Mark as Sent", go: () => open("sent", { DeliveryMode: n.DeliveryMode || "" }) },
              { label: "Edit", outline: true, go: () => open("noticeEdit", { OfferedDate: day(n.OfferedDate), ResponseDeadline: day(n.ResponseDeadline), DeliveryMode: n.DeliveryMode || "", Notes: n.Notes || "" }) },
            ] : n.Status === "Sent" ? [
              { label: "Acknowledge", go: () => open("ack") },
              { label: "Mark as Disputed", danger: true, go: () => open("dispute", { reason: "" }) },
              { label: "Record acknowledgement", outline: true, go: () => open("proxyAck", { ProxyMethod: "Phone", ProxyRemarks: "" }) },
              { label: "Record dispute", outline: true, go: () => open("proxyDispute", { ProxyMethod: "Phone", ProxyRemarks: "" }) },
            ] : n.Status === "Disputed" ? [{ label: "Withdraw Dispute", go: () => open("retract", { reason: "" }) }] : []) : null}
          </>
        )}
      </Section>

      <Section title="Handover">
        {!r.HandoverId || (!liveHo && r.HandoverStatus === "Cancelled") ? (
          <>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>
              {r.NoticeStatus === "Acknowledged" ? (r.HandoverStatus === "Cancelled" ? "The last handover was cancelled. A new one can be scheduled." : "Ready to be scheduled.") : "Available once the customer acknowledges the notice."}
            </Text>
            {keys([right("crm-handover", "create") && !liveHo && r.NoticeStatus === "Acknowledged" && !closed && { label: "Schedule Handover", go: () => open("schedule", { ScheduledDate: dayAhead(7), Notes: "" }) }])}
          </>
        ) : !h ? <ActivityIndicator color={colors.mutedForeground} /> : (
          <>
            <Kv label="Status" value={HANDOVER_LABEL[h.Status] ?? h.Status} />
            <Kv label="Scheduled for" value={showDate(h.ScheduledDate)} />
            <Kv label="Handed over on" value={showDate(h.ActualHandoverDate)} />
            <Kv label="Keys handed by" value={h.KeyHandoverByName || "—"} />
            <Kv label="Final dues" value={h.FinalDuesCleared ? "Cleared" : "Not confirmed"} />
            <Kv label="Customer" value={h.CustomerAcknowledged ? "Took possession" : "Not yet"} />
            <Kv label="Notes" value={h.Notes || "—"} />
            {keys([
              ...moves.map((m) => ({ label: HANDOVER_ACTION[m], go: () => (m === "Completed"
                ? (openSnags > 0 ? toast.error("Resolve the open snags first.") : open("complete", { ActualHandoverDate: dayAhead(), KeyHandoverBy: "", FinalDuesCleared: false, CustomerAcknowledged: false }))
                : run(() => crmSend(hUrl, "PUT", { Status: m }), `Handover: ${HANDOVER_LABEL[m]}`)) })),
              hoActive && right("crm-handover", "create") && { label: "Raise Snag", outline: true, go: () => open("snag", { Category: SNAG_CATEGORIES[0], Description: "" }) },
              hoActive && right("crm-handover", "edit") && !closed && { label: "Cancel Handover", danger: true, go: () => open("cancelHo") },
            ])}
            <Text style={{ fontSize: 13.5, fontFamily: fonts.heading.semibold, color: colors.foreground, marginTop: 14 }}>{`Snags (${snags.length})`}</Text>
            {snags.length === 0 ? <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>No snags raised.</Text> : snags.map((s) => (
              <View key={s.Id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 4 }}>
                <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{joinDot(s.Category, s.Status === "Resolved" ? "Resolved" : "Open")}</Text>
                <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.foreground }}>{s.Description}</Text>
                <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{joinDot(s.RaisedByName && `Raised by ${s.RaisedByName}`, s.ResolvedByName && `Resolved by ${s.ResolvedByName}`)}</Text>
                {s.Status !== "Resolved" && right("crm-handover", "edit") ? (
                  <View style={{ flexDirection: "row" }}><ActionKey label="Mark Resolved" outline onPress={() => run(() => crmSend(`${hUrl}/snags/${s.Id}`, "PUT", { Status: "Resolved" }), "Snag resolved")} /></View>
                ) : null}
              </View>
            ))}
          </>
        )}
      </Section>

      <Section title={`Signed Documents (${(docsQ.data?.documents ?? []).length})`}>
        {(docsQ.data?.documents ?? []).length === 0 ? (
          <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>No signed copy uploaded yet.</Text>
        ) : (docsQ.data?.documents ?? []).map((d) => (
          <LinkRow key={d.Id} icon={FileText} title={d.DocumentType} sub={joinDot(d.FileName, d.UploadedByName || "—", fmtDate(d.CreatedAt))}
            onPress={() => openDocument(`/api/crm/booking-documents/file/${d.Id}`, d.FileName || "Document").catch((e: Error) => toast.error(e.message))} />
        ))}
        {(right("crm-possession-notice", "edit") || right("crm-handover", "edit")) && !closed ? (
          <View style={{ marginTop: 10, gap: 8 }}>
            <PickerRow label="Document" value={docType || (docsQ.data?.types ?? [])[0] || ""} placeholder="Select the document" onPress={() => setTypePick(true)} />
            <View style={{ flexDirection: "row" }}><ActionKey outline label={uploading ? "Uploading…" : "Upload"} onPress={() => { if (!uploading) void uploadSigned(); }} /></View>
          </View>
        ) : null}
      </Section>
      <OptionPickerModal visible={typePick} title="Document" options={(docsQ.data?.types ?? []).map((t) => ({ key: t, label: t }))} selectedKey={docType || (docsQ.data?.types ?? [])[0] || null}
        onSelect={(k) => { setDocType(k ?? ""); setTypePick(false); }} onClose={() => setTypePick(false)} />

      <Modal visible={!!dlg} transparent animationType="fade" onRequestClose={() => setDlg(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 16 }}>
          <View style={{ maxHeight: "90%", backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.border }}>
            <ScrollView contentContainerStyle={{ padding: 18, gap: 8 }} keyboardShouldPersistTaps="handled">
              {dlg === "start" ? (
                <>
                  <Text style={DLG_TITLE}>{form.edit ? "Pre-Possession Checklist" : "Start Pre-Possession Checklist"}</Text>
                  <DateField label={form.edit ? "Inspection scheduled" : "Inspection scheduled for"} value={String(form.edit ? form.ScheduledInspectionDate ?? "" : form.date ?? "")} onChange={(v: string) => setF(form.edit ? "ScheduledInspectionDate" : "date", v)} />
                  {form.edit ? <DateField label="Inspection completed" value={String(form.InspectionCompletedDate ?? "")} onChange={(v: string) => setF("InspectionCompletedDate", v)} /> : null}
                  {form.edit ? <TextField label="Notes" value={String(form.Notes ?? "")} onChangeText={(v) => setF("Notes", v)} placeholder="Inspection remarks" /> : null}
                  <DlgKeys busy={busy} onClose={() => setDlg(null)} label={form.edit ? "Save" : "Start Checklist"} onOk={() => {
                    if (form.edit) {
                      if (form.InspectionCompletedDate && form.ScheduledInspectionDate && form.InspectionCompletedDate < form.ScheduledInspectionDate) return toast.error("The inspection can't be completed before it was scheduled.");
                      run(() => crmSend(`/api/crm/pre-possession/${c!.Id}`, "PUT", { ScheduledInspectionDate: form.ScheduledInspectionDate || null, InspectionCompletedDate: form.InspectionCompletedDate || null, Notes: form.Notes || null }), "Checklist saved");
                    } else run(() => crmSend("/api/crm/pre-possession", "POST", { BookingId: r.BookingId, ScheduledInspectionDate: form.date || null }), "Checklist started");
                  }} />
                </>
              ) : dlg === "notice" || dlg === "noticeEdit" ? (
                <>
                  <Text style={DLG_TITLE}>{dlg === "notice" ? "Create Possession Notice" : "Edit Possession Notice"}</Text>
                  <DateField label="Offered on" value={String(form.OfferedDate ?? "")} onChange={(v: string) => setF("OfferedDate", v)} />
                  <DateField label="Respond by" value={String(form.ResponseDeadline ?? "")} onChange={(v: string) => setF("ResponseDeadline", v)} />
                  <Chips label="Delivery" options={DELIVERY_MODES} value={(form.DeliveryMode || null) as (typeof DELIVERY_MODES)[number] | null} onChange={(m) => setF("DeliveryMode", m)} labelOf={(m) => MODE_LABEL[m]} />
                  <RemarksField label="Notes" value={String(form.Notes ?? "")} onChangeText={(v) => setF("Notes", v)} />
                  <DlgKeys busy={busy} onClose={() => setDlg(null)} label={dlg === "notice" ? "Create Notice" : "Save Changes"} onOk={() => {
                    if (form.OfferedDate && form.ResponseDeadline && form.ResponseDeadline < form.OfferedDate) return toast.error("The response deadline can't be before the offered date.");
                    if (dlg === "notice") run(() => crmSend("/api/crm/possession-notice", "POST", { ...form, BookingId: r.BookingId }), "Notice created");
                    else run(() => crmSend(nUrl, "PUT", { OfferedDate: form.OfferedDate || undefined, ResponseDeadline: form.ResponseDeadline || undefined, DeliveryMode: form.DeliveryMode || undefined, Notes: form.Notes }), "Notice saved");
                  }} />
                </>
              ) : dlg === "sent" ? (
                <>
                  <Text style={DLG_TITLE}>Mark as Sent</Text>
                  <Chips label="Sent by" required options={DELIVERY_MODES} value={(form.DeliveryMode || null) as (typeof DELIVERY_MODES)[number] | null} onChange={(m) => setF("DeliveryMode", m)} labelOf={(m) => MODE_LABEL[m]} />
                  <Text style={DLG_NOTE}>However it is delivered, the customer can read this letter and respond on their portal as soon as it is marked as sent.</Text>
                  <DlgKeys busy={busy} onClose={() => setDlg(null)} label="Mark as Sent" onOk={() => (form.DeliveryMode ? run(() => crmSend(`${nUrl}/mark-sent`, "PUT", { DeliveryMode: form.DeliveryMode }), "Notice marked as sent") : toast.error("Pick how it was sent."))} />
                </>
              ) : dlg === "ack" ? (
                <>
                  <Text style={DLG_TITLE}>Acknowledge Notice</Text>
                  <Text style={DLG_NOTE}>The customer has accepted this offer of possession. The handover can then be scheduled.</Text>
                  <DlgKeys busy={busy} onClose={() => setDlg(null)} label="Acknowledge" onOk={() => run(() => crmSend(`${nUrl}/mark-acknowledged`, "PUT"), "Notice acknowledged")} />
                </>
              ) : dlg === "dispute" || dlg === "retract" ? (
                <>
                  <Text style={DLG_TITLE}>{dlg === "dispute" ? "Mark as Disputed" : "Withdraw Dispute"}</Text>
                  <Text style={DLG_NOTE}>{dlg === "dispute" ? "The notice stays disputed until the objection is settled." : "The notice goes back to Draft so it can be revised and sent again."}</Text>
                  <TextField label={dlg === "dispute" ? "Customer's objection" : "How it was settled"} required multiline value={String(form.reason ?? "")} onChangeText={(v) => setF("reason", v)} />
                  <DlgKeys busy={busy} danger={dlg === "dispute"} onClose={() => setDlg(null)} label={dlg === "dispute" ? "Mark as Disputed" : "Back to Draft"} onOk={() => {
                    const why = String(form.reason ?? "").trim();
                    if (!why) return toast.error("Write the reason.");
                    if (dlg === "dispute") run(() => crmSend(`${nUrl}/mark-disputed`, "PUT", { DisputeReason: why }), "Notice marked as disputed");
                    else run(() => crmSend(`${nUrl}/retract-dispute`, "PUT", { RetractReason: why }), "Dispute withdrawn; the notice is back to Draft");
                  }} />
                </>
              ) : dlg === "proxyAck" || dlg === "proxyDispute" ? (
                <>
                  <Text style={DLG_TITLE}>{dlg === "proxyAck" ? "Record customer's acknowledgement" : "Record customer's dispute"}</Text>
                  <Text style={DLG_NOTE}>{dlg === "proxyAck" ? "The customer acknowledged the possession notice without using their portal." : "The customer disputed the possession notice without using their portal. Put their reason in the notes."}</Text>
                  <Chips label="How did the customer communicate?" required options={PROXY_METHODS} value={form.ProxyMethod ?? null} onChange={(m) => setF("ProxyMethod", m)} labelOf={(m) => (m === "InPerson" ? "In person" : m)} />
                  <TextField label="Notes for the record" required multiline value={String(form.ProxyRemarks ?? "")} onChangeText={(v) => setF("ProxyRemarks", v)} />
                  <DlgKeys busy={busy} onClose={() => setDlg(null)} label={dlg === "proxyAck" ? "Record acknowledgement" : "Record dispute"} onOk={() => {
                    if (!String(form.ProxyRemarks ?? "").trim()) return toast.error("Write the notes for the record.");
                    run(() => crmSend(`${nUrl}/${dlg === "proxyAck" ? "proxy-acknowledge" : "proxy-dispute"}`, "PUT", { ProxyMethod: form.ProxyMethod, ProxyRemarks: String(form.ProxyRemarks).trim() }),
                      dlg === "proxyAck" ? "Customer's acknowledgement recorded" : "Customer's dispute recorded");
                  }} />
                </>
              ) : dlg === "schedule" ? (
                <>
                  <Text style={DLG_TITLE}>Schedule Handover</Text>
                  <DateField label="Scheduled for" value={String(form.ScheduledDate ?? "")} onChange={(v: string) => setF("ScheduledDate", v)} />
                  <TextField label="Notes" value={String(form.Notes ?? "")} onChangeText={(v) => setF("Notes", v)} />
                  <DlgKeys busy={busy} onClose={() => setDlg(null)} label="Schedule Handover" onOk={() => run(() => crmSend("/api/crm/handover", "POST", { BookingId: r.BookingId, ScheduledDate: form.ScheduledDate || null, Notes: form.Notes || null }), "Handover scheduled")} />
                </>
              ) : dlg === "snag" ? (
                <>
                  <Text style={DLG_TITLE}>Raise Snag</Text>
                  <Chips label="Category" options={SNAG_CATEGORIES} value={form.Category ?? null} onChange={(v) => setF("Category", v)} labelOf={(v) => v} />
                  <TextField label="Defect" required multiline value={String(form.Description ?? "")} onChangeText={(v) => setF("Description", v)} />
                  <DlgKeys busy={busy} onClose={() => setDlg(null)} label="Raise Snag" onOk={() => (String(form.Description ?? "").trim()
                    ? run(() => crmSend(`${hUrl}/snags`, "POST", { Category: form.Category, Description: String(form.Description).trim() }), "Snag raised") : toast.error("Describe the defect."))} />
                </>
              ) : dlg === "cancelHo" ? (
                <>
                  <Text style={DLG_TITLE}>Cancel Handover</Text>
                  <Text style={DLG_NOTE}>This handover can't be resumed; a new one would have to be scheduled.</Text>
                  <DlgKeys busy={busy} danger onClose={() => setDlg(null)} closeLabel="Keep" label="Cancel Handover" onOk={() => run(() => crmSend(hUrl, "PUT", { Status: "Cancelled" }), "Handover cancelled")} />
                </>
              ) : dlg === "complete" ? (
                <>
                  <Text style={DLG_TITLE}>Complete Handover</Text>
                  <Text style={DLG_NOTE}>The permanent record of the key handover. Every item is required.</Text>
                  <DateField label="Handed over on" required value={String(form.ActualHandoverDate ?? "")} onChange={(v: string) => setF("ActualHandoverDate", v)} />
                  <Chips label="Keys handed by" required options={(staffQ.data ?? []).map((u) => String(u.Id))} value={form.KeyHandoverBy || null}
                    onChange={(v) => setF("KeyHandoverBy", v)} labelOf={(v) => (staffQ.data ?? []).find((u) => String(u.Id) === v)?.Name ?? v} />
                  {([["FinalDuesCleared", "Every final due is cleared: no payment demand remains on this booking."], ["CustomerAcknowledged", "The customer took possession and received the keys."]] as const).map(([k, text]) => (
                    <Pressable key={k} onPress={() => setF(k, !form[k])} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", padding: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.border }}>
                      <Square size={16} color={form[k] ? CRM : colors.mutedForeground} fill={form[k] ? CRM : "transparent"} />
                      <Text style={{ flex: 1, fontSize: 13, fontFamily: fonts.body.regular, color: colors.foreground }}>{text}</Text>
                    </Pressable>
                  ))}
                  <DlgKeys busy={busy} onClose={() => setDlg(null)} label="Complete Handover" onOk={() => {
                    if (!form.ActualHandoverDate) return toast.error("Enter the handover date.");
                    if (form.ActualHandoverDate > dayAhead()) return toast.error("The handover date can't be in the future.");
                    if (!form.KeyHandoverBy) return toast.error("Select who handed over the keys.");
                    if (!form.FinalDuesCleared) return toast.error("Confirm that every final due is cleared.");
                    if (!form.CustomerAcknowledged) return toast.error("Confirm that the customer took possession.");
                    run(() => crmSend(hUrl, "PUT", { Status: "Completed", ActualHandoverDate: form.ActualHandoverDate, KeyHandoverBy: Number(form.KeyHandoverBy), FinalDuesCleared: true, CustomerAcknowledged: true }), "Handover completed");
                  }} />
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
const DLG_TITLE = { fontSize: 16, fontFamily: fonts.heading.bold, color: colors.foreground } as const;
const DLG_NOTE = { fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground } as const;
function DlgKeys({ busy, danger, label, closeLabel = "Cancel", onOk, onClose }: { busy: boolean; danger?: boolean; label: string; closeLabel?: string; onOk: () => void; onClose: () => void }) {
  return (
    <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
      <ActionKey label={closeLabel} outline tone={colors.mutedForeground} onPress={onClose} />
      <ActionKey label={busy ? "Saving…" : label} tone={danger ? colors.destructive : undefined} onPress={() => { if (!busy) onOk(); }} />
    </View>
  );
}

// ── Generate invoice (dialog) ────────────────────────────────────────────────
// The web's Generate invoice dialog for one booking (src/pages/crm/invoices/GenerateInvoiceDialog.tsx): milestones whose
// demand is raised and not yet invoiced (POST /bookings/invoices/bulk-generate), an on-account deposit not yet invoiced,
// a Maintenance or Other invoice (POST /bookings/:id/invoices, number automatic, by prefix or exact), and for a
// Non-invoice customer one final invoice once everything is paid (POST /:id/invoices/final).
type InvKind = "Milestone" | "OnAccount" | "Maintenance" | "Other";
export function GenerateInvoiceDialog({ bookingId, onClose }: { bookingId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const detailQ = useQuery({ queryKey: ["crm-booking", bookingId], queryFn: () => crmGet<Row>(`/api/crm/bookings/${bookingId}`) });
  const oaQ = useQuery({ queryKey: ["crm-booking-oa", bookingId], queryFn: () => crmGet<{ payments: Row[] }>(`/api/crm/payments/booking/${bookingId}/on-account`) });
  const invQ = useQuery({ queryKey: ["crm-booking-invoices", bookingId], queryFn: () => crmGet<Row[]>(`/api/crm/bookings/${bookingId}/invoices`) });
  const milestones: Row[] = detailQ.data?.milestones ?? [];
  const invoices = invQ.data ?? [];
  const live = (inv: Row) => inv.Status !== "Void";
  const ready = milestones.filter((m) => m.Status !== "Waived" && !invoices.some((inv) => inv.MilestoneId === m.Id && live(inv)) && m.DemandStatus !== "Pending");
  const deposits = (oaQ.data?.payments ?? []).filter((p) => p.InvoiceId == null && p.Status !== "Applied" && p.Status !== "PartiallyApplied" && !invoices.some((inv) => inv.OnAccountPaymentId === p.Id && live(inv)));
  const outstanding = milestones.filter((m) => m.Status !== "Paid" && m.Status !== "Waived" && Number(m.AmountDue || 0) - Number(m.AmountPaid || 0) > 0);
  const nonInvoice = detailQ.data?.customer?.InvoiceMode === "NonInvoice";
  const finalInv = invoices.find((inv) => inv.InvoiceType === "Final" && live(inv));
  const finalDue = nonInvoice && !finalInv && milestones.length > 0 && outstanding.length === 0 && !milestones.some((m) => m.Status !== "Paid" && m.Status !== "Waived");

  const [kind, setKind] = useState<InvKind>("Milestone");
  const [ticked, setTicked] = useState<number[]>([]);
  const [deposit, setDeposit] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [desc, setDesc] = useState("");
  const [numMode, setNumMode] = useState<"auto" | "prefix" | "custom">("auto");
  const [numText, setNumText] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const done = () => { ["crm-booking-invoices", "crm-booking", "crm", "crm-dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); onClose(); };
  const unlinked = (kind === "Maintenance" || kind === "Other") && outstanding.length > 0;

  const generate = async () => {
    setBusy(true);
    try {
      if (kind === "Milestone") {
        if (!ticked.length) throw new Error("Tick the milestones to invoice.");
        const d = await crmSend<{ succeeded: Row[]; skipped: Row[] }>("/api/crm/bookings/invoices/bulk-generate", "POST", { items: ticked.map((milestoneId) => ({ bookingId, milestoneId })) });
        if (d.succeeded?.length) toast.success(d.succeeded.length === 1 ? `Invoice ${d.succeeded[0].InvoiceNo} generated` : `${d.succeeded.length} invoices generated`);
        if (d.skipped?.length) toast.error(`${d.skipped.length} not generated: ${d.skipped.map((x) => x.reason).join("; ")}`);
        if (d.succeeded?.length) done();
        return;
      }
      if (kind === "OnAccount" && !deposit) throw new Error("Pick the deposit to invoice.");
      if (kind !== "OnAccount" && !(Number(amount) > 0)) throw new Error("Enter the amount.");
      if (numMode !== "auto" && !numText.trim()) throw new Error(numMode === "prefix" ? "Enter the prefix." : "Enter the invoice number.");
      if (unlinked && !ack) throw new Error("Confirm this invoice does not settle the plan's outstanding amount.");
      const body: Row = { InvoiceType: kind, Description: desc, InvoicePrefix: numMode === "prefix" ? numText.trim() : undefined, CustomInvoiceNo: numMode === "custom" ? numText.trim() : undefined };
      if (kind === "OnAccount") body.OnAccountPaymentId = Number(deposit);
      else { body.Amount = parseFloat(amount); body.InvoiceDate = date; }
      const d = await crmSend<Row>(`/api/crm/bookings/${bookingId}/invoices`, "POST", body);
      toast.success(`Invoice ${d?.InvoiceNo ?? ""} generated`);
      done();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  const generateFinal = async () => {
    setBusy(true);
    try { const d = await crmSend<Row>(`/api/crm/bookings/${bookingId}/invoices/final`, "POST"); toast.success(d?.message || "Final invoice generated"); done(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  const kinds: InvKind[] = ["Milestone", ...(deposits.length ? ["OnAccount" as const] : []), "Maintenance", "Other"];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 16 }}>
        <View style={{ maxHeight: "92%", backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.border }}>
          <ScrollView contentContainerStyle={{ padding: 18, gap: 10 }} keyboardShouldPersistTaps="handled">
            <Text style={DLG_TITLE}>Generate invoice</Text>
            {detailQ.isLoading ? <ActivityIndicator color={colors.mutedForeground} /> : nonInvoice ? (
              <>
                <Text style={{ fontSize: 13.5, fontFamily: fonts.heading.semibold, color: colors.foreground }}>This customer takes one final invoice</Text>
                <Text style={DLG_NOTE}>{finalInv ? `Final invoice ${finalInv.InvoiceNo} is generated.` : finalDue ? "Everything is paid: the final invoice can be generated." : "One final invoice for what is due is generated once everything is paid."}</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <ActionKey label="Close" outline tone={colors.mutedForeground} onPress={onClose} />
                  {finalDue ? <ActionKey label={busy ? "Generating…" : "Generate final invoice"} onPress={generateFinal} /> : null}
                </View>
              </>
            ) : finalInv ? (
              <>
                <Text style={{ fontSize: 13.5, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{`This booking is invoiced by final invoice ${finalInv.InvoiceNo}`}</Text>
                <Text style={DLG_NOTE}>Void it first if milestone invoices are needed, so nothing is invoiced twice.</Text>
                <View style={{ flexDirection: "row" }}><ActionKey label="Close" outline tone={colors.mutedForeground} onPress={onClose} /></View>
              </>
            ) : (
              <>
                <Chips label="What to invoice" options={kinds} value={kind} onChange={setKind}
                  labelOf={(k) => (k === "Milestone" ? `Milestones (${ready.length})` : k === "OnAccount" ? `On-account deposit (${deposits.length})` : k)} />
                {kind === "Milestone" ? (ready.length === 0 ? <Text style={DLG_NOTE}>No milestone is due for invoicing. Raise its demand first.</Text> : ready.map((m) => {
                  const on = ticked.includes(m.Id);
                  return (
                    <Pressable key={m.Id} onPress={() => setTicked((t) => (on ? t.filter((x) => x !== m.Id) : [...t, m.Id]))}
                      style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: on ? CRM : colors.border }}>
                      <Square size={16} color={on ? CRM : colors.mutedForeground} fill={on ? CRM : "transparent"} />
                      <Text style={{ flex: 1, fontSize: 13, fontFamily: fonts.body.medium, color: colors.foreground }}>{`${m.MilestoneNo}. ${m.MilestoneName}`}</Text>
                      <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{money(m.AmountDue)}</Text>
                    </Pressable>
                  );
                })) : kind === "OnAccount" ? (
                  <Chips label="Deposit" options={deposits.map((p) => String(p.Id))} value={deposit} onChange={setDeposit}
                    labelOf={(v) => { const p = deposits.find((x) => String(x.Id) === v); return p ? `${p.ReceiptNo} · ${money(p.Amount)}` : v; }} />
                ) : (
                  <>
                    <NumberField label="Amount" required value={amount} onChangeText={setAmount} />
                    <DateField label="Invoice date" value={date} onChange={(v: string) => setDate(v)} />
                  </>
                )}
                {kind !== "Milestone" ? (
                  <>
                    <TextField label="Description" value={desc} onChangeText={setDesc} />
                    <Chips label="Invoice number" options={["auto", "prefix", "custom"] as const} value={numMode} onChange={setNumMode}
                      labelOf={(m) => (m === "auto" ? "Automatic" : m === "prefix" ? "With a prefix" : "Exact number")} />
                    {numMode !== "auto" ? <TextField label={numMode === "prefix" ? "Prefix" : "Invoice number"} value={numText} onChangeText={setNumText} autoCapitalize="characters" /> : null}
                  </>
                ) : null}
                {unlinked ? (
                  <Pressable onPress={() => setAck(!ack)} style={{ flexDirection: "row", gap: 10, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: "#f59e0b80" }}>
                    <Square size={16} color={ack ? CRM : colors.mutedForeground} fill={ack ? CRM : "transparent"} />
                    <Text style={{ flex: 1, fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.foreground }}>
                      {`This invoice is not linked to the payment plan, which still has ${money(outstanding.reduce((s, m) => s + Number(m.AmountDue || 0) - Number(m.AmountPaid || 0), 0))} outstanding. It does not settle that.`}
                    </Text>
                  </Pressable>
                ) : null}
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <ActionKey label="Cancel" outline tone={colors.mutedForeground} onPress={onClose} />
                  <ActionKey label={busy ? "Generating…" : "Generate"} onPress={generate} />
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── Ownership change dialog ───────────────────────────────────────────────────
// Opens from the booking detail's After-sales section (crm-ownership-changes create right).
// Only valid after the sale deed is registered; the server enforces this and returns a clear error.
// Sends POST /api/crm/ownership-changes.
export function OwnershipChangeDialog({ bookingId, fromCustomerId, onClose }: {
  bookingId: number;
  fromCustomerId?: number;
  onClose: () => void;
}) {
  const [newOwner, setNewOwner] = useState<Row | null>(null);
  const [deedNo, setDeedNo] = useState("");
  const [deedDate, setDeedDate] = useState("");
  const [regOffice, setRegOffice] = useState("");
  const [considerationValue, setConsiderationValue] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!newOwner) return toast.error("Choose the new owner");
    setBusy(true);
    try {
      await crmSend("/api/crm/ownership-changes", "POST", {
        BookingId: bookingId, ToCustomerId: newOwner.Id,
        ...(deedNo.trim() ? { DeedNo: deedNo.trim() } : {}),
        ...(deedDate.trim() ? { DeedDate: deedDate } : {}),
        ...(regOffice.trim() ? { RegOffice: regOffice.trim() } : {}),
        ...(considerationValue.trim() ? { ConsiderationValue: parseFloat(considerationValue) } : {}),
        ...(notes.trim() ? { Notes: notes.trim() } : {}),
      });
      toast.success("Ownership change opened — submit it for approval when ready");
      onClose();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 16 }}>
        <View style={{ maxHeight: "92%", backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.border }}>
          <ScrollView contentContainerStyle={{ padding: 18, gap: 4 }} keyboardShouldPersistTaps="handled">
            <Text style={{ fontSize: 16, fontFamily: fonts.heading.bold, color: colors.foreground, marginBottom: 4 }}>Ownership change</Text>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginBottom: 10 }}>
              Records the transfer of ownership after the sale deed is registered.
            </Text>
            <CustomerSearchPicker label="New owner *" value={newOwner} onChange={setNewOwner} excludeId={fromCustomerId} />
            <TextField label="Registered deed no." value={deedNo} onChangeText={setDeedNo} />
            <DateField label="Deed date" value={deedDate} onChange={setDeedDate} />
            <TextField label="Registration office" value={regOffice} onChangeText={setRegOffice} />
            <NumberField label="Consideration value (₹)" value={considerationValue} onChangeText={setConsiderationValue} />
            <RemarksField label="Notes" value={notes} onChangeText={setNotes} />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <ActionKey label="Close" outline tone={colors.mutedForeground} onPress={onClose} />
              <ActionKey label={busy ? "Opening…" : "Open record"} onPress={submit} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── Customer search picker ────────────────────────────────────────────────────
// Used by resale and ownership-change forms to pick the new buyer/owner.
// Calls GET /api/crm/customers?search=q (requires crm-customers or crm-resales view right).
export function CustomerSearchPicker({ label, value, onChange, excludeId }: {
  label: string;
  value: Row | null;
  onChange: (c: Row | null) => void;
  excludeId?: number;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback((q: string) => {
    if (q.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    crmGet<Row[]>(`/api/crm/customers?search=${encodeURIComponent(q.trim())}`)
      .then((rows) => setResults(Array.isArray(rows) ? rows.slice(0, 10) : []))
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, []);

  const onType = (t: string) => {
    setQuery(t);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => search(t), 350);
  };

  const pick = (r: Row) => { onChange(r); setOpen(false); setQuery(""); setResults([]); };
  const clear = () => { onChange(null); };

  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: fonts.body.medium, marginBottom: 6 }}>{label}</Text>
      {value ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
          <User size={15} color={CRM} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 13.5, fontFamily: fonts.body.medium, color: colors.foreground }} numberOfLines={1}>{value.CustomerName}</Text>
            <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }} numberOfLines={1}>{[value.CustomerNo, value.Mobile].filter(Boolean).join(" · ")}</Text>
          </View>
          <TouchableOpacity onPress={clear} hitSlop={8}>
            <Text style={{ fontSize: 13, color: colors.destructive, fontFamily: fonts.body.medium }}>✕</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity onPress={() => setOpen(true)} style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
          <Search size={15} color={colors.mutedForeground} />
          <Text style={{ flex: 1, fontSize: 13.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>Search by name or mobile…</Text>
        </TouchableOpacity>
      )}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }} onPress={() => setOpen(false)}>
          <Pressable onPress={() => {}} style={{ margin: 24, marginTop: 80, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, maxHeight: "70%" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Search size={16} color={colors.mutedForeground} />
              <TextInput autoFocus value={query} onChangeText={onType} placeholder="Name or mobile number…"
                placeholderTextColor={`${colors.mutedForeground}99`}
                style={{ flex: 1, fontSize: 14, fontFamily: fonts.body.regular, color: colors.foreground }} />
              {loading ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : null}
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              {results.length === 0 && query.trim().length >= 2 && !loading ? (
                <Text style={{ padding: 16, fontSize: 13, color: colors.mutedForeground, fontFamily: fonts.body.regular, textAlign: "center" }}>No customers found</Text>
              ) : null}
              {results.filter((r) => !excludeId || Number(r.Id) !== excludeId).map((r) => (
                <TouchableOpacity key={r.Id} onPress={() => pick(r)} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <User size={14} color={CRM} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 13.5, fontFamily: fonts.body.medium, color: colors.foreground }} numberOfLines={1}>{r.CustomerName}</Text>
                    <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }} numberOfLines={1}>{[r.CustomerNo, r.Mobile, r.PanNo].filter(Boolean).join(" · ")}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ── Resale / Buy-back dialog ─────────────────────────────────────────────────
// Opens from the booking detail's After-sales section (crm-resales create right).
// Sends POST /api/crm/resales/deal.
export function ResaleDealDialog({ bookingId, sellerId, onClose }: {
  bookingId: number;
  sellerId?: number;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<"Resale" | "BuyBack">("Resale");
  const [buyer, setBuyer] = useState<Row | null>(null);
  const [agreed, setAgreed] = useState("");
  const [fee, setFee] = useState("");
  const [tds, setTds] = useState("");
  const [bbGst, setBbGst] = useState("");
  const [stamp, setStamp] = useState("");
  const [resaleDate, setResaleDate] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (kind === "Resale" && !buyer) return toast.error("Choose the new buyer");
    if (!(parseFloat(agreed) > 0)) return toast.error(kind === "BuyBack" ? "Enter the buy-back price" : "Enter the agreed value");
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        FromBookingId: bookingId, Kind: kind, AgreedValue: parseFloat(agreed),
        ...(kind === "Resale" ? { ToCustomerId: buyer!.Id } : {}),
        ...(fee.trim() && kind === "Resale" ? { DeveloperFeeAmount: parseFloat(fee) } : {}),
        ...(tds.trim() && kind === "BuyBack" ? { TdsAmount: parseFloat(tds) } : {}),
        ...(bbGst.trim() && kind === "BuyBack" ? { BuyBackGstAmount: parseFloat(bbGst) } : {}),
        ...(stamp.trim() && kind === "BuyBack" ? { StampDutyAmount: parseFloat(stamp) } : {}),
        ...(resaleDate.trim() ? { ResaleDate: resaleDate } : {}),
        ...(notes.trim() ? { Notes: notes.trim() } : {}),
      };
      const r = await crmSend("/api/crm/resales/deal", "POST", body) as Row;
      toast.success(r?.message ?? "Case opened");
      onClose();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 16 }}>
        <View style={{ maxHeight: "92%", backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.border }}>
          <ScrollView contentContainerStyle={{ padding: 18, gap: 4 }} keyboardShouldPersistTaps="handled">
            <Text style={{ fontSize: 16, fontFamily: fonts.heading.bold, color: colors.foreground, marginBottom: 10 }}>Resale / Buy-back</Text>
            <Chips label="Type" options={["Resale", "BuyBack"] as const} value={kind} onChange={(v) => { setKind(v); setBuyer(null); }}
              labelOf={(v) => v === "BuyBack" ? "Buy-back (we buy it back)" : "Resale (new buyer)"} />
            {kind === "Resale" ? (
              <CustomerSearchPicker label="New buyer *" value={buyer} onChange={setBuyer} excludeId={sellerId} />
            ) : null}
            <NumberField label={kind === "BuyBack" ? "Buy-back price (₹) *" : "Agreed value (₹) *"} value={agreed} onChangeText={setAgreed} />
            {kind === "Resale" ? (
              <NumberField label="Developer fee (₹)" value={fee} onChangeText={setFee} />
            ) : (
              <>
                <NumberField label="TDS amount (₹)" value={tds} onChangeText={setTds} />
                <NumberField label="Buy-back GST (₹)" value={bbGst} onChangeText={setBbGst} />
                <NumberField label="Stamp duty (₹)" value={stamp} onChangeText={setStamp} />
              </>
            )}
            <DateField label="Transaction date" value={resaleDate} onChange={setResaleDate} />
            <RemarksField label="Notes" value={notes} onChangeText={setNotes} />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <ActionKey label="Close" outline tone={colors.mutedForeground} onPress={onClose} />
              <ActionKey label={busy ? "Opening…" : "Open case"} onPress={submit} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── Auto Project Setup ────────────────────────────────────────────────────────
// The web's Auto Project Setup page: company picker, project picker, then the status of blocks/units/plots.
// Navigation buttons go into the relevant setup registers so the user can create or fix items in-app.
// GET /api/business/dropdown, GET /api/crm/project-auto-setup/status?projectId=X.
export function CrmAutoProjectSetupScreen() {
  const nav = useNavigation<Nav>();
  const { canAccessPage } = useAuth();
  const bizQ = useQuery({ queryKey: ["business-dropdown"], staleTime: 5 * 60_000,
    queryFn: () => crmGet<{ companies: { id: number; name: string }[]; projects: { id: number; name: string; companyId: number }[] }>("/api/business/dropdown") });
  const companies: { id: number; name: string }[] = bizQ.data?.companies ?? [];
  const allProjects: { id: number; name: string; companyId: number }[] = bizQ.data?.projects ?? [];
  const [companyId, setCompanyId] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("");
  const [compPick, setCompPick] = useState(false);
  const [projPick, setProjPick] = useState(false);
  const projects = allProjects.filter((p) => !companyId || String(p.companyId) === companyId);
  const statusQ = useQuery({ queryKey: ["auto-setup-status", projectId], enabled: !!projectId,
    queryFn: () => crmGet<{ blocks: number; units: number; plots: number; blocksSetUp: number; unitsSetUp: number; plotsSetUp: number }>(`/api/crm/project-auto-setup/status?projectId=${projectId}`) });
  const st = statusQ.data;
  const goSetup = (register: string) => () => nav.navigate("CrmRegister", { register });
  const canManage = canAccessPage("crm-auto-project-setup");

  const statRow = (label: string, done: number | undefined, total: number | undefined, register: string) => (
    <View key={label} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border, gap: 10 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ fontSize: 14.5, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{label}</Text>
        {done != null && total != null ? (
          <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{done} of {total} set up</Text>
        ) : null}
      </View>
      {canManage ? (
        <TouchableOpacity onPress={goSetup(register)} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, backgroundColor: `${CRM}18`, borderWidth: 1, borderColor: `${CRM}40` }}>
          <Text style={{ fontSize: 12.5, fontFamily: fonts.heading.semibold, color: CRM }}>Manage</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Section title="Company & Project">
        <PickerRow label="Company" value={companies.find((c) => String(c.id) === companyId)?.name ?? ""}
          placeholder={bizQ.isLoading ? "Loading…" : "Select company (optional)"}
          onPress={() => setCompPick(true)} />
        <PickerRow label="Project" required value={allProjects.find((p) => String(p.id) === projectId)?.name ?? ""}
          placeholder={bizQ.isLoading ? "Loading…" : projects.length === 0 && companyId ? "No projects for this company" : "Select project"}
          onPress={() => setProjPick(true)} />
      </Section>

      {projectId ? (
        <Section title="Setup status">
          {statusQ.isLoading ? (
            <ActivityIndicator color={colors.mutedForeground} style={{ paddingVertical: 16 }} />
          ) : statusQ.isError ? (
            <Text style={{ fontSize: 12.5, color: colors.destructive }}>{(statusQ.error as Error).message || "Could not load status"}</Text>
          ) : st ? (
            <View style={{ borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
              {statRow("Blocks", st.blocksSetUp, st.blocks, "setup-blocks")}
              {statRow("Units", st.unitsSetUp, st.units, "setup-units")}
              {statRow("Plots", st.plotsSetUp, st.plots, "setup-plots")}
            </View>
          ) : null}
        </Section>
      ) : (
        <View style={{ alignItems: "center", paddingVertical: 32, gap: 8 }}>
          <Text style={{ fontSize: 14.5, fontFamily: fonts.heading.semibold, color: colors.foreground }}>Select a project to view its setup status</Text>
          <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, textAlign: "center", maxWidth: 300 }}>
            Then use the Manage buttons to open the setup registers for Blocks, Units, and Plots directly in the app.
          </Text>
        </View>
      )}

      <OptionPickerModal visible={compPick} searchable title="Company"
        options={[{ key: "", label: "All companies" }, ...companies.map((c) => ({ key: String(c.id), label: c.name }))]}
        selectedKey={companyId} onSelect={(k) => { setCompanyId(k ?? ""); setProjectId(""); setCompPick(false); }}
        onClose={() => setCompPick(false)} />
      <OptionPickerModal visible={projPick} searchable title="Project"
        options={projects.map((p) => ({ key: String(p.id), label: p.name }))}
        selectedKey={projectId} onSelect={(k) => { setProjectId(k ?? ""); setProjPick(false); }}
        onClose={() => setProjPick(false)} />
    </ScrollView>
  );
}

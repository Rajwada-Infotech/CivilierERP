// The CRM jobs staff do from the phone — each one the web's own form, sent to the same server route with the same
// fields, so the rules, rights and approvals stay the server's:
//   WelcomeCallScreen  log a welcome call (crmWelcomeCalls.js POST /) — the web's Welcome Calls "Log call"
//   PaymentScreen      a payment against a milestone (crmPayments.js PUT /:id) or an on-account deposit
//                      (POST /booking/:id/on-account) — both go to Finance, then the Directors, before they count
//   NewTicketScreen    raise a service ticket on a booking (crmServiceTickets.js POST /)
// NotePrompt is the small "why / what was done" box the ticket screen uses.
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Modal, Pressable, Text, TextInput, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Phone, Square } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { fetchWithAuth } from "@/services/fetchWithAuth";
import { getBookingPayments, type Row } from "@/api/crmApi";
import { createServiceTicket, getAssignableStaff, TICKET_CATEGORIES, TICKET_PRIORITIES, type TicketCategory, type TicketPriority } from "@/api/serviceTicketApi";
import { FormScaffold, FormSection, NumberField, RemarksField, TextField } from "@/components/form/Form";
import { DateField } from "@/components/form/DateField";
import { OptionPickerModal, PickerRow } from "@/components/OptionPicker";
import { statusText } from "@/components/list/DataList";
import { toast } from "@/components/Toast";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { OUTCOME_LABEL, WELCOME_OUTCOMES } from "./crmRegisters";
import { CRM, Empty, Kv, Section, money } from "./ui";

type Nav = NativeStackNavigationProp<MainStackParamList>;

/** Today, YYYY-MM-DD, where the person is (toISOString would give the UTC date, a day behind before 05:30 IST). */
const localDay = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

async function send(url: string, method: "POST" | "PUT", body: object): Promise<any> {
  const res = await fetchWithAuth(url, { method, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `The request could not be completed (${res.status}).`);
  return data;
}

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

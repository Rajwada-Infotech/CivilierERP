// Sale Deed workspace: view the booking's deed status, create a deed, schedule
// and complete the registry visit. Document uploads stay on the web (file size).
// Endpoints:
//   GET  /api/crm/sales-deed/booking/:id/context  — pre-flight context
//   GET  /api/crm/sales-deed/booking/:id/deed     — { Id, DeedNo } or null
//   GET  /api/crm/sales-deed/:id                  — full deed + docs + history
//   POST /api/crm/sales-deed                      — create deed
//   GET  /api/crm/sales-deed/registry/booking/:id — current registry
//   POST /api/crm/sales-deed/registry             — start registry tracker
//   PUT  /api/crm/sales-deed/registry/:id/schedule    — schedule appointment
//   PUT  /api/crm/sales-deed/registry/:id/reschedule  — reschedule
//   PUT  /api/crm/sales-deed/registry/:id/complete    — complete with reg details
import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { CalendarDays, FileText } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { crmGet, crmSend, type Row } from "@/api/crmApi";
import { toast } from "@/components/Toast";
import { TextField, RemarksField } from "@/components/form/Form";
import { DateField } from "@/components/form/DateField";
import { fonts } from "@/theme/fonts";
import { useBrand } from "@/theme/ThemeContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { ActionKey, Empty, Kv, Pill, Section, fmtDate, joinDot, money, words } from "./ui";

type DeedCtx = {
  booking: Row;
  agreement: Row | null;
  loanDetail: Row | null;
  loanBlockReason: string | null;
  existingDeed: Row | null;
  registryStatus: string | null;
  registryNo: string | null;
  registryScheduledDate: string | null;
  queryPaymentStatus: string | null;
  queryPaymentNo: string | null;
  queryPaymentConfirmedAmount: number | null;
  handoverStatus: string | null;
  projectType: string | null;
  requiresHandoverBeforeDeed: boolean;
};

const DEED_STEPS = [
  "Setup", "Legal executive", "Documents", "Senior approval",
  "Customer approval", "Director approval", "Stamp duty", "Execution", "Registered",
];

function StepsBar({ stepIndex }: { stepIndex: number }) {
  const b = useBrand();
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", gap: 3 }}>
        {DEED_STEPS.map((_, i) => (
          <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < stepIndex ? b.accent : i === stepIndex ? b.warning : b.border }} />
        ))}
      </View>
      <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>
        Step {stepIndex + 1} of {DEED_STEPS.length}: {DEED_STEPS[stepIndex] ?? "Complete"}
      </Text>
    </View>
  );
}

function CreateDeedForm({ bookingId, ctx, onCreated }: { bookingId: number; ctx: DeedCtx; onCreated: () => void }) {
  const b = useBrand();
  const agr = ctx.agreement;
  const [deedValue, setDeedValue] = useState("");
  const [stampDuty, setStampDuty] = useState("");
  const [registrationFee, setRegFee] = useState("");
  const [stampDutyCredit, setStampDutyCredit] = useState(
    agr?.AfsStampDuty ? String(agr.AfsStampDuty) : ""
  );
  const [deedDate, setDeedDate] = useState("");
  const [regDeadline, setRegDeadline] = useState("");
  const [subRegOffice, setSubRegOffice] = useState("");
  const [witnessNames, setWitnessNames] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!deedValue.trim()) return toast.error("Enter the Deed Value");
    if (!stampDuty.trim()) return toast.error("Enter the Stamp Duty");
    if (!registrationFee.trim()) return toast.error("Enter the Registration Fee");
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        BookingId: bookingId,
        DeedValue: parseFloat(deedValue),
        StampDuty: parseFloat(stampDuty),
        RegistrationFee: parseFloat(registrationFee),
      };
      if (agr?.Id) payload.AgreementId = Number(agr.Id);
      if (stampDutyCredit.trim()) payload.StampDutyCredit = parseFloat(stampDutyCredit);
      if (subRegOffice.trim()) payload.SubRegistrarOffice = subRegOffice.trim();
      if (deedDate) payload.DeedDate = deedDate;
      if (regDeadline) payload.RegistrationDeadline = regDeadline;
      if (witnessNames.trim()) payload.WitnessNames = witnessNames.trim();
      if (notes.trim()) payload.Notes = notes.trim();
      await crmSend("/api/crm/sales-deed", "POST", payload);
      toast.success("Sale deed created");
      onCreated();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Section title="New Sale Deed">
      <View style={{ gap: 12 }}>
        {agr ? <Kv label="Agreement" value={joinDot(agr.AgreementNo, agr.Status)} /> : null}
        <TextField label="Deed value (₹)" value={deedValue} onChangeText={setDeedValue} keyboardType="numeric" placeholder="e.g. 5000000" />
        <TextField label="Stamp duty (₹)" value={stampDuty} onChangeText={setStampDuty} keyboardType="numeric" placeholder="e.g. 250000" />
        <TextField label="Registration fee (₹)" value={registrationFee} onChangeText={setRegFee} keyboardType="numeric" placeholder="e.g. 30000" />
        {agr?.AfsStampDuty ? (
          <TextField label="AFS stamp duty credit (₹)" value={stampDutyCredit} onChangeText={setStampDutyCredit} keyboardType="numeric" />
        ) : null}
        <TextField label="Sub-Registrar Office (optional)" value={subRegOffice} onChangeText={setSubRegOffice} />
        <DateField label="Deed date (optional)" value={deedDate} onChange={setDeedDate} />
        <DateField label="Registration deadline (optional)" value={regDeadline} onChange={setRegDeadline} />
        <TextField label="Witness names (optional)" value={witnessNames} onChangeText={setWitnessNames} placeholder="Two witness names" />
        <RemarksField label="Notes (optional)" value={notes} onChangeText={setNotes} />
        <ActionKey label={busy ? "Creating…" : "Create Sale Deed"} onPress={submit} />
      </View>
    </Section>
  );
}

function ScheduleForm({ registryId, existing, onDone }: {
  registryId: number; existing?: { ScheduledDate?: string; AppointmentOffice?: string };
  onDone: () => void;
}) {
  const isReschedule = !!existing?.ScheduledDate;
  const [date, setDate] = useState(existing?.ScheduledDate?.slice(0, 10) ?? "");
  const [time, setTime] = useState("");
  const [office, setOffice] = useState(existing?.AppointmentOffice ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!date) return toast.error("Enter the appointment date");
    if (!office.trim()) return toast.error("Enter the Sub-Registrar Office");
    if (isReschedule && !reason.trim()) return toast.error("Enter the reason for rescheduling");
    setBusy(true);
    try {
      const path = isReschedule ? `/api/crm/sales-deed/registry/${registryId}/reschedule` : `/api/crm/sales-deed/registry/${registryId}/schedule`;
      const body: Record<string, unknown> = { ScheduledDate: date, AppointmentOffice: office.trim() };
      if (time.trim()) body.AppointmentTime = time.trim();
      if (isReschedule) body.Reason = reason.trim();
      await crmSend(path, "PUT", body);
      toast.success(isReschedule ? "Appointment rescheduled" : "Appointment scheduled");
      onDone();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <View style={{ gap: 12 }}>
      <DateField label="Appointment date" value={date} onChange={setDate} />
      <TextField label="Time (optional)" value={time} onChangeText={setTime} placeholder="e.g. 11:00 AM" />
      <TextField label="Sub-Registrar Office" value={office} onChangeText={setOffice} />
      {isReschedule ? <RemarksField label="Reason for rescheduling" value={reason} onChangeText={setReason} /> : null}
      <ActionKey label={busy ? "Saving…" : isReschedule ? "Confirm reschedule" : "Schedule appointment"} onPress={submit} />
    </View>
  );
}

function CompleteForm({ registryId, onDone }: { registryId: number; onDone: () => void }) {
  const [registrationNo, setRegNo] = useState("");
  const [registrationDate, setRegDate] = useState("");
  const [bookNo, setBookNo] = useState("");
  const [partNo, setPartNo] = useState("");
  const [subRegOffice, setSubRegOffice] = useState("");
  const [witnessNames, setWitnessNames] = useState("");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!registrationNo.trim()) return toast.error("Enter the Registration No.");
    if (!witnessNames.trim()) return toast.error("Enter the witness names (Registration Act requires two witnesses)");
    setBusy(true);
    try {
      await crmSend(`/api/crm/sales-deed/registry/${registryId}/complete`, "PUT", {
        RegistrationNo: registrationNo.trim(),
        RegistrationDate: registrationDate || undefined,
        BookNo: bookNo.trim() || undefined,
        PartNo: partNo.trim() || undefined,
        SubRegistrarOffice: subRegOffice.trim() || undefined,
        WitnessNames: witnessNames.trim(),
        BuyerAttended: true,
        SellerAttended: true,
        Remarks: remarks.trim() || undefined,
      });
      toast.success("Registry completed — deed is now Registered");
      onDone();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <View style={{ gap: 12 }}>
      <TextField label="Registration No." value={registrationNo} onChangeText={setRegNo} placeholder="e.g. 1234/2026" />
      <DateField label="Registration date (optional)" value={registrationDate} onChange={setRegDate} />
      <TextField label="Book No. (optional)" value={bookNo} onChangeText={setBookNo} />
      <TextField label="Part No. (optional)" value={partNo} onChangeText={setPartNo} />
      <TextField label="Sub-Registrar Office (optional)" value={subRegOffice} onChangeText={setSubRegOffice} />
      <TextField label="Witness names" value={witnessNames} onChangeText={setWitnessNames} placeholder="Two witness names required" />
      <RemarksField label="Remarks (optional)" value={remarks} onChangeText={setRemarks} />
      <ActionKey label={busy ? "Completing…" : "Mark Registry as Completed"} onPress={submit} />
    </View>
  );
}

export default function CrmSaleDeedScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmSaleDeed">>();
  const { bookingId } = params;
  const { canDoAction, canAccessPage } = useAuth();
  const b = useBrand();
  const qc = useQueryClient();

  const canCreate = canDoAction("crm-sales-deed", "create");
  const canEdit = canDoAction("crm-sales-deed", "edit");
  const canRegistry = canAccessPage("crm-registry") || canEdit;

  const ctxQ = useQuery<DeedCtx>({
    queryKey: ["crm-deed-ctx", bookingId],
    queryFn: () => crmGet(`/api/crm/sales-deed/booking/${bookingId}/context`),
  });

  const deedRefQ = useQuery<{ Id: number; DeedNo: string } | null>({
    queryKey: ["crm-deed-ref", bookingId],
    queryFn: () => crmGet(`/api/crm/sales-deed/booking/${bookingId}/deed`),
    enabled: !!ctxQ.data,
  });

  const deedQ = useQuery<Row>({
    queryKey: ["crm-deed-detail", deedRefQ.data?.Id],
    queryFn: () => crmGet(`/api/crm/sales-deed/${deedRefQ.data!.Id}`),
    enabled: !!deedRefQ.data?.Id,
  });

  const registryQ = useQuery<Row | null>({
    queryKey: ["crm-registry-booking", bookingId],
    queryFn: () => crmGet(`/api/crm/sales-deed/registry/booking/${bookingId}`),
    enabled: !!ctxQ.data,
  });

  const [showSchedule, setShowSchedule] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const [busyReg, setBusyReg] = useState(false);

  const invalidate = () => {
    ["crm-deed-ctx", "crm-deed-ref", "crm-registry-booking", "crm-booking-legal-mil", "crm-booking"].forEach((k) =>
      qc.invalidateQueries({ queryKey: [k, bookingId] })
    );
    if (deedRefQ.data?.Id) qc.invalidateQueries({ queryKey: ["crm-deed-detail", deedRefQ.data.Id] });
  };

  const startRegistry = async () => {
    setBusyReg(true);
    try {
      await crmSend("/api/crm/sales-deed/registry", "POST", { BookingId: bookingId });
      toast.success("Registry tracker started");
      invalidate();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusyReg(false); }
  };

  const loading = ctxQ.isLoading;

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: b.surface }}>
        <ActivityIndicator color={b.accent} />
      </View>
    );
  }
  if (ctxQ.error || !ctxQ.data) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: b.surface, padding: 24 }}>
        <Text style={{ color: b.danger, fontFamily: fonts.body.medium, textAlign: "center" }}>
          {(ctxQ.error as Error | null)?.message || "Could not load sale deed details."}
        </Text>
      </View>
    );
  }

  const ctx = ctxQ.data;
  const deed = deedQ.data;
  const registry = registryQ.data;
  const stepIndex = deed ? (Number(deed.StepIndex) ?? 0) : -1;

  // Pre-condition notices
  const agrStatus = ctx.agreement?.Status;
  const agrRegistered = agrStatus === "Registered";
  const notices: string[] = [];
  if (!agrRegistered) notices.push(`Agreement must be Registered before creating a Sale Deed (currently: ${agrStatus || "none"})`);
  if (ctx.requiresHandoverBeforeDeed && ctx.handoverStatus !== "Completed") notices.push("Handover must be Completed before the Sale Deed for this under-construction project");
  if (ctx.loanBlockReason) notices.push(`Loan processing: ${ctx.loanBlockReason}`);

  const qpConfirmed = ctx.queryPaymentStatus === "Confirmed";
  const hasRegistry = !!registry;
  const regStatus = registry?.Status as string | undefined;
  const regScheduled = regStatus === "Scheduled";
  const regCompleted = regStatus === "Completed";

  return (
    <ScrollView style={{ flex: 1, backgroundColor: b.surface }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 56 }}>
      {/* Pre-condition notices */}
      {notices.length > 0 ? (
        <View style={{ gap: 8 }}>
          {notices.map((n, i) => (
            <View key={i} style={{ backgroundColor: b.warningSoft, borderRadius: 12, padding: 12, flexDirection: "row", gap: 8 }}>
              <FileText size={15} color={b.warning} style={{ marginTop: 1 }} />
              <Text style={{ flex: 1, fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textPrimary }}>{n}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Deed overview */}
      {deed ? (
        <Section title="Sale Deed">
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{deed.DeedNo}</Text>
              <Pill label={deed.Status || "Draft"} />
            </View>
            {stepIndex >= 0 && stepIndex < DEED_STEPS.length ? <StepsBar stepIndex={stepIndex} /> : null}
            {deed.DeedDate ? <Kv label="Deed date" value={fmtDate(deed.DeedDate)} /> : null}
            {deed.RegistrationDeadline ? <Kv label="Registration deadline" value={fmtDate(deed.RegistrationDeadline)} /> : null}
            {deed.DeedValue ? <Kv label="Deed value" value={money(deed.DeedValue)} /> : null}
            {deed.StampDuty ? <Kv label="Stamp duty" value={money(deed.StampDuty)} /> : null}
            {deed.RegistrationFee ? <Kv label="Registration fee" value={money(deed.RegistrationFee)} /> : null}
            {deed.StampDutyCredit ? <Kv label="AFS stamp duty credit" value={money(deed.StampDutyCredit)} /> : null}
            {deed.SubRegistrarOffice ? <Kv label="Sub-Registrar Office" value={deed.SubRegistrarOffice as string} /> : null}
            {deed.LegalExecutiveName ? <Kv label="Legal executive" value={deed.LegalExecutiveName as string} /> : null}
            {deed.SeniorApprovalStatus ? <Kv label="Senior approval" value={words(deed.SeniorApprovalStatus as string)} /> : null}
            {deed.CustomerApprovalStatus ? <Kv label="Customer approval" value={words(deed.CustomerApprovalStatus as string)} /> : null}
            {deed.DirectorApprovalStatus ? <Kv label="Director approval" value={words(deed.DirectorApprovalStatus as string)} /> : null}
            {deed.ExecutedBy ? <Kv label="Executed by" value={deed.ExecutedBy as string} /> : null}
            {deed.RegistrationNo ? <Kv label="Registration No." value={deed.RegistrationNo as string} /> : null}
            {deed.RegistrationDate ? <Kv label="Registration date" value={fmtDate(deed.RegistrationDate)} /> : null}
            {(deed.MandatoryDocCount as number) > 0 ? (
              <Kv label="Documents" value={`${deed.MandatoryUploadedCount}/${deed.MandatoryDocCount} uploaded — manage on web`} />
            ) : null}
          </View>
        </Section>
      ) : (
        !deedRefQ.isLoading && (
          canCreate && agrRegistered && !ctx.requiresHandoverBeforeDeed ? (
            <CreateDeedForm bookingId={bookingId} ctx={ctx} onCreated={invalidate} />
          ) : (
            <Empty text="No sale deed yet." />
          )
        )
      )}

      {/* Stamp duty (Query Payment) */}
      {ctx.queryPaymentNo || ctx.queryPaymentStatus ? (
        <Section title="Stamp Duty Payment">
          <Kv label="Payment ref." value={joinDot(ctx.queryPaymentNo, ctx.queryPaymentStatus)} />
          {ctx.queryPaymentConfirmedAmount ? <Kv label="Confirmed amount" value={money(ctx.queryPaymentConfirmedAmount)} /> : null}
          {!qpConfirmed ? (
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textSecondary, marginTop: 4 }}>
              Stamp duty and registration fee must be confirmed before starting the registry visit.
            </Text>
          ) : null}
        </Section>
      ) : deed && !qpConfirmed ? (
        <Section title="Stamp Duty Payment">
          <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>
            No stamp duty payment recorded yet. Raise and confirm the query payment on the web before proceeding to registry.
          </Text>
        </Section>
      ) : null}

      {/* Registry tracker */}
      {qpConfirmed && deed ? (
        <Section title="Registry Visit">
          {hasRegistry ? (
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 13.5, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{(registry as Row).RegNo}</Text>
                <Pill label={regStatus ?? "Pending"} />
              </View>
              {(registry as Row).ScheduledDate ? (
                <Kv label="Appointment" value={joinDot(fmtDate((registry as Row).ScheduledDate), (registry as Row).AppointmentTime as string | null, (registry as Row).AppointmentOffice as string | null)} />
              ) : null}
              {(registry as Row).RegistrationNo ? <Kv label="Registration No." value={(registry as Row).RegistrationNo as string} /> : null}
              {(registry as Row).RegistrationDate ? <Kv label="Registration date" value={fmtDate((registry as Row).RegistrationDate)} /> : null}
              {(registry as Row).WitnessNames ? <Kv label="Witnesses" value={(registry as Row).WitnessNames as string} /> : null}

              {!regCompleted && canEdit ? (
                <>
                  {!showSchedule && !showComplete ? (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                      <ActionKey
                        label={regScheduled ? "Reschedule" : "Schedule appointment"}
                        icon={CalendarDays}
                        outline={regScheduled}
                        onPress={() => setShowSchedule(true)}
                      />
                      {regScheduled ? (
                        <ActionKey label="Complete registry" onPress={() => setShowComplete(true)} />
                      ) : null}
                    </View>
                  ) : null}
                  {showSchedule ? (
                    <View style={{ gap: 8 }}>
                      <ScheduleForm
                        registryId={Number((registry as Row).Id)}
                        existing={regScheduled ? { ScheduledDate: (registry as Row).ScheduledDate as string, AppointmentOffice: (registry as Row).AppointmentOffice as string } : undefined}
                        onDone={() => { setShowSchedule(false); invalidate(); }}
                      />
                      <ActionKey outline label="Cancel" onPress={() => setShowSchedule(false)} />
                    </View>
                  ) : null}
                  {showComplete ? (
                    <View style={{ gap: 8 }}>
                      <CompleteForm
                        registryId={Number((registry as Row).Id)}
                        onDone={() => { setShowComplete(false); invalidate(); }}
                      />
                      <ActionKey outline label="Cancel" onPress={() => setShowComplete(false)} />
                    </View>
                  ) : null}
                </>
              ) : null}
            </View>
          ) : (
            canRegistry ? (
              <View style={{ gap: 10 }}>
                <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>
                  Stamp duty confirmed. Start the registry tracker to record the Sub-Registrar Office visit.
                </Text>
                <ActionKey label={busyReg ? "Starting…" : "Start registry tracker"} onPress={startRegistry} />
              </View>
            ) : (
              <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>
                Stamp duty confirmed — a registry tracker can be started once you have registry edit rights.
              </Text>
            )
          )}
        </Section>
      ) : null}
    </ScrollView>
  );
}

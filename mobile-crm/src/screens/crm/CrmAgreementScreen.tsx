// Agreement workspace: view the agreement for a booking, run it through its lifecycle, and
// draft one if none exists. The web's CRM Agreement page, its core workflow:
//   Draft → submit → Senior approval → send to customer → customer approves → date agreed
//   → mark executed → AFS registry done → mark registered
// Includes proxy customer approval & rework, proxy date accept, and eligible booking selection.
import { useState } from "react";
import { ActivityIndicator, Modal, ScrollView, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { Check, Users } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { crmGet, crmSend, type Row } from "@/api/crmApi";
import { TextField, NumberField, RemarksField } from "@/components/form/Form";
import { DateField } from "@/components/form/DateField";
import { OptionPickerModal, PickerRow } from "@/components/OptionPicker";
import { toast } from "@/components/Toast";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { ActionKey, CRM, Empty, Kv, Pill, Section, fmtDate, joinDot, money, words } from "./ui";

type Params = RouteProp<MainStackParamList, "CrmAgreement">;

const AGR_STEPS: { key: string; label: string }[] = [
  { key: "D_agrInit",     label: "Drafted" },
  { key: "D_agrLegal",    label: "Legal assigned" },
  { key: "D_agrPapers",   label: "Documents" },
  { key: "D_agrSenior",   label: "Internal approval" },
  { key: "D_agrSent",     label: "Sent to customer" },
  { key: "D_agrCustomer", label: "Customer approved" },
  { key: "D_agrDate",     label: "Date confirmed" },
  { key: "D_agrExecuted", label: "Executed" },
  { key: "D_agrRegistered", label: "Registered" },
];

function StepsBar({ agr }: { agr: Row }) {
  const done = AGR_STEPS.filter((s) => agr[s.key] === 1).length;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", gap: 3 }}>
        {AGR_STEPS.map((s) => {
          const isDone = agr[s.key] === 1;
          return (
            <View key={s.key} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: isDone ? "#10b981" : colors.border }} />
          );
        })}
      </View>
      <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>
        {`${done} of ${AGR_STEPS.length} steps done`}
      </Text>
    </View>
  );
}

function MarkRegisteredModal({ agreementId, onClose, onDone }: { agreementId: number; onClose: () => void; onDone: () => void }) {
  const [regNo, setRegNo] = useState("");
  const [regDate, setRegDate] = useState("");
  const [stampDuty, setStampDuty] = useState("");
  const [regFee, setRegFee] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!regNo.trim()) return toast.error("Enter the registration number from the Sub-Registrar");
    if (!regDate) return toast.error("Enter the registration date");
    setBusy(true);
    try {
      await crmSend(`/api/crm/agreements/${agreementId}/mark-registered`, "PUT", {
        AfsRegistrationNo: regNo.trim(), AfsRegistrationDate: regDate,
        ...(stampDuty.trim() ? { AfsStampDuty: parseFloat(stampDuty) } : {}),
        ...(regFee.trim() ? { AfsRegistrationFee: parseFloat(regFee) } : {}),
      });
      toast.success("Agreement marked as Registered");
      onDone();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 16 }}>
        <View style={{ backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.border }}>
          <ScrollView contentContainerStyle={{ padding: 18, gap: 4 }} keyboardShouldPersistTaps="handled">
            <Text style={{ fontSize: 16, fontFamily: fonts.heading.bold, color: colors.foreground, marginBottom: 6 }}>Mark as Registered</Text>
            <TextField label="Registration no. (Sub-Registrar) *" value={regNo} onChangeText={setRegNo} />
            <DateField label="Registration date *" value={regDate} onChange={setRegDate} />
            <NumberField label="Stamp duty (₹)" value={stampDuty} onChangeText={setStampDuty} />
            <NumberField label="Registration fee (₹)" value={regFee} onChangeText={setRegFee} />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <ActionKey label="Cancel" outline tone={colors.mutedForeground} onPress={onClose} />
              <ActionKey label={busy ? "Saving…" : "Mark Registered"} onPress={submit} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ProposeDateModal({ agreementId, onClose, onDone }: { agreementId: number; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!date) return toast.error("Choose a proposed signing date");
    setBusy(true);
    try {
      await crmSend(`/api/crm/agreements/${agreementId}/propose-date`, "PUT", { ProposedDate: date });
      toast.success("Signing date proposed — waiting for the customer to respond on Civilier Home");
      onDone();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 16 }}>
        <View style={{ backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 18, gap: 10 }}>
          <Text style={{ fontSize: 16, fontFamily: fonts.heading.bold, color: colors.foreground }}>Propose signing date</Text>
          <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>
            The customer confirms (or rejects) this on Civilier Home. Once both sides match, it goes for Date Approval.
          </Text>
          <DateField label="Proposed date *" value={date} onChange={setDate} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <ActionKey label="Cancel" outline tone={colors.mutedForeground} onPress={onClose} />
            <ActionKey label={busy ? "Proposing…" : "Propose date"} onPress={submit} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function CreateAgreementModal({ bookingId, onClose, onDone }: { bookingId: number; onClose: () => void; onDone: () => void }) {
  const [legalName, setLegalName] = useState("");
  const [legalAddress, setLegalAddress] = useState("");
  const [panNo, setPanNo] = useState("");
  const [aadhaarNo, setAadhaarNo] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await crmSend("/api/crm/agreements", "POST", {
        BookingId: bookingId,
        ...(legalName.trim() ? { LegalName: legalName.trim() } : {}),
        ...(legalAddress.trim() ? { LegalAddress: legalAddress.trim() } : {}),
        ...(panNo.trim() ? { PanNo: panNo.trim().toUpperCase() } : {}),
        ...(aadhaarNo.trim() ? { AadhaarNo: aadhaarNo.trim() } : {}),
        ...(notes.trim() ? { Notes: notes.trim() } : {}),
      });
      toast.success("Agreement drafted");
      onDone();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 16 }}>
        <View style={{ maxHeight: "90%", backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.border }}>
          <ScrollView contentContainerStyle={{ padding: 18, gap: 4 }} keyboardShouldPersistTaps="handled">
            <Text style={{ fontSize: 16, fontFamily: fonts.heading.bold, color: colors.foreground, marginBottom: 4 }}>Draft agreement</Text>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginBottom: 8 }}>
              All fields are optional — the server pre-fills from the customer's KYC on file. Fill only where the legal name or PAN differs.
            </Text>
            <TextField label="Legal name" value={legalName} onChangeText={setLegalName} />
            <RemarksField label="Legal address" value={legalAddress} onChangeText={setLegalAddress} />
            <TextField label="PAN" value={panNo} onChangeText={setPanNo} autoCapitalize="characters" />
            <TextField label="Aadhaar no." value={aadhaarNo} onChangeText={setAadhaarNo} keyboardType="numeric" />
            <RemarksField label="Notes" value={notes} onChangeText={setNotes} />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <ActionKey label="Cancel" outline tone={colors.mutedForeground} onPress={onClose} />
              <ActionKey label={busy ? "Drafting…" : "Draft agreement"} onPress={submit} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export default function CrmAgreementScreen() {
  const { params } = useRoute<Params>();
  const initialBookingId = params?.bookingId;
  const [selectedBookingId, setSelectedBookingId] = useState<number | null>(initialBookingId ?? null);
  const [showBookingPicker, setShowBookingPicker] = useState(false);

  const { canAccessPage, canDoAction } = useAuth();
  const qc = useQueryClient();
  const seesAgr = canAccessPage("crm-agreements");
  const canEditAgr = canDoAction("crm-agreements", "edit");
  const canCreateAgr = canDoAction("crm-agreements", "create");

  // Eligible bookings for when opening Draft Agreement without pre-set bookingId
  const eligibleQ = useQuery<Row[]>({
    queryKey: ["crm-agreements-eligible-bookings"],
    queryFn: () => crmGet<Row[]>("/api/crm/agreements/eligible-bookings").then((d) => (Array.isArray(d) ? d : [])),
    enabled: seesAgr && canCreateAgr && selectedBookingId == null,
  });

  const activeBookingId = selectedBookingId;

  const q = useQuery<Row | null>({
    queryKey: ["crm-agreement-booking", activeBookingId],
    enabled: seesAgr && activeBookingId != null,
    queryFn: () => crmGet<Row | null>(`/api/crm/agreements/booking/${activeBookingId!}`),
  });
  const agr = q.data ?? null;

  const [showCreate, setShowCreate] = useState(false);
  const [showPropose, setShowPropose] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [showRework, setShowRework] = useState(false);
  const [reworkRemarks, setReworkRemarks] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () => {
    if (activeBookingId) {
      qc.invalidateQueries({ queryKey: ["crm-agreement-booking", activeBookingId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    }
  };

  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try { await fn(); toast.success(done); refresh(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); }
  };

  if (!seesAgr) return (
    <View style={{ flex: 1, backgroundColor: colors.background, padding: 16 }}>
      <Empty text="You don't have a right on Agreements." />
    </View>
  );

  // If no booking is selected yet, offer the eligible booking picker
  if (!activeBookingId) {
    const eligible = eligibleQ.data ?? [];
    const options = eligible.map((e) => ({
      key: String(e.Id),
      label: `${e.ApplicantName} (${e.BookingNo})`,
      sublabel: e.UnitNo ? `Unit ${e.UnitNo}` : undefined,
    }));

    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Section title="Draft Agreement">
          <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>
            Select a live booking that does not have an agreement to draft one.
          </Text>
          <PickerRow
            label="Eligible Booking"
            required
            value=""
            placeholder={eligibleQ.isLoading ? "Loading eligible bookings…" : "Choose a booking…"}
            onPress={() => setShowBookingPicker(true)}
          />
        </Section>

        <OptionPickerModal
          visible={showBookingPicker}
          title="Select Booking for Agreement"
          options={options}
          searchable
          onSelect={(k) => {
            setSelectedBookingId(Number(k));
            setShowBookingPicker(false);
            setShowCreate(true);
          }}
          onClose={() => setShowBookingPicker(false)}
        />
      </ScrollView>
    );
  }

  if (q.isLoading) return (
    <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator color={CRM} />
    </View>
  );

  if (q.error) return (
    <View style={{ flex: 1, backgroundColor: colors.background, padding: 16 }}>
      <Text style={{ color: colors.destructive, fontSize: 13, fontFamily: fonts.body.regular }}>{(q.error as Error).message}</Text>
    </View>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 96 }}>
      {!agr ? (
        <Section title="Agreement">
          <Empty text="No agreement has been drafted for this booking yet." />
          {canCreateAgr ? (
            <View style={{ flexDirection: "row", marginTop: 12 }}>
              <ActionKey label="Draft agreement" onPress={() => setShowCreate(true)} />
            </View>
          ) : null}
        </Section>
      ) : (
        <>
          {/* Status + steps */}
          <Section title="Agreement">
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <View>
                <Text style={{ fontSize: 17, fontFamily: fonts.heading.bold, color: colors.foreground }}>{agr.AgreementNo}</Text>
                <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 2 }}>
                  {joinDot(agr.ProjectName, agr.UnitNo)}
                </Text>
              </View>
              <Pill label={words(agr.Status)} tone={agr.Status === "Executed" || agr.Status === "Registered" ? "#10b981" : agr.Status === "Draft" ? undefined : "#f59e0b"} />
            </View>
            <StepsBar agr={agr} />
          </Section>

          {/* Key details */}
          <Section title="Details">
            {agr.LegalName || agr.ApplicantName ? <Kv label="Legal name" value={agr.LegalName || agr.ApplicantName} /> : null}
            {agr.PanNo || agr.CustomerPanNo ? <Kv label="PAN" value={agr.PanNo || agr.CustomerPanNo} /> : null}
            {agr.AadhaarNo || agr.CustomerAadhaarNo ? <Kv label="Aadhaar" value={agr.AadhaarNo || agr.CustomerAadhaarNo} /> : null}
            {agr.LegalExecutiveName ? <Kv label="Legal executive" value={agr.LegalExecutiveName} /> : null}
            {agr.AgreementDate ? <Kv label="Agreement date" value={fmtDate(agr.AgreementDate)} /> : null}
            {agr.ProposedDate ? <Kv label="Proposed signing date" value={joinDot(fmtDate(agr.ProposedDate), words(agr.ProposedDateStatus))} /> : null}
            {agr.SentToCustomerAt ? <Kv label="Sent to customer" value={fmtDate(agr.SentToCustomerAt)} /> : null}
            {agr.SeniorApprovalStatus ? <Kv label="Senior approval" value={words(agr.SeniorApprovalStatus)} /> : null}
            {agr.CustomerApprovalStatus ? <Kv label="Customer response" value={words(agr.CustomerApprovalStatus)} /> : null}
            {agr.AfsRegistrationNo ? <Kv label="AFS reg. no." value={joinDot(agr.AfsRegistrationNo, fmtDate(agr.AfsRegistrationDate))} /> : null}
            {Number(agr.AfsStampDuty) > 0 ? <Kv label="Stamp duty / reg. fee" value={joinDot(money(agr.AfsStampDuty), money(agr.AfsRegistrationFee))} /> : null}
            {agr.DocumentCount != null ? <Kv label="Documents" value={`${agr.MandatoryUploadedCount}/${agr.MandatoryDocCount} mandatory uploaded`} /> : null}
            {agr.Notes ? <Kv label="Notes" value={agr.Notes} /> : null}
          </Section>

          {/* Approval trail */}
          {agr.LastRecheckRemarks ? (
            <Section title="Last recheck note">
              <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: colors.foreground }}>{agr.LastRecheckRemarks}</Text>
            </Section>
          ) : null}

          {/* Actions */}
          {canEditAgr && agr.Status === "Draft" ? (
            <Section title="Actions">
              <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginBottom: 10 }}>
                Submit once a legal executive is assigned and all mandatory documents are uploaded.
              </Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <ActionKey label={busy === "submit" ? "Submitting…" : "Submit for approval"}
                  onPress={() => act("submit", () => crmSend(`/api/crm/agreements/${agr.Id}/submit`, "PUT", {}), "Submitted for approval")} />
              </View>
            </Section>
          ) : null}

          {canEditAgr && agr.SeniorApprovalStatus === "Approved" && !agr.SentToCustomerAt ? (
            <Section title="Actions">
              <View style={{ flexDirection: "row", gap: 8 }}>
                <ActionKey label={busy === "send" ? "Sending…" : "Send to customer"}
                  onPress={() => act("send", () => crmSend(`/api/crm/agreements/${agr.Id}/send-to-customer`, "PUT", {}), "Agreement sent to customer on Civilier Home")} />
              </View>
            </Section>
          ) : null}

          {/* Customer approval & rework */}
          {canEditAgr && agr.SentToCustomerAt && agr.CustomerApprovalStatus !== "Approved" ? (
            <Section title="Customer Actions">
              <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginBottom: 10 }}>
                If the customer confirmed offline, record approval or rework on their behalf.
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <ActionKey
                  label={busy === "proxy-approve" ? "Approving…" : "Proxy Customer Approval"}
                  onPress={() => act("proxy-approve", () => crmSend(`/api/crm/agreements/${agr.Id}/proxy-customer-approve`, "PUT", {}), "Customer approval recorded")}
                />
                {!showRework ? (
                  <ActionKey
                    outline
                    tone={colors.destructive}
                    label="Customer requested rework"
                    onPress={() => setShowRework(true)}
                  />
                ) : null}
              </View>

              {showRework ? (
                <View style={{ gap: 8, marginTop: 8 }}>
                  <RemarksField label="Customer's rework comments" value={reworkRemarks} onChangeText={setReworkRemarks} />
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <ActionKey
                      tone={colors.destructive}
                      label={busy === "proxy-rework" ? "Saving…" : "Confirm rework"}
                      onPress={async () => {
                        await act("proxy-rework", () => crmSend(`/api/crm/agreements/${agr.Id}/proxy-customer-recheck`, "PUT", { Remarks: reworkRemarks }), "Rework requested");
                        setShowRework(false);
                      }}
                    />
                    <ActionKey outline label="Cancel" onPress={() => setShowRework(false)} />
                  </View>
                </View>
              ) : null}
            </Section>
          ) : null}

          {/* Signing date */}
          {canEditAgr && agr.SentToCustomerAt && !agr.AgreementDate ? (
            <Section title="Signing Date">
              <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginBottom: 10 }}>
                Propose a signing date — the customer responds on Civilier Home. Once both sides match, it goes for Date Approval.
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <ActionKey label="Propose signing date" outline onPress={() => setShowPropose(true)} />
                {agr.ProposedDate && agr.ProposedDateStatus !== "Agreed" ? (
                  <ActionKey
                    label={busy === "proxy-date" ? "Accepting…" : "Proxy Accept Date"}
                    onPress={() => act("proxy-date", () => crmSend(`/api/crm/agreements/${agr.Id}/proxy-date-accept`, "PUT", {}), "Proposed date accepted")}
                  />
                ) : null}
              </View>
            </Section>
          ) : null}

          {canEditAgr && agr.Status === "Draft" && agr.AgreementDate && agr.CustomerApprovalStatus === "Approved" ? (
            <Section title="Actions">
              <View style={{ flexDirection: "row", gap: 8 }}>
                <ActionKey label={busy === "execute" ? "Marking…" : "Mark as Executed"}
                  onPress={() => act("execute", () => crmSend(`/api/crm/agreements/${agr.Id}/mark-executed`, "PUT", {}), "Agreement marked as Executed")} />
              </View>
            </Section>
          ) : null}

          {canEditAgr && agr.Status === "Executed" ? (
            <Section title="Actions">
              <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginBottom: 10 }}>
                The AFS Registry tracker must be completed before you can mark it registered.
              </Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <ActionKey label="Mark as Registered" onPress={() => setShowRegister(true)} />
              </View>
            </Section>
          ) : null}
        </>
      )}

      {showCreate ? <CreateAgreementModal bookingId={activeBookingId} onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); refresh(); }} /> : null}
      {agr && showPropose ? <ProposeDateModal agreementId={Number(agr.Id)} onClose={() => setShowPropose(false)} onDone={() => { setShowPropose(false); refresh(); }} /> : null}
      {agr && showRegister ? <MarkRegisteredModal agreementId={Number(agr.Id)} onClose={() => setShowRegister(false)} onDone={() => { setShowRegister(false); refresh(); }} /> : null}
    </ScrollView>
  );
}

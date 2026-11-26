// NOC (No Objection Certificate) lifecycle screen.
// Context: GET /api/crm/noc/booking/:bookingId/context → { booking, agreement, existingNocs, loanDetail }
// Create: POST /api/crm/noc; submit/approve/reject/mark-issued via PUT /:id/<action>
// Edit notes: PUT /api/crm/noc/:id
import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Building2, CheckCircle2, FileText, Landmark, PenLine, ShieldCheck, XCircle } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { crmGet, crmSend, type Row } from "@/api/crmApi";
import { toast } from "@/components/Toast";
import { TextField, RemarksField } from "@/components/form/Form";
import { DateField } from "@/components/form/DateField";
import { OptionPickerModal, PickerRow } from "@/components/OptionPicker";
import { fonts } from "@/theme/fonts";
import { useBrand } from "@/theme/ThemeContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { ActionKey, Empty, Kv, Pill, Section, fmtDate, joinDot, money, words } from "./ui";

type Ctx = {
  booking: Row;
  agreement: Row | null;
  existingNocs: Row[];
  loanDetail: Row | null;
};

interface EligibleBooking {
  Id: number;
  BookingNo: string;
  UnitNo?: string | null;
  ApplicantName: string;
  NocType: string;
  HasLoan: number;
}

const STATUS_COLOR: Record<string, string> = {
  Pending: "#f59e0b",
  Approved: "#10b981",
  Issued: "#10b981",
  Rejected: "#ef4444",
};

function NocCard({
  noc,
  canEdit,
  onAction,
  onEditNotes,
  busy,
}: {
  noc: Row;
  canEdit: boolean;
  onAction: (action: "submit" | "approve" | "reject" | "mark-issued", note?: string) => Promise<void>;
  onEditNotes: (notes: string) => Promise<void>;
  busy: boolean;
}) {
  const b = useBrand();
  const [rejectNote, setRejectNote] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [showEditNotes, setShowEditNotes] = useState(false);
  const [editNotesText, setEditNotesText] = useState(String(noc.Notes ?? ""));

  const tone = STATUS_COLOR[noc.Status] ?? b.textSecondary;
  const isPending = noc.Status === "Pending";
  const isApproved = noc.Status === "Approved";
  const isIssued = noc.Status === "Issued";

  return (
    <View style={{ backgroundColor: b.surfaceCard, borderRadius: 14, padding: 16, gap: 10, borderWidth: 1, borderColor: b.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{noc.NocNo || "NOC"}</Text>
        <Pill label={noc.Status} />
      </View>
      <Kv label="Type" value={words(noc.NocType)} />
      {noc.NocDate ? <Kv label="NOC date" value={fmtDate(noc.NocDate)} /> : null}
      {noc.BankName ? <Kv label="Bank" value={joinDot(noc.BankName, noc.LoanAccountNo)} /> : null}
      {noc.LoanAmount ? <Kv label="Loan amount" value={money(noc.LoanAmount)} /> : null}
      {noc.ApprovalDate ? <Kv label="Approval date" value={fmtDate(noc.ApprovalDate)} /> : null}
      {noc.IssuedDate ? <Kv label="Issued date" value={fmtDate(noc.IssuedDate)} /> : null}
      {noc.Reason ? <Kv label="Reason" value={noc.Reason} /> : null}
      {noc.Notes ? <Kv label="Notes" value={noc.Notes} /> : null}

      {/* Action buttons */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
        {canEdit && isPending && !noc.SubmittedAt ? (
          <ActionKey label={busy ? "Submitting…" : "Submit for approval"} onPress={() => onAction("submit")} />
        ) : null}

        {canEdit && isPending && noc.SubmittedAt ? (
          <>
            <ActionKey label={busy && !showReject ? "Approving…" : "Approve"} onPress={() => onAction("approve")} />
            <ActionKey outline tone="#ef4444" label="Reject" onPress={() => setShowReject(true)} />
          </>
        ) : null}

        {canEdit && isApproved ? (
          <ActionKey label={busy ? "Marking…" : "Mark as Issued"} onPress={() => onAction("mark-issued")} />
        ) : null}

        {canEdit && !isIssued ? (
          <ActionKey
            outline
            label="Edit Notes"
            onPress={() => {
              setEditNotesText(String(noc.Notes ?? ""));
              setShowEditNotes(true);
            }}
          />
        ) : null}
      </View>

      {/* Reject sheet */}
      {showReject ? (
        <View style={{ gap: 8, marginTop: 6 }}>
          <RemarksField label="Rejection note (optional)" value={rejectNote} onChangeText={setRejectNote} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <ActionKey tone="#ef4444" label={busy ? "Rejecting…" : "Confirm reject"} onPress={() => { onAction("reject", rejectNote); setShowReject(false); }} />
            <ActionKey outline label="Cancel" onPress={() => setShowReject(false)} />
          </View>
        </View>
      ) : null}

      {/* Edit Notes sheet */}
      {showEditNotes ? (
        <View style={{ gap: 8, marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: b.border }}>
          <RemarksField label="Edit notes" value={editNotesText} onChangeText={setEditNotesText} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <ActionKey
              label={busy ? "Saving…" : "Save Notes"}
              onPress={async () => {
                await onEditNotes(editNotesText);
                setShowEditNotes(false);
              }}
            />
            <ActionKey outline label="Cancel" onPress={() => setShowEditNotes(false)} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function CreateNocForm({ bookingId, ctx, onCreated }: { bookingId: number; ctx: Ctx; onCreated: () => void }) {
  const loan = ctx.loanDetail;
  const isBank = !!(loan && (loan.FinancingType === "Bank" || loan.BankName));
  const [nocDate, setNocDate] = useState("");
  const [reason, setReason] = useState("");
  const [bankName, setBankName] = useState((loan?.BankName as string) || "");
  const [loanAccNo, setLoanAccNo] = useState((loan?.LoanAccountNumber as string) || (loan?.LoanAccountNo as string) || "");
  const [loanAmount, setLoanAmount] = useState(loan?.LoanAmount ? String(loan.LoanAmount) : "");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (isBank && !bankName.trim()) return toast.error("Enter the bank name");
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { BookingId: bookingId };
      if (nocDate) payload.NocDate = nocDate;
      if (reason.trim()) payload.Reason = reason.trim();
      if (notes.trim()) payload.Notes = notes.trim();
      if (isBank) {
        if (bankName.trim()) payload.BankName = bankName.trim();
        if (loanAccNo.trim()) payload.LoanAccountNo = loanAccNo.trim();
        if (loanAmount.trim()) payload.LoanAmount = parseFloat(loanAmount);
      }
      await crmSend("/api/crm/noc", "POST", payload);
      toast.success("NOC created");
      onCreated();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={`New NOC${isBank ? " (Bank)" : " (Organisation)"}`}>
      <View style={{ gap: 12 }}>
        {isBank ? (
          <>
            <TextField label="Bank name" value={bankName} onChangeText={setBankName} placeholder="e.g. HDFC Bank" />
            <TextField label="Loan account number" value={loanAccNo} onChangeText={setLoanAccNo} placeholder="e.g. 1234567890" />
            <TextField label="Loan amount" value={loanAmount} onChangeText={setLoanAmount} keyboardType="numeric" placeholder="e.g. 5000000" />
          </>
        ) : null}
        <DateField label="NOC date (optional)" value={nocDate} onChange={setNocDate} />
        <RemarksField label="Reason (optional)" value={reason} onChangeText={setReason} />
        <RemarksField label="Notes (optional)" value={notes} onChangeText={setNotes} />
        <ActionKey label={busy ? "Creating…" : "Create NOC"} onPress={submit} />
      </View>
    </Section>
  );
}

export default function CrmNocScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmNoc">>();
  const initialBookingId = params?.bookingId;
  const [selectedBookingId, setSelectedBookingId] = useState<number | null>(initialBookingId ?? null);
  const [showPicker, setShowPicker] = useState(false);

  const { canDoAction } = useAuth();
  const b = useBrand();
  const qc = useQueryClient();
  const canEdit = canDoAction("crm-noc", "edit");
  const canCreate = canDoAction("crm-noc", "create");

  // Eligible bookings for when bookingId is not passed directly
  const eligibleQ = useQuery<EligibleBooking[]>({
    queryKey: ["crm-noc-eligible-bookings"],
    queryFn: () => crmGet<EligibleBooking[]>("/api/crm/noc/eligible-bookings").then((d) => (Array.isArray(d) ? d : [])),
    enabled: selectedBookingId == null,
  });

  const activeBookingId = selectedBookingId;

  const ctxQ = useQuery<Ctx>({
    queryKey: ["crm-noc-ctx", activeBookingId],
    queryFn: () => crmGet<Ctx>(`/api/crm/noc/booking/${activeBookingId!}/context`),
    enabled: activeBookingId != null,
  });

  const [busy, setBusy] = useState(false);

  const invalidate = () => {
    if (!activeBookingId) return;
    ["crm-noc-ctx", "crm-booking-legal-mil", "crm-booking", "crm-noc-eligible-bookings"].forEach((k) =>
      qc.invalidateQueries({ queryKey: [k, activeBookingId] })
    );
  };

  const doAction = async (nocId: number, action: "submit" | "approve" | "reject" | "mark-issued", note?: string) => {
    setBusy(true);
    try {
      const path = `/api/crm/noc/${nocId}/${action}`;
      const body = action === "reject" && note ? { note } : undefined;
      await crmSend(path, "PUT", body);
      const labels: Record<string, string> = {
        submit: "Submitted for approval",
        approve: "NOC approved",
        reject: "NOC rejected",
        "mark-issued": "NOC marked as issued",
      };
      toast.success(labels[action] ?? "Done");
      invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const editNotes = async (nocId: number, newNotes: string) => {
    setBusy(true);
    try {
      await crmSend(`/api/crm/noc/${nocId}`, "PUT", { Notes: newNotes.trim() || null });
      toast.success("Notes saved");
      invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // If no booking is selected yet
  if (!activeBookingId) {
    const eligible = eligibleQ.data ?? [];
    const options = eligible.map((e) => ({
      key: String(e.Id),
      label: `${e.ApplicantName} (${e.BookingNo})`,
      sublabel: `${e.NocType === "Bank" ? "Bank NOC" : "Developer NOC"}${e.UnitNo ? ` · Unit ${e.UnitNo}` : ""}`,
    }));

    return (
      <ScrollView style={{ flex: 1, backgroundColor: b.surface }} contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Section title="Request NOC">
          <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: b.textSecondary }}>
            Choose a booking whose Agreement for Sale is registered to view its status or request a NOC.
          </Text>
          <PickerRow
            label="Eligible Booking"
            required
            value=""
            placeholder={eligibleQ.isLoading ? "Loading eligible bookings…" : "Select a booking…"}
            onPress={() => setShowPicker(true)}
          />
        </Section>

        <OptionPickerModal
          visible={showPicker}
          title="Select Booking for NOC"
          options={options}
          searchable
          onSelect={(k) => {
            setSelectedBookingId(Number(k));
            setShowPicker(false);
          }}
          onClose={() => setShowPicker(false)}
        />
      </ScrollView>
    );
  }

  if (ctxQ.isLoading) {
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
          {(ctxQ.error as Error | null)?.message || "Could not load NOC details."}
        </Text>
      </View>
    );
  }

  const ctx = ctxQ.data;
  const nocs = ctx.existingNocs ?? [];
  const activeNoc = nocs.find((n) => n.Status !== "Rejected");
  const canCreateHere = canCreate && !activeNoc;
  const agreement = ctx.agreement;
  const agrRegistered = agreement?.Status === "Registered";

  return (
    <ScrollView style={{ flex: 1, backgroundColor: b.surface }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}>
      {/* Booking banner */}
      <View style={{ backgroundColor: b.surfaceCard, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: b.border, gap: 4 }}>
        <Text style={{ fontSize: 15, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>
          {ctx.booking.ApplicantName as string}
        </Text>
        <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>
          {[ctx.booking.BookingNo, ctx.booking.UnitNo, ctx.booking.ProjectName].filter(Boolean).join(" · ")}
        </Text>
      </View>

      {/* Pre-condition notice */}
      {!agrRegistered ? (
        <View style={{ backgroundColor: b.warningSoft, borderRadius: 12, padding: 14, flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
          <FileText size={16} color={b.warning} style={{ marginTop: 1 }} />
          <Text style={{ flex: 1, fontSize: 13, fontFamily: fonts.body.regular, color: b.textPrimary }}>
            {agreement
              ? `Agreement is currently "${words(agreement.Status)}". A NOC can only be raised after the agreement is Registered.`
              : "No agreement found for this booking. Register the agreement before raising a NOC."}
          </Text>
        </View>
      ) : null}

      {/* Existing NOCs */}
      {nocs.length > 0 ? (
        <Section title="NOC history">
          <View style={{ gap: 12 }}>
            {nocs.map((noc) => (
              <NocCard
                key={noc.Id}
                noc={noc}
                canEdit={canEdit}
                busy={busy}
                onAction={(action, note) => doAction(Number(noc.Id), action, note)}
                onEditNotes={(newNotes) => editNotes(Number(noc.Id), newNotes)}
              />
            ))}
          </View>
        </Section>
      ) : (
        <Empty text="No NOC raised yet for this booking." />
      )}

      {/* Create form */}
      {canCreateHere && agrRegistered ? <CreateNocForm bookingId={activeBookingId} ctx={ctx} onCreated={invalidate} /> : null}
      {canCreateHere && !agrRegistered ? (
        <View style={{ backgroundColor: b.surfaceCard, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: b.border }}>
          <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: b.textSecondary }}>
            Raise the NOC once the agreement is registered.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

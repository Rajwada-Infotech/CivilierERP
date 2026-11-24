// NOC (No Objection Certificate) lifecycle screen.
// Context: GET /api/crm/noc/booking/:bookingId/context → { booking, agreement, existingNocs, loanDetail }
// Create: POST /api/crm/noc; submit/approve/reject/mark-issued via PUT /:id/<action>
import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Building2, CheckCircle2, FileText, XCircle } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { crmGet, crmSend, type Row } from "@/api/crmApi";
import { toast } from "@/components/Toast";
import { TextField, RemarksField } from "@/components/form/Form";
import { DateField } from "@/components/form/DateField";
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

const STATUS_COLOR: Record<string, string> = {
  Pending: "#f59e0b",
  Approved: "#10b981",
  Issued: "#10b981",
  Rejected: "#ef4444",
};

function NocCard({ noc, canEdit, onAction, busy }: {
  noc: Row; canEdit: boolean;
  onAction: (action: "submit" | "approve" | "reject" | "mark-issued", note?: string) => Promise<void>;
  busy: boolean;
}) {
  const b = useBrand();
  const [rejectNote, setRejectNote] = useState("");
  const [showReject, setShowReject] = useState(false);
  const tone = STATUS_COLOR[noc.Status] ?? b.textSecondary;
  const isPending = noc.Status === "Pending";
  const isApproved = noc.Status === "Approved";

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
      {canEdit && isPending && !noc.SubmittedAt ? (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
          <ActionKey label={busy ? "Submitting…" : "Submit for approval"} onPress={() => onAction("submit")} />
        </View>
      ) : null}
      {canEdit && isPending && noc.SubmittedAt ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
          <ActionKey label={busy && !showReject ? "Approving…" : "Approve"} onPress={() => onAction("approve")} />
          <ActionKey outline tone="#ef4444" label="Reject" onPress={() => setShowReject(true)} />
        </View>
      ) : null}
      {showReject ? (
        <View style={{ gap: 8 }}>
          <RemarksField label="Rejection note (optional)" value={rejectNote} onChangeText={setRejectNote} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <ActionKey tone="#ef4444" label={busy ? "Rejecting…" : "Confirm reject"} onPress={() => { onAction("reject", rejectNote); setShowReject(false); }} />
            <ActionKey outline label="Cancel" onPress={() => setShowReject(false)} />
          </View>
        </View>
      ) : null}
      {canEdit && isApproved ? (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
          <ActionKey label={busy ? "Marking…" : "Mark as Issued"} onPress={() => onAction("mark-issued")} />
        </View>
      ) : null}
    </View>
  );
}

function CreateNocForm({ bookingId, ctx, onCreated }: { bookingId: number; ctx: Ctx; onCreated: () => void }) {
  const b = useBrand();
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
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
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
  const { bookingId } = params;
  const { canDoAction } = useAuth();
  const b = useBrand();
  const qc = useQueryClient();
  const canEdit = canDoAction("crm-noc", "edit");

  const ctxQ = useQuery<Ctx>({
    queryKey: ["crm-noc-ctx", bookingId],
    queryFn: () => crmGet(`/api/crm/noc/booking/${bookingId}/context`),
  });

  const [busy, setBusy] = useState(false);

  const invalidate = () => {
    ["crm-noc-ctx", "crm-booking-legal-mil", "crm-booking"].forEach((k) =>
      qc.invalidateQueries({ queryKey: [k, bookingId] })
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
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

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
  // Active NOC = any that isn't Rejected
  const activeNoc = nocs.find((n) => n.Status !== "Rejected");
  const canCreate = canDoAction("crm-noc", "create") && !activeNoc;
  const agreement = ctx.agreement;
  const agrRegistered = agreement?.Status === "Registered";

  return (
    <ScrollView style={{ flex: 1, backgroundColor: b.surface }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}>
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
              />
            ))}
          </View>
        </Section>
      ) : (
        <Empty text="No NOC raised yet for this booking." />
      )}

      {/* Create form */}
      {canCreate && agrRegistered ? <CreateNocForm bookingId={bookingId} ctx={ctx} onCreated={invalidate} /> : null}
      {canCreate && !agrRegistered ? (
        <View style={{ backgroundColor: b.surfaceCard, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: b.border }}>
          <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: b.textSecondary }}>
            Raise the NOC once the agreement is registered.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

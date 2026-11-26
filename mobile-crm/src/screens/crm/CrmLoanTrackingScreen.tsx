// Home Loan Tracking screen — view and update loan sanction status, bank details,
// RM contacts, and bank preferences from welcome calls.
// Parity with web CrmLoanTracking.tsx.
import { useState, useEffect } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRoute, useNavigation, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, Wallet, X } from "lucide-react-native";
import { crmGet, crmSend, type Row } from "@/api/crmApi";
import { useAuth } from "@/auth/AuthContext";
import { toast } from "@/components/Toast";
import { fonts } from "@/theme/fonts";
import { useBrand } from "@/theme/ThemeContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { ActionKey, CRM, Kv, Pill, Section, fmtDate, joinDot, money, words } from "./ui";

const STATUS_ORDER = ["NotApplied", "Applied", "Sanctioned", "Disbursed"] as const;
const SANCTION_STATUSES = ["NotApplied", "Applied", "Sanctioned", "Disbursed", "Rejected"] as const;

const STATUS_LABELS: Record<string, string> = {
  NotApplied: "Not applied",
  Applied: "Applied",
  Sanctioned: "Sanctioned",
  Disbursed: "Disbursed",
  Rejected: "Rejected",
  Closed: "Closed (previous owner)",
};

export default function CrmLoanTrackingScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmLoanTracking">>();
  const { bookingId } = params;
  const b = useBrand();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { canDoAction } = useAuth();
  const qc = useQueryClient();

  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Form fields
  const [sanctionStatus, setSanctionStatus] = useState("NotApplied");
  const [bankName, setBankName] = useState("");
  const [branchName, setBranchName] = useState("");
  const [loanAmount, setLoanAmount] = useState("");
  const [sanctionDate, setSanctionDate] = useState("");
  const [loanAccountNo, setLoanAccountNo] = useState("");
  const [rmName, setRmName] = useState("");
  const [rmContact, setRmContact] = useState("");
  const [notes, setNotes] = useState("");

  const canEdit = canDoAction("crm-loan-details", "edit");

  // Load booking details (which contains loan details)
  const q = useQuery<Row>({
    queryKey: ["crm-booking-loan", bookingId],
    queryFn: () => crmGet(`/api/crm/bookings/${bookingId}`),
  });

  // Load bank preferences from welcome calls
  const prefQ = useQuery<Row[]>({
    queryKey: ["crm-bank-preferences", bookingId],
    queryFn: () => crmGet(`/api/crm/welcome-calls/${bookingId}/bank-preferences`).catch(() => []),
  });

  const bkg = q.data;
  const loan = bkg?.loan || bkg || {};

  useEffect(() => {
    if (loan) {
      setSanctionStatus(loan.SanctionStatus || "NotApplied");
      setBankName(loan.BankName || "");
      setBranchName(loan.BranchName || "");
      setLoanAmount(loan.LoanAmount != null ? String(loan.LoanAmount) : "");
      setSanctionDate(loan.SanctionDate ? String(loan.SanctionDate).slice(0, 10) : "");
      setLoanAccountNo(loan.LoanAccountNo || "");
      setRmName(loan.RmName || "");
      setRmContact(loan.RmContact || "");
      setNotes(loan.LoanNotes || loan.Notes || "");
    }
  }, [loan]);

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["crm-booking-loan", bookingId] });
    qc.invalidateQueries({ queryKey: ["crm-booking", bookingId] });
    qc.invalidateQueries({ queryKey: ["crm"] });
  };

  const handleSave = async () => {
    if (["Sanctioned", "Disbursed"].includes(sanctionStatus) && !(Number(loanAmount) > 0)) {
      toast.error("Enter the sanctioned amount");
      return;
    }
    if (["Applied", "Sanctioned", "Disbursed"].includes(sanctionStatus) && !bankName.trim()) {
      toast.error("Enter the bank name");
      return;
    }

    setBusy(true);
    try {
      await crmSend(`/api/crm/bookings/${bookingId}/loan`, "PUT", {
        SanctionStatus: sanctionStatus,
        BankName: bankName.trim() || null,
        BranchName: branchName.trim() || null,
        LoanAmount: loanAmount ? Number(loanAmount) : null,
        SanctionDate: sanctionDate || null,
        LoanAccountNo: loanAccountNo.trim() || null,
        RmName: rmName.trim() || null,
        RmContact: rmContact.trim() || null,
        Notes: notes.trim() || null,
      });
      toast.success("Loan details updated");
      setEditOpen(false);
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: b.surface }}>
        <ActivityIndicator size="large" color={CRM} />
      </View>
    );
  }

  if (q.isError || !bkg) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: b.surface }}>
        <Text style={{ fontSize: 16, fontFamily: fonts.heading.bold, color: b.danger, textAlign: "center" }}>
          {q.error instanceof Error ? q.error.message : "Loan record not found"}
        </Text>
      </View>
    );
  }

  const currentStatus = loan.SanctionStatus || "NotApplied";
  const rejected = currentStatus === "Rejected";
  const currentIdx = STATUS_ORDER.indexOf(currentStatus as (typeof STATUS_ORDER)[number]);

  return (
    <>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, backgroundColor: b.surface }}>
        {/* Header Hero */}
        <View style={{ padding: 16, borderRadius: 16, backgroundColor: b.surfaceCard, borderWidth: 1, borderColor: b.border, gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: b.textSecondary, textTransform: "uppercase", letterSpacing: 0.8 }}>
                {`Home Loan · Booking ${bkg.BookingNo || ""}`}
              </Text>
              <Text style={{ fontSize: 20, fontFamily: fonts.heading.bold, color: b.textPrimary, marginTop: 2 }}>
                {bkg.ApplicantName}
              </Text>
              <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: b.textSecondary }}>
                {[bkg.ProjectName, bkg.BlockName, bkg.UnitNo].filter(Boolean).join(" · ")}
              </Text>
            </View>
            <Pill label={STATUS_LABELS[currentStatus] || currentStatus} />
          </View>

          <View style={{ marginTop: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: b.border, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
            <View>
              <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>Sanctioned Loan Amount</Text>
              <Text style={{ fontSize: 22, fontFamily: fonts.heading.bold, color: b.textPrimary }}>
                {money(loan.LoanAmount)}
              </Text>
            </View>
            {loan.BankName ? (
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>Bank</Text>
                <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>
                  {loan.BankName}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Loan Stepper */}
        <View style={{ padding: 14, borderRadius: 14, backgroundColor: b.surfaceCard, borderWidth: 1, borderColor: b.border, gap: 10 }}>
          <Text style={{ fontSize: 12, fontFamily: fonts.heading.bold, color: b.textSecondary, textTransform: "uppercase", letterSpacing: 1 }}>
            Sanction Status
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            {STATUS_ORDER.map((step, i) => {
              const isDone = !rejected && currentIdx >= i;
              const isCurrent = !rejected && currentIdx === i;
              return (
                <View key={step} style={{ flex: 1, alignItems: "center" }}>
                  <View style={{
                    width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center",
                    backgroundColor: isDone && !isCurrent ? CRM : isCurrent ? `${CRM}22` : b.surface,
                    borderWidth: 1, borderColor: isDone || isCurrent ? CRM : b.border,
                  }}>
                    {isDone && !isCurrent ? <Check size={14} color="#fff" /> : (
                      <Text style={{ fontSize: 11, fontFamily: fonts.heading.bold, color: isCurrent ? CRM : b.textSecondary }}>{i + 1}</Text>
                    )}
                  </View>
                  <Text numberOfLines={1} style={{ fontSize: 10.5, fontFamily: fonts.body.medium, color: isDone || isCurrent ? b.textPrimary : b.textSecondary, marginTop: 4, textAlign: "center" }}>
                    {STATUS_LABELS[step]}
                  </Text>
                </View>
              );
            })}
            {rejected ? (
              <View style={{ flex: 1, alignItems: "center" }}>
                <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: b.danger }}>
                  <X size={14} color="#fff" />
                </View>
                <Text style={{ fontSize: 10.5, fontFamily: fonts.body.medium, color: b.danger, marginTop: 4 }}>Rejected</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Bank & Sanction Details */}
        <Section title="Loan Details">
          <Kv label="Sanction Status" value={STATUS_LABELS[currentStatus] || currentStatus} />
          <Kv label="Bank Name" value={loan.BankName || "—"} />
          <Kv label="Branch" value={loan.BranchName || "—"} />
          <Kv label="Loan Amount" value={money(loan.LoanAmount)} />
          <Kv label="Sanction Date" value={fmtDate(loan.SanctionDate)} />
          <Kv label="Loan Account No." value={loan.LoanAccountNo || "—"} />
          <Kv label="Bank RM Name" value={loan.RmName || "—"} />
          <Kv label="Bank RM Contact" value={loan.RmContact || "—"} />
          {loan.Notes ? <Kv label="Notes" value={loan.Notes} /> : null}
        </Section>

        {/* Customer Bank Preferences from Welcome Call */}
        {(prefQ.data ?? []).length > 0 ? (
          <Section title="Buyer's Bank Preferences">
            {(prefQ.data ?? []).map((p, idx) => (
              <View key={idx} style={{ paddingVertical: 6, borderBottomWidth: idx < (prefQ.data?.length ?? 1) - 1 ? 1 : 0, borderBottomColor: b.border }}>
                <Text style={{ fontSize: 13.5, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{p.BankName}</Text>
                {p.Notes ? <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.textSecondary }}>{p.Notes}</Text> : null}
              </View>
            ))}
          </Section>
        ) : null}

        {/* Action Keys */}
        <View style={{ gap: 8, marginTop: 4 }}>
          {canEdit ? (
            <ActionKey label="Update Loan Details" onPress={() => setEditOpen(true)} />
          ) : null}
          <ActionKey outline label="Open Booking Details" onPress={() => nav.navigate("CrmBooking", { bookingId: Number(bookingId), title: bkg.BookingNo || "Booking" })} />
        </View>
      </ScrollView>

      {/* Edit Loan Sheet */}
      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={() => setEditOpen(false)} />
        <View style={{ maxHeight: "88%", backgroundColor: b.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: insets.bottom + 16, gap: 12 }}>
          <Text style={{ fontSize: 18, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>Update Loan Details</Text>

          <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
            <View style={{ gap: 6 }}>
              <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textSecondary }}>Status</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {SANCTION_STATUSES.map((st) => (
                  <Pressable key={st} onPress={() => setSanctionStatus(st)}
                    style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1,
                      borderColor: sanctionStatus === st ? CRM : b.border, backgroundColor: sanctionStatus === st ? `${CRM}22` : b.surfaceCard }}>
                    <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: sanctionStatus === st ? b.textPrimary : b.textSecondary }}>
                      {STATUS_LABELS[st]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textSecondary }}>Bank Name</Text>
              <TextInput value={bankName} onChangeText={setBankName} placeholder="e.g. HDFC Bank, SBI…" placeholderTextColor={b.textFaint}
                style={{ height: 46, borderWidth: 1, borderColor: b.border, borderRadius: 12, paddingHorizontal: 12, fontSize: 14, color: b.textPrimary, backgroundColor: b.surfaceCard }} />
            </View>

            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textSecondary }}>Branch</Text>
              <TextInput value={branchName} onChangeText={setBranchName} placeholder="Branch name…" placeholderTextColor={b.textFaint}
                style={{ height: 46, borderWidth: 1, borderColor: b.border, borderRadius: 12, paddingHorizontal: 12, fontSize: 14, color: b.textPrimary, backgroundColor: b.surfaceCard }} />
            </View>

            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textSecondary }}>Sanctioned Loan Amount (₹)</Text>
              <TextInput value={loanAmount} onChangeText={setLoanAmount} keyboardType="numeric" placeholder="e.g. 4500000" placeholderTextColor={b.textFaint}
                style={{ height: 46, borderWidth: 1, borderColor: b.border, borderRadius: 12, paddingHorizontal: 12, fontSize: 14, color: b.textPrimary, backgroundColor: b.surfaceCard }} />
            </View>

            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textSecondary }}>Sanction Date (YYYY-MM-DD)</Text>
              <TextInput value={sanctionDate} onChangeText={setSanctionDate} placeholder="YYYY-MM-DD" placeholderTextColor={b.textFaint}
                style={{ height: 46, borderWidth: 1, borderColor: b.border, borderRadius: 12, paddingHorizontal: 12, fontSize: 14, color: b.textPrimary, backgroundColor: b.surfaceCard }} />
            </View>

            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textSecondary }}>Loan Account No.</Text>
              <TextInput value={loanAccountNo} onChangeText={setLoanAccountNo} placeholder="Account number…" placeholderTextColor={b.textFaint}
                style={{ height: 46, borderWidth: 1, borderColor: b.border, borderRadius: 12, paddingHorizontal: 12, fontSize: 14, color: b.textPrimary, backgroundColor: b.surfaceCard }} />
            </View>

            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textSecondary }}>Bank RM Name</Text>
              <TextInput value={rmName} onChangeText={setRmName} placeholder="Relationship manager name…" placeholderTextColor={b.textFaint}
                style={{ height: 46, borderWidth: 1, borderColor: b.border, borderRadius: 12, paddingHorizontal: 12, fontSize: 14, color: b.textPrimary, backgroundColor: b.surfaceCard }} />
            </View>

            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textSecondary }}>RM Contact No.</Text>
              <TextInput value={rmContact} onChangeText={setRmContact} keyboardType="phone-pad" placeholder="Phone number…" placeholderTextColor={b.textFaint}
                style={{ height: 46, borderWidth: 1, borderColor: b.border, borderRadius: 12, paddingHorizontal: 12, fontSize: 14, color: b.textPrimary, backgroundColor: b.surfaceCard }} />
            </View>

            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textSecondary }}>Notes</Text>
              <TextInput value={notes} onChangeText={setNotes} multiline placeholder="Additional notes…" placeholderTextColor={b.textFaint}
                style={{ minHeight: 64, textAlignVertical: "top", borderWidth: 1, borderColor: b.border, borderRadius: 12, padding: 12, fontSize: 14, color: b.textPrimary, backgroundColor: b.surfaceCard }} />
            </View>
          </ScrollView>

          <View style={{ flexDirection: "row", gap: 10, paddingTop: 4 }}>
            <ActionKey outline label="Cancel" onPress={() => setEditOpen(false)} />
            <ActionKey label={busy ? "Saving…" : "Save Loan"} onPress={handleSave} />
          </View>
        </View>
      </Modal>
    </>
  );
}

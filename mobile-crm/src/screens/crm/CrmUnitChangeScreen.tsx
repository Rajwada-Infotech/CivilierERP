// Unit change detail — customer moving from one unit to another.
// Full lifecycle parity with web CrmUnitChanges.tsx:
// - Step journey: Application → Approval → New booking → Money moved
// - Financial breakdown: Settled on milestones, On account, With Finance, Moved to new booking, Still to move
// - Actions: Withdraw, Retry, Approve, Reject, Open Old/New Booking, Open Application
import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRoute, useNavigation, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowRight, Check, CheckCircle2, ChevronRight, XCircle } from "lucide-react-native";
import { crmGet, crmSend, type Row } from "@/api/crmApi";
import { useAuth } from "@/auth/AuthContext";
import { toast } from "@/components/Toast";
import { fonts } from "@/theme/fonts";
import { useBrand } from "@/theme/ThemeContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { ActionKey, CRM, Kv, Pill, Section, fmtDate, joinDot, money, words } from "./ui";

const API = "/api/crm/bookings/unit-changes";

const STATUS_TEXT: Record<string, string> = {
  Open: "Open",
  Draft: "Application in progress",
  Pending: "Awaiting approval",
  Approved: "Being carried out",
  MovingMoney: "Money on its way",
  Failed: "Stopped part-way",
  Completed: "Completed",
  Rejected: "Rejected",
  Withdrawn: "Withdrawn",
};

export default function CrmUnitChangeScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmUnitChange">>();
  const { changeId } = params;
  const b = useBrand();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { canDoAction } = useAuth();
  const qc = useQueryClient();

  const [busy, setBusy] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [reviewAction, setReviewAction] = useState<null | "approve" | "reject">(null);
  const [reviewNotes, setReviewNotes] = useState("");

  const canEdit = canDoAction("crm-bookings", "edit");

  const q = useQuery<Row>({
    queryKey: ["crm-unit-change", changeId],
    queryFn: () => crmGet(`${API}/${changeId}`),
  });

  const r = q.data;

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["crm-unit-change", changeId] });
    qc.invalidateQueries({ queryKey: ["crm"] });
  };

  const handleWithdraw = async () => {
    if (!withdrawReason.trim()) {
      toast.error("Please enter a reason for withdrawal");
      return;
    }
    setBusy(true);
    try {
      await crmSend(`${API}/${changeId}/withdraw`, "PUT", { reason: withdrawReason.trim() });
      toast.success("Unit change request withdrawn");
      setWithdrawOpen(false);
      setWithdrawReason("");
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRetry = async () => {
    setBusy(true);
    try {
      await crmSend(`${API}/${changeId}/retry`, "PUT", {});
      toast.success("Unit change retried");
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleReview = async () => {
    if (!reviewAction) return;
    if (reviewAction === "reject" && !reviewNotes.trim()) {
      toast.error("Please provide review notes for rejection");
      return;
    }
    setBusy(true);
    try {
      await crmSend(`${API}/${changeId}/${reviewAction}`, "PUT", { notes: reviewNotes.trim() || null });
      toast.success(reviewAction === "approve" ? "Unit change approved" : "Unit change rejected");
      setReviewAction(null);
      setReviewNotes("");
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

  if (q.isError || !r) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: b.surface }}>
        <Text style={{ fontSize: 16, fontFamily: fonts.heading.bold, color: b.danger, textAlign: "center" }}>
          {q.error instanceof Error ? q.error.message : "Unit change request not found"}
        </Text>
      </View>
    );
  }

  const dropped = r.Status === "Rejected" || r.Status === "Withdrawn";
  const approved = ["Approved", "MovingMoney", "Failed", "Completed"].includes(r.Status);
  const draft = r.Status === "Draft";

  const steps = [
    { label: "Application", done: !draft, active: draft },
    { label: "Approval", done: approved, active: !draft && !approved && !dropped, stopped: dropped },
    { label: "New booking", done: !!r.TargetBookingId, active: approved && !r.TargetBookingId && r.Status !== "Failed", stopped: r.Status === "Failed" && !r.TargetBookingId },
    { label: "Money moved", done: r.Status === "Completed", active: !!r.TargetBookingId && r.Status !== "Completed" && r.Status !== "Failed", stopped: r.Status === "Failed" && !!r.TargetBookingId },
  ];

  const received = Number(r.ClearedAtRequest || 0) + Number(r.AvailableCreditAtRequest || 0);

  return (
    <>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, backgroundColor: b.surface }}>
        {/* Header Hero Card */}
        <View style={{ padding: 16, borderRadius: 16, backgroundColor: b.surfaceCard, borderWidth: 1, borderColor: b.border, gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: b.textSecondary, textTransform: "uppercase", letterSpacing: 0.8 }}>
                {`Unit Change · ${r.RequestNo || ""}`}
              </Text>
              <Text style={{ fontSize: 20, fontFamily: fonts.heading.bold, color: b.textPrimary, marginTop: 2 }}>
                {r.CustomerName}
              </Text>
            </View>
            <Pill label={STATUS_TEXT[r.Status] || r.Status} />
          </View>

          {/* Unit transfer transition */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 }}>
            <View style={{ flex: 1, padding: 8, borderRadius: 10, backgroundColor: b.surface, borderWidth: 1, borderColor: b.border }}>
              <Text style={{ fontSize: 11, fontFamily: fonts.body.medium, color: b.textSecondary }}>From</Text>
              <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{r.SourceUnitName || "Current unit"}</Text>
              <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>{r.SourceProjectName}</Text>
            </View>
            <ArrowRight size={18} color={b.textSecondary} />
            <View style={{ flex: 1, padding: 8, borderRadius: 10, backgroundColor: b.surface, borderWidth: 1, borderColor: b.border }}>
              <Text style={{ fontSize: 11, fontFamily: fonts.body.medium, color: b.textSecondary }}>To</Text>
              <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{r.TargetUnitName || "New unit"}</Text>
              <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>{r.TargetProjectName}</Text>
            </View>
          </View>

          {/* Total values comparison */}
          <View style={{ marginTop: 4, paddingTop: 12, borderTopWidth: 1, borderTopColor: b.border, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
            <View>
              <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>Received (Moves in Full)</Text>
              <Text style={{ fontSize: 20, fontFamily: fonts.heading.bold, color: b.textPrimary }}>{money(received)}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>New Price (Estimate)</Text>
              <Text style={{ fontSize: 16, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{money(r.TargetEstimateAtRequest)}</Text>
            </View>
          </View>
        </View>

        {/* Step Progress Tracker */}
        <View style={{ padding: 14, borderRadius: 14, backgroundColor: b.surfaceCard, borderWidth: 1, borderColor: b.border, gap: 10 }}>
          <Text style={{ fontSize: 12, fontFamily: fonts.heading.bold, color: b.textSecondary, textTransform: "uppercase", letterSpacing: 1 }}>
            Progress
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            {steps.map((st, i) => (
              <View key={st.label} style={{ flex: 1, alignItems: "center", position: "relative" }}>
                <View style={{
                  width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center",
                  backgroundColor: st.done ? CRM : st.stopped ? b.danger : st.active ? `${CRM}22` : b.surface,
                  borderWidth: 1, borderColor: st.done ? CRM : st.stopped ? b.danger : st.active ? CRM : b.border,
                }}>
                  {st.done ? <Check size={14} color="#fff" /> : (
                    <Text style={{ fontSize: 11, fontFamily: fonts.heading.bold, color: st.active ? CRM : b.textSecondary }}>{i + 1}</Text>
                  )}
                </View>
                <Text numberOfLines={1} style={{ fontSize: 10.5, fontFamily: fonts.body.medium, color: st.done || st.active ? b.textPrimary : b.textSecondary, marginTop: 4, textAlign: "center" }}>
                  {st.label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Status Notice / Guidance */}
        {r.Note || r.Status === "Failed" ? (
          <View style={{ padding: 12, borderRadius: 12, backgroundColor: r.Status === "Failed" ? `${b.danger}15` : `${CRM}15`, borderWidth: 1, borderColor: r.Status === "Failed" ? b.danger : CRM }}>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: r.Status === "Failed" ? b.danger : b.textPrimary }}>
              {r.Status === "Failed" ? `Stopped part-way: ${r.Note || "Please review and retry."}` : r.Note}
            </Text>
          </View>
        ) : null}

        {/* Money Breakdown Section */}
        <Section title="Money & Transfers">
          <Kv label="Settled on Milestones" value={money(r.ClearedAtRequest)} />
          <Kv label="On Account" value={money(r.AvailableCreditAtRequest)} />
          <Kv label="With Finance (Pending Verification)" value={money(r.PendingFinanceAtRequest)} />
          <Kv label="Receipts Pending Finance" value={money(r.PendingCrmReceiptAtRequest)} />
          <Kv label="Moved to New Booking" value={money(r.CreditCarriedAmount)} />
          <Kv label="Still to Move" value={money(r.MoneyStillToMove)} />
          {r.FundTransferDocNo ? <Kv label="Fund Transfer Doc" value={r.FundTransferDocNo} /> : null}
        </Section>

        {/* Booking Details Section */}
        <Section title="Booking Details">
          <Kv label="Source Booking" value={r.SourceBookingNo || "—"} />
          <Kv label="Original Grand Total" value={money(r.SourceGrandTotalAtRequest)} />
          <Kv label="Target Booking" value={r.TargetBookingNo || "Generated upon approval"} />
          {r.RatePerSqFt ? <Kv label="New Rate / sq ft" value={money(r.RatePerSqFt)} /> : null}
          {r.TargetApplicationNo ? <Kv label="Application No." value={r.TargetApplicationNo} /> : null}
          {r.Reason ? <Kv label="Reason for Transfer" value={r.Reason} /> : null}
          <Kv label="Requested Date" value={fmtDate(r.CreatedAt)} />
        </Section>

        {/* Action Keys */}
        <View style={{ gap: 8, marginTop: 4 }}>
          {/* Draft action: Continue in Application */}
          {r.Status === "Draft" && r.TargetApplicationId ? (
            <ActionKey label="Continue in Application" onPress={() => nav.navigate("CrmApplicationForm", { applicationId: Number(r.TargetApplicationId) })} />
          ) : null}

          {/* Pending actions: Approve / Reject */}
          {canEdit && r.Status === "Pending" ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <ActionKey label="Approve Change" onPress={() => { setReviewNotes(""); setReviewAction("approve"); }} />
              <ActionKey outline tone={b.danger} label="Reject" onPress={() => { setReviewNotes(""); setReviewAction("reject"); }} />
            </View>
          ) : null}

          {/* Failed: Retry action */}
          {canEdit && r.Status === "Failed" ? (
            <ActionKey label={busy ? "Retrying…" : "Retry Transfer"} onPress={handleRetry} />
          ) : null}

          {/* Withdraw action */}
          {canEdit && (r.Status === "Draft" || r.Status === "Pending" || (r.Status === "Failed" && !r.TargetBookingId)) ? (
            <ActionKey outline tone={b.danger} label="Withdraw Request" onPress={() => { setWithdrawReason(""); setWithdrawOpen(true); }} />
          ) : null}

          {/* Quick Navigation Links */}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
            {r.SourceBookingId ? (
              <ActionKey outline label={`Old Booking: ${r.SourceBookingNo || ""}`} onPress={() => nav.navigate("CrmBooking", { bookingId: Number(r.SourceBookingId), title: r.SourceBookingNo || "Booking" })} />
            ) : null}
            {r.TargetBookingId ? (
              <ActionKey outline label={`New Booking: ${r.TargetBookingNo || ""}`} onPress={() => nav.navigate("CrmBooking", { bookingId: Number(r.TargetBookingId), title: r.TargetBookingNo || "Booking" })} />
            ) : null}
          </View>
        </View>
      </ScrollView>

      {/* Withdraw Modal */}
      <Modal visible={withdrawOpen} transparent animationType="slide" onRequestClose={() => setWithdrawOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={() => setWithdrawOpen(false)} />
        <View style={{ backgroundColor: b.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: insets.bottom + 16, gap: 14 }}>
          <Text style={{ fontSize: 18, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>Withdraw Unit Change</Text>
          <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>The old booking carries on as it was. Please specify a reason.</Text>
          <TextInput value={withdrawReason} onChangeText={setWithdrawReason} multiline placeholder="Reason for withdrawal…" placeholderTextColor={b.textFaint}
            style={{ minHeight: 80, textAlignVertical: "top", borderWidth: 1, borderColor: b.border, borderRadius: 12, padding: 12, fontSize: 14, color: b.textPrimary, backgroundColor: b.surfaceCard }} />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <ActionKey outline label="Cancel" onPress={() => setWithdrawOpen(false)} />
            <ActionKey tone={b.danger} label={busy ? "…" : "Withdraw"} onPress={handleWithdraw} />
          </View>
        </View>
      </Modal>

      {/* Review Modal */}
      <Modal visible={!!reviewAction} transparent animationType="slide" onRequestClose={() => setReviewAction(null)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={() => setReviewAction(null)} />
        <View style={{ backgroundColor: b.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: insets.bottom + 16, gap: 14 }}>
          <Text style={{ fontSize: 18, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>
            {reviewAction === "approve" ? "Approve Unit Change" : "Reject Unit Change"}
          </Text>
          <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>
            {reviewAction === "approve" ? "Approving closes the old booking and creates a new booking with transferred funds." : "State why this request is being rejected."}
          </Text>
          <TextInput value={reviewNotes} onChangeText={setReviewNotes} multiline placeholder="Review notes…" placeholderTextColor={b.textFaint}
            style={{ minHeight: 80, textAlignVertical: "top", borderWidth: 1, borderColor: b.border, borderRadius: 12, padding: 12, fontSize: 14, color: b.textPrimary, backgroundColor: b.surfaceCard }} />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <ActionKey outline label="Cancel" onPress={() => setReviewAction(null)} />
            <ActionKey tone={reviewAction === "reject" ? b.danger : undefined} label={busy ? "…" : reviewAction === "approve" ? "Confirm Approval" : "Confirm Rejection"} onPress={handleReview} />
          </View>
        </View>
      </Modal>
    </>
  );
}

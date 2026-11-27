// CrmDemandDetailScreen — milestone demand detail and operations.
// Web counterpart: src/pages/CRM/CrmDemands.tsx
// Endpoints:
//   GET /api/crm/payments/demands?view=all
//   POST /api/crm/payments/:id/demand      { Notes?: string }
//   PATCH /api/crm/payments/:id/demand/undo
import React, { useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRoute, useNavigation, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Send, Undo2, AlertTriangle, PhoneCall, CreditCard, ExternalLink } from "lucide-react-native";
import { crmGet, crmSend, type Row } from "@/api/crmApi";
import { useAuth } from "@/auth/AuthContext";
import { toast } from "@/components/Toast";
import { fonts } from "@/theme/fonts";
import { useBrand } from "@/theme/ThemeContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { ActionKey, CRM, Kv, Pill, Section, fmtDate, money, words } from "./ui";
import { BookingRemindersSection } from "./CrmForms";

const DEMAND_TONES: Record<string, { label: string; color: string }> = {
  Paid: { label: "Paid", color: "#10b981" },
  Overdue: { label: "Overdue", color: "#ef4444" },
  Demanded: { label: "Raised", color: "#3b82f6" },
  Pending: { label: "Not raised", color: "#f59e0b" },
};

export default function CrmDemandDetailScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmDemandDetail">>();
  const { milestoneId } = params;
  const b = useBrand();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { canDoAction, canAccessPage } = useAuth();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();

  const [raiseSheet, setRaiseSheet] = useState(false);
  const [raiseNotes, setRaiseNotes] = useState("");
  const [undoSheet, setUndoSheet] = useState(false);
  const [busy, setBusy] = useState(false);

  const canEdit = canDoAction("crm-payments", "edit");

  // Load demands
  const demandsQ = useQuery<{ demands: Row[] }>({
    queryKey: ["crm-demands"],
    queryFn: () => crmGet<{ demands: Row[] }>("/api/crm/payments/demands?view=all"),
    staleTime: 30_000,
  });

  const row = (demandsQ.data?.demands ?? []).find((r) => Number(r.Id) === milestoneId) || params.demand;

  const handleRaise = async () => {
    setBusy(true);
    try {
      const res = await crmSend<{ DemandNo?: string }>(
        `/api/crm/payments/${milestoneId}/demand`,
        "POST",
        { Notes: raiseNotes.trim() || undefined }
      );
      toast.success(`Demand raised: ${res.DemandNo || "Success"}`);
      ["crm-demands", "crm-milestones", "crm-payments", "crm"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] })
      );
      setRaiseSheet(false);
      setRaiseNotes("");
      void demandsQ.refetch();
    } catch (e: any) {
      toast.error(e?.message || "Could not raise demand");
    } finally {
      setBusy(false);
    }
  };

  const handleUndo = async () => {
    setBusy(true);
    try {
      await crmSend(`/api/crm/payments/${milestoneId}/demand/undo`, "PATCH");
      toast.success("Demand reverted");
      ["crm-demands", "crm-milestones", "crm-payments", "crm"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] })
      );
      setUndoSheet(false);
      void demandsQ.refetch();
    } catch (e: any) {
      toast.error(e?.message || "Could not undo demand");
    } finally {
      setBusy(false);
    }
  };

  if (demandsQ.isLoading && !row) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: b.surface }}>
        <ActivityIndicator color={b.accent} />
      </View>
    );
  }

  if (!row) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: b.surface, padding: 24 }}>
        <Text style={{ color: b.danger, fontFamily: fonts.body.medium, textAlign: "center" }}>
          Milestone demand #{milestoneId} not found.
        </Text>
      </View>
    );
  }

  const isOverdue = !!row.IsOverdue;
  const statusKey = row.DemandStatus === "Paid" ? "Paid" : isOverdue ? "Overdue" : row.DemandStatus === "Demanded" ? "Demanded" : "Pending";
  const statusInfo = DEMAND_TONES[statusKey] ?? { label: words(row.DemandStatus as string), color: b.textSecondary };
  const balance = Math.max(0, Number(row.AmountDue || 0) - Number(row.AmountPaid || 0));
  const missing = Number(row.Missing ?? balance);
  const onAccountHeld = Math.max(0, balance - missing);

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: b.surface }}
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 64 }}
      >
        {/* Milestone & Status */}
        <Section title="Demand Overview">
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontFamily: fonts.heading.bold, color: b.textPrimary }}>
                {row.MilestoneNo ? `${row.MilestoneNo}. ` : ""}{row.MilestoneName || "Milestone"}
              </Text>
              <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: b.textSecondary, marginTop: 3 }}>
                {row.DemandNo ? `Demand #${row.DemandNo}` : "No demand number yet"}
              </Text>
            </View>
            <Pill label={statusInfo.label} tone={statusInfo.color} />
          </View>

          {isOverdue && row.DaysOverdue != null && (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                backgroundColor: "rgba(239,68,68,0.1)",
                borderRadius: 10,
                padding: 10,
                marginTop: 8,
              }}
            >
              <AlertTriangle size={15} color={b.danger} />
              <Text style={{ fontSize: 12.5, fontFamily: fonts.heading.semibold, color: b.danger }}>
                {row.DaysOverdue} days late (Due: {fmtDate(row.DueDate)})
              </Text>
            </View>
          )}
        </Section>

        {/* Operational Actions */}
        {canEdit && (
          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            {row.DemandStatus === "Pending" && balance > 0 && (
              <ActionKey
                label="Raise Demand"
                tone={b.success}
                onPress={() => {
                  setRaiseNotes("");
                  setRaiseSheet(true);
                }}
              />
            )}
            {row.DemandStatus === "Demanded" && (
              <ActionKey
                label="Undo Demand"
                tone={b.danger}
                outline
                onPress={() => setUndoSheet(true)}
              />
            )}
            {canAccessPage("crm-payments") && row.BookingId && (
              <ActionKey
                label="Record Payment"
                tone={b.accent}
                onPress={() =>
                  nav.navigate("CrmPayment", {
                    bookingId: Number(row.BookingId),
                    milestoneId: Number(row.Id),
                    title: row.MilestoneName as string,
                  })
                }
              />
            )}
          </View>
        )}

        {/* Financial Breakdown */}
        <Section title="Financial Breakdown">
          <Kv label="Total Amount Due" value={money(row.AmountDue)} />
          <Kv label="Amount Paid / Adjusted" value={money(row.AmountPaid)} />
          <View style={{ height: 1, backgroundColor: b.border, marginVertical: 4 }} />
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>
              Net Balance Due
            </Text>
            <Text
              style={{
                fontSize: 15,
                fontFamily: fonts.heading.bold,
                color: missing > 0 ? (isOverdue ? b.danger : b.accent) : b.success,
              }}
            >
              {missing > 0 ? money(missing) : "Nil (Settled)"}
            </Text>
          </View>
          {onAccountHeld > 0 && (
            <Kv label="Held On Account" value={`${money(onAccountHeld)} available`} />
          )}
          {row.Percent != null && (
            <Kv label="Share of Value" value={`${row.Percent}%`} />
          )}
        </Section>

        {/* Customer & Booking Details */}
        <Section title="Buyer & Booking">
          <Kv label="Applicant" value={row.ApplicantName} />
          {row.Mobile ? (
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textFaint }}>Mobile</Text>
              <Pressable
                onPress={() => Linking.openURL(`tel:${row.Mobile}`)}
                style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
              >
                <PhoneCall size={13} color={b.accent} />
                <Text style={{ fontSize: 13, fontFamily: fonts.body.medium, color: b.accent }}>
                  {row.Mobile}
                </Text>
              </Pressable>
            </View>
          ) : null}
          <Kv label="Booking No" value={row.BookingNo} />
          <Kv label="Project" value={row.ProjectName || "—"} />
          <Kv label="Unit No" value={row.UnitNo || "—"} />
          {row.AssignedToName && <Kv label="Relationship Manager" value={row.AssignedToName} />}

          {row.BookingId && (canAccessPage("crm-bookings") || canAccessPage("crm-payments")) && (
            <View style={{ flexDirection: "row", marginTop: 4 }}>
              <ActionKey
                outline
                label="Open Booking Details"
                onPress={() =>
                  nav.navigate("CrmBooking", {
                    bookingId: Number(row.BookingId),
                    title: row.BookingNo || "Booking",
                  })
                }
              />
            </View>
          )}
        </Section>

        {/* Demand Schedule & Timeline */}
        <Section title="Schedule & Dates">
          <Kv label="Due Date" value={fmtDate(row.DueDate)} />
          {row.DemandRaisedOn && <Kv label="Raised On" value={fmtDate(row.DemandRaisedOn)} />}
          {row.DemandNotes ? (
            <View style={{ marginTop: 6, backgroundColor: b.surfaceCard, borderRadius: 10, padding: 12 }}>
              <Text style={{ fontSize: 11.5, fontFamily: fonts.heading.semibold, color: b.textFaint }}>
                Demand Notes
              </Text>
              <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: b.textPrimary, marginTop: 4 }}>
                {row.DemandNotes}
              </Text>
            </View>
          ) : null}
        </Section>

        {/* Booking's active reminders — same section as Payment Milestones */}
        {row.BookingId && (canAccessPage("crm-reminder-setup") || canAccessPage("crm-payments")) ? (
          <BookingRemindersSection bookingId={Number(row.BookingId)} bookingNo={row.BookingNo as string | undefined}
            canEdit={canDoAction("crm-payments", "edit") || canDoAction("crm-reminder-setup", "edit")} />
        ) : null}
      </ScrollView>

      {/* Raise Demand Modal */}
      <Modal
        visible={raiseSheet}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!busy) setRaiseSheet(false);
        }}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }}
          onPress={() => !busy && setRaiseSheet(false)}
        />
        <View
          style={{
            backgroundColor: b.surface,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            padding: 20,
            paddingBottom: insets.bottom + 16,
            gap: 14,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Send size={18} color={b.success} />
            <Text style={{ fontSize: 16, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>
              Raise Milestone Demand
            </Text>
          </View>
          <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: b.textSecondary }}>
            Raising demand for {row.MilestoneName} ({money(row.AmountDue)}) for booking {row.BookingNo}.
          </Text>

          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: b.textSecondary }}>
              Notes (optional)
            </Text>
            <TextInput
              value={raiseNotes}
              onChangeText={setRaiseNotes}
              placeholder="Notes for demand notice..."
              placeholderTextColor={b.textFaint}
              multiline
              numberOfLines={3}
              style={{
                minHeight: 70,
                textAlignVertical: "top",
                borderWidth: 1,
                borderColor: b.border,
                borderRadius: 12,
                padding: 10,
                fontSize: 14,
                fontFamily: fonts.body.regular,
                color: b.textPrimary,
                backgroundColor: b.surfaceCard,
              }}
            />
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
            <ActionKey
              label="Cancel"
              outline
              onPress={() => !busy && setRaiseSheet(false)}
            />
            <ActionKey
              label={busy ? "Raising…" : "Raise Demand"}
              tone={b.success}
              onPress={handleRaise}
            />
          </View>
        </View>
      </Modal>

      {/* Undo Demand Modal */}
      <Modal
        visible={undoSheet}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!busy) setUndoSheet(false);
        }}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }}
          onPress={() => !busy && setUndoSheet(false)}
        />
        <View
          style={{
            backgroundColor: b.surface,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            padding: 20,
            paddingBottom: insets.bottom + 16,
            gap: 14,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Undo2 size={18} color={b.danger} />
            <Text style={{ fontSize: 16, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>
              Undo Demand
            </Text>
          </View>
          <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: b.textSecondary, lineHeight: 18 }}>
            Are you sure you want to revert demand {row.DemandNo ? `#${row.DemandNo}` : ""} back to "Not Raised"?
          </Text>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
            <ActionKey
              label="Keep Demand"
              outline
              onPress={() => !busy && setUndoSheet(false)}
            />
            <ActionKey
              label={busy ? "Reverting…" : "Undo Demand"}
              tone={b.danger}
              onPress={handleUndo}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

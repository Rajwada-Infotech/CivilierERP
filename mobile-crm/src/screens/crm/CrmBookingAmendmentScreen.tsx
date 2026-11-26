// CrmBookingAmendmentScreen — full detail and review for booking amendment requests.
// Web counterpart: src/pages/CRM/CrmBookingAmendments.tsx
// Endpoints:
//   GET /api/crm/booking-amendments
//   PUT /api/crm/booking-amendments/:id/approve  { Notes?: string }
//   PUT /api/crm/booking-amendments/:id/reject   { Notes: string }
import React, { useState } from "react";
import {
  ActivityIndicator,
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
import { CheckCircle2, XCircle, AlertCircle, FilePenLine } from "lucide-react-native";
import { crmGet, crmSend, type Row } from "@/api/crmApi";
import { useAuth } from "@/auth/AuthContext";
import { toast } from "@/components/Toast";
import { fonts } from "@/theme/fonts";
import { useBrand } from "@/theme/ThemeContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { ActionKey, CRM, Kv, Pill, Section, fmtDate, words } from "./ui";

const STATUS_COLOR: Record<string, string> = {
  Pending: "#f59e0b",
  Approved: "#10b981",
  Rejected: "#ef4444",
};

const changeLabel = (type?: string, action?: string) =>
  `${type === "ParkingAllotment" ? "Parking" : type === "ExtraCharge" ? "Extra charge" : type || "Amendment"} · ${action || "Change"}`;

const proposedEntries = (json?: string) => {
  try {
    const obj = JSON.parse(json || "{}") as Record<string, unknown>;
    return Object.entries(obj).filter(([k]) => k !== "Reason");
  } catch {
    return [];
  }
};

export default function CrmBookingAmendmentScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmBookingAmendment">>();
  const { amendmentId } = params;
  const b = useBrand();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { canDoAction, canAccessPage } = useAuth();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();

  const [reviewAction, setReviewAction] = useState<"approve" | "reject" | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [busy, setBusy] = useState(false);

  // Load amendments list or find cached
  const amdQ = useQuery<Row[]>({
    queryKey: ["crm-booking-amendments"],
    queryFn: () => crmGet<Row[]>("/api/crm/booking-amendments"),
    staleTime: 30_000,
  });

  const row = (amdQ.data ?? []).find((r) => Number(r.Id) === amendmentId) || params.amendment;

  // Approver check for crm-booking-amendment
  const approverQ = useQuery({
    queryKey: ["can-act", "crm-booking-amendment"],
    staleTime: 5 * 60_000,
    queryFn: () =>
      crmGet<{ canAct: boolean }>("/api/approval-workflows/can-act?module=crm-booking-amendment")
        .then((d) => !!d.canAct)
        .catch(() => false),
  });
  const isApprover = approverQ.data ?? false;
  const canEdit = canDoAction("crm-bookings", "edit");
  const canReview = canEdit && isApprover && row?.Status === "Pending";

  const handleReview = async () => {
    if (!reviewAction) return;
    const isApprove = reviewAction === "approve";
    if (!isApprove && !reviewNotes.trim()) {
      toast.error("Review notes are required to reject an amendment.");
      return;
    }

    setBusy(true);
    try {
      await crmSend(
        `/api/crm/booking-amendments/${amendmentId}/${reviewAction}`,
        "PUT",
        { Notes: reviewNotes.trim() || null }
      );
      toast.success(isApprove ? "Amendment approved and applied" : "Amendment rejected");
      ["crm-booking-amendments", "crm-bookings", "crm-booking-detail", "crm"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] })
      );
      setReviewAction(null);
      setReviewNotes("");
      void amdQ.refetch();
    } catch (e: any) {
      toast.error(e?.message || "Failed to process review");
    } finally {
      setBusy(false);
    }
  };

  if (amdQ.isLoading && !row) {
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
          Amendment request #{amendmentId} not found.
        </Text>
      </View>
    );
  }

  const entries = proposedEntries(row.ProposedChange);
  const statusColor = STATUS_COLOR[row.Status as string] ?? b.textSecondary;

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: b.surface }}
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 64 }}
      >
        {/* Header / Status Banner */}
        <Section title="Amendment Request">
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontFamily: fonts.heading.bold, color: b.textPrimary }}>
                {changeLabel(row.ChangeType, row.Action)}
              </Text>
              <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: b.textSecondary, marginTop: 3 }}>
                Booking {row.BookingNo} · {row.ApplicantName || "Applicant"}
              </Text>
            </View>
            <Pill label={words(row.Status as string)} tone={statusColor} />
          </View>

          {row.Reason ? (
            <View
              style={{
                backgroundColor: b.surfaceCard,
                borderRadius: 10,
                padding: 12,
                marginTop: 8,
                borderLeftWidth: 3,
                borderLeftColor: b.accent,
              }}
            >
              <Text style={{ fontSize: 11.5, fontFamily: fonts.heading.semibold, color: b.textFaint, textTransform: "uppercase" }}>
                Reason
              </Text>
              <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: b.textPrimary, marginTop: 4 }}>
                {row.Reason}
              </Text>
            </View>
          ) : null}
        </Section>

        {/* Approver Action Buttons */}
        {canReview && (
          <View style={{ flexDirection: "row", gap: 10 }}>
            <ActionKey
              label="Approve"
              tone={b.success}
              onPress={() => {
                setReviewAction("approve");
                setReviewNotes("");
              }}
            />
            <ActionKey
              label="Reject"
              tone={b.danger}
              outline
              onPress={() => {
                setReviewAction("reject");
                setReviewNotes("");
              }}
            />
          </View>
        )}

        {/* Proposed Changes Diff */}
        <Section title="Proposed Changes">
          {entries.length > 0 ? (
            <View style={{ gap: 8 }}>
              {entries.map(([key, val]) => (
                <View
                  key={key}
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    backgroundColor: b.surfaceCard,
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                  }}
                >
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textSecondary }}>
                    {key}
                  </Text>
                  <Text
                    style={{
                      fontSize: 13,
                      fontFamily: fonts.heading.semibold,
                      color: b.textPrimary,
                      maxWidth: "60%",
                      textAlign: "right",
                    }}
                  >
                    {String(val ?? "—")}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: b.textFaint, fontStyle: "italic" }}>
              No detailed field properties recorded.
            </Text>
          )}
        </Section>

        {/* Booking Details */}
        <Section title="Property & Booking">
          <Kv label="Booking No" value={row.BookingNo} />
          <Kv label="Applicant" value={row.ApplicantName} />
          <Kv label="Project" value={row.ProjectName || "—"} />
          <Kv label="Unit No" value={row.UnitNo || "—"} />
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

        {/* Audit Trail & Review Info */}
        <Section title="Audit & Decisions">
          <Kv
            label="Requested By"
            value={row.RequestedByName ? `${row.RequestedByName} on ${fmtDate(row.RequestedAt)}` : fmtDate(row.RequestedAt) || "—"}
          />
          {row.ReviewedByName && (
            <Kv
              label="Reviewed By"
              value={`${row.ReviewedByName} on ${fmtDate(row.ReviewedAt)}`}
            />
          )}
          {row.ReviewNotes ? (
            <View style={{ marginTop: 6, backgroundColor: b.surfaceCard, borderRadius: 10, padding: 12 }}>
              <Text style={{ fontSize: 11.5, fontFamily: fonts.heading.semibold, color: b.textFaint }}>
                Review Notes
              </Text>
              <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: b.textPrimary, marginTop: 4 }}>
                {row.ReviewNotes}
              </Text>
            </View>
          ) : null}
        </Section>
      </ScrollView>

      {/* Review Dialog / Bottom Sheet */}
      <Modal
        visible={reviewAction !== null}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!busy) setReviewAction(null);
        }}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }}
          onPress={() => !busy && setReviewAction(null)}
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
            {reviewAction === "approve" ? (
              <CheckCircle2 size={18} color={b.success} />
            ) : (
              <XCircle size={18} color={b.danger} />
            )}
            <Text style={{ fontSize: 16, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>
              {reviewAction === "approve" ? "Approve Amendment" : "Reject Amendment"}
            </Text>
            <Text style={{ fontSize: 14, fontFamily: fonts.body.regular, color: b.textSecondary }}>
              · {row.BookingNo}
            </Text>
          </View>

          {reviewAction === "approve" ? (
            <View
              style={{
                flexDirection: "row",
                gap: 8,
                backgroundColor: b.accentSoft,
                borderRadius: 10,
                padding: 12,
              }}
            >
              <AlertCircle size={15} color={b.accent} style={{ marginTop: 2 }} />
              <Text style={{ flex: 1, fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textPrimary, lineHeight: 18 }}>
                Approving applies the change to the booking at once; payment milestones are recalculated automatically.
              </Text>
            </View>
          ) : (
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>
              Please provide remarks explaining why this amendment is being rejected.
            </Text>
          )}

          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: b.textSecondary }}>
              Review notes {reviewAction === "approve" ? "(optional)" : "(required)"}
            </Text>
            <TextInput
              value={reviewNotes}
              onChangeText={setReviewNotes}
              placeholder="Notes for this decision..."
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
              onPress={() => !busy && setReviewAction(null)}
            />
            <ActionKey
              label={busy ? "Working…" : reviewAction === "approve" ? "Approve and apply" : "Reject"}
              tone={reviewAction === "approve" ? b.success : b.danger}
              onPress={handleReview}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

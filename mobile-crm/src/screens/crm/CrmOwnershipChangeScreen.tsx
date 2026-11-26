// Ownership change detail — current owner → new owner, deed reference, approval.
// Web counterpart: src/pages/CRM/CrmOwnershipChanges.tsx
// Endpoints:
//   GET /api/crm/ownership-changes/:id
//   PUT /api/crm/ownership-changes/:id
//   PUT /api/crm/ownership-changes/:id/submit
//   PUT /api/crm/ownership-changes/:id/approve
//   PUT /api/crm/ownership-changes/:id/reject
//   PUT /api/crm/ownership-changes/:id/cancel
//   PUT /api/crm/ownership-changes/:id/owner-application
//   GET /api/crm/ownership-changes/:id/history
import React, { useState, useEffect, type ReactNode } from "react";
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
import { Check, CheckCircle2, History, Info, Users, XCircle } from "lucide-react-native";
import { crmGet, crmSend, type Row } from "@/api/crmApi";
import { useAuth } from "@/auth/AuthContext";
import { toast } from "@/components/Toast";
import { fonts } from "@/theme/fonts";
import { useBrand } from "@/theme/ThemeContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { ActionKey, CRM, Kv, Pill, Section, fmtDate, money, words } from "./ui";

const STATUS_COLOR: Record<string, string> = {
  Draft: "#94a3b8",
  Pending: "#f59e0b",
  Approved: "#10b981",
  Rejected: "#ef4444",
  Cancelled: "#64748b",
};

/** Bottom sheet modal */
function Sheet({
  open,
  title,
  sub,
  children,
  cancel,
  confirm,
  onConfirm,
  onClose,
  disabled,
  danger,
  busy,
}: {
  open: boolean;
  title: string;
  sub?: string;
  children?: ReactNode;
  cancel: string;
  confirm: string;
  onConfirm: () => void;
  onClose: () => void;
  disabled?: boolean;
  danger?: boolean;
  busy?: boolean;
}) {
  const b = useBrand();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={onClose} />
      <View
        style={{
          maxHeight: "88%",
          backgroundColor: b.surface,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          paddingBottom: insets.bottom + 16,
        }}
      >
        <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }} keyboardShouldPersistTaps="handled">
          <Text style={{ fontSize: 18, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{title}</Text>
          {sub ? <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>{sub}</Text> : null}
          {children}
        </ScrollView>
        <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 20 }}>
          <ActionKey outline label={cancel} onPress={onClose} />
          <ActionKey
            label={busy ? "…" : confirm}
            tone={danger ? b.danger : undefined}
            onPress={() => {
              if (!disabled && !busy) onConfirm();
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

function Field({
  label,
  hint,
  required,
  value,
  onChange,
  multiline,
  keyboardType,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  keyboardType?: "default" | "numeric";
}) {
  const b = useBrand();
  return (
    <View style={{ gap: 5 }}>
      <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textSecondary }}>
        {label}
        {required ? " *" : ""}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        keyboardType={keyboardType}
        placeholderTextColor={b.textFaint}
        style={{
          minHeight: multiline ? 76 : 46,
          textAlignVertical: multiline ? "top" : "center",
          borderWidth: 1,
          borderColor: b.border,
          borderRadius: 12,
          paddingHorizontal: 12,
          paddingVertical: 10,
          fontSize: 14.5,
          fontFamily: fonts.body.regular,
          color: b.textPrimary,
          backgroundColor: b.surfaceCard,
        }}
      />
      {hint ? <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.textFaint }}>{hint}</Text> : null}
    </View>
  );
}

export default function CrmOwnershipChangeScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmOwnershipChange">>();
  const { changeId } = params;
  const b = useBrand();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const qc = useQueryClient();
  const { canDoAction, canAccessPage } = useAuth();
  const canEdit = canDoAction("crm-ownership-changes", "edit");

  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<null | "approve" | "reject" | "editDeed" | "cancel">(null);
  const [notes, setNotes] = useState("");

  // Edit deed fields
  const [editDeedNo, setEditDeedNo] = useState("");
  const [editDeedDate, setEditDeedDate] = useState("");
  const [editRegOffice, setEditRegOffice] = useState("");
  const [editConsideration, setEditConsideration] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const q = useQuery<Row>({
    queryKey: ["crm-ownership-change", changeId],
    queryFn: () => crmGet(`/api/crm/ownership-changes/${changeId}`),
  });

  const historyQ = useQuery<Row[]>({
    queryKey: ["crm-ownership-change-history", changeId],
    queryFn: () => crmGet(`/api/crm/ownership-changes/${changeId}/history`),
  });

  // Approver check
  const approverQ = useQuery({
    queryKey: ["can-act", "crm-ownership-change"],
    staleTime: 5 * 60_000,
    queryFn: () =>
      crmGet<{ canAct: boolean }>(`/api/approval-workflows/can-act?module=crm-ownership-change`)
        .then((d) => !!d.canAct)
        .catch(() => false),
  });
  const isApprover = approverQ.data ?? false;

  useEffect(() => {
    if (q.data) {
      setEditDeedNo(q.data.DeedNo || "");
      setEditDeedDate(q.data.DeedDate ? String(q.data.DeedDate).slice(0, 10) : "");
      setEditRegOffice(q.data.RegOffice || "");
      setEditConsideration(q.data.ConsiderationValue != null ? String(q.data.ConsiderationValue) : "");
      setEditNotes(q.data.Notes || "");
    }
  }, [q.data]);

  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      toast.success(done);
      void q.refetch();
      void historyQ.refetch();
      ["crm-ownership-change", "crm-ownership-changes", "crm"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] })
      );
      setSheet(null);
    } catch (e: any) {
      toast.error(e?.message || "Operation failed");
    } finally {
      setBusy(false);
    }
  };

  const openSheet = (s: "approve" | "reject" | "editDeed" | "cancel") => {
    setNotes("");
    if (s === "editDeed" && q.data) {
      setEditDeedNo(q.data.DeedNo || "");
      setEditDeedDate(q.data.DeedDate ? String(q.data.DeedDate).slice(0, 10) : "");
      setEditRegOffice(q.data.RegOffice || "");
      setEditConsideration(q.data.ConsiderationValue != null ? String(q.data.ConsiderationValue) : "");
      setEditNotes(q.data.Notes || "");
    }
    setSheet(s);
  };

  if (q.isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: b.surface }}>
        <ActivityIndicator color={b.accent} />
      </View>
    );
  }
  if (q.error || !q.data) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: b.surface, padding: 24 }}>
        <Text style={{ color: b.danger, fontFamily: fonts.body.medium, textAlign: "center" }}>
          {q.error ? (q.error as Error).message : "Not found"}
        </Text>
      </View>
    );
  }

  const r = q.data;
  const statusColor = STATUS_COLOR[r.Status as string] ?? b.textSecondary;
  const isApproved = r.Status === "Approved";
  const isRejected = r.Status === "Rejected";
  const isPending = r.Status === "Pending";
  const isDraftOrRejected = ["Draft", "Rejected"].includes(r.Status as string);
  const canModify = canEdit && isDraftOrRejected;

  // Prerequisites checklist
  const checks: [string, boolean][] = [
    ["New owner chosen", !!r.ToCustomerId],
    ["New owner's PAN on file", !!r.ToPan],
    ["New owner's address on file", !!r.ToAddress],
    ["New owner's application opened", !!r.ToApplicationId],
    ["Sale deed registration number", !!r.DeedNo],
    ["Sale deed registration date", !!r.DeedDate],
    ["Registration office", !!r.RegOffice],
  ];
  const readyToSubmit = checks.every(([, ok]) => ok);

  const sub = `${r.ChangeNo as string || ""} · ${words(r.Status as string)}`;

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: b.surface }}
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 64 }}
      >
        {/* Identity & Status */}
        <Section title="Ownership Change">
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontFamily: fonts.heading.bold, color: b.textPrimary }}>
                {r.Property || "Property"}{r.ProjectName ? ` · ${r.ProjectName}` : ""}
              </Text>
              <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: b.textSecondary, marginTop: 3 }}>
                {r.ChangeNo} · Booking {r.BookingNo}
              </Text>
            </View>
            <Pill label={words(r.Status as string)} tone={statusColor} />
          </View>
          <View style={{ marginTop: 6 }}>
            <Text style={{ fontSize: 13.5, fontFamily: fonts.body.medium, color: b.textPrimary }}>
              {r.FromName} <Text style={{ color: b.textFaint }}>→</Text> {r.ToName || "—"}
            </Text>
          </View>
          {r.CreatedAt ? <Kv label="Opened On" value={fmtDate(r.CreatedAt)} /> : null}
        </Section>

        {/* Action Buttons */}
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {/* Approver Actions */}
          {isPending && isApprover && (
            <>
              <ActionKey label="Approve" tone={b.success} onPress={() => openSheet("approve")} />
              <ActionKey outline tone={b.danger} label="Send Back" onPress={() => openSheet("reject")} />
            </>
          )}

          {/* Edit / Submit Actions when Draft or Rejected */}
          {canModify && (
            <>
              <ActionKey outline label="Edit Sale Deed" onPress={() => openSheet("editDeed")} />
              {!r.ToApplicationId && (
                <ActionKey
                  label="Open Application"
                  tone={b.accent}
                  onPress={() =>
                    void run(
                      () => crmSend(`/api/crm/ownership-changes/${changeId}/owner-application`, "PUT"),
                      "New owner application opened"
                    )
                  }
                />
              )}
              <ActionKey
                label={r.Status === "Rejected" ? "Resubmit" : "Send for Approval"}
                tone={b.success}
                onPress={() => {
                  if (!readyToSubmit) {
                    toast.error("Please complete all checklist items before submitting.");
                    return;
                  }
                  void run(
                    () => crmSend(`/api/crm/ownership-changes/${changeId}/submit`, "PUT"),
                    "Sent for approval"
                  );
                }}
              />
            </>
          )}

          {/* Cancel Record */}
          {canEdit && ["Draft", "Rejected", "Pending"].includes(r.Status as string) && (
            <ActionKey outline tone={b.danger} label="Cancel Record" onPress={() => openSheet("cancel")} />
          )}

          {/* Link to Booking */}
          {r.BookingId && (canAccessPage("crm-bookings") || canAccessPage("crm-payments")) && (
            <ActionKey
              outline
              label="Open Booking"
              onPress={() =>
                nav.navigate("CrmBooking", {
                  bookingId: Number(r.BookingId),
                  title: r.BookingNo as string || "Booking",
                })
              }
            />
          )}
        </View>

        {/* Owners & KYC */}
        <Section title="Owners & KYC">
          <View style={{ gap: 10 }}>
            <View>
              <Text style={{ fontSize: 11.5, fontFamily: fonts.heading.semibold, color: b.textFaint, marginBottom: 4, textTransform: "uppercase" }}>
                Current Owner
              </Text>
              <Kv label="Name" value={(r.FromName || "—") as string} />
              {r.FromMobile ? <Kv label="Mobile" value={r.FromMobile as string} /> : null}
            </View>
            <View style={{ height: 1, backgroundColor: b.border }} />
            <View>
              <Text style={{ fontSize: 11.5, fontFamily: fonts.heading.semibold, color: b.textFaint, marginBottom: 4, textTransform: "uppercase" }}>
                New Owner
              </Text>
              <Kv label="Name" value={(r.ToName || "—") as string} />
              {r.ToMobile ? <Kv label="Mobile" value={r.ToMobile as string} /> : null}
              {r.ToPan ? <Kv label="PAN" value={r.ToPan as string} /> : null}
              {r.ToAddress ? <Kv label="Address" value={r.ToAddress as string} /> : null}
              {r.ToApplicationNo ? (
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textFaint }}>Application</Text>
                  <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: b.accent }}>
                    #{r.ToApplicationNo}
                  </Text>
                </View>
              ) : null}
              {Number(r.CoOwnerCount) > 0 ? (
                <Kv label="Co-owners" value={`${r.CoOwnerCount}`} />
              ) : null}
            </View>
          </View>
        </Section>

        {/* Sale Deed Reference */}
        <Section title="Registered Sale Deed">
          {r.DeedNo ? <Kv label="Registration No" value={r.DeedNo as string} /> : null}
          {r.DeedDate ? <Kv label="Registration Date" value={fmtDate(r.DeedDate)} /> : null}
          {r.RegOffice ? <Kv label="Sub-Registrar Office" value={r.RegOffice as string} /> : null}
          {r.ConsiderationValue ? <Kv label="Consideration / Sale Value" value={money(r.ConsiderationValue)} /> : null}
          {!r.DeedNo && !r.DeedDate && (
            <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: b.textFaint, fontStyle: "italic" }}>
              Sale deed details not recorded yet.
            </Text>
          )}
        </Section>

        {/* Approval Checklist */}
        <Section title="Approval Prerequisites">
          <View style={{ gap: 8 }}>
            {checks.map(([label, ok]) => (
              <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    backgroundColor: ok ? b.success : b.border,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {ok ? <Check size={12} color="#fff" /> : null}
                </View>
                <Text
                  style={{
                    fontSize: 13,
                    fontFamily: fonts.body.medium,
                    color: ok ? b.textPrimary : b.textFaint,
                  }}
                >
                  {label}
                </Text>
              </View>
            ))}
          </View>
        </Section>

        {/* History / Audit Log */}
        {(historyQ.data?.length ?? 0) > 0 && (
          <Section title="History">
            <View style={{ gap: 10 }}>
              {(historyQ.data ?? []).map((l: Row) => (
                <View
                  key={l.Id}
                  style={{
                    backgroundColor: b.surfaceCard,
                    borderRadius: 10,
                    padding: 10,
                    borderWidth: 1,
                    borderColor: b.border,
                    gap: 4,
                  }}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 12.5, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>
                      {l.Action}
                    </Text>
                    <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.textFaint }}>
                      {fmtDate(l.CreatedAt)}
                    </Text>
                  </View>
                  {l.Remarks ? (
                    <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.textSecondary }}>
                      {l.Remarks}
                    </Text>
                  ) : null}
                  {l.UserName ? (
                    <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: b.textFaint }}>
                      by {l.UserName}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          </Section>
        )}
      </ScrollView>

      {/* Approve Modal */}
      <Sheet
        open={sheet === "approve"}
        title="Approve Ownership Change"
        sub={sub}
        cancel="Cancel"
        confirm="Approve"
        busy={busy}
        onClose={() => setSheet(null)}
        onConfirm={() =>
          void run(
            () => crmSend(`/api/crm/ownership-changes/${changeId}/approve`, "PUT", { Notes: notes.trim() || undefined }),
            "Ownership change approved"
          )
        }
      >
        <Kv label="Property" value={[r.Property, r.ProjectName].filter(Boolean).join(" · ")} />
        <Kv label="Current owner" value={(r.FromName || "—") as string} />
        <Kv label="New owner" value={(r.ToName || "—") as string} />
        <Field label="Notes (optional)" value={notes} onChange={setNotes} multiline />
      </Sheet>

      {/* Reject Modal */}
      <Sheet
        open={sheet === "reject"}
        title="Send Back Ownership Change"
        sub={sub}
        cancel="Cancel"
        confirm="Send Back"
        danger
        busy={busy}
        disabled={!notes.trim()}
        onClose={() => setSheet(null)}
        onConfirm={() =>
          void run(
            () => crmSend(`/api/crm/ownership-changes/${changeId}/reject`, "PUT", { Notes: notes.trim() }),
            "Ownership change sent back"
          )
        }
      >
        <Field label="Reason / Remarks" required hint="Required to send back for corrections" value={notes} onChange={setNotes} multiline />
      </Sheet>

      {/* Cancel Record Modal */}
      <Sheet
        open={sheet === "cancel"}
        title="Cancel Ownership Change"
        sub={sub}
        cancel="Keep Record"
        confirm="Cancel Record"
        danger
        busy={busy}
        disabled={!notes.trim()}
        onClose={() => setSheet(null)}
        onConfirm={() =>
          void run(
            () => crmSend(`/api/crm/ownership-changes/${changeId}/cancel`, "PUT", { note: notes.trim() }),
            "Ownership change cancelled"
          )
        }
      >
        <Field label="Cancellation reason" required hint="Explain why this record is being cancelled" value={notes} onChange={setNotes} multiline />
      </Sheet>

      {/* Edit Deed Details Modal */}
      <Sheet
        open={sheet === "editDeed"}
        title="Edit Registered Sale Deed"
        sub={sub}
        cancel="Cancel"
        confirm="Save Deed Details"
        busy={busy}
        onClose={() => setSheet(null)}
        onConfirm={() =>
          void run(
            () =>
              crmSend(`/api/crm/ownership-changes/${changeId}`, "PUT", {
                DeedNo: editDeedNo.trim() || null,
                DeedDate: editDeedDate || null,
                RegOffice: editRegOffice.trim() || null,
                ConsiderationValue: editConsideration.trim() ? parseFloat(editConsideration) : null,
                Notes: editNotes.trim() || null,
              }),
            "Deed details saved"
          )
        }
      >
        <Field label="Registration Number" value={editDeedNo} onChange={setEditDeedNo} hint="e.g. I-1902-04567/2026" />
        <Field label="Registration Date (YYYY-MM-DD)" value={editDeedDate} onChange={setEditDeedDate} hint="Date registered at Sub-Registrar" />
        <Field label="Registration Office" value={editRegOffice} onChange={setEditRegOffice} hint="Sub-Registrar's Office" />
        <Field label="Sale Value (₹)" value={editConsideration} onChange={setEditConsideration} keyboardType="numeric" />
        <Field label="Notes" value={editNotes} onChange={setEditNotes} multiline />
      </Sheet>
    </>
  );
}

// Brokerage record detail — broker, commission, payment log.
// Endpoints: GET /api/crm/brokerage/:id  → { brokerage, payments[] }
//            PUT /api/crm/brokerage/:id/approve — approver sends to Finance
//            PUT /api/crm/brokerage/:id         — editor updates rate/notes when Pending or Rejected
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRoute, useNavigation, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { crmGet, crmSend, type Row } from "@/api/crmApi";
import { useAuth } from "@/auth/AuthContext";
import { toast } from "@/components/Toast";
import { fonts } from "@/theme/fonts";
import { useBrand } from "@/theme/ThemeContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { ActionKey, Kv, Pill, Section, fmtDate, money, words } from "./ui";

const STATUS_COLOR: Record<string, string> = {
  Pending:  "#f59e0b",
  Approved: "#3b82f6",
  Paid:     "#10b981",
  Rejected: "#ef4444",
};

type BrokerageData = { brokerage: Row; payments: Row[] };

/** Bottom sheet — same pattern as CrmRefundScreen */
function Sheet({ open, title, sub, children, cancel, confirm, onConfirm, onClose, disabled, danger, busy }: {
  open: boolean; title: string; sub?: string; children?: ReactNode; cancel: string; confirm: string;
  onConfirm: () => void; onClose: () => void; disabled?: boolean; danger?: boolean; busy?: boolean;
}) {
  const b = useBrand();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={onClose} />
      <View style={{ maxHeight: "88%", backgroundColor: b.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: insets.bottom + 16 }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }} keyboardShouldPersistTaps="handled">
          <Text style={{ fontSize: 18, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{title}</Text>
          {sub ? <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textSecondary }}>{sub}</Text> : null}
          {children}
        </ScrollView>
        <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 20 }}>
          <ActionKey outline label={cancel} onPress={onClose} />
          <ActionKey label={busy ? "…" : confirm} tone={danger ? b.danger : undefined} onPress={() => { if (!disabled && !busy) onConfirm(); }} />
        </View>
      </View>
    </Modal>
  );
}

function Field({ label, hint, required, value, onChange, multiline }: {
  label: string; hint?: string; required?: boolean; value: string; onChange: (v: string) => void; multiline?: boolean;
}) {
  const b = useBrand();
  return (
    <View style={{ gap: 5 }}>
      <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textSecondary }}>{label}{required ? " *" : ""}</Text>
      <TextInput value={value} onChangeText={onChange} multiline={multiline} placeholderTextColor={b.textFaint}
        style={{ minHeight: multiline ? 76 : 46, textAlignVertical: multiline ? "top" : "center", borderWidth: 1, borderColor: b.border,
          borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14.5, fontFamily: fonts.body.regular,
          color: b.textPrimary, backgroundColor: b.surfaceCard }} />
      {hint ? <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.textFaint }}>{hint}</Text> : null}
    </View>
  );
}

/** Chip row for selecting rate type */
function RateTypeChips({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const b = useBrand();
  const opts = [{ key: "Percentage", label: "%" }, { key: "Amount", label: "Fixed ₹" }, { key: "FlatAmount", label: "Flat ₹" }];
  return (
    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
      {opts.map((o) => (
        <Pressable key={o.key} onPress={() => onChange(o.key)}
          style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1,
            borderColor: value === o.key ? b.accent : b.border,
            backgroundColor: value === o.key ? b.accentSoft : b.surfaceCard }}>
          <Text style={{ fontSize: 13.5, fontFamily: fonts.heading.semibold, color: value === o.key ? b.accent : b.textSecondary }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function CrmBrokerageScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmBrokerage">>();
  const { brokerageId } = params;
  const b = useBrand();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { canAccessPage, canDoAction } = useAuth();
  const qc = useQueryClient();

  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<null | "approve" | "edit">(null);
  const [editRateType, setEditRateType] = useState("Percentage");
  const [editRateValue, setEditRateValue] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const q = useQuery<BrokerageData>({
    queryKey: ["crm-brokerage", brokerageId],
    queryFn: () => crmGet(`/api/crm/brokerage/${brokerageId}`),
  });

  // Approver check
  const approverQ = useQuery({
    queryKey: ["can-act", "crm-brokerage"],
    staleTime: 5 * 60_000,
    queryFn: () =>
      crmGet<{ canAct: boolean }>(`/api/approval-workflows/can-act?module=crm-brokerage`)
        .then((d) => !!d.canAct)
        .catch(() => false),
  });
  const isApprover = approverQ.data ?? false;

  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      toast.success(done);
      void q.refetch();
      qc.invalidateQueries({ queryKey: ["crm"] });
      setSheet(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
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

  const { brokerage: br, payments } = q.data;
  const statusColor = STATUS_COLOR[br.Status as string] ?? b.textSecondary;
  const rateLabel = br.RateType === "Percentage"
    ? `${Number(br.RateValue).toFixed(2)}%`
    : br.RateType === "Amount"
    ? money(br.RateValue)
    : br.RateValue != null ? String(br.RateValue) : null;

  const balance = Number(br.ComputedAmount ?? 0) - Number(br.TotalPaid ?? 0);
  const canEdit = canDoAction("crm-brokerage", "edit");
  const canEditRecord = canEdit && (br.Status === "Pending" || br.Status === "Rejected");
  const canApprove = isApprover && br.Status === "Pending";
  const handoffFailed = br.Status === "Approved" && !br.FinancePaymentId;

  const sub = `${br.BrokerMasterName || br.BrokerName || "—"} · ${words(br.Status as string)}`;

  const openEdit = () => {
    setEditRateType((br.RateType as string) || "Percentage");
    setEditRateValue(br.RateValue != null ? String(br.RateValue) : "");
    setEditNotes((br.Notes as string) || "");
    setSheet("edit");
  };

  return (
    <>
      <ScrollView style={{ flex: 1, backgroundColor: b.surface }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 56 }}>

        {/* Identity */}
        <Section title="Brokerage">
          <Kv label="Booking" value={[br.BookingNo, br.UnitNo].filter(Boolean).join(" · ")} />
          {br.BookingId && (canAccessPage("crm-bookings") || canAccessPage("crm-payments")) ? (
            <View style={{ flexDirection: "row", marginBottom: 4 }}>
              <ActionKey outline label="Open booking" onPress={() => nav.navigate("CrmBooking", { bookingId: Number(br.BookingId), title: br.BookingNo as string || "Booking" })} />
            </View>
          ) : null}
          <Kv label="Applicant" value={br.ApplicantName as string} />
          {br.MilestoneName ? <Kv label="Milestone" value={br.MilestoneName as string} /> : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textFaint }}>Status</Text>
            <Pill label={words(br.Status as string)} tone={statusColor} />
            {br.IsLocked ? <Pill label="Locked" tone={b.textFaint} /> : null}
          </View>
        </Section>

        {/* Actions */}
        {(canApprove || canEditRecord || (handoffFailed && canEdit)) ? (
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {canApprove ? (
              <ActionKey label="Approve & Send to Finance" tone={b.success} onPress={() => setSheet("approve")} />
            ) : null}
            {canEditRecord ? (
              <ActionKey outline label="Edit Rate / Notes" onPress={openEdit} />
            ) : null}
            {handoffFailed && canEdit ? (
              <ActionKey
                outline
                tone={b.danger}
                label="Retry Hand-off to Finance"
                onPress={() =>
                  void run(
                    () => crmSend(`/api/crm/brokerage/${brokerageId}/retry-finance-handoff`, "PUT"),
                    "Sent to Finance"
                  )
                }
              />
            ) : null}
          </View>
        ) : null}

        {/* Broker */}
        <Section title="Broker">
          <Kv label="Name" value={(br.BrokerMasterName || br.BrokerName || "—") as string} />
          {br.BrokerFirm ? <Kv label="Firm" value={br.BrokerFirm as string} /> : null}
          {br.BrokerContact || br.BrokerMasterPhone ? (
            <Kv label="Contact" value={(br.BrokerContact || br.BrokerMasterPhone) as string} />
          ) : null}
        </Section>

        {/* Commission */}
        <Section title="Commission">
          {rateLabel ? <Kv label={`Rate (${words(br.RateType as string)})`} value={rateLabel} /> : null}
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>Commission</Text>
            <Text style={{ fontSize: 14, fontFamily: fonts.heading.bold, color: b.accent }}>{money(br.ComputedAmount)}</Text>
          </View>
          {Number(br.TotalPaid) > 0 ? (
            <>
              <Kv label="Paid so far" value={money(br.TotalPaid)} />
              <View style={{ height: 1, backgroundColor: b.border, marginVertical: 4 }} />
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>Balance</Text>
                <Text style={{ fontSize: 13, fontFamily: fonts.heading.bold, color: balance <= 0 ? b.success : b.accent }}>{money(balance)}</Text>
              </View>
            </>
          ) : null}
          {Number(br.TotalSubmitted) > 0 && br.Status !== "Paid" ? (
            <Kv label="Submitted to Finance" value={money(br.TotalSubmitted)} />
          ) : null}
          {br.FinancePaymentDocNo ? (
            <Kv label="Finance voucher" value={[br.FinancePaymentDocNo, words(br.FinancePaymentStatus as string)].filter(Boolean).join(" · ")} />
          ) : null}
          {br.Notes ? <Kv label="Notes" value={br.Notes as string} /> : null}
        </Section>

        {/* Payment log */}
        {payments.length > 0 ? (
          <Section title="Payments made">
            <View style={{ gap: 8 }}>
              {payments.map((p, i) => (
                <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textPrimary }}>{fmtDate(p.PaidDate)}</Text>
                    {p.Remarks ? (
                      <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.textFaint }}>{p.Remarks as string}</Text>
                    ) : null}
                  </View>
                  <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: b.success }}>{money(p.Amount)}</Text>
                </View>
              ))}
            </View>
          </Section>
        ) : null}

      </ScrollView>

      {/* Approve dialog */}
      <Sheet open={sheet === "approve"} title="Approve & Send to Finance" sub={sub}
        cancel="Cancel" confirm="Approve" busy={busy} onClose={() => setSheet(null)}
        onConfirm={() => void run(
          () => crmSend(`/api/crm/brokerage/${brokerageId}/approve`, "PUT"),
          "Brokerage approved and sent to Finance"
        )}>
        <Kv label="Broker" value={(br.BrokerMasterName || br.BrokerName || "—") as string} />
        {br.BrokerFirm ? <Kv label="Firm" value={br.BrokerFirm as string} /> : null}
        <Kv label="Commission" value={money(br.ComputedAmount)} />
        <Kv label="Booking" value={[br.BookingNo, br.UnitNo].filter(Boolean).join(" · ")} />
      </Sheet>

      {/* Edit Rate dialog */}
      <Sheet open={sheet === "edit"} title="Edit Brokerage Rate" sub={sub}
        cancel="Cancel" confirm="Save Changes" busy={busy} disabled={!editRateValue.trim()}
        onClose={() => setSheet(null)}
        onConfirm={() => void run(
          () => crmSend(`/api/crm/brokerage/${brokerageId}`, "PUT", {
            RateType: editRateType,
            RateValue: parseFloat(editRateValue),
            Notes: editNotes.trim() || undefined,
          }),
          "Brokerage updated"
        )}>
        <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: b.textSecondary }}>Rate type</Text>
        <RateTypeChips value={editRateType} onChange={setEditRateType} />
        <Field label={editRateType === "Percentage" ? "Rate (%)" : "Amount (₹)"}
          required value={editRateValue} onChange={setEditRateValue} />
        <Field label="Notes (optional)" value={editNotes} onChange={setEditNotes} multiline />
      </Sheet>
    </>
  );
}

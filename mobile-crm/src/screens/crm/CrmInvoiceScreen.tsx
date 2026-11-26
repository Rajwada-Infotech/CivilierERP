// Invoice detail — invoice number, type, GST breakdown, credit note offsets.
// Endpoints: GET /api/crm/invoices/:id
//            POST /api/crm/invoices/:id/approve  — approver only
//            POST /api/crm/invoices/:id/cancel   — editor, with Reason (non-Cancelled/Void invoices)
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
import { openDocument } from "@/utils/documents";
import { ActionKey, Kv, Pill, Section, fmtDate, money, words } from "./ui";

const STATUS_COLOR: Record<string, string> = {
  Draft:   "#94a3b8",
  Issued:  "#3b82f6",
  Void:    "#ef4444",
  Final:   "#10b981",
};

const TYPE_LABEL: Record<string, string> = {
  Tax:    "Tax Invoice",
  Proforma: "Proforma",
  Final:  "Final Statement",
};

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

export default function CrmInvoiceScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmInvoice">>();
  const { invoiceId } = params;
  const b = useBrand();
  // NOTE: hooks are called BEFORE early returns to comply with React hooks rules.
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { canAccessPage, canDoAction } = useAuth();
  const qc = useQueryClient();

  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<null | "approve" | "cancel">(null);
  const [cancelReason, setCancelReason] = useState("");

  const q = useQuery<Row>({
    queryKey: ["crm-invoice", invoiceId],
    queryFn: () => crmGet(`/api/crm/invoices/${invoiceId}`),
  });

  // Approver check for crm-invoice module
  const approverQ = useQuery({
    queryKey: ["can-act", "crm-invoice"],
    staleTime: 5 * 60_000,
    queryFn: () =>
      crmGet<{ canAct: boolean }>(`/api/approval-workflows/can-act?module=crm-invoice`)
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

  const inv = q.data;
  const statusColor = STATUS_COLOR[inv.Status as string] ?? b.textSecondary;
  const typeLabel = TYPE_LABEL[inv.InvoiceType as string] ?? words(inv.InvoiceType as string);
  const hasTax = Number(inv.GstAmount) > 0 || Number(inv.TaxableValue) > 0;
  const netAfterCredit = Number(inv.Amount) - Number(inv.CreditedAmount ?? 0);
  const canEdit = canDoAction("crm-invoices", "edit");
  const canVoid = canEdit && inv.Status !== "Cancelled" && inv.Status !== "Void";
  const isPending = inv.Status === "Pending" || inv.Status === "Draft";

  const sub = `${inv.InvoiceNo as string} · ${inv.ApplicantName as string || ""}`;

  return (
    <>
      <ScrollView style={{ flex: 1, backgroundColor: b.surface }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 56 }}>

        {/* Identity */}
        <Section title="Invoice">
          <Kv label="Number" value={inv.InvoiceNo as string} />
          <Kv label="Type" value={typeLabel} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textFaint }}>Status</Text>
            <Pill label={inv.Status as string} tone={statusColor} />
          </View>
          <Kv label="Date" value={fmtDate(inv.InvoiceDate)} />
          <Kv label="Booking" value={[inv.BookingNo, inv.UnitNo, inv.ProjectName].filter(Boolean).join(" · ")} />
          {inv.BookingId && (canAccessPage("crm-bookings") || canAccessPage("crm-payments")) ? (
            <View style={{ flexDirection: "row", marginBottom: 4 }}>
              <ActionKey outline label="Open booking" onPress={() => nav.navigate("CrmBooking", { bookingId: Number(inv.BookingId), title: inv.BookingNo as string || "Booking" })} />
            </View>
          ) : null}
          <Kv label="Applicant" value={inv.ApplicantName as string} />
          {inv.Description ? <Kv label="Description" value={inv.Description as string} /> : null}
          {inv.VoidReason ? (
            <View style={{ backgroundColor: b.dangerSoft, borderRadius: 8, padding: 10, marginTop: 4 }}>
              <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.danger, marginBottom: 2 }}>Voided</Text>
              <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textPrimary }}>{inv.VoidReason as string}</Text>
            </View>
          ) : null}
        </Section>

        {/* Actions */}
        {isPending && isApprover ? (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <ActionKey label="Approve Invoice" onPress={() => setSheet("approve")} />
          </View>
        ) : null}
        {canVoid ? (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <ActionKey outline tone={b.danger} label="Cancel / Void Invoice" onPress={() => { setCancelReason(""); setSheet("cancel"); }} />
          </View>
        ) : null}

        {/* Amounts */}
        <Section title="Amounts">
          {hasTax ? (
            <>
              <Kv label="Taxable value" value={money(inv.TaxableValue)} />
              <Kv label="GST" value={money(inv.GstAmount)} />
              <View style={{ height: 1, backgroundColor: b.border, marginVertical: 4 }} />
            </>
          ) : null}
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>Invoice amount</Text>
            <Text style={{ fontSize: 14, fontFamily: fonts.heading.bold, color: b.accent }}>{money(inv.Amount)}</Text>
          </View>
          {Number(inv.CreditedAmount) > 0 ? (
            <>
              <Kv label="Credit notes" value={`− ${money(inv.CreditedAmount)}`} />
              <View style={{ height: 1, backgroundColor: b.border, marginVertical: 4 }} />
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>Net after credits</Text>
                <Text style={{ fontSize: 13, fontFamily: fonts.heading.bold, color: netAfterCredit <= 0 ? b.success : b.accent }}>{money(netAfterCredit)}</Text>
              </View>
              {inv.CreditNoteNos ? (
                <Kv label="Credit note nos." value={inv.CreditNoteNos as string} />
              ) : null}
            </>
          ) : null}
        </Section>

        {/* PDF */}
        <View style={{ flexDirection: "row" }}>
          <ActionKey label="Open PDF" onPress={() => openDocument(`/api/crm/bookings/${inv.BookingId}/invoices/${invoiceId}/pdf`, `${inv.InvoiceNo as string || "Invoice"}.pdf`).catch(() => {})} />
        </View>

      </ScrollView>

      {/* Approve dialog */}
      <Sheet open={sheet === "approve"} title="Approve Invoice" sub={sub}
        cancel="Cancel" confirm="Approve" busy={busy} onClose={() => setSheet(null)}
        onConfirm={() => void run(
          () => crmSend(`/api/crm/invoices/${invoiceId}/approve`, "POST"),
          "Invoice approved"
        )}>
        <Kv label="Invoice no." value={inv.InvoiceNo as string} />
        <Kv label="Type" value={typeLabel} />
        <Kv label="Amount" value={money(inv.Amount)} />
        <Kv label="Booking" value={[inv.BookingNo, inv.UnitNo, inv.ProjectName].filter(Boolean).join(" · ")} />
      </Sheet>

      {/* Cancel dialog */}
      <Sheet open={sheet === "cancel"} title="Cancel / Void Invoice" sub={sub}
        cancel="Keep It" confirm="Void Invoice" danger busy={busy} disabled={!cancelReason.trim()}
        onClose={() => setSheet(null)}
        onConfirm={() => void run(
          () => crmSend(`/api/crm/invoices/${invoiceId}/cancel`, "POST", { Reason: cancelReason.trim() }),
          "Invoice cancelled"
        )}>
        <Kv label="Invoice no." value={inv.InvoiceNo as string} />
        <Kv label="Amount" value={money(inv.Amount)} />
        <Field label="Reason for cancellation" required hint="Required before voiding" value={cancelReason} onChange={setCancelReason} multiline />
      </Sheet>
    </>
  );
}

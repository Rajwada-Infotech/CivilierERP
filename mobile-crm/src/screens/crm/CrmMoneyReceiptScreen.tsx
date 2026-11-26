// Money receipt detail — amount, payment instrument, Finance link, bounce reason.
// Endpoints: GET /api/crm/money-receipts/:id
//            PUT /api/crm/money-receipts/:id/approve  — CRM editor approval
//            PUT /api/crm/money-receipts/:id/bounce   — mark as bounced (Approved → Bounced)
//            GET /api/crm/money-receipts/:id/pdf  (opens in device PDF viewer)
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
import { openDocument } from "@/utils/documents";

const STATUS_COLOR: Record<string, string> = {
  Pending:  "#f59e0b",
  Approved: "#10b981",
  Bounced:  "#ef4444",
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

export default function CrmMoneyReceiptScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmMoneyReceipt">>();
  const { receiptId } = params;
  const b = useBrand();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { canAccessPage, canDoAction } = useAuth();
  const qc = useQueryClient();

  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<null | "approve" | "bounce">(null);
  const [bounceReason, setBounceReason] = useState("");

  const q = useQuery<Row>({
    queryKey: ["crm-money-receipt", receiptId],
    queryFn: () => crmGet(`/api/crm/money-receipts/${receiptId}`),
  });

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

  const r = q.data;
  const statusColor = STATUS_COLOR[r.Status as string] ?? b.textSecondary;
  const hasInstrument = r.ChequeNo || r.ChequeDate || r.TransactionRef;
  const isBounced = r.Status === "Bounced";
  const isApproved = r.Status === "Approved";
  const isPending = r.Status === "Pending";
  const hasTax = Number(r.GSTAmount) > 0 || Number(r.BaseAmount) > 0;
  const canEdit = canDoAction("crm-money-receipts", "edit");

  const sub = `${r.ReceiptNo as string} · ${r.ApplicantName as string || ""}`;

  return (
    <>
      <ScrollView style={{ flex: 1, backgroundColor: b.surface }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 56 }}>

        {/* Identity */}
        <Section title="Receipt">
          <Kv label="Receipt no." value={r.ReceiptNo as string} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textFaint }}>Status</Text>
            <Pill label={r.Status as string} tone={statusColor} />
          </View>
          <Kv label="Received" value={fmtDate(r.ReceivedDate)} />
          <Kv label="Booking" value={[r.BookingNo, r.UnitNo, r.ProjectName].filter(Boolean).join(" · ")} />
          {r.BookingId && (canAccessPage("crm-bookings") || canAccessPage("crm-payments")) ? (
            <View style={{ flexDirection: "row", marginBottom: 4 }}>
              <ActionKey outline label="Open booking" onPress={() => nav.navigate("CrmBooking", { bookingId: Number(r.BookingId), title: r.BookingNo as string || "Booking" })} />
            </View>
          ) : null}
          <Kv label="Applicant" value={r.ApplicantName as string} />
          {isApproved && r.ApprovedAt ? <Kv label="Approved" value={fmtDate(r.ApprovedAt)} /> : null}
          {isBounced && r.BouncedReason ? (
            <View style={{ backgroundColor: b.dangerSoft, borderRadius: 8, padding: 10, marginTop: 4 }}>
              <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.danger, marginBottom: 2 }}>Bounce reason</Text>
              <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textPrimary }}>{r.BouncedReason as string}</Text>
            </View>
          ) : null}
        </Section>

        {/* Actions */}
        {isPending && canEdit ? (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <ActionKey label="Approve Receipt" onPress={() => setSheet("approve")} />
          </View>
        ) : null}
        {isApproved && canEdit ? (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <ActionKey outline tone={b.danger} label="Mark as Bounced" onPress={() => { setBounceReason(""); setSheet("bounce"); }} />
          </View>
        ) : null}

        {/* Amount */}
        <Section title="Amount">
          {hasTax ? (
            <>
              <Kv label="Base amount" value={money(r.BaseAmount)} />
              <Kv label="GST" value={money(r.GSTAmount)} />
              <View style={{ height: 1, backgroundColor: b.border, marginVertical: 4 }} />
            </>
          ) : null}
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>Total received</Text>
            <Text style={{ fontSize: 14, fontFamily: fonts.heading.bold, color: b.accent }}>{money(r.Amount)}</Text>
          </View>
          <Kv label="Mode" value={words(r.PaymentMode as string)} />
        </Section>

        {/* Instrument */}
        {hasInstrument ? (
          <Section title="Instrument">
            {r.ChequeNo ? <Kv label="Cheque no." value={r.ChequeNo as string} /> : null}
            {r.ChequeDate ? <Kv label="Cheque date" value={fmtDate(r.ChequeDate)} /> : null}
            {r.TransactionRef ? <Kv label="Transaction ref" value={r.TransactionRef as string} /> : null}
          </Section>
        ) : null}

        {/* Finance */}
        {r.RPDocNo ? (
          <Section title="Finance">
            <Kv label="Received Payment" value={r.RPDocNo as string} />
            {r.RPStatus ? <Kv label="Status" value={words(r.RPStatus as string)} /> : null}
          </Section>
        ) : null}

        {/* PDF */}
        <ActionKey
          label="Open PDF receipt"
          onPress={() =>
            openDocument(`/api/crm/money-receipts/${receiptId}/pdf`, `${r.ReceiptNo as string}.pdf`).catch(() => {})
          }
        />

      </ScrollView>

      {/* Approve dialog */}
      <Sheet open={sheet === "approve"} title="Approve Receipt" sub={sub}
        cancel="Cancel" confirm="Approve" busy={busy} onClose={() => setSheet(null)}
        onConfirm={() => void run(
          () => crmSend(`/api/crm/money-receipts/${receiptId}/approve`, "PUT"),
          "Receipt approved"
        )}>
        <Kv label="Booking" value={[r.BookingNo, r.UnitNo, r.ProjectName].filter(Boolean).join(" · ")} />
        <Kv label="Applicant" value={r.ApplicantName as string} />
        <Kv label="Amount" value={money(r.Amount)} />
        <Kv label="Mode" value={words(r.PaymentMode as string)} />
      </Sheet>

      {/* Bounce dialog */}
      <Sheet open={sheet === "bounce"} title="Mark Receipt as Bounced" sub={sub}
        cancel="Cancel" confirm="Mark Bounced" danger busy={busy} disabled={!bounceReason.trim()}
        onClose={() => setSheet(null)}
        onConfirm={() => void run(
          () => crmSend(`/api/crm/money-receipts/${receiptId}/bounce`, "PUT", { BouncedReason: bounceReason.trim() }),
          "Receipt marked as bounced"
        )}>
        <Kv label="Booking" value={[r.BookingNo, r.UnitNo, r.ProjectName].filter(Boolean).join(" · ")} />
        <Kv label="Amount" value={money(r.Amount)} />
        <Field label="Bounce reason" required hint="Required to mark as bounced" value={bounceReason} onChange={setBounceReason} multiline />
      </Sheet>
    </>
  );
}

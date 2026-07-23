// RN port of a scoped slice of src/pages/material/ExpenseBookingPreviewModal.tsx
// (~1450 lines on web) — Booking Information, Vendor/Supplier, Amount
// Breakdown (standard computeBreakdown path, using the stored rates — the
// live per-item GRN GST breakdown fetch isn't ported), and EMI details when
// enabled. Not yet ported: the Posting tab (GL journal entry view), GRN
// Items Summary table, Invoice & Allocation section, and Print/Edit
// actions — this is a read-only preview of what the register already shows,
// same "one page at a time" scoping as the rest of Finance mobile so far.
import { useRoute, type RouteProp } from "@react-navigation/native";
import { View, Text, ScrollView, ActivityIndicator, Pressable, Alert } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Truck, User, Package, Banknote, CreditCard, Receipt } from "lucide-react-native";
import { fetchInvoiceById, computeBreakdown } from "@/api/invoiceApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

const ACCENT = "#10b981";

function fmt(n: number) {
  return (n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function notBuiltYet(title: string) {
  Alert.alert(title, `The ${title} isn't built on mobile yet — use the web app for now.`);
}

function InfoTile({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <View
      className="rounded-xl px-3 py-2.5"
      style={{ width: "48%", marginBottom: 8, backgroundColor: `${colors.muted}50`, borderWidth: 1, borderColor: `${colors.border}80` }}
    >
      <Text style={{ color: `${colors.mutedForeground}b3`, fontSize: 9, fontFamily: fonts.body.regular, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</Text>
      <Text numberOfLines={1} style={{ color: mono ? ACCENT : colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold, marginTop: 2 }}>
        {value || "—"}
      </Text>
    </View>
  );
}

function SectionTitle({ icon: Icon, children }: { icon: React.ComponentType<{ size?: number; color?: string }>; children: string }) {
  return (
    <View className="flex-row items-center gap-1.5 mb-3">
      <Icon size={11} color={ACCENT} />
      <Text style={{ color: `${colors.mutedForeground}cc`, fontSize: 10, fontFamily: fonts.heading.bold, textTransform: "uppercase", letterSpacing: 1.2 }}>
        {children}
      </Text>
    </View>
  );
}

function BreakdownRow({ label, sub, amount, isAdd, bold, tint }: { label: string; sub?: string; amount: number; isAdd?: boolean; bold?: boolean; tint?: "green" | "red" | "muted" }) {
  const color = tint === "green" ? ACCENT : tint === "red" ? "#ef4444" : colors.foreground;
  return (
    <View className="flex-row items-center justify-between px-3.5 py-2.5" style={{ borderBottomWidth: 1, borderBottomColor: `${colors.border}50` }}>
      <View>
        <Text style={{ color: bold ? colors.foreground : colors.mutedForeground, fontSize: 12, fontFamily: bold ? fonts.heading.medium : fonts.body.regular }}>{label}</Text>
        {!!sub && <Text style={{ color: `${colors.mutedForeground}99`, fontSize: 9.5, fontFamily: fonts.body.regular, marginTop: 1 }}>{sub}</Text>}
      </View>
      <Text style={{ color, fontSize: bold ? 13.5 : 12.5, fontFamily: fonts.heading.semibold }}>
        {isAdd == null ? "" : isAdd ? "+ " : "− "}₹{fmt(amount)}
      </Text>
    </View>
  );
}

export default function InvoicePreviewScreen() {
  const route = useRoute<RouteProp<MainStackParamList, "InvoicePreview">>();
  const { id } = route.params;

  const { data: rec, isLoading, isError } = useQuery({
    queryKey: ["invoice", id],
    queryFn: () => fetchInvoiceById(id),
  });

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }

  if (isError || !rec) {
    return (
      <View className="flex-1 items-center justify-center px-6" style={{ backgroundColor: colors.background }}>
        <Text style={{ color: colors.destructive, fontSize: 13, fontFamily: fonts.body.medium, textAlign: "center" }}>
          Could not load this invoice.
        </Text>
      </View>
    );
  }

  const hasIgst = rec.igstRate > 0;
  const bd = computeBreakdown(rec.basicAmount, rec.cgstRate, rec.sgstRate, rec.igstRate, rec.billingTerms);
  const netAmount = rec.netAmount ?? bd.netAmount;
  const hasEmi = !!(rec.emi?.enabled && rec.emi.installmentCount > 0);

  return (
    <ScrollView className="flex-1" style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      {/* Header */}
      <View className="flex-row items-center gap-2 mb-1">
        <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: `${ACCENT}22`, borderWidth: 1, borderColor: `${ACCENT}40` }}>
          <Receipt size={14} color={ACCENT} />
        </View>
        <Text numberOfLines={1} style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 16, flexShrink: 1 }}>
          {rec.bookingReference || "—"}
        </Text>
      </View>
      <Text style={{ color: `${colors.mutedForeground}99`, fontSize: 10, fontFamily: fonts.body.regular, marginLeft: 40, textTransform: "uppercase", letterSpacing: 1 }}>
        Invoice · {rec.status}
      </Text>

      <Pressable
        onPress={() => notBuiltYet("Edit Invoice")}
        className="rounded-xl mt-4 mb-1 items-center"
        style={{ backgroundColor: ACCENT, paddingVertical: 10 }}
      >
        <Text style={{ color: "#fff", fontSize: 12.5, fontFamily: fonts.heading.semibold }}>Edit Invoice</Text>
      </Pressable>

      {/* Booking Information */}
      <View className="mt-6">
        <SectionTitle icon={CalendarDays}>Booking Information</SectionTitle>
        <View className="flex-row flex-wrap justify-between">
          <InfoTile label="Booking Date" value={rec.bookingDate} />
          <InfoTile label="Due Date" value={rec.dueDate} />
          <InfoTile label="Document Type" value={rec.docTypeName || rec.materialCategory} />
          <InfoTile label="Source Document" value={rec.sourceDocNo || (rec.eSourceType && rec.eSourceId ? `${rec.eSourceType}-${rec.eSourceId}` : null)} mono />
          <InfoTile label="Company" value={rec.companyName} />
          <InfoTile label="Project / Site" value={rec.projectName} />
        </View>
      </View>

      {/* Vendor / Supplier */}
      <View className="mt-4">
        <SectionTitle icon={Truck}>Vendor / Supplier</SectionTitle>
        <View className="flex-row gap-2.5">
          <View className="flex-1 flex-row items-center gap-2.5 rounded-xl px-3.5 py-3" style={{ backgroundColor: `${colors.muted}50`, borderWidth: 1, borderColor: `${colors.border}80` }}>
            <View className="w-7 h-7 rounded-lg items-center justify-center" style={{ backgroundColor: `${ACCENT}1f` }}>
              <User size={13} color={ACCENT} />
            </View>
            <View className="flex-1 min-w-0">
              <Text style={{ color: `${colors.mutedForeground}b3`, fontSize: 9, fontFamily: fonts.body.regular, textTransform: "uppercase" }}>Supplier</Text>
              <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold }}>{rec.supplier || "—"}</Text>
            </View>
          </View>
          {!!rec.materialCategory && (
            <View className="flex-1 flex-row items-center gap-2.5 rounded-xl px-3.5 py-3" style={{ backgroundColor: `${colors.muted}50`, borderWidth: 1, borderColor: `${colors.border}80` }}>
              <View className="w-7 h-7 rounded-lg items-center justify-center" style={{ backgroundColor: `${ACCENT}1f` }}>
                <Package size={13} color={ACCENT} />
              </View>
              <View className="flex-1 min-w-0">
                <Text style={{ color: `${colors.mutedForeground}b3`, fontSize: 9, fontFamily: fonts.body.regular, textTransform: "uppercase" }}>Category</Text>
                <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold }}>{rec.materialCategory}</Text>
              </View>
            </View>
          )}
        </View>
      </View>

      {/* Amount Breakdown */}
      <View className="mt-4">
        <SectionTitle icon={Banknote}>Amount Breakdown</SectionTitle>
        <View className="rounded-xl overflow-hidden" style={{ borderWidth: 1, borderColor: `${colors.border}80` }}>
          <BreakdownRow label="Basic Amount" amount={rec.basicAmount} bold />
          {bd.preRows.map((r, i) => (
            <BreakdownRow
              key={`pre-${i}`}
              label={r.term.masterTermName || `Term ${i + 1}`}
              sub={`${r.term.type === "percentage" ? `${r.term.value}%` : `₹${fmt(r.term.value)}`} · pre-GST`}
              amount={r.amount}
              isAdd={r.term.deductionType === "Addition"}
              tint={r.term.deductionType === "Addition" ? "green" : "red"}
            />
          ))}
          {!hasIgst && rec.cgstRate > 0 && <BreakdownRow label="CGST" amount={bd.cgstAmount} isAdd tint="muted" />}
          {!hasIgst && rec.sgstRate > 0 && <BreakdownRow label="SGST" amount={bd.sgstAmount} isAdd tint="muted" />}
          {hasIgst && <BreakdownRow label="IGST" amount={bd.igstAmount} isAdd tint="muted" />}
          {!hasIgst && rec.cgstRate === 0 && rec.sgstRate === 0 && (
            <View className="flex-row items-center justify-between px-3.5 py-2.5">
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular }}>GST</Text>
              <Text style={{ color: `${colors.mutedForeground}99`, fontSize: 11, fontFamily: fonts.body.regular }}>Not applicable</Text>
            </View>
          )}
          {bd.postRows.map((r, i) => (
            <BreakdownRow
              key={`post-${i}`}
              label={r.term.masterTermName || `Term ${i + 1}`}
              sub={`${r.term.type === "percentage" ? `${r.term.value}%` : `₹${fmt(r.term.value)}`} · post-GST`}
              amount={r.amount}
              isAdd={r.term.deductionType === "Addition"}
              tint={r.term.deductionType === "Addition" ? "green" : "red"}
            />
          ))}
          <View className="flex-row items-center justify-between px-3.5 py-3" style={{ backgroundColor: `${ACCENT}18` }}>
            <Text style={{ color: ACCENT, fontSize: 11, fontFamily: fonts.heading.bold, textTransform: "uppercase", letterSpacing: 0.8 }}>Net Payable</Text>
            <Text style={{ color: ACCENT, fontSize: 15, fontFamily: fonts.heading.bold }}>₹{fmt(netAmount)}</Text>
          </View>
        </View>
      </View>

      {/* EMI Details */}
      {hasEmi && (
        <View className="mt-4">
          <SectionTitle icon={CreditCard}>EMI / Installment Plan</SectionTitle>
          <View className="flex-row flex-wrap justify-between">
            <View className="rounded-xl items-center py-3" style={{ width: "48%", marginBottom: 8, backgroundColor: "#8b5cf61a", borderWidth: 1, borderColor: "#8b5cf640" }}>
              <Text style={{ color: `${colors.mutedForeground}b3`, fontSize: 9, fontFamily: fonts.body.regular, textTransform: "uppercase" }}>Installments</Text>
              <Text style={{ color: "#a78bfa", fontSize: 17, fontFamily: fonts.heading.bold, marginTop: 2 }}>{rec.emi.installmentCount}</Text>
            </View>
            <View className="rounded-xl items-center py-3" style={{ width: "48%", marginBottom: 8, backgroundColor: "#8b5cf61a", borderWidth: 1, borderColor: "#8b5cf640" }}>
              <Text style={{ color: `${colors.mutedForeground}b3`, fontSize: 9, fontFamily: fonts.body.regular, textTransform: "uppercase" }}>Per EMI</Text>
              <Text style={{ color: "#a78bfa", fontSize: 14, fontFamily: fonts.heading.bold, marginTop: 2 }}>₹{fmt(rec.emi.emiAmount)}</Text>
            </View>
            <View className="rounded-xl items-center py-3" style={{ width: "48%", backgroundColor: `${colors.muted}50`, borderWidth: 1, borderColor: `${colors.border}80` }}>
              <Text style={{ color: `${colors.mutedForeground}b3`, fontSize: 9, fontFamily: fonts.body.regular, textTransform: "uppercase" }}>Start Date</Text>
              <Text style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold, marginTop: 2 }}>{rec.emi.startDate || "—"}</Text>
            </View>
            <View className="rounded-xl items-center py-3" style={{ width: "48%", backgroundColor: `${colors.muted}50`, borderWidth: 1, borderColor: `${colors.border}80` }}>
              <Text style={{ color: `${colors.mutedForeground}b3`, fontSize: 9, fontFamily: fonts.body.regular, textTransform: "uppercase" }}>Frequency</Text>
              <Text style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold, marginTop: 2, textTransform: "capitalize" }}>{rec.emi.frequency || "Monthly"}</Text>
            </View>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

// RN port of src/pages/material/ExpenseBookingPreviewModal.tsx — Details
// tab (Booking Information, Vendor/Supplier, GRN Items Summary when
// GRN-linked, Amount Breakdown, EMI, Invoice & Allocation), a Posting tab
// (view-only GL journal entry preview — this app never auto-posts to the
// GL from mobile, unlike web's modal, which posts the instant the tab
// opens; that's a side-effecting money write kept web-only), and Print
// (expo-print renders a plain HTML invoice to PDF, expo-sharing opens the
// native share sheet — web's window.print() has no RN equivalent, this is
// the closest native analogue: share/save/print the generated PDF).
import { useState } from "react";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { View, Text, ScrollView, ActivityIndicator, Pressable, Alert } from "react-native";
import { useQuery } from "@tanstack/react-query";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { CalendarDays, Truck, User, Package, Banknote, CreditCard, Receipt, FileText, Wallet, Hash, Printer } from "lucide-react-native";
import { fetchInvoiceById, fetchGRNItemsFor, fetchInvoicePosting, computeBreakdown, type InvoiceRecord, type GRNItemLine } from "@/api/invoiceApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

const ACCENT = "#10b981";

function fmt(n: number) {
  return (n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

// Plain, print-safe HTML — deliberately not trying to match the app's dark
// glass UI (paper doesn't render backdrop-blur); this mirrors what web's
// window.print() actually produces: a light, readable, ink-cheap document.
function buildInvoiceHtml(rec: InvoiceRecord, bd: ReturnType<typeof computeBreakdown>, netAmount: number, grnItems: GRNItemLine[]): string {
  const row = (label: string, value: string) => `<tr><td class="lbl">${label}</td><td class="val">${value}</td></tr>`;
  const amtRow = (label: string, amount: number, sign = "") =>
    `<tr><td>${label}</td><td class="amt">${sign}₹${fmt(amount)}</td></tr>`;

  const termsRows = [
    ...bd.preRows.map((r) => amtRow(`${r.term.masterTermName || "Term"} (pre-GST)`, r.amount, r.term.deductionType === "Addition" ? "+ " : "− ")),
    ...bd.postRows.map((r) => amtRow(`${r.term.masterTermName || "Term"} (post-GST)`, r.amount, r.term.deductionType === "Addition" ? "+ " : "− ")),
  ].join("");

  const grnRows = grnItems.length
    ? `<h3>GRN Items</h3><table class="tbl">
        <tr><th>Item</th><th>Ordered</th><th>Received</th><th>UOM</th></tr>
        ${grnItems.map((it) => `<tr><td>${it.itemName || "—"}</td><td>${it.orderedQty}</td><td>${it.receivedQty}</td><td>${it.uom || ""}</td></tr>`).join("")}
      </table>`
    : "";

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #111; padding: 24px; }
          h1 { font-size: 20px; margin: 0 0 4px; }
          h2 { font-size: 13px; color: #555; margin: 0 0 20px; font-weight: normal; }
          h3 { font-size: 13px; margin: 20px 0 8px; text-transform: uppercase; letter-spacing: 0.5px; color: #333; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
          td, th { padding: 6px 4px; border-bottom: 1px solid #eee; font-size: 12px; text-align: left; }
          .lbl { color: #666; width: 40%; }
          .val { font-weight: 600; }
          .amt { text-align: right; }
          .tbl th { background: #f5f5f5; font-size: 11px; text-transform: uppercase; color: #666; }
          .net { font-weight: 700; font-size: 14px; background: #f0fdf4; }
        </style>
      </head>
      <body>
        <h1>${rec.bookingReference || "Invoice"}</h1>
        <h2>${rec.status} · ${rec.docTypeName || rec.materialCategory || "Invoice"}</h2>
        <table>
          ${row("Booking Date", rec.bookingDate || "—")}
          ${row("Due Date", rec.dueDate || "—")}
          ${row("Company", rec.companyName || "—")}
          ${row("Project / Site", rec.projectName || "—")}
          ${row("Supplier / Vendor", rec.supplier || "—")}
        </table>
        ${grnRows}
        <h3>Amount Breakdown</h3>
        <table>
          ${amtRow("Basic Amount", rec.basicAmount)}
          ${termsRows}
          ${rec.cgstRate > 0 ? amtRow("CGST", bd.cgstAmount, "+ ") : ""}
          ${rec.sgstRate > 0 ? amtRow("SGST", bd.sgstAmount, "+ ") : ""}
          ${rec.igstRate > 0 ? amtRow("IGST", bd.igstAmount, "+ ") : ""}
          <tr class="net"><td>Net Payable</td><td class="amt">₹${fmt(netAmount)}</td></tr>
        </table>
        ${rec.emi.enabled ? `<h3>EMI</h3><table>${row("Installments", String(rec.emi.installmentCount))}${row("Per EMI", `₹${fmt(rec.emi.emiAmount)}`)}${row("Start Date", rec.emi.startDate || "—")}</table>` : ""}
      </body>
    </html>
  `;
}

export default function InvoicePreviewScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute<RouteProp<MainStackParamList, "InvoicePreview">>();
  const { id } = route.params;
  const [tab, setTab] = useState<"details" | "posting">("details");

  const { data: rec, isLoading, isError } = useQuery({
    queryKey: ["invoice", id],
    queryFn: () => fetchInvoiceById(id),
  });

  const { data: grnItems = [] } = useQuery({
    queryKey: ["invoice-grn-items", id, rec?.eSourceType, rec?.eSourceId],
    queryFn: () => fetchGRNItemsFor(rec!.eSourceType, rec!.eSourceId, rec!.linkedGrnIds),
    enabled: !!rec && rec.eSourceType === "GRN",
  });

  const { data: posting, isLoading: postingLoading } = useQuery({
    queryKey: ["invoice-posting", id],
    queryFn: () => fetchInvoicePosting(id),
    enabled: tab === "posting",
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

  const handlePrint = async () => {
    try {
      const html = buildInvoiceHtml(rec, bd, netAmount, grnItems);
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: rec.bookingReference || "Invoice" });
      } else {
        await Print.printAsync({ uri });
      }
    } catch (e: any) {
      Alert.alert("Print failed", e?.message ?? "Could not generate the invoice PDF.");
    }
  };

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

      <View className="flex-row gap-2 mt-4 mb-1">
        <Pressable
          onPress={() => navigation.navigate("NewInvoice", { id: rec.id })}
          className="flex-1 rounded-xl items-center"
          style={{ backgroundColor: ACCENT, paddingVertical: 10 }}
        >
          <Text style={{ color: "#fff", fontSize: 12.5, fontFamily: fonts.heading.semibold }}>Edit Invoice</Text>
        </Pressable>
        <Pressable
          onPress={handlePrint}
          className="flex-row items-center justify-center gap-1.5 rounded-xl"
          style={{ paddingHorizontal: 16, borderWidth: 1, borderColor: `${colors.border}80` }}
        >
          <Printer size={14} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, fontSize: 12.5, fontFamily: fonts.heading.medium }}>Print</Text>
        </Pressable>
      </View>

      {/* Tab bar */}
      <View className="flex-row gap-1.5 mt-4 mb-1">
        {(["details", "posting"] as const).map((t) => {
          const active = tab === t;
          return (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              className="flex-1 flex-row items-center justify-center gap-1.5 py-2 rounded-lg"
              style={{ backgroundColor: active ? `${ACCENT}22` : "transparent", borderWidth: 1, borderColor: active ? `${ACCENT}50` : colors.border }}
            >
              {t === "details" ? <FileText size={12} color={active ? ACCENT : colors.mutedForeground} /> : <Wallet size={12} color={active ? ACCENT : colors.mutedForeground} />}
              <Text style={{ color: active ? ACCENT : colors.mutedForeground, fontSize: 11, fontFamily: fonts.heading.medium, textTransform: "capitalize" }}>{t}</Text>
            </Pressable>
          );
        })}
      </View>

      {tab === "posting" ? (
        <View className="mt-4">
          {postingLoading ? (
            <View className="py-10 items-center"><ActivityIndicator color={colors.mutedForeground} /></View>
          ) : !posting ? (
            <Text className="text-center py-8" style={{ color: `${colors.mutedForeground}80`, fontSize: 12, fontFamily: fonts.body.regular }}>Could not load posting data.</Text>
          ) : (
            <>
              <View className="flex-row items-center justify-between mb-3">
                <Text style={{ color: `${colors.mutedForeground}cc`, fontSize: 10, fontFamily: fonts.heading.bold, textTransform: "uppercase", letterSpacing: 1 }}>
                  Journal Entry — Invoice Posting
                </Text>
                {posting.isPosted ? (
                  <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: "#10b98122", borderWidth: 1, borderColor: "#10b98140" }}>
                    <Text style={{ color: "#10b981", fontSize: 9.5, fontFamily: fonts.heading.semibold }}>Posted · {posting.jvNo}</Text>
                  </View>
                ) : (
                  <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: "#f59e0b22", borderWidth: 1, borderColor: "#f59e0b40" }}>
                    <Text style={{ color: "#f59e0b", fontSize: 9.5, fontFamily: fonts.heading.semibold }}>Not posted</Text>
                  </View>
                )}
              </View>
              {posting.isGrnLinked && (
                <Text style={{ color: `${colors.mutedForeground}99`, fontSize: 10, fontFamily: fonts.body.regular, marginBottom: 10, lineHeight: 15 }}>
                  GRN-linked invoice — Provision for Pending GRN is debited (reversing the GRN posting); Supplier is credited.
                </Text>
              )}
              <View className="rounded-xl overflow-hidden" style={{ borderWidth: 1, borderColor: `${colors.border}80` }}>
                {posting.isGrnLinked ? (
                  <>
                    <BreakdownRow label={posting.accounts.pgrn?.label ?? "Provision for Pending GRN A/c"} amount={posting.baseAmount} isAdd tint="green" bold />
                    {posting.taxAmount > 0 && <BreakdownRow label={posting.accounts.gstCredit?.label ?? "GST Credit Available"} amount={posting.taxAmount} isAdd tint="green" />}
                    <BreakdownRow label={posting.accounts.supplier?.label ?? "Supplier / Creditor A/c"} amount={posting.totalAmount} isAdd={false} tint="red" bold />
                  </>
                ) : (
                  <>
                    <BreakdownRow label={posting.accounts.purchase?.label ?? "Purchase A/c"} amount={posting.totalAmount} isAdd tint="green" bold />
                    <BreakdownRow label={posting.accounts.supplier?.label ?? "Supplier / Creditor A/c"} amount={posting.totalAmount} isAdd={false} tint="red" bold />
                  </>
                )}
              </View>
            </>
          )}
        </View>
      ) : (
      <>
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

      {/* GRN Items Summary — only for GRN-linked invoices */}
      {rec.eSourceType === "GRN" && grnItems.length > 0 && (
        <View className="mt-4">
          <SectionTitle icon={Truck}>{`GRN Items Summary (${grnItems.length})`}</SectionTitle>
          <View className="rounded-xl overflow-hidden" style={{ borderWidth: 1, borderColor: `${colors.border}80` }}>
            {grnItems.map((it, i) => (
              <View
                key={i}
                className="flex-row items-center justify-between px-3.5 py-2.5"
                style={i < grnItems.length - 1 ? { borderBottomWidth: 1, borderBottomColor: `${colors.border}50` } : undefined}
              >
                <View className="flex-1 min-w-0 pr-2">
                  <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 11.5, fontFamily: fonts.body.medium }}>{it.itemName || "—"}</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular, marginTop: 1 }}>
                    Ordered {it.orderedQty} · Remaining {it.remainingQty} {it.uom}
                  </Text>
                </View>
                <Text style={{ color: it.remainingQty > 0 ? "#f59e0b" : colors.foreground, fontSize: 12, fontFamily: fonts.heading.semibold }}>
                  {it.receivedQty} {it.uom}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

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

      {/* Invoice & Allocation */}
      {(rec.vendorInvoiceNo || rec.costCenter || rec.glAccount || rec.workDoneRef) && (
        <View className="mt-4 mb-2">
          <SectionTitle icon={Hash}>Invoice & Allocation</SectionTitle>
          <View className="flex-row flex-wrap justify-between">
            {!!rec.vendorInvoiceNo && <InfoTile label="Vendor Invoice No" value={rec.vendorInvoiceNo} mono />}
            {!!rec.vendorInvoiceDate && <InfoTile label="Vendor Invoice Date" value={rec.vendorInvoiceDate} />}
            {!!rec.costCenter && <InfoTile label="Cost Centre" value={rec.costCenter} />}
            {!!rec.glAccount && <InfoTile label="GL Account" value={rec.glAccount} />}
            {!!rec.workDoneRef && <InfoTile label="Work Done Ref" value={rec.workDoneRef} mono />}
          </View>
        </View>
      )}
      </>
      )}
    </ScrollView>
  );
}

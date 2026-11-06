// RN port of src/pages/material/ExpenseBookingPreviewModal.tsx, on the drawing sheet (SheetShell with Back / Edit /
// Print keys, Details and Posting as ink segments, ruled panels) — Details
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
import { View, Text, ScrollView, Alert } from "react-native";
import { useQuery } from "@tanstack/react-query";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { ArrowLeft, CalendarDays, Truck, Package, Banknote, CreditCard, Hash, Printer } from "lucide-react-native";
import { fetchInvoiceById, fetchGRNItemsFor, fetchInvoicePosting, computeBreakdown, type InvoiceRecord, type GRNItemLine } from "@/api/invoiceApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors, sheet as S } from "@/theme/colors";
import { usePageRights } from "@/hooks/usePageRights";
import { Body, InfoGrid, Key, Label, Notice, Panel, Seg, SheetMark, SheetShell, Skel, StatGrid } from "@/components/sheet/Sheet";
import { fonts } from "@/theme/fonts";

function fmt(n: number) {
  return (n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** One line of the amount breakdown or the journal: label (and a note) on the left, the signed amount on the right. */
function BreakdownRow({ label, sub, amount, isAdd, bold, tint }: { label: string; sub?: string; amount: number; isAdd?: boolean; bold?: boolean; tint?: "green" | "red" | "muted" }) {
  const color = tint === "red" ? S.red : tint === "green" ? S.blue : S.ink;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: S.ruleSoft }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: bold ? S.ink : S.ink2, fontSize: 12.5, fontFamily: bold ? fonts.body.semibold : fonts.body.regular }}>{label}</Text>
        {!!sub && <Text style={{ color: S.graphite, fontSize: 10.5, fontFamily: fonts.body.regular, marginTop: 1 }}>{sub}</Text>}
      </View>
      <Text style={{ color, fontSize: bold ? 14 : 13, fontFamily: fonts.heading.semibold }}>
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
  const rights = usePageRights("expense-booking");

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

  if (isLoading || isError || !rec) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 96 }}>
        <SheetShell eyebrow="CivilierERP · Invoice" title="Invoice" action={<Key label="Back" icon={<ArrowLeft size={13} color={S.ink} />} onPress={() => navigation.goBack()} style={{ alignSelf: "flex-start" }} />}>
          {isLoading ? (
            <>
              <Skel h={120} />
              <Skel h={160} />
            </>
          ) : (
            <Notice>Could not load this invoice.</Notice>
          )}
        </SheetShell>
      </ScrollView>
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
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 96 }}>
      <SheetShell
        eyebrow={`CivilierERP · Invoice · ${rec.status || "Draft"}`}
        title={rec.bookingReference || "Invoice"}
        subtitle={[rec.docTypeName || rec.materialCategory, rec.supplier].filter(Boolean).join(" · ") || undefined}
        action={
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Key label="Back" icon={<ArrowLeft size={13} color={S.ink} />} onPress={() => navigation.goBack()} />
            {rights.canEdit && <Key tone="ink" label="Edit invoice" onPress={() => navigation.navigate("NewInvoice", { id: rec.id })} />}
            <Key label="Print" icon={<Printer size={13} color={S.ink} />} onPress={handlePrint} />
          </View>
        }
      >
        <Seg
          options={[
            { value: "details", label: "Details" },
            { value: "posting", label: "Posting" },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === "posting" ? (
          <Panel title="Journal entry · invoice posting">
            {postingLoading ? (
              <>
                <Skel h={30} />
                <Skel h={30} />
                <Skel h={30} />
              </>
            ) : !posting ? (
              <Notice>Could not load the posting.</Notice>
            ) : (
              <>
                <SheetMark text={posting.isPosted ? `Posted · ${posting.jvNo}` : "Not posted"} tone={posting.isPosted ? "done" : "waiting"} />
                {posting.isGrnLinked && (
                  <Body size={12} color={S.graphite}>
                    GRN-linked invoice: Provision for Pending GRN is debited (reversing the GRN posting); the supplier is credited.
                  </Body>
                )}
                <View>
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
          </Panel>
        ) : (
          <>
            <Panel title="Booking information" icon={<CalendarDays size={14} color={S.ink} />}>
              <InfoGrid
                items={[
                  { label: "Booking Date", value: rec.bookingDate || "—" },
                  { label: "Due Date", value: rec.dueDate || "—" },
                  { label: "Document Type", value: rec.docTypeName || rec.materialCategory || "—" },
                  { label: "Source Document", value: rec.sourceDocNo || (rec.eSourceType && rec.eSourceId ? `${rec.eSourceType}-${rec.eSourceId}` : "—") },
                  { label: "Company", value: rec.companyName || "—" },
                  { label: "Project / Site", value: rec.projectName || "—" },
                ]}
              />
            </Panel>

            <Panel title="Vendor / supplier" icon={<Truck size={14} color={S.ink} />}>
              <InfoGrid
                items={[
                  { label: "Supplier", value: <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 13.5, color: S.ink }}>{rec.supplier || "—"}</Text> },
                  ...(rec.materialCategory ? [{ label: "Category", value: rec.materialCategory }] : []),
                ]}
              />
            </Panel>

            {rec.eSourceType === "GRN" && grnItems.length > 0 && (
              <Panel title={`GRN items summary (${grnItems.length})`} icon={<Package size={14} color={S.ink} />}>
                <View>
                  {grnItems.map((it, i) => (
                    <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: S.ruleSoft }}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ color: S.ink, fontSize: 12.5, fontFamily: fonts.body.medium }}>{it.itemName || "—"}</Text>
                        <Body size={11} color={S.graphite}>{`Ordered ${it.orderedQty} · Remaining ${it.remainingQty} ${it.uom}`}</Body>
                      </View>
                      <Text style={{ color: it.remainingQty > 0 ? S.ink2 : S.ink, fontSize: 13, fontFamily: fonts.heading.semibold }}>
                        {it.receivedQty} {it.uom}
                      </Text>
                    </View>
                  ))}
                </View>
              </Panel>
            )}

            <Panel title="Amount breakdown" icon={<Banknote size={14} color={S.ink} />}>
              <View>
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
                  <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: S.ruleSoft }}>
                    <Body size={12.5} color={S.ink2}>GST</Body>
                    <Body size={12} color={S.graphite}>Not applicable</Body>
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
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 12, marginTop: 2, borderTopWidth: 1.5, borderTopColor: S.ink }}>
                  <Label color={S.ink}>Net payable</Label>
                  <Text style={{ color: S.ink, fontSize: 20, letterSpacing: -0.4, fontFamily: fonts.heading.semibold }}>₹{fmt(netAmount)}</Text>
                </View>
              </View>
            </Panel>

            {hasEmi && (
              <Panel title="EMI / installment plan" icon={<CreditCard size={14} color={S.ink} />}>
                <StatGrid
                  size={16}
                  items={[
                    { label: "Installments", value: String(rec.emi.installmentCount) },
                    { label: "Per EMI", value: `₹${fmt(rec.emi.emiAmount)}` },
                    { label: "Start date", value: rec.emi.startDate || "—" },
                    { label: "Frequency", value: rec.emi.frequency ? rec.emi.frequency[0].toUpperCase() + rec.emi.frequency.slice(1) : "Monthly" },
                  ]}
                />
              </Panel>
            )}

            {!!(rec.vendorInvoiceNo || rec.costCenter || rec.glAccount || rec.workDoneRef) && (
              <Panel title="Invoice & allocation" icon={<Hash size={14} color={S.ink} />}>
                <InfoGrid
                  items={[
                    ...(rec.vendorInvoiceNo ? [{ label: "Vendor Invoice No", value: rec.vendorInvoiceNo }] : []),
                    ...(rec.vendorInvoiceDate ? [{ label: "Vendor Invoice Date", value: rec.vendorInvoiceDate }] : []),
                    ...(rec.costCenter ? [{ label: "Cost Centre", value: rec.costCenter }] : []),
                    ...(rec.glAccount ? [{ label: "GL Account", value: rec.glAccount }] : []),
                    ...(rec.workDoneRef ? [{ label: "Work Done Ref", value: rec.workDoneRef }] : []),
                  ]}
                />
              </Panel>
            )}
          </>
        )}
      </SheetShell>
    </ScrollView>
  );
}

// RN port of Payment.tsx's viewingRec detail modal, on the drawing sheet (SheetShell with the action keys, ink
// segments for the tabs, ruled panels) — Details / Payment
// Chain / Posting tabs, plus Edit/Delete/Approve/Reject, Print (plain HTML
// voucher via expo-print + share, same approach as Invoice/Contract — no
// GST breakdown since PaymentRecord doesn't carry base/tax rates), and a
// user-triggered "Post to GL" action (web auto-posts the instant the
// Posting tab opens — a background side-effecting write; here it's an
// explicit button with a confirm, so nothing gets posted to the ledger
// without the user actually choosing to).
import { fmtIstStamp } from "@/utils/istTime";
import { useEffect, useState } from "react";
import { View, Text, Modal, ScrollView, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { X, AlertTriangle, RefreshCw, ArrowLeft, BookOpen, Pencil, Trash2, Check, Send, Printer } from "lucide-react-native";
import { colors, sheet as S } from "@/theme/colors";
import { Body, InfoGrid, Key, Label, Panel, Seg, SheetMark, SheetShell, Skel, StatGrid } from "@/components/sheet/Sheet";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import {
  getPaymentChain, getPaymentPosting, fetchPaymentSummary, computePaymentStatus,
  deletePayment, approvePayment, rejectPayment, postPaymentToGL, postBounceChargeToGL,
  type PaymentRecord, type PaymentChainItem, type ChainSummary } from "@/api/newPaymentApi";
import { StatusBadge, ModeBadge, DisplayStatusBadge } from "./PaymentBadges";

type Tab = "details" | "chain" | "posting";

// Plain, print-safe HTML — mirrors ContractDetailScreen's buildContractHtml
// approach (light/ink-cheap rather than matching the app's dark UI). Skips
// the GST/tax-rate section web's handlePrintPayment shows, since
// PaymentRecord doesn't carry base amount / CGST/SGST/IGST rates.
function buildPaymentHtml(r: PaymentRecord, supplier: ChainSummary["supplier"] | null): string {
  const row = (label: string, value?: string | null) => (value ? `<tr><td class="lbl">${label}</td><td class="val">${value}</td></tr>` : "");
  const ref = r.chequeNo ? `Cheque #${r.chequeNo}` : r.neftNumber || r.upiTransactionId || r.rtgsReference || r.impsReference || r.cardReference || null;
  const printedAt = fmtIstStamp(Date.now());

  const supplierRows = supplier
    ? [
        row("Supplier Name", supplier.name),
        row("Supplier Code", supplier.code),
        row("Address", supplier.address),
        row("Contact No.", supplier.phone),
        row("Email", supplier.email),
        row("GSTIN (GST Identification Number)", supplier.gst),
        row("PAN (Permanent Account Number)", supplier.pan),
      ].join("")
    : "";

  const paymentRows = [
    row("Payment Ref", r.docNo || "—"),
    row("Payment Purpose", r.paymentName),
    row("Paid To", r.paidTo),
    row("Date", r.date || "—"),
    row("Mode", r.mode || "—"),
    row("Bank Account", r.bankName),
    row("Reference / Txn ID", ref),
    row("Cheque Date", r.chequeDate),
    row("Cheque Lot", r.chequeLotNumber),
    row("Card Used", r.cardDisplay),
    row("Company", r.company || "—"),
    row("Project", r.project || "—"),
    row("Parent Doc", r.parentDocNo),
  ].join("");

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
          .amt { margin: 18px 0; padding: 14px 18px; background: #6467f210; border-radius: 10px; border: 1px solid #6467f220; }
          .amt .n { font-size: 26px; font-weight: 800; color: #6467f2; }
          .foot { margin-top: 28px; padding-top: 12px; border-top: 1px solid #eee; font-size: 10px; color: #999; display: flex; justify-content: space-between; }
        </style>
      </head>
      <body>
        <h1>Payment Receipt — ${r.docNo || r.paymentName}</h1>
        <h2>${r.status} · ${r.mode}</h2>
        <div class="amt">
          <div style="font-size:10px;text-transform:uppercase;color:#666;margin-bottom:2px;">Payment Amount</div>
          <div class="n">₹${Number(r.amount ?? 0).toLocaleString("en-IN")}</div>
        </div>
        ${supplierRows ? `<h3>Supplier / Vendor Information</h3><table>${supplierRows}</table>` : ""}
        <h3>Payment Information</h3>
        <table>${paymentRows}</table>
        <div class="foot">
          <span>This is a system-generated receipt and does not require a physical signature.</span>
          <span>Printed: ${printedAt}</span>
        </div>
      </body>
    </html>
  `;
}

export function PaymentDetailModal({
  record, onClose, onEdit, onDeleted, canDelete,
}: {
  record: PaymentRecord | null;
  onClose: () => void;
  onEdit?: (rec: PaymentRecord) => void;
  onDeleted?: () => void;
  canDelete?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("details");

  useEffect(() => {
    if (record) setTab("details");
  }, [record?.id]);

  const deleteMutation = useMutation({
    mutationFn: () => deletePayment(record!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payments-mobile"], exact: false });
      onDeleted?.();
    },
    onError: (e: Error) => Alert.alert("Delete failed", e.message),
  });

  const approveMutation = useMutation({
    mutationFn: () => approvePayment(record!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payments-mobile"], exact: false });
      onDeleted?.(); // closes the modal; the list refetch shows the new status
    },
    onError: (e: Error) => Alert.alert("Approve failed", e.message),
  });

  const rejectMutation = useMutation({
    mutationFn: () => rejectPayment(record!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payments-mobile"], exact: false });
      onDeleted?.();
    },
    onError: (e: Error) => Alert.alert("Reject failed", e.message),
  });

  const postMutation = useMutation({
    mutationFn: (kind: "payment" | "bounce_charge") => (kind === "payment" ? postPaymentToGL(record!.id) : postBounceChargeToGL(record!.id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payment-posting", record?.id] }),
    onError: (e: Error) => Alert.alert("Posting failed", e.message),
  });

  const confirmDelete = () => {
    Alert.alert("Delete Payment?", "This action cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate() },
    ]);
  };

  const confirmPost = (kind: "payment" | "bounce_charge", amount: number) => {
    Alert.alert(
      "Post to General Ledger?",
      `This creates a journal entry for ${formatINR(amount)} — it cannot be undone from here.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Post", onPress: () => postMutation.mutate(kind) },
      ],
    );
  };

  const handlePrint = async () => {
    if (!record) return;
    try {
      const html = buildPaymentHtml(record, summary?.supplier ?? null);
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: record.docNo || "Payment" });
      } else {
        await Print.printAsync({ uri });
      }
    } catch (e: any) {
      Alert.alert("Print failed", e?.message ?? "Could not generate the payment receipt.");
    }
  };

  const hasRef = !!record?.expenseRef;

  const { data: chainData, isLoading: chainLoading } = useQuery({
    queryKey: ["payment-chain", record?.expenseRef],
    queryFn: () => getPaymentChain(record!.expenseRef),
    enabled: !!record && hasRef && tab === "chain",
  });

  const { data: summary } = useQuery({
    queryKey: ["payment-summary", record?.expenseId],
    queryFn: () => fetchPaymentSummary(record!.expenseId),
    enabled: !!record && !!record.expenseId,
  });

  const { data: posting, isLoading: postingLoading } = useQuery({
    queryKey: ["payment-posting", record?.id, record?.expenseRef],
    queryFn: () => getPaymentPosting(record!.id, record!.expenseRef || undefined),
    enabled: !!record && tab === "posting",
  });

  if (!record) return null;

  const chainStatus = chainData
    ? computePaymentStatus(
        Number(chainData.invoice?.GrnTotalAmount || chainData.invoice?.ENetAmount || chainData.invoice?.EAmount || 0),
        chainData.payments,
      )
    : null;
  const invoiceTotal = chainData
    ? Number(chainData.invoice?.GrnTotalAmount || chainData.invoice?.ENetAmount || chainData.invoice?.EAmount || 0)
    : 0;

  const fields: { label: string; value: string }[] = [
    { label: "Payment Purpose", value: record.paymentName || "—" },
    { label: "Paid To", value: [record.supplierContact, record.paidTo].filter(Boolean).join(" · ") || "—" },
    { label: "Date", value: record.date || "—" },
    { label: "Mode", value: record.mode || "—" },
    { label: "Company", value: record.company || "—" },
    { label: "Project", value: record.project || "—" },
    { label: "Expense Ref", value: record.expenseRef || "—" },
    ...(record.jvNo ? [{ label: "Settles JV", value: record.jvNo }] : []),
    ...(record.bankName ? [{ label: "Bank", value: record.bankName }] : []),
    ...(record.chequeNo ? [{ label: "Cheque No.", value: `#${record.chequeNo}` }] : []),
    ...(record.chequeDate ? [{ label: "Cheque Date", value: record.chequeDate }] : []),
    ...(record.chequeLotNumber ? [{ label: "Cheque Lot", value: record.chequeLotNumber }] : []),
    ...(record.neftNumber ? [{ label: "NEFT Ref.", value: record.neftNumber }] : []),
    ...(record.upiTransactionId ? [{ label: "UPI Txn ID", value: record.upiTransactionId }] : []),
    ...(record.rtgsReference ? [{ label: "RTGS Ref.", value: record.rtgsReference }] : []),
    ...(record.impsReference ? [{ label: "IMPS Ref.", value: record.impsReference }] : []),
    ...(record.cardReference ? [{ label: "Card Ref.", value: record.cardReference }] : []),
    ...(record.cardDisplay ? [{ label: "Card Used", value: record.cardDisplay }] : []),
    ...(record.parentDocNo ? [{ label: "Parent Doc", value: record.parentDocNo }] : []),
  ];

  return (
    <Modal visible={!!record} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
          <SheetShell
            eyebrow={`CivilierERP · Payment${record.docNo ? ` · ${record.docNo}` : ""}`}
            title={formatINR(record.amount ?? 0)}
            subtitle={[record.paymentName, record.paidTo].filter(Boolean).join(" · ") || undefined}
            action={
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <Key label="Close" icon={<X size={13} color={S.ink} />} onPress={onClose} />
                {onEdit && <Key label="Edit" icon={<Pencil size={13} color={S.ink} />} onPress={() => onEdit(record)} />}
                {record.status === "Pending" && (
                  <>
                    <Key tone="ink" label={approveMutation.isPending ? "Approving…" : "Approve"} icon={<Check size={13} color={S.paper} />} onPress={() => approveMutation.mutate()} disabled={approveMutation.isPending} />
                    <Key tone="red" label={rejectMutation.isPending ? "Rejecting…" : "Reject"} onPress={() => rejectMutation.mutate()} disabled={rejectMutation.isPending} />
                  </>
                )}
                <Key label="Print" icon={<Printer size={13} color={S.ink} />} onPress={handlePrint} />
                {canDelete && <Key tone="red" label={deleteMutation.isPending ? "Deleting…" : "Delete"} icon={<Trash2 size={13} color="#ffffff" />} onPress={confirmDelete} disabled={deleteMutation.isPending} />}
              </View>
            }
          >
            {hasRef && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <Seg
                  options={[
                    { value: "details", label: "Details" },
                    { value: "chain", label: "Payment chain" },
                    { value: "posting", label: "Posting" },
                  ]}
                  value={tab}
                  onChange={setTab}
                />
              </ScrollView>
            )}

            {tab === "details" && (
              <>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <StatusBadge status={record.status} />
                  <ModeBadge mode={record.mode} />
                </View>

                {summary?.supplier && (
                  <Panel title="Supplier / vendor">
                    <Text style={{ color: S.ink, fontSize: 13.5, fontFamily: fonts.heading.semibold }}>
                      {summary.supplier.name}
                      {summary.supplier.code ? <Text style={{ color: S.graphite, fontFamily: fonts.body.regular }}>{`  ${summary.supplier.code}`}</Text> : null}
                    </Text>
                    {!!summary.supplier.gst && <Body size={12} color={S.graphite}>{`GSTIN ${summary.supplier.gst}`}</Body>}
                  </Panel>
                )}

                <Panel title="Payment">
                  <InfoGrid items={fields} />
                </Panel>
              </>
            )}

            {tab === "chain" && hasRef && (
              <Panel title="Payment chain">
                {chainLoading ? (
                  <>
                    <Skel h={60} />
                    <Skel h={60} />
                  </>
                ) : !chainData?.payments.length ? (
                  <Body size={12.5} color={S.graphite}>No payments found for this invoice.</Body>
                ) : (
                  <>
                    {invoiceTotal > 0 && chainStatus && (
                      <StatGrid
                        cols={3}
                        size={14}
                        items={[
                          { label: "Invoice", value: formatINR(invoiceTotal) },
                          { label: "Paid", value: formatINR(chainStatus.totalPaid) },
                          { label: "Outstanding", value: formatINR(chainStatus.remaining), red: chainStatus.remaining > 0 },
                        ]}
                      />
                    )}
                    <View>
                      {chainData.payments.map((p: PaymentChainItem, i: number) => (
                        <View key={p.PPaymentID} style={{ paddingVertical: 11, borderTopWidth: i ? 1 : 0, borderTopColor: S.ruleSoft, gap: 5 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                            <Text numberOfLines={1} style={{ flexShrink: 1, color: S.ink, fontSize: 12.5, fontFamily: fonts.heading.semibold }}>
                              {p.DocNo ?? "—"}
                              {p.PDate ? <Text style={{ color: S.graphite, fontFamily: fonts.body.regular }}>{`  ${p.PDate.slice(0, 10)}`}</Text> : null}
                            </Text>
                            <DisplayStatusBadge status={p.DisplayStatus} />
                          </View>
                          <Text style={{ color: S.ink, fontSize: 14, fontFamily: fonts.heading.semibold }}>
                            {formatINR(Number(p.PAmount ?? 0))}
                            {!!p.PMode && <Text style={{ color: S.graphite, fontSize: 11.5, fontFamily: fonts.body.regular }}>{`  ${p.PMode}`}</Text>}
                            {!!p.PChequeNo && <Text style={{ color: S.graphite, fontSize: 11.5, fontFamily: fonts.body.regular }}>{`  Chq #${p.PChequeNo}`}</Text>}
                          </Text>
                          {!!p.BounceDate && (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                              <AlertTriangle size={11} color={S.red} />
                              <Body size={11.5} color={S.red}>{`Bounced ${p.BounceDate.slice(0, 10)}${p.BounceReason ? ` · ${p.BounceReason}` : ""}`}</Body>
                            </View>
                          )}
                          {!!p.ReplacementDocNo && (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                              <RefreshCw size={11} color={S.blue} />
                              <Body size={11.5} color={S.blue}>{`Reissued as ${p.ReplacementDocNo}`}</Body>
                            </View>
                          )}
                          {!!p.OriginalDocNo && (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                              <ArrowLeft size={11} color={S.graphite} />
                              <Body size={11.5} color={S.graphite}>{`Replaces ${p.OriginalDocNo}`}</Body>
                            </View>
                          )}
                        </View>
                      ))}
                    </View>
                  </>
                )}
              </Panel>
            )}

            {tab === "posting" && (
              <Panel title="GL postings" icon={<BookOpen size={14} color={S.ink} />}>
                {postingLoading ? (
                  <>
                    <Skel h={70} />
                    <Skel h={70} />
                  </>
                ) : !posting?.entries?.length ? (
                  <Body size={12.5} color={S.graphite}>No approved payments to post yet.</Body>
                ) : (
                  <View>
                    {posting.entries.map((entry, i) => (
                      <View key={`${entry.pmtId}-${entry.type}`} style={{ paddingVertical: 11, borderTopWidth: i ? 1 : 0, borderTopColor: S.ruleSoft, gap: 6 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <Label color={S.ink}>{`${entry.type === "bounce_charge" ? "Bounce charge" : "Payment"} · ${entry.docNo}`}</Label>
                          <SheetMark text={entry.isPosted ? `Posted · ${entry.jvNo}` : "Not posted"} tone={entry.isPosted ? "done" : "waiting"} />
                        </View>
                        <Text style={{ color: S.ink, fontSize: 15, fontFamily: fonts.heading.semibold }}>{formatINR(entry.amount)}</Text>
                        <Body size={11.5} color={S.graphite}>
                          {entry.type === "bounce_charge"
                            ? `Dr ${entry.accounts?.bankCharges?.label ?? "Bank Charges"} → Cr ${entry.accounts?.bank?.label ?? "Bank A/c"}`
                            : `Dr ${entry.accounts?.supplier?.label ?? "Supplier A/c"} → Cr ${entry.accounts?.bank?.label ?? "Bank A/c"}`}
                        </Body>
                        {!entry.isPosted && (
                          <Key
                            tone="ink"
                            label={postMutation.isPending ? "Posting…" : "Post to GL"}
                            icon={<Send size={12} color={S.paper} />}
                            onPress={() => confirmPost(entry.type, entry.amount)}
                            disabled={postMutation.isPending}
                            style={{ alignSelf: "flex-start", minHeight: 36 }}
                          />
                        )}
                      </View>
                    ))}
                  </View>
                )}
              </Panel>
            )}
          </SheetShell>
        </ScrollView>
      </View>
    </Modal>
  );
}

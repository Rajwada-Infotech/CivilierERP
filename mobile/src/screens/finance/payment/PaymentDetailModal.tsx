// RN port of Payment.tsx's viewingRec detail modal — Details / Payment
// Chain / Posting tabs. View-only: unlike web, the Posting tab never calls
// post-to-gl / post-bounce-charge-to-gl (see newPaymentApi.getPaymentPosting)
// — it only ever displays whatever posting state already exists.
import { useEffect, useState } from "react";
import { View, Text, Modal, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import {
  X, Receipt, ArrowRight, AlertTriangle, RefreshCw, ArrowLeft, BookOpen,
} from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import {
  getPaymentChain, getPaymentPosting, fetchPaymentSummary, computePaymentStatus,
  type PaymentRecord, type PaymentChainItem, type DisplayStatus,
} from "@/api/newPaymentApi";
import { StatusBadge, ModeBadge, DisplayStatusBadge } from "./PaymentBadges";

type Tab = "details" | "chain" | "posting";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ width: "50%", paddingRight: 8, marginBottom: 12 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 9.5, fontFamily: fonts.heading.medium, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </Text>
      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.body.medium, marginTop: 2 }}>
        {value}
      </Text>
    </View>
  );
}

const CHAIN_COLOR = (ds: DisplayStatus) =>
  ds === "Success" || ds === "Cheque Cleared" ? "#059669" :
  ds === "Pending" ? "#d97706" :
  ds === "Cheque Issued" ? "#2563eb" :
  ds === "Cheque Bounced" ? "#dc2626" :
  ds === "Reissued" ? "#7c3aed" : colors.mutedForeground;

export function PaymentDetailModal({ record, onClose }: { record: PaymentRecord | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("details");

  useEffect(() => {
    if (record) setTab("details");
  }, [record?.id]);

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

  return (
    <Modal visible={!!record} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ paddingTop: insets.top + 8 }}>
          <View className="flex-row items-center justify-between px-4 pb-3">
            <View className="flex-row items-center gap-2.5 flex-1 min-w-0">
              <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: `${colors.primary}26` }}>
                <Receipt size={14} color={colors.primary} />
              </View>
              <View className="min-w-0">
                <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>Payment Details</Text>
                {!!record.docNo && (
                  <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular }}>{record.docNo}</Text>
                )}
              </View>
            </View>
            <Pressable onPress={onClose} className="w-8 h-8 rounded-lg items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
              <X size={15} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {hasRef && (
            <View className="flex-row px-4" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
              {(["details", "chain", "posting"] as Tab[]).map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setTab(t)}
                  style={{ paddingHorizontal: 4, paddingVertical: 10, marginRight: 20, borderBottomWidth: 2, borderBottomColor: tab === t ? colors.primary : "transparent" }}
                >
                  <Text style={{ color: tab === t ? colors.primary : colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.medium }}>
                    {t === "details" ? "Details" : t === "chain" ? "Payment Chain" : "Posting"}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
          {tab === "details" && (
            <>
              <View className="flex-row items-center gap-2 mb-4">
                <StatusBadge status={record.status} />
                <ModeBadge mode={record.mode} />
              </View>

              {summary?.supplier && (
                <View className="rounded-xl p-3 mb-3" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 9.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
                    Supplier / Vendor
                  </Text>
                  <Text style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.body.medium }}>
                    {summary.supplier.name}{summary.supplier.code ? ` · ${summary.supplier.code}` : ""}
                  </Text>
                  {!!summary.supplier.gst && (
                    <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular, marginTop: 2 }}>
                      GSTIN: {summary.supplier.gst}
                    </Text>
                  )}
                </View>
              )}

              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                <Field label="Payment Purpose" value={record.paymentName || "—"} />
                <Field label="Paid To" value={[record.supplierContact, record.paidTo].filter(Boolean).join(" · ") || "—"} />
                <Field label="Amount" value={formatINR(record.amount ?? 0)} />
                <Field label="Date" value={record.date || "—"} />
                <Field label="Mode" value={record.mode || "—"} />
                <Field label="Company" value={record.company || "—"} />
                <Field label="Project" value={record.project || "—"} />
                <Field label="Expense Ref" value={record.expenseRef || "—"} />
                {!!record.bankName && <Field label="Bank" value={record.bankName} />}
                {!!record.chequeNo && <Field label="Cheque No." value={`#${record.chequeNo}`} />}
                {!!record.chequeDate && <Field label="Cheque Date" value={record.chequeDate} />}
                {!!record.chequeLotNumber && <Field label="Cheque Lot" value={record.chequeLotNumber} />}
                {!!record.neftNumber && <Field label="NEFT Ref." value={record.neftNumber} />}
                {!!record.upiTransactionId && <Field label="UPI Txn ID" value={record.upiTransactionId} />}
                {!!record.rtgsReference && <Field label="RTGS Ref." value={record.rtgsReference} />}
                {!!record.impsReference && <Field label="IMPS Ref." value={record.impsReference} />}
                {!!record.cardReference && <Field label="Card Ref." value={record.cardReference} />}
                {!!record.cardDisplay && <Field label="Card Used" value={record.cardDisplay} />}
                {!!record.parentDocNo && <Field label="Parent Doc" value={record.parentDocNo} />}
              </View>
            </>
          )}

          {tab === "chain" && hasRef && (
            <View>
              {chainLoading ? (
                <View className="py-16 items-center"><ActivityIndicator color={colors.mutedForeground} /></View>
              ) : !chainData?.payments.length ? (
                <Text style={{ textAlign: "center", color: colors.mutedForeground, fontSize: 12, paddingVertical: 24 }}>
                  No payments found for this invoice.
                </Text>
              ) : (
                <>
                  {invoiceTotal > 0 && chainStatus && (
                    <View className="rounded-xl p-3 mb-4 flex-row" style={{ backgroundColor: `${colors.primary}0d`, borderWidth: 1, borderColor: `${colors.primary}33` }}>
                      <View style={{ flex: 1, alignItems: "center" }}>
                        <Text style={{ color: colors.mutedForeground, fontSize: 8.5, fontFamily: fonts.body.regular, textTransform: "uppercase" }}>Invoice</Text>
                        <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.bold, marginTop: 2 }}>{formatINR(invoiceTotal)}</Text>
                      </View>
                      <View style={{ flex: 1, alignItems: "center" }}>
                        <Text style={{ color: colors.mutedForeground, fontSize: 8.5, fontFamily: fonts.body.regular, textTransform: "uppercase" }}>Paid</Text>
                        <Text style={{ color: "#059669", fontSize: 12, fontFamily: fonts.heading.bold, marginTop: 2 }}>{formatINR(chainStatus.totalPaid)}</Text>
                      </View>
                      <View style={{ flex: 1, alignItems: "center" }}>
                        <Text style={{ color: colors.mutedForeground, fontSize: 8.5, fontFamily: fonts.body.regular, textTransform: "uppercase" }}>Outstanding</Text>
                        <Text style={{ color: chainStatus.remaining > 0 ? "#d97706" : colors.mutedForeground, fontSize: 12, fontFamily: fonts.heading.bold, marginTop: 2 }}>
                          {formatINR(chainStatus.remaining)}
                        </Text>
                      </View>
                    </View>
                  )}
                  <View style={{ gap: 10 }}>
                    {chainData.payments.map((p: PaymentChainItem) => {
                      const ds = p.DisplayStatus;
                      const c = CHAIN_COLOR(ds);
                      return (
                        <View key={p.PPaymentID} className="rounded-xl p-3" style={{ borderWidth: 1, borderLeftWidth: 3, borderColor: colors.border, borderLeftColor: c, backgroundColor: `${colors.card}80` }}>
                          <View className="flex-row items-center justify-between mb-1.5">
                            <Text style={{ color: colors.foreground, fontSize: 11, fontFamily: fonts.heading.semibold }}>
                              {p.DocNo ?? "—"}{p.PDate ? `  ·  ${p.PDate.slice(0, 10)}` : ""}
                            </Text>
                            <DisplayStatusBadge status={ds} />
                          </View>
                          <View className="flex-row items-center gap-2.5">
                            <Text style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.bold }}>
                              {formatINR(Number(p.PAmount ?? 0))}
                            </Text>
                            {!!p.PMode && <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>· {p.PMode}</Text>}
                            {!!p.PChequeNo && <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>· Chq #{p.PChequeNo}</Text>}
                          </View>
                          {!!p.BounceDate && (
                            <View className="flex-row items-center gap-1 mt-1.5">
                              <AlertTriangle size={9} color="#dc2626" />
                              <Text style={{ color: "#dc2626", fontSize: 10 }}>
                                Bounced {p.BounceDate.slice(0, 10)}{p.BounceReason ? ` — ${p.BounceReason}` : ""}
                              </Text>
                            </View>
                          )}
                          {!!p.ReplacementDocNo && (
                            <View className="flex-row items-center gap-1 mt-1.5">
                              <RefreshCw size={9} color="#7c3aed" />
                              <Text style={{ color: "#7c3aed", fontSize: 10 }}>Reissued as {p.ReplacementDocNo}</Text>
                            </View>
                          )}
                          {!!p.OriginalDocNo && (
                            <View className="flex-row items-center gap-1 mt-1.5">
                              <ArrowLeft size={9} color={colors.mutedForeground} />
                              <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>Replaces {p.OriginalDocNo}</Text>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                </>
              )}
            </View>
          )}

          {tab === "posting" && (
            <View>
              <View className="flex-row items-center gap-2 mb-3">
                <BookOpen size={13} color={colors.primary} />
                <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  GL Postings
                </Text>
              </View>
              {postingLoading ? (
                <View className="py-16 items-center"><ActivityIndicator color={colors.mutedForeground} /></View>
              ) : !posting?.entries?.length ? (
                <Text style={{ textAlign: "center", color: colors.mutedForeground, fontSize: 12, paddingVertical: 24 }}>
                  No approved payments to post yet.
                </Text>
              ) : (
                <View style={{ gap: 10 }}>
                  {posting.entries.map((entry) => (
                    <View key={`${entry.pmtId}-${entry.type}`} className="rounded-xl overflow-hidden" style={{ borderWidth: 1, borderColor: colors.border }}>
                      <View className="flex-row items-center justify-between px-3 py-2" style={{ backgroundColor: `${colors.muted}80` }}>
                        <Text style={{ color: colors.mutedForeground, fontSize: 9.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase" }}>
                          {entry.type === "bounce_charge" ? "Bounce Charge" : "Payment"} · {entry.docNo}
                        </Text>
                        {entry.isPosted ? (
                          <Text style={{ color: "#059669", fontSize: 10, fontFamily: fonts.body.semibold }}>✓ {entry.jvNo}</Text>
                        ) : (
                          <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.medium }}>Not posted</Text>
                        )}
                      </View>
                      <View className="px-3 py-2.5">
                        <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.bold }}>{formatINR(entry.amount)}</Text>
                        <Text style={{ color: colors.mutedForeground, fontSize: 10, marginTop: 2 }}>
                          {entry.type === "bounce_charge"
                            ? `Dr ${entry.accounts?.bankCharges?.label ?? "Bank Charges"} → Cr ${entry.accounts?.bank?.label ?? "Bank A/c"}`
                            : `Dr ${entry.accounts?.supplier?.label ?? "Supplier A/c"} → Cr ${entry.accounts?.bank?.label ?? "Bank A/c"}`}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

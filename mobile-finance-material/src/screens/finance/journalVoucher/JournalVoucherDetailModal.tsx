// RN port of JournalVoucher.tsx's viewingJV dialog, on the drawing sheet: the voucher's number as the title with its
// date, company, project and who made it; its status and whether it is posted to the GL; the narration; the payment mode
// when the voucher carries one; and the journal entry — every line's ledger with its debit or credit, totalled. Approve /
// Reject (a Pending voucher), Edit (not while Pending) and Delete sit in the title block, as the list row offers them.
import { View, Text, Modal, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Check, Pencil, Trash2, X } from "lucide-react-native";
import { getJournalVoucher, type JournalVoucherDetail } from "@/api/journalVoucherApi";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, Key, Label, Notice, Panel, SheetMark, SheetShell, Skel, statusTone } from "@/components/sheet/Sheet";

const fmt2 = (n: number) => `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function fmtDate(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function JournalVoucherDetailModal({
  id, onClose, onApprove, onReject, onEdit, onDelete, acting,
}: {
  id: number | null;
  onClose: () => void;
  onApprove?: (id: number) => void;
  onReject?: (id: number) => void;
  onEdit?: (id: number) => void;
  onDelete?: (jv: JournalVoucherDetail) => void;
  acting?: "approve" | "reject" | null;
}) {
  const insets = useSafeAreaInsets();
  const { data: jv, isLoading, isError } = useQuery({ queryKey: ["journal-voucher", id], queryFn: () => getJournalVoucher(id!), enabled: id != null });
  const extra = (jv ?? {}) as JournalVoucherDetail & {
    CreatedBy?: string; CreatedByName?: string; Mode?: string; BankName?: string; ChequeNo?: string; ChequeLotNumber?: string; ChequeDate?: string; DigitalRefNumber?: string;
  };

  const debit = (jv?.lines ?? []).reduce((s, l) => s + (Number(l.DebitAmount) || 0), 0);
  const credit = (jv?.lines ?? []).reduce((s, l) => s + (Number(l.CreditAmount) || 0), 0);
  const status = jv?.Status || "Draft";

  return (
    <Modal visible={id != null} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
          <SheetShell
            eyebrow="CivilierERP · Finance · Journal voucher"
            title={jv ? jv.JVNo || `JV-${jv.JVID}` : "Journal voucher"}
            subtitle={
              jv
                ? [fmtDate(jv.JVDate), jv.CompanyName, jv.ProjectName, extra.CreatedByName || extra.CreatedBy ? `Created by ${extra.CreatedByName || extra.CreatedBy}` : null]
                    .filter(Boolean)
                    .join(" · ")
                : undefined
            }
            action={
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <Key label="Close" icon={<X size={13} color={S.ink} />} onPress={onClose} />
                {jv && status === "Pending" && onApprove && (
                  <Key tone="ink" label={acting === "approve" ? "Approving…" : "Approve"} icon={<Check size={13} color={S.paper} />} onPress={() => onApprove(jv.JVID)} disabled={!!acting} />
                )}
                {jv && status === "Pending" && onReject && <Key tone="red" label={acting === "reject" ? "Rejecting…" : "Reject"} onPress={() => onReject(jv.JVID)} disabled={!!acting} />}
                {jv && status !== "Pending" && onEdit && <Key label="Edit" icon={<Pencil size={13} color={S.ink} />} onPress={() => onEdit(jv.JVID)} />}
                {jv && onDelete && <Key tone="red" label="Delete" icon={<Trash2 size={13} color="#ffffff" />} onPress={() => onDelete(jv)} />}
              </View>
            }
          >
            {isLoading ? (
              <>
                <Skel h={40} />
                <Skel h={160} />
              </>
            ) : isError || !jv ? (
              <Notice>Could not load this journal voucher.</Notice>
            ) : (
              <>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                  <SheetMark text={status} tone={/draft/i.test(status) ? "draft" : statusTone(status)} />
                  {status === "Approved" && <SheetMark text={jv.PostedToGL ? "Posted to GL" : "Not posted"} tone={jv.PostedToGL ? "done" : "stopped"} />}
                </View>

                {!!jv.Narration && <Body size={13.5} color={S.ink}>{jv.Narration}</Body>}

                {!!extra.Mode && (
                  <Panel title="Payment mode">
                    <Body size={13.5} weight="medium">{extra.Mode}</Body>
                    {!!extra.BankName && <Body size={12} color={S.graphite}>{`Bank: ${extra.BankName}`}</Body>}
                    {!!extra.ChequeNo && (
                      <Body size={12} color={S.graphite}>
                        {`${extra.ChequeLotNumber ? `${extra.ChequeLotNumber} · ` : ""}Cheque #${extra.ChequeNo}${extra.ChequeDate ? ` · ${fmtDate(extra.ChequeDate)}` : ""}`}
                      </Body>
                    )}
                    {!!extra.DigitalRefNumber && <Body size={12} color={S.graphite}>{`Ref: ${extra.DigitalRefNumber}`}</Body>}
                  </Panel>
                )}

                <Panel title="Journal entry" icon={<BookOpen size={14} color={S.ink} />}>
                  <View>
                    <View style={{ flexDirection: "row", paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: S.ink }}>
                      <Label style={{ flex: 1 }}>Ledger</Label>
                      <Label style={{ width: 92, textAlign: "right" }}>Debit</Label>
                      <Label style={{ width: 92, textAlign: "right" }}>Credit</Label>
                    </View>
                    {jv.lines.map((l, i) => {
                      const isDebit = Number(l.DebitAmount) > 0;
                      return (
                        <View key={l.LineID ?? i} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: S.ruleSoft, gap: 4 }}>
                          <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 7 }}>
                            <View style={{ width: 6, height: 6, backgroundColor: isDebit ? S.ink : S.red }} />
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text numberOfLines={2} style={{ color: S.ink, fontSize: 12.5, fontFamily: fonts.body.medium }}>{l.LHeadName || "—"}</Text>
                              {!!l.Narration && <Text numberOfLines={1} style={{ color: S.graphite, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 1 }}>{l.Narration}</Text>}
                            </View>
                          </View>
                          <Text style={{ width: 92, textAlign: "right", color: S.ink, fontSize: 12.5, fontFamily: fonts.heading.semibold }}>{l.DebitAmount ? fmt2(l.DebitAmount) : ""}</Text>
                          <Text style={{ width: 92, textAlign: "right", color: S.red, fontSize: 12.5, fontFamily: fonts.heading.semibold }}>{l.CreditAmount ? fmt2(l.CreditAmount) : ""}</Text>
                        </View>
                      );
                    })}
                    <View style={{ flexDirection: "row", alignItems: "center", paddingTop: 10, borderTopWidth: 1.5, borderTopColor: S.ink, marginTop: -1 }}>
                      <Label color={S.ink} style={{ flex: 1 }}>Total</Label>
                      <Text style={{ width: 92, textAlign: "right", color: S.ink, fontSize: 13, fontFamily: fonts.heading.bold }}>{fmt2(debit)}</Text>
                      <Text style={{ width: 92, textAlign: "right", color: S.red, fontSize: 13, fontFamily: fonts.heading.bold }}>{fmt2(credit)}</Text>
                    </View>
                  </View>
                </Panel>
              </>
            )}
          </SheetShell>
        </ScrollView>
      </View>
    </Modal>
  );
}

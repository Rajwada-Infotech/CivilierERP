// RN port of QtView.tsx, on the drawing sheet: the request for quotation's number as the title with its date, company
// and project; its status; the particulars (company, project, date, due, source MR, remarks); the items line by line;
// and the tagged suppliers — each with its status, invited date and the payment term its purchase order will start
// with (picked here with the edit right). Keys in the title block: Print (a shared PDF), Edit and Send to suppliers
// while Draft, Delete while Draft. Deferred vs. web: DocumentChainPanel.
import { useState } from "react";
import { View, Alert } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Download, Pencil, Send, Trash2, Truck } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { getQuotationById, deleteQuotation, sendQuotation, setSupplierPaymentTerm, getPaymentTermOptions, type Quotation } from "@/api/quotationApi";
import { OptionPickerModal, PickerRow } from "@/screens/finance/payment/OptionPicker";
import { Body, InfoGrid, Key, Panel, SheetMark, statusTone } from "@/components/sheet/Sheet";
import { DetailSheet, LineList, fmtDate } from "@/components/sheet/Register";
import { esc, sharePdf } from "@/screens/finance/statements/StatementParts";
import { qtStatusLabel, qtStatusTone } from "./status";

function quotationHtml(r: Quotation) {
  const items = (r.items ?? []).map((it, i) => `<tr><td>${i + 1}</td><td>${esc(it.ItemName || it.ItemId)}</td><td>${esc(it.UOMName || it.UOMCode || "")}</td><td class="amt">${esc(it.Quantity)}</td></tr>`).join("");
  const sups = (r.suppliers ?? []).map((s) => `<tr><td>${esc(s.SupplierName)}</td><td>${esc(s.Status)}</td><td>${esc(s.PaymentTermName || "—")}</td><td>${esc(fmtDate(s.InvitedAt))}</td></tr>`).join("");
  return `<table><tr><th>Company</th><th>Project</th><th>Date</th><th>Source MR</th></tr><tr><td>${esc(r.CompanyName || "—")}</td><td>${esc(r.ProjectName || "—")}</td><td>${esc(fmtDate(r.DocDate))}</td><td>${esc(r.SourceMRDocNo || "—")}</td></tr></table>
    <h2 style="text-align:left;margin-top:16px">Items</h2><table><tr><th>#</th><th>Item</th><th>UOM</th><th class="amt">Qty</th></tr>${items}</table>
    <h2 style="text-align:left;margin-top:16px">Suppliers</h2><table><tr><th>Supplier</th><th>Status</th><th>Payment terms</th><th>Invited</th></tr>${sups}</table>`;
}

export function QuotationDetailModal({
  recordId, onClose, onEdit, canEdit, canDelete,
}: { recordId: number | null; onClose: () => void; onEdit?: (id: number) => void; canEdit?: boolean; canDelete?: boolean }) {
  const qc = useQueryClient();
  const [termFor, setTermFor] = useState<number | null>(null);
  const [printing, setPrinting] = useState(false);

  const { data: r, isLoading, isError, error, refetch } = useQuery<Quotation>({
    queryKey: ["qt-detail", recordId],
    queryFn: () => getQuotationById(recordId!),
    enabled: recordId != null,
  });
  const { data: terms = [] } = useQuery({ queryKey: ["payment-terms-po"], queryFn: getPaymentTermOptions, enabled: recordId != null && !!canEdit });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["qt-list"] });
    qc.invalidateQueries({ queryKey: ["qt-detail", recordId] });
  };
  const sendMutation = useMutation({
    mutationFn: () => sendQuotation(recordId!),
    onSuccess: () => {
      refresh();
      Alert.alert("Sent", "The quotation went to the tagged suppliers.");
    },
    onError: (e: any) => Alert.alert("Could not send", e.message ?? "Something went wrong."),
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteQuotation(recordId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["qt-list"] });
      onClose();
    },
    onError: (e: any) => Alert.alert("Could not delete", e.message ?? "Something went wrong."),
  });
  const termMutation = useMutation({
    mutationFn: (v: { supplierId: number; termId: number | null }) => setSupplierPaymentTerm(recordId!, v.supplierId, v.termId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["qt-detail", recordId] }),
    onError: (e: any) => Alert.alert("Could not save the payment term", e.message ?? "Something went wrong."),
  });

  const status = r?.Status || "Draft";
  const draft = status === "Draft";
  const busy = sendMutation.isPending || deleteMutation.isPending;
  const termSupplier = r?.suppliers?.find((s) => s.SupplierLHeadId === termFor);

  const print = async () => {
    if (!r) return;
    setPrinting(true);
    await sharePdf("Request for quotation", `${r.DocNo || ""} · ${qtStatusLabel(status === "Pending" ? "Provisional" : status)}`, quotationHtml(r));
    setPrinting(false);
  };

  return (
    <DetailSheet
        visible={recordId != null}
        onClose={onClose}
        eyebrow="CivilierERP · Material · Request for quotation"
        title={r?.DocNo || (r ? `QT-${r.QuotationId}` : "Quotation")}
        subtitle={r ? [fmtDate(r.DocDate), r.CompanyName, r.ProjectName].filter(Boolean).join(" · ") : undefined}
        actions={
          r ? (
            <>
              <Key label={printing ? "Preparing…" : "Print"} icon={<Download size={13} color={S.ink} />} onPress={print} disabled={printing} />
              {draft && canEdit && onEdit && <Key label="Edit" icon={<Pencil size={13} color={S.ink} />} onPress={() => onEdit(r.QuotationId)} />}
              {draft && canEdit && (
                <Key tone="ink" label={sendMutation.isPending ? "Sending…" : "Send to suppliers"} icon={<Send size={13} color={S.paper} />} onPress={() => sendMutation.mutate()} disabled={busy} />
              )}
              {draft && canDelete && (
                <Key
                  tone="red"
                  label="Delete"
                  icon={<Trash2 size={13} color="#ffffff" />}
                  disabled={busy}
                  onPress={() =>
                    Alert.alert("Delete quotation?", `${r.DocNo || "This quotation"} will be permanently removed.`, [
                      { text: "Cancel", style: "cancel" },
                      { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate() },
                    ])
                  }
                />
              )}
            </>
          ) : null
        }
        loading={isLoading || !r}
        error={isError ? (error as Error)?.message || "Could not load this quotation." : null}
        onRetry={() => refetch()}
      >
        {r && (
          <>
            <View style={{ flexDirection: "row" }}>
              <SheetMark text={qtStatusLabel(status)} tone={qtStatusTone(status)} />
            </View>
            <InfoGrid
              items={[
                { label: "Company", value: r.CompanyName || "—" },
                { label: "Project", value: r.ProjectName || "—" },
                { label: "Date", value: fmtDate(r.DocDate) },
                { label: "Response due", value: r.DueDate ? fmtDate(r.DueDate) : "—" },
                { label: "Source MR", value: r.SourceMRDocNo || "—" },
                { label: "Financial year", value: r.FinYearName || "—" },
                ...(r.Remarks ? [{ label: "Remarks", value: r.Remarks, wide: true }] : []),
              ]}
            />

            <Panel title={`Items (${r.items?.length ?? 0})`} icon={<ClipboardList size={14} color={S.ink} />}>
              <LineList empty="No items." rows={(r.items ?? []).map((it, i) => ({ key: i, title: it.ItemName || it.ItemId, right: `${it.Quantity} ${it.UOMName || it.UOMCode || ""}` }))} />
            </Panel>

            <Panel title={`Suppliers (${r.suppliers?.length ?? 0})`} icon={<Truck size={14} color={S.ink} />}>
              {!r.suppliers?.length ? (
                <Body size={12.5} color={S.graphite}>No suppliers tagged.</Body>
              ) : (
                r.suppliers.map((s, i) => (
                  <View key={s.Id} style={{ gap: 8, paddingTop: i ? 12 : 0, borderTopWidth: i ? 1 : 0, borderTopColor: S.ruleSoft }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                      <Body size={13} weight="semibold" style={{ flex: 1 }}>{s.SupplierName}</Body>
                      <SheetMark text={s.Status || "Pending"} tone={statusTone(s.Status || "Pending")} />
                    </View>
                    <Body size={11.5} color={S.graphite}>{`Invited ${fmtDate(s.InvitedAt)}`}</Body>
                    {canEdit ? (
                      <PickerRow
                        label="Payment terms"
                        value={s.PaymentTermName ? `${s.PaymentTermName} (${s.PaymentTermDays} days)` : ""}
                        placeholder="Not set"
                        onPress={() => setTermFor(s.SupplierLHeadId)}
                        disabled={termMutation.isPending}
                      />
                    ) : (
                      <Body size={12} color={S.ink2}>{s.PaymentTermName ? `Payment terms ${s.PaymentTermName} · ${s.PaymentTermDays} days` : "Payment terms not set"}</Body>
                    )}
                  </View>
                ))
              )}
              <Body size={11} color={S.graphite}>The purchase order raised for a supplier starts with its payment term; payment reminders follow it.</Body>
            </Panel>
          </>
        )}
        {/* Inside the sheet's own modal, so it stacks over it on iOS as well. */}
        <OptionPickerModal
          visible={termFor != null}
          title={`Payment terms · ${termSupplier?.SupplierName ?? ""}`}
          options={[
            // Keep a term since made inactive selectable as the current value.
            ...(termSupplier?.PaymentTermId && !terms.some((t) => t.id === termSupplier.PaymentTermId)
              ? [{ key: String(termSupplier.PaymentTermId), label: `${termSupplier.PaymentTermName} (${termSupplier.PaymentTermDays} days)` }]
              : []),
            ...terms.map((t) => ({ key: String(t.id), label: `${t.label} (${t.days} days)` })),
          ]}
          selectedKey={termSupplier?.PaymentTermId ? String(termSupplier.PaymentTermId) : ""}
          clearable
          onClose={() => setTermFor(null)}
          onSelect={(k) => {
            if (termFor != null) termMutation.mutate({ supplierId: termFor, termId: k ? Number(k) : null });
            setTermFor(null);
          }}
        />
    </DetailSheet>
  );
}

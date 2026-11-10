// RN port of GRN.tsx's view, on the drawing sheet: the GRN's number as the title with its date, supplier and project;
// its approval mark; the particulars (company, project, PO, supplier, source transfer / MR); the received items line by
// line (ordered, received, pending; quantity × rate, GST); the GRN total against the PO's value and what is left on it;
// the GST by rate; remarks. Deferred vs. web as before: the Posting tab (GL preview and auto-post), the per-line quality
// debit note, DocumentChainPanel, LinkedExpenseBookings and the "New GRN for remaining" quick action.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { View } from "react-native";
import { PackageCheck, Percent } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { formatINR } from "@/utils/formatCurrency";
import { getGRNById, type GRNRecord } from "@/api/grnApi";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { Body, InfoGrid, Label, Panel, SheetMark, statusTone } from "@/components/sheet/Sheet";
import { DetailSheet, LineList, fmtDate } from "@/components/sheet/Register";

function TotalLine({ label, value, strong, red }: { label: string; value: string; strong?: boolean; red?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingTop: strong ? 10 : 6, borderTopWidth: strong ? 1.5 : 0, borderTopColor: S.ink }}>
      <Label color={strong ? S.ink : undefined}>{label}</Label>
      <Body size={strong ? 16 : 13} weight="semibold" color={red ? S.red : S.ink}>{value}</Body>
    </View>
  );
}

export function GRNDetailModal({ recordId, onClose }: { recordId: number | null; onClose: () => void }) {
  const { data: grn, isLoading, isError, error, refetch } = useQuery<GRNRecord>({
    queryKey: ["grn-detail", recordId],
    queryFn: () => getGRNById(recordId!),
    enabled: recordId != null,
  });

  const items = grn?.GRNItems ?? [];
  const subtotal = useMemo(() => items.reduce((s, i) => s + (i.totalAmount || 0), 0), [items]);
  const gstTotal = useMemo(() => items.reduce((s, i) => s + (i.gstAmount || 0), 0), [items]);
  const grandTotal = subtotal + gstTotal;
  const poTotal = Number(grn?.POTotalAmount ?? 0);
  const balance = poTotal - grandTotal;
  const gstByRate = useMemo(() => {
    const map = new Map<number, number>();
    for (const i of items) {
      const pct = Number(i.gstPct || 0);
      const amt = Number(i.gstAmount || 0);
      if (pct > 0 && amt > 0) map.set(pct, (map.get(pct) ?? 0) + amt);
    }
    return Array.from(map.entries());
  }, [items]);

  return (
    <DetailSheet
      visible={recordId != null}
      onClose={onClose}
      eyebrow="CivilierERP · Material · Goods receipt note"
      title={grn?.DocNo || grn?.GRNNo || "GRN"}
      subtitle={grn ? [fmtDate(grn.GRNDate), grn.SupplierName, grn.ProjectName].filter(Boolean).join(" · ") : undefined}
      loading={isLoading || !grn}
      error={isError ? (error as Error)?.message || "Could not load this GRN." : null}
      onRetry={() => refetch()}
    >
      {grn && (
        <>
          <ApprovalStatusChain table="GoodsReceiptNotes" recordId={grn.GRNID} fallback={<SheetMark text={grn.Status || "Draft"} tone={statusTone(grn.Status || "Draft")} />} />
          <InfoGrid
            items={[
              { label: "GRN date", value: fmtDate(grn.GRNDate) },
              { label: "PO no", value: grn.PONumber || "—" },
              { label: "Company", value: grn.CompanyName || "—" },
              { label: "Project", value: grn.ProjectName || "—" },
              { label: "Supplier", value: grn.SupplierName || "—" },
              ...(grn.SourceTransferDocNo ? [{ label: "Source transfer", value: grn.SourceTransferDocNo }] : []),
              ...(grn.SourceMRDocNo ? [{ label: "Source MR", value: grn.SourceMRDocNo }] : []),
              ...(grn.Remarks ? [{ label: "Remarks", value: grn.Remarks, wide: true }] : []),
            ]}
          />

          <Panel title={`Received items (${items.length})`} icon={<PackageCheck size={14} color={S.ink} />}>
            <LineList
              empty="No items on this GRN."
              rows={items.map((it, i) => ({
                key: i,
                title: it.itemName || "—",
                note: `Ordered ${it.orderedQty} · received ${it.receivedQty} · pending ${it.remainingQty} ${it.uom || ""}\n${it.quantity} ${it.uom || ""} × ${formatINR(it.rate)}${it.gstPct ? ` · ${it.gstPct}% GST` : ""}`,
                right: formatINR(it.totalAmount),
              }))}
            />
            <View>
              <TotalLine label="GRN total (received)" value={formatINR(grandTotal)} strong />
              {poTotal > 0 && (
                <>
                  <TotalLine label="PO value (incl. GST)" value={formatINR(poTotal)} />
                  <TotalLine label="Balance on PO" value={balance > 0.005 ? formatINR(balance) : "Fully received"} />
                </>
              )}
            </View>
          </Panel>

          {gstByRate.length > 0 && (
            <Panel title="GST breakdown" icon={<Percent size={14} color={S.ink} />}>
              <LineList
                rows={[
                  { key: "sub", title: "Subtotal (before GST)", right: formatINR(subtotal) },
                  ...gstByRate.map(([rate, amount]) => ({ key: rate, title: `GST ${rate}%`, right: `+${formatINR(amount)}` })),
                ]}
              />
              <TotalLine label="Grand total (incl. GST)" value={formatINR(grandTotal)} strong />
            </Panel>
          )}
        </>
      )}
    </DetailSheet>
  );
}

// RN port of PurchaseOrderMaster.tsx's preview, on the drawing sheet: the order's number as the title with its date,
// supplier and project; its approval mark and source (MR / WO / WD); the particulars; the supplier and billing company;
// the order's items line by line (quantity × rate, GST, received); terms and remarks. Edit sits in the title block.
// Deferred vs. web as before: the Supplier tab (OrderChat), the purchase-flow chain panel and print.
import { useQuery } from "@tanstack/react-query";
import { View } from "react-native";
import { Building2, Pencil, ShoppingCart, Truck } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { formatINR } from "@/utils/formatCurrency";
import { getPurchaseOrderById, getSupplierDetails, getCompanyDetails, type PurchaseOrder } from "@/api/purchaseOrdersApi";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { Body, InfoGrid, Key, Panel, SheetMark, statusTone } from "@/components/sheet/Sheet";
import { DetailSheet, LineList, fmtDate } from "@/components/sheet/Register";

export function PurchaseOrderDetailModal({ recordId, onClose, onEdit }: { recordId: number | null; onClose: () => void; onEdit?: (id: number) => void }) {
  const { data: po, isLoading, isError, error, refetch } = useQuery<PurchaseOrder>({
    queryKey: ["po-detail", recordId],
    queryFn: () => getPurchaseOrderById(recordId!),
    enabled: recordId != null,
  });
  const { data: supplier } = useQuery({
    queryKey: ["po-detail-supplier", po?.SupplierID],
    queryFn: () => getSupplierDetails(po!.SupplierID!),
    enabled: !!po?.SupplierID,
  });
  const { data: company } = useQuery({
    queryKey: ["po-detail-company", po?.CompanyId],
    queryFn: () => getCompanyDetails(po!.CompanyId!),
    enabled: !!po?.CompanyId,
  });

  const sources = po ? ([["MR", po.SourceMRDocNo], ["WO", po.SourceWODocNo], ["WD", po.SourceWDDocNo]] as const).filter(([, v]) => !!v) : [];

  return (
    <DetailSheet
      visible={recordId != null}
      onClose={onClose}
      eyebrow="CivilierERP · Material · Purchase order"
      title={po?.PurchaseOrderNo || "Purchase order"}
      subtitle={po ? [fmtDate(po.PODate), po.SupplierName, po.ProjectName].filter(Boolean).join(" · ") : undefined}
      actions={po && onEdit ? <Key label="Edit" icon={<Pencil size={13} color={S.ink} />} onPress={() => onEdit(po.PurchaseOrderID)} /> : null}
      loading={isLoading || !po}
      error={isError ? (error as Error)?.message || "Could not load this purchase order." : null}
      onRetry={() => refetch()}
    >
      {po && (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
            <ApprovalStatusChain table="PurchaseOrders" recordId={po.PurchaseOrderID} fallback={<SheetMark text={po.Status || "Draft"} tone={statusTone(po.Status || "Draft")} />} />
            {sources.map(([k, v]) => <SheetMark key={k} text={`${k} ${v}`} tone="draft" />)}
          </View>

          <InfoGrid
            items={[
              { label: "PO type", value: po.POType === "WO_PO" ? "WO-PO" : po.POType || "—" },
              { label: "Total amount", value: formatINR(po.TotalAmount ?? 0) },
              { label: "PO date", value: fmtDate(po.PODate) },
              { label: "Expected delivery", value: fmtDate(po.ExpectedDeliveryDate) },
              { label: "Company", value: po.CompanyName || "—" },
              { label: "Project / site", value: po.ProjectName || "—" },
              { label: "Cost centre", value: po.CostCenterName || "—" },
              { label: "Supplier", value: po.SupplierName || "—" },
            ]}
          />

          <Panel title={`Order items (${po.POItems?.length ?? 0})`} icon={<ShoppingCart size={14} color={S.ink} />}>
            <LineList
              empty="No items on this order."
              rows={(po.POItems ?? []).map((li, i) => {
                const qty = Number(li.Quantity ?? 0);
                const received = li.ReceivedQty != null ? Number(li.ReceivedQty) : null;
                return {
                  key: i,
                  title: li.ItemName || li.Description || "—",
                  note: `${qty} ${li.UomName || ""} × ${formatINR(li.Rate ?? 0)}${li.TaxPct ? ` · ${li.TaxPct}% GST` : ""}`,
                  right: formatINR(li.LineAmount ?? qty * (li.Rate ?? 0)),
                  rightNote: received != null ? `Received ${received}${received >= qty ? " · in full" : ""}` : null,
                };
              })}
            />
          </Panel>

          {!!supplier && (
            <Panel title="Supplier" icon={<Truck size={14} color={S.ink} />}>
              <View style={{ gap: 3 }}>
                <Body size={13} weight="semibold">{supplier.LHeadName}</Body>
                {!!supplier.LHeadAddress && <Body size={12} color={S.graphite}>{supplier.LHeadAddress}</Body>}
                {!!supplier.LGST && <Body size={12} color={S.graphite}>{`GSTIN ${supplier.LGST}`}</Body>}
              </View>
            </Panel>
          )}
          {!!company && (
            <Panel title="Billing company" icon={<Building2 size={14} color={S.ink} />}>
              <View style={{ gap: 3 }}>
                <Body size={13} weight="semibold">{company.name}</Body>
                {!!company.address && <Body size={12} color={S.graphite}>{company.address}</Body>}
                {!!company.gst_no && <Body size={12} color={S.graphite}>{`GSTIN ${company.gst_no}`}</Body>}
              </View>
            </Panel>
          )}

          {(!!po.PaymentTerms || !!po.Remarks) && (
            <InfoGrid
              items={[
                ...(po.PaymentTerms ? [{ label: "Payment terms / T&C", value: po.PaymentTerms, wide: true }] : []),
                ...(po.Remarks ? [{ label: "Remarks", value: po.Remarks, wide: true }] : []),
              ]}
            />
          )}
        </>
      )}
    </DetailSheet>
  );
}

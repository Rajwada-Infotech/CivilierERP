// RN port of MRViewModal.tsx, on the drawing sheet: the request's number as the title with its date, company and
// project; its approval mark and priority; the particulars (required by, items, reason, remarks); the requested items
// line by line; and the purchase orders raised against it. Edit sits in the title block with the edit right.
import { useQuery } from "@tanstack/react-query";
import { View } from "react-native";
import { ClipboardList, Pencil, ShoppingCart } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { getMaterialRequestById, getMRLinkedPOs, type MaterialRequest } from "@/api/materialRequestApi";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { Body, InfoGrid, Key, Panel, SheetMark, statusTone } from "@/components/sheet/Sheet";
import { DetailSheet, LineList, fmtDate } from "@/components/sheet/Register";
import { priorityTone } from "./priority";

export function MaterialRequestDetailModal({ recordId, onClose, onEdit }: { recordId: number | null; onClose: () => void; onEdit?: (id: number) => void }) {
  const { data: mr, isLoading, isError, error, refetch } = useQuery<MaterialRequest>({
    queryKey: ["mr-detail", recordId],
    queryFn: () => getMaterialRequestById(recordId!),
    enabled: recordId != null,
  });
  const { data: linkedPOs = [] } = useQuery({
    queryKey: ["mr-detail-linked-pos", recordId],
    queryFn: () => getMRLinkedPOs(recordId!),
    enabled: recordId != null,
  });

  return (
    <DetailSheet
      visible={recordId != null}
      onClose={onClose}
      eyebrow="CivilierERP · Material · Material request"
      title={mr?.DocNo || (mr ? `MR-${mr.MRId}` : "Material request")}
      subtitle={mr ? [fmtDate(mr.RequestDate), mr.CompanyName, mr.ProjectName].filter(Boolean).join(" · ") : undefined}
      actions={mr && onEdit && mr.Status !== "Short Closed" ? <Key label="Edit" icon={<Pencil size={13} color={S.ink} />} onPress={() => onEdit(mr.MRId)} /> : null}
      loading={isLoading || !mr}
      error={isError ? (error as Error)?.message || "Could not load this material request." : null}
      onRetry={() => refetch()}
    >
      {mr && (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
            <ApprovalStatusChain table="MaterialRequests" recordId={mr.MRId} fallback={<SheetMark text={mr.Status || "Draft"} tone={statusTone(mr.Status || "Draft")} />} />
            <SheetMark text={`${mr.Priority || "Normal"} priority`} tone={priorityTone(mr.Priority)} />
          </View>

          <InfoGrid
            items={[
              { label: "Company", value: mr.CompanyName || "—" },
              { label: "Project", value: mr.ProjectName || "—" },
              { label: "Requested", value: fmtDate(mr.RequestDate) },
              { label: "Required by", value: fmtDate(mr.RequiredByDate) },
              { label: "Items", value: `${mr.ItemCount ?? mr.items?.length ?? 0} (${Number(mr.TotalQty ?? 0).toFixed(2)} units)` },
              { label: "Financial year", value: mr.FinYearName || "—" },
              { label: "Reason", value: mr.Reason || "—", wide: true },
              ...(mr.Remarks ? [{ label: "Remarks", value: mr.Remarks, wide: true }] : []),
            ]}
          />

          <Panel title={`Requested items (${mr.items?.length ?? 0})`} icon={<ClipboardList size={14} color={S.ink} />}>
            <LineList
              empty="No items on this request."
              rows={(mr.items ?? []).map((it, i) => ({ key: i, title: it.ItemName || it.ItemId || "—", note: it.Remarks || null, right: `${it.Quantity} ${it.UOMCode}` }))}
            />
          </Panel>

          <Panel title="Linked purchase orders" icon={<ShoppingCart size={14} color={S.ink} />}>
            {linkedPOs.length === 0 ? (
              <Body size={12.5} color={S.graphite}>No purchase order raised against this request yet.</Body>
            ) : (
              <LineList
                rows={linkedPOs.map((po) => ({
                  key: po.purchaseOrderId,
                  title: po.poNumber,
                  note: `${fmtDate(po.date)} · ${po.status}`,
                  right: `Ordered ${po.orderedQty}`,
                  rightNote: `Remaining after ${po.remainingQtyAfter}`,
                }))}
              />
            )}
          </Panel>
        </>
      )}
    </DetailSheet>
  );
}

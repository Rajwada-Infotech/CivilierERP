// RN port of StockTransfer.tsx's TransferPreviewModal, on the drawing sheet: the transfer's number as the title with its
// date and who made it; its approval mark; the from → to godowns; the items moved line by line; remarks. "Make GRN"
// stays on the register's row, as the web keeps it in the table rather than the preview (MakeGRNFromTransferModal).
import { useQuery } from "@tanstack/react-query";
import { View, Text } from "react-native";
import { ArrowRight, Repeat } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { getStockTransferById, type StockTransfer } from "@/api/stockTransferApi";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { InfoGrid, Label, Panel } from "@/components/sheet/Sheet";
import { DetailSheet, LineList, fmtDate } from "@/components/sheet/Register";

function Godown({ label, name }: { label: string; name: string }) {
  return (
    <View style={{ flex: 1, borderWidth: 1, borderColor: S.ink, padding: 10, gap: 4 }}>
      <Label>{label}</Label>
      <Text numberOfLines={2} style={{ fontFamily: fonts.heading.semibold, fontSize: 13, color: S.ink }}>{name || "—"}</Text>
    </View>
  );
}

export function StockTransferDetailModal({ recordId, onClose }: { recordId: number | null; onClose: () => void }) {
  const { data: transfer, isLoading, isError, error, refetch } = useQuery<StockTransfer>({
    queryKey: ["trf-detail", recordId],
    queryFn: () => getStockTransferById(recordId!),
    enabled: recordId != null,
  });

  return (
    <DetailSheet
      visible={recordId != null}
      onClose={onClose}
      eyebrow="CivilierERP · Material · Stock transfer"
      title={transfer?.DocNo || "Stock transfer"}
      subtitle={transfer ? [fmtDate(transfer.TransferDate), transfer.CreatedBy ? transfer.CreatedBy.split("@")[0] : null].filter(Boolean).join(" · ") : undefined}
      loading={isLoading || !transfer}
      error={isError ? (error as Error)?.message || "Could not load this transfer." : null}
      onRetry={() => refetch()}
    >
      {transfer && (
        <>
          <ApprovalStatusChain table="StockTransfers" recordId={transfer.TransferID} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Godown label="From" name={transfer.FromGodownName} />
            <ArrowRight size={16} color={S.ink} />
            <Godown label="To" name={transfer.ToGodownName} />
          </View>
          <Panel title={`Items (${transfer.TransferItems?.length ?? 0})`} icon={<Repeat size={14} color={S.ink} />}>
            <LineList empty="No items on this transfer." rows={(transfer.TransferItems ?? []).map((it, i) => ({ key: i, title: it.itemName || it.itemId, right: `${it.qty} ${it.uom || ""}` }))} />
          </Panel>
          {!!transfer.Remarks && <InfoGrid items={[{ label: "Remarks", value: transfer.Remarks, wide: true }]} />}
        </>
      )}
    </DetailSheet>
  );
}

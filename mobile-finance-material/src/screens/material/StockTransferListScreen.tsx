// RN port of StockTransfer.tsx's TransferHistory, on the drawing sheet as the web draws it: the title block with New
// transfer; the transfer register — its count and one ruled row per transfer with its from → to godowns, items, its
// approval mark, the GRN made from it (or a Make GRN key) and View. Plain stock transfers only (inter-company transfers
// are out of scope, see stockTransferApi.ts). No Edit / Delete: a transfer executes at once and the backend has no PUT /
// DELETE for it. A row opens StockTransferDetailModal; New opens the form as its own page (StockTransferFormScreen).
import { useMemo, useState } from "react";
import { View, Text, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, RefreshCw } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { usePageRights } from "@/hooks/usePageRights";
import type { MainStackParamList } from "@/navigation/MainStack";
import { getStockTransfers, type StockTransfer } from "@/api/stockTransferApi";
import { getGRNsByTransfer } from "@/api/grnApi";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { Body, Key, Notice, RegisterHead, SheetMark, SheetShell } from "@/components/sheet/Sheet";
import { NoAccess, RecordRow, RegisterBox, RegisterFoot, RegisterLoading, RowKeys, SheetPage, fmtDate } from "@/components/sheet/Register";
import { StockTransferDetailModal } from "./stockTransfer/StockTransferDetailModal";
import { MakeGRNFromTransferModal } from "./stockTransfer/MakeGRNFromTransferModal";

const PAGE_SIZE = 15;

function TransferRow({ transfer, last, onView, onMakeGRN }: { transfer: StockTransfer; last: boolean; onView: () => void; onMakeGRN?: () => void }) {
  // Fetched per row so only the rows on screen ask for their GRNs.
  const { data: linkedGRNs = [] } = useQuery({
    queryKey: ["transfer-grns", transfer.TransferID],
    queryFn: () => getGRNsByTransfer(transfer.TransferID),
    staleTime: 30_000,
  });
  const n = (transfer.TransferItems ?? []).length;
  return (
    <RecordRow
      last={last}
      title={transfer.DocNo}
      date={fmtDate(transfer.TransferDate)}
      side={`${n} item${n === 1 ? "" : "s"}`}
      onPress={onView}
      lines={[
        <Text key="route" style={{ fontFamily: fonts.body.medium, fontSize: 12.5, color: S.ink }}>
          {transfer.FromGodownName}
          <Text style={{ color: S.graphite }}>{"  →  "}</Text>
          {transfer.ToGodownName}
        </Text>,
      ]}
      marks={
        <>
          <ApprovalStatusChain table="StockTransfers" recordId={transfer.TransferID} />
          {linkedGRNs.length > 0 && <SheetMark text={linkedGRNs.length > 1 ? `${linkedGRNs.length} GRNs` : `GRN ${linkedGRNs[0].GRNNo || linkedGRNs[0].DocNo}`} tone="done" />}
        </>
      }
      actions={
        <RowKeys onView={onView}>
          {linkedGRNs.length === 0 && onMakeGRN && <Key label="Make GRN" icon={<FileText size={12} color={S.ink} />} onPress={onMakeGRN} style={{ minHeight: 32, paddingHorizontal: 10 }} />}
        </RowKeys>
      }
    />
  );
}

export default function StockTransferListScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const qc = useQueryClient();
  const rights = usePageRights("stock-transfers");
  const [refreshing, setRefreshing] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [grnTransfer, setGrnTransfer] = useState<StockTransfer | null>(null);

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage, refetch, isFetching } = useInfiniteQuery({
    queryKey: ["stock-transfers-mobile"],
    queryFn: ({ pageParam }) => getStockTransfers({ page: pageParam, limit: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((s, p) => s + (p?.data?.length ?? 0), 0);
      return loaded < (last?.total ?? 0) ? pages.length + 1 : undefined;
    },
    enabled: rights.canView,
  });
  const records: StockTransfer[] = useMemo(() => (data?.pages ?? []).flatMap((p) => p?.data ?? []), [data]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  if (!rights.canView) return <NoAccess eyebrow="CivilierERP · Material" title="Stock transfer" what="stock transfers" />;

  return (
    <View style={{ flex: 1 }}>
      <SheetPage refreshing={refreshing} onRefresh={onRefresh} onEndReached={() => hasNextPage && !isFetchingNextPage && fetchNextPage()}>
        <SheetShell
          eyebrow="CivilierERP · Material"
          title="Stock transfer"
          subtitle="Move stock between godowns, checked against what the source godown holds."
          action={
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {rights.canCreate && <Key tone="ink" label="New transfer" icon={<Plus size={13} color={S.paper} />} onPress={() => navigation.navigate("StockTransferForm")} />}
              <Key label={isFetching && !isFetchingNextPage ? "Reading…" : "Refresh"} icon={<RefreshCw size={13} color={S.ink} />} onPress={() => refetch()} />
            </View>
          }
        >
          <RegisterBox>
            <RegisterHead title="Transfer history" count={records.length} unit={["transfer loaded", "transfers loaded"]} />
            {isLoading ? (
              <RegisterLoading />
            ) : isError ? (
              <Notice>Could not load the stock transfers. Pull down to try again.</Notice>
            ) : records.length === 0 ? (
              <Body color={S.graphite}>No stock transfers yet.</Body>
            ) : (
              <View>
                {records.map((t, i) => (
                  <TransferRow
                    key={t.TransferID}
                    transfer={t}
                    last={i === records.length - 1}
                    onView={() => setViewingId(t.TransferID)}
                    onMakeGRN={rights.canCreate ? () => setGrnTransfer(t) : undefined}
                  />
                ))}
                <RegisterFoot loadingMore={isFetchingNextPage} done={!hasNextPage} shown={records.length} />
              </View>
            )}
          </RegisterBox>
        </SheetShell>
      </SheetPage>

      <StockTransferDetailModal recordId={viewingId} onClose={() => setViewingId(null)} />
      <MakeGRNFromTransferModal
        transfer={grnTransfer}
        onClose={() => setGrnTransfer(null)}
        onSuccess={(grnNo) => {
          const transferId = grnTransfer?.TransferID;
          setGrnTransfer(null);
          if (transferId != null) qc.invalidateQueries({ queryKey: ["transfer-grns", transferId] });
          Alert.alert("GRN created", `${grnNo} was created from this transfer.`);
        }}
      />
    </View>
  );
}

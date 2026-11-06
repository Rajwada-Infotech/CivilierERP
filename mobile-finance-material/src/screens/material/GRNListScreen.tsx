// RN port of src/pages/material/GRN.tsx (web), on the drawing sheet as the web draws it: the title block with New GRN;
// the receipt register — its count, a search box, the status keys (All / Pending / Approved / Booked / Rejected) and
// the receipts grouped by project, each a ruled row with the PO (or the transfer it came from), supplier, amount, its
// approval mark and keys. A row opens GRNDetailModal; New GRN opens the form as its own page (GRNFormScreen).
import { useMemo, useState } from "react";
import { View, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { formatINR } from "@/utils/formatCurrency";
import { usePageRights } from "@/hooks/usePageRights";
import type { MainStackParamList } from "@/navigation/MainStack";
import { getGRNs, deleteGRN, type GRNRecord } from "@/api/grnApi";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { Key, Notice, RegisterHead, SearchBox, SheetMark, SheetShell, statusTone } from "@/components/sheet/Sheet";
import { Facts, KeyRow, NoAccess, ProjectGroups, RecordRow, RegisterBox, RegisterFoot, RegisterLoading, RowKeys, SheetPage, fmtDate } from "@/components/sheet/Register";
import { GRNDetailModal } from "./grn/GRNDetailModal";

const PAGE_SIZE = 15;
const STATUS = ["", "Pending", "Approved", "Booked", "Rejected"];

export default function GRNListScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const queryClient = useQueryClient();
  const rights = usePageRights("grn-master");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage, refetch, isFetching } = useInfiniteQuery({
    queryKey: ["grns-mobile", status],
    queryFn: ({ pageParam }) => getGRNs({ page: pageParam, limit: PAGE_SIZE, status: status || undefined }),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (pages.length < (last?.totalPages ?? 1) ? pages.length + 1 : undefined),
    enabled: rights.canView,
  });

  const records: GRNRecord[] = useMemo(() => (data?.pages ?? []).flatMap((p) => p?.data ?? []), [data]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) => [r.DocNo, r.GRNNo, r.PONumber, r.SupplierName, r.SourceTransferDocNo, r.SourceMRDocNo].some((v) => (v ?? "").toLowerCase().includes(q)));
  }, [records, search]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleDelete = (grn: GRNRecord) =>
    Alert.alert("Delete GRN?", `${grn.DocNo || grn.GRNNo} will be permanently removed.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteGRN(grn.GRNID);
            queryClient.invalidateQueries({ queryKey: ["grns-mobile"], exact: false });
          } catch (err: any) {
            Alert.alert("Could not delete", err.message ?? "Something went wrong.");
          }
        },
      },
    ]);

  if (!rights.canView) return <NoAccess eyebrow="CivilierERP · Material" title="Goods receipt notes" what="goods receipt notes" />;

  return (
    <View style={{ flex: 1 }}>
      <SheetPage refreshing={refreshing} onRefresh={onRefresh} onEndReached={() => hasNextPage && !isFetchingNextPage && fetchNextPage()}>
        <SheetShell
          eyebrow="CivilierERP · Material"
          title="Goods receipt notes"
          subtitle="Goods received against purchase orders: what arrived, its quality, and what is still to come."
          action={
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {rights.canCreate && <Key tone="ink" label="New GRN" icon={<Plus size={13} color={S.paper} />} onPress={() => navigation.navigate("GRNForm")} />}
              <Key label={isFetching && !isFetchingNextPage ? "Reading…" : "Refresh"} icon={<RefreshCw size={13} color={S.ink} />} onPress={() => refetch()} />
            </View>
          }
        >
          <RegisterBox>
            <RegisterHead title="Receipt register" count={filtered.length} unit={["GRN loaded", "GRNs loaded"]} />
            <SearchBox value={search} onChange={setSearch} placeholder="Search GRN, PO, supplier, transfer…" />
            <KeyRow options={STATUS.map((s) => ({ value: s, label: s || "All" }))} value={status} onChange={setStatus} />

            {isLoading ? (
              <RegisterLoading />
            ) : isError ? (
              <Notice>Could not load the goods receipt notes. Pull down to try again.</Notice>
            ) : (
              <>
                <ProjectGroups
                  items={filtered}
                  getProject={(r) => r.ProjectName}
                  keyOf={(r) => r.GRNID}
                  unit={["GRN", "GRNs"]}
                  expandAll={!!search.trim()}
                  emptyText={search ? "No GRN matches that search." : "No goods receipt notes yet."}
                  renderItem={(grn, last) => {
                    const isTransfer = !!grn.SourceTransferDocNo;
                    return (
                      <RecordRow
                        last={last}
                        title={grn.DocNo || grn.GRNNo || "—"}
                        date={fmtDate(grn.GRNDate)}
                        side={formatINR(grn.TotalAmount ?? 0)}
                        onPress={() => setViewingId(grn.GRNID)}
                        lines={[
                          grn.SupplierName || (isTransfer ? "Stock transfer" : "—"),
                          <Facts key="f" items={[[isTransfer ? "Transfer" : "PO", isTransfer ? grn.SourceTransferDocNo : grn.PONumber], ["Company", grn.CompanyName]]} />,
                        ]}
                        marks={
                          <>
                            <ApprovalStatusChain table="GoodsReceiptNotes" recordId={grn.GRNID} fallback={<SheetMark text={grn.Status || "Draft"} tone={statusTone(grn.Status || "Draft")} />} />
                            {isTransfer && <SheetMark text="Transfer" tone="draft" />}
                          </>
                        }
                        actions={<RowKeys onView={() => setViewingId(grn.GRNID)} onDelete={rights.canDelete ? () => handleDelete(grn) : undefined} />}
                      />
                    );
                  }}
                />
                <RegisterFoot loadingMore={isFetchingNextPage} done={!hasNextPage} shown={records.length} />
              </>
            )}
          </RegisterBox>
        </SheetShell>
      </SheetPage>

      <GRNDetailModal recordId={viewingId} onClose={() => setViewingId(null)} />
    </View>
  );
}

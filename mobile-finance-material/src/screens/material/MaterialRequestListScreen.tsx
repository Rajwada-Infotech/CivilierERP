// RN port of src/pages/material/MaterialRequest.tsx (MRList), on the drawing sheet as the web draws it: the title
// block with New request; the request register — its count, a search box, the status keys (All / Pending / Approved /
// Overdue) and the requests grouped by project, each a ruled row with its approval mark, priority, items and keys.
// A row opens MaterialRequestDetailModal; New and Edit open the form as its own page (MaterialRequestFormScreen).
import { useMemo, useState } from "react";
import { View, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import type { MainStackParamList } from "@/navigation/MainStack";
import { usePageRights } from "@/hooks/usePageRights";
import { getMaterialRequests, deleteMaterialRequest, type MaterialRequest } from "@/api/materialRequestApi";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { Key, Notice, RegisterHead, SearchBox, SheetMark, SheetShell, statusTone } from "@/components/sheet/Sheet";
import { Facts, KeyRow, NoAccess, ProjectGroups, RecordRow, RegisterBox, RegisterFoot, RegisterLoading, RowKeys, SheetPage, fmtDate } from "@/components/sheet/Register";
import { MaterialRequestDetailModal } from "./materialRequest/MaterialRequestDetailModal";
import { priorityTone } from "./materialRequest/priority";

const PAGE_SIZE = 15;
const STATUS = ["", "Pending", "Approved", "Overdue"] as const;


export default function MaterialRequestListScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const queryClient = useQueryClient();
  const rights = usePageRights("material-request");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<(typeof STATUS)[number]>("");
  const [refreshing, setRefreshing] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage, refetch, isFetching } = useInfiniteQuery({
    queryKey: ["material-requests-mobile", status],
    queryFn: ({ pageParam }) => getMaterialRequests({ page: pageParam, limit: PAGE_SIZE, status: status || undefined }),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (pages.length < (last?.totalPages ?? 1) ? pages.length + 1 : undefined),
    enabled: rights.canView,
  });

  const records: MaterialRequest[] = useMemo(() => (data?.pages ?? []).flatMap((p) => p?.data ?? []), [data]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) => [r.DocNo, r.CompanyName, r.ProjectName, r.Reason].some((v) => (v ?? "").toLowerCase().includes(q)));
  }, [records, search]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleDelete = (mr: MaterialRequest) =>
    Alert.alert("Delete material request?", `${mr.DocNo || `MR-${mr.MRId}`} will be permanently removed.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteMaterialRequest(mr.MRId);
            queryClient.invalidateQueries({ queryKey: ["material-requests-mobile"], exact: false });
          } catch (err: any) {
            Alert.alert("Could not delete", err.message ?? "Something went wrong.");
          }
        },
      },
    ]);

  if (!rights.canView) return <NoAccess eyebrow="CivilierERP · Material" title="Material requests" what="material requests" />;

  return (
    <View style={{ flex: 1 }}>
      <SheetPage refreshing={refreshing} onRefresh={onRefresh} onEndReached={() => hasNextPage && !isFetchingNextPage && fetchNextPage()}>
        <SheetShell
          eyebrow="CivilierERP · Material"
          title="Material requests"
          subtitle="Materials a project asks for, from request through approval to ordering."
          action={
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {rights.canCreate && <Key tone="ink" label="New request" icon={<Plus size={13} color={S.paper} />} onPress={() => navigation.navigate("MaterialRequestForm")} />}
              <Key label={isFetching && !isFetchingNextPage ? "Reading…" : "Refresh"} icon={<RefreshCw size={13} color={S.ink} />} onPress={() => refetch()} />
            </View>
          }
        >
          <RegisterBox>
            <RegisterHead title="Request register" count={filtered.length} unit={["request loaded", "requests loaded"]} />
            <SearchBox value={search} onChange={setSearch} placeholder="Search doc no, company, project, reason…" />
            <KeyRow options={STATUS.map((s) => ({ value: s, label: s || "All" }))} value={status} onChange={setStatus} />

            {isLoading ? (
              <RegisterLoading />
            ) : isError ? (
              <Notice>Could not load the material requests. Pull down to try again.</Notice>
            ) : (
              <>
                <ProjectGroups
                  items={filtered}
                  getProject={(r) => r.ProjectName}
                  keyOf={(r) => r.MRId}
                  unit={["request", "requests"]}
                  expandAll={!!search.trim()}
                  emptyText={search ? "No request matches that search." : "No material requests found. Use New request to raise one."}
                  renderItem={(mr, last) => (
                    <RecordRow
                      last={last}
                      title={mr.DocNo || `MR-${mr.MRId}`}
                      date={fmtDate(mr.RequestDate)}
                      side={`${mr.ItemCount ?? mr.items?.length ?? 0} items`}
                      sideNote={`${mr.TotalQty ?? 0} units`}
                      onPress={() => setViewingId(mr.MRId)}
                      lines={[
                        mr.CompanyName || null,
                        <Facts key="f" items={[["Required by", mr.RequiredByDate ? fmtDate(mr.RequiredByDate) : null]]} />,
                      ]}
                      marks={
                        <>
                          <ApprovalStatusChain table="MaterialRequests" recordId={mr.MRId} fallback={<SheetMark text={mr.Status || "Draft"} tone={statusTone(mr.Status || "Draft")} />} />
                          <SheetMark text={mr.Priority || "Normal"} tone={priorityTone(mr.Priority)} />
                        </>
                      }
                      actions={
                        <RowKeys
                          onView={() => setViewingId(mr.MRId)}
                          onEdit={rights.canEdit && mr.Status !== "Short Closed" ? () => navigation.navigate("MaterialRequestForm", { id: mr.MRId }) : undefined}
                          onDelete={rights.canDelete ? () => handleDelete(mr) : undefined}
                        />
                      }
                    />
                  )}
                />
                <RegisterFoot loadingMore={isFetchingNextPage} done={!hasNextPage} shown={records.length} />
              </>
            )}
          </RegisterBox>
        </SheetShell>
      </SheetPage>

      <MaterialRequestDetailModal
        recordId={viewingId}
        onClose={() => setViewingId(null)}
        onEdit={rights.canEdit ? (id) => { setViewingId(null); navigation.navigate("MaterialRequestForm", { id }); } : undefined}
      />
    </View>
  );
}

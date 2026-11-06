// RN port of src/pages/material/Issues.tsx (web), on the drawing sheet as the web draws it: the title block with New
// issue; the issue register — its count, a search box, the status keys (All / Draft / Pending / Approved / Rejected) and
// one ruled row per issue with its company and project, godown, items, status and approval marks and keys. A row opens
// MaterialIssueDetailModal; New and Edit open the form as its own page (MaterialIssueFormScreen). Web relies on the
// server's 400 to block editing a non-Draft / Rejected issue; mobile hides Edit and Delete on those rows instead.
import { useMemo, useState } from "react";
import { View, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { usePageRights } from "@/hooks/usePageRights";
import type { MainStackParamList } from "@/navigation/MainStack";
import { getMaterialIssues, deleteMaterialIssue, type MaterialIssue } from "@/api/issuesApi";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { Body, Key, Notice, RegisterHead, SearchBox, SheetMark, SheetShell, statusTone } from "@/components/sheet/Sheet";
import { Facts, KeyRow, NoAccess, RecordRow, RegisterBox, RegisterFoot, RegisterLoading, RowKeys, SheetPage, fmtDate } from "@/components/sheet/Register";
import { MaterialIssueDetailModal } from "./materialIssues/MaterialIssueDetailModal";

const PAGE_SIZE = 15;
const STATUS = ["", "Draft", "Pending", "Approved", "Rejected"];
const EDITABLE = new Set(["Draft", "Rejected"]);
const markOf = (status?: string | null) => (/draft/i.test(status || "Draft") ? "draft" : statusTone(status || "")) as "draft" | "done" | "waiting" | "stopped";

export default function MaterialIssuesListScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const queryClient = useQueryClient();
  const rights = usePageRights("material-issues");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage, refetch, isFetching } = useInfiniteQuery({
    queryKey: ["material-issues-mobile", status],
    queryFn: ({ pageParam }) => getMaterialIssues({ page: pageParam, limit: PAGE_SIZE, status: status || undefined }),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (pages.length < (last?.totalPages ?? 1) ? pages.length + 1 : undefined),
    enabled: rights.canView,
  });

  const records: MaterialIssue[] = useMemo(() => (data?.pages ?? []).flatMap((p) => p?.data ?? []), [data]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) => [r.DocNo, r.IssueNo, r.CompanyName, r.ProjectName, r.GodownName, r.Reason].some((v) => (v ?? "").toLowerCase().includes(q)));
  }, [records, search]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleDelete = (issue: MaterialIssue) =>
    Alert.alert("Delete material issue?", `${issue.DocNo || issue.IssueNo || `ISS-${issue.IssueId}`} will be permanently removed and its stock deduction reversed.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteMaterialIssue(issue.IssueId);
            queryClient.invalidateQueries({ queryKey: ["material-issues-mobile"], exact: false });
          } catch (err: any) {
            Alert.alert("Could not delete", err.message ?? "Something went wrong.");
          }
        },
      },
    ]);

  if (!rights.canView) return <NoAccess eyebrow="CivilierERP · Material" title="Material issues" what="material issues" />;

  return (
    <View style={{ flex: 1 }}>
      <SheetPage refreshing={refreshing} onRefresh={onRefresh} onEndReached={() => hasNextPage && !isFetchingNextPage && fetchNextPage()}>
        <SheetShell
          eyebrow="CivilierERP · Material"
          title="Material issues"
          subtitle="Material issued from a godown to its project, checked against the stock in that godown."
          action={
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {rights.canCreate && <Key tone="ink" label="New issue" icon={<Plus size={13} color={S.paper} />} onPress={() => navigation.navigate("MaterialIssueForm")} />}
              <Key label={isFetching && !isFetchingNextPage ? "Reading…" : "Refresh"} icon={<RefreshCw size={13} color={S.ink} />} onPress={() => refetch()} />
            </View>
          }
        >
          <RegisterBox>
            <RegisterHead title="Issue register" count={filtered.length} unit={["issue loaded", "issues loaded"]} />
            <SearchBox value={search} onChange={setSearch} placeholder="Search issue, company, project, godown…" />
            <KeyRow options={STATUS.map((s) => ({ value: s, label: s || "All" }))} value={status} onChange={setStatus} />

            {isLoading ? (
              <RegisterLoading />
            ) : isError ? (
              <Notice>Could not load the material issues. Pull down to try again.</Notice>
            ) : filtered.length === 0 ? (
              <Body color={S.graphite}>{search ? "No issue matches that search." : "No material issues yet."}</Body>
            ) : (
              <View style={{ borderTopWidth: 1, borderTopColor: S.ink }}>
                {filtered.map((issue, i) => {
                  const editable = EDITABLE.has(issue.Status);
                  return (
                    <RecordRow
                      key={issue.IssueId}
                      last={i === filtered.length - 1}
                      title={issue.DocNo || issue.IssueNo || `ISS-${issue.IssueId}`}
                      date={fmtDate(issue.Date)}
                      side={`${issue.ItemCount ?? issue.items?.length ?? 0} items`}
                      sideNote={`${issue.TotalQty ?? 0} units`}
                      onPress={() => setViewingId(issue.IssueId)}
                      lines={[
                        [issue.CompanyName, issue.ProjectName].filter(Boolean).join(" · ") || "—",
                        <Facts key="f" items={[["Godown", [issue.GodownName, issue.GodownCode].filter(Boolean).join(" · ")]]} />,
                      ]}
                      marks={
                        <>
                          <SheetMark text={issue.Status || "Draft"} tone={markOf(issue.Status)} />
                          <ApprovalStatusChain table="MaterialIssues" recordId={issue.IssueId} />
                        </>
                      }
                      actions={
                        <RowKeys
                          onView={() => setViewingId(issue.IssueId)}
                          onEdit={rights.canEdit && editable ? () => navigation.navigate("MaterialIssueForm", { id: issue.IssueId }) : undefined}
                          onDelete={rights.canDelete && editable ? () => handleDelete(issue) : undefined}
                        />
                      }
                    />
                  );
                })}
                <RegisterFoot loadingMore={isFetchingNextPage} done={!hasNextPage} shown={records.length} />
              </View>
            )}
          </RegisterBox>
        </SheetShell>
      </SheetPage>

      <MaterialIssueDetailModal recordId={viewingId} onClose={() => setViewingId(null)} />
    </View>
  );
}

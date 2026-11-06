// RN port of src/pages/material/IssueReturn.tsx (web), on the drawing sheet as the web draws it: the title block with
// New return; the return register — its count, a search box, the status keys (All / Draft / Pending / Approved /
// Rejected) and one ruled row per return with the issue it returns against, company and project, its status and keys.
// Web has no server paging or search here (a small register), so one query and client-side filtering mirror that.
// Submit / Approve / Reject live in IssueReturnDetailModal; New and Edit open the form as its own page
// (IssueReturnFormScreen). Edit only while Draft; Delete while Draft or Rejected.
import { useMemo, useState } from "react";
import { View, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { usePageRights } from "@/hooks/usePageRights";
import type { MainStackParamList } from "@/navigation/MainStack";
import { getIssueReturns, deleteIssueReturn, type IssueReturn } from "@/api/issueReturnApi";
import { Body, Key, Notice, RegisterHead, SearchBox, SheetMark, SheetShell, statusTone } from "@/components/sheet/Sheet";
import { Facts, KeyRow, NoAccess, RecordRow, RegisterBox, RegisterLoading, RowKeys, SheetPage, fmtDate } from "@/components/sheet/Register";
import { IssueReturnDetailModal } from "./issueReturn/IssueReturnDetailModal";

const STATUS = ["", "Draft", "Pending", "Approved", "Rejected"];

export default function MaterialIssueReturnListScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const queryClient = useQueryClient();
  const rights = usePageRights("material-issue-return");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);

  const { data: records = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["issue-returns-mobile"],
    queryFn: () => getIssueReturns(),
    enabled: rights.canView,
  });

  const filtered = useMemo(() => {
    let rows = records;
    if (status) rows = rows.filter((r) => r.Status === status);
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((r) => [r.DocNo, r.IssueDocNo, r.CompanyName, r.ProjectName].some((v) => (v ?? "").toLowerCase().includes(q)));
    return rows;
  }, [records, status, search]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const openEdit = (id: number) => {
    setViewingId(null);
    navigation.navigate("IssueReturnForm", { id });
  };

  const handleDelete = (rec: IssueReturn) =>
    Alert.alert("Delete issue return?", `${rec.DocNo || `IRN-${rec.ReturnId}`} will be permanently removed.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteIssueReturn(rec.ReturnId);
            queryClient.invalidateQueries({ queryKey: ["issue-returns-mobile"], exact: false });
          } catch (err: any) {
            Alert.alert("Could not delete", err.message ?? "Something went wrong.");
          }
        },
      },
    ]);

  if (!rights.canView) return <NoAccess eyebrow="CivilierERP · Material" title="Issue returns" what="issue returns" />;

  return (
    <View style={{ flex: 1 }}>
      <SheetPage refreshing={refreshing} onRefresh={onRefresh}>
        <SheetShell
          eyebrow="CivilierERP · Material"
          title="Issue returns"
          subtitle="Material coming back from a project into the godown it was issued from, capped at what is still out on the issue."
          action={
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {rights.canCreate && <Key tone="ink" label="New return" icon={<Plus size={13} color={S.paper} />} onPress={() => navigation.navigate("IssueReturnForm")} />}
              <Key label={isFetching ? "Reading…" : "Refresh"} icon={<RefreshCw size={13} color={S.ink} />} onPress={() => refetch()} />
            </View>
          }
        >
          <RegisterBox>
            <RegisterHead title="Return register" count={filtered.length} unit={["return", "returns"]} />
            <SearchBox value={search} onChange={setSearch} placeholder="Search return, issue ref, company, project…" />
            <KeyRow options={STATUS.map((s) => ({ value: s, label: s || "All" }))} value={status} onChange={setStatus} />

            {isLoading ? (
              <RegisterLoading />
            ) : isError ? (
              <Notice>Could not load the issue returns. Pull down to try again.</Notice>
            ) : filtered.length === 0 ? (
              <Body color={S.graphite}>{search || status ? "No return matches that filter." : "No issue returns yet."}</Body>
            ) : (
              <View style={{ borderTopWidth: 1, borderTopColor: S.ink }}>
                {filtered.map((rec, i) => (
                  <RecordRow
                    key={rec.ReturnId}
                    last={i === filtered.length - 1}
                    title={rec.DocNo || `IRN-${rec.ReturnId}`}
                    date={fmtDate(rec.ReturnDate)}
                    onPress={() => setViewingId(rec.ReturnId)}
                    lines={[
                      [rec.CompanyName, rec.ProjectName].filter(Boolean).join(" · ") || "—",
                      <Facts key="f" items={[["Against issue", rec.IssueDocNo || "—"]]} />,
                    ]}
                    marks={<SheetMark text={rec.Status || "Draft"} tone={/draft/i.test(rec.Status || "Draft") ? "draft" : statusTone(rec.Status)} />}
                    actions={
                      <RowKeys
                        onView={() => setViewingId(rec.ReturnId)}
                        onEdit={rights.canEdit && rec.Status === "Draft" ? () => openEdit(rec.ReturnId) : undefined}
                        onDelete={rights.canDelete && (rec.Status === "Draft" || rec.Status === "Rejected") ? () => handleDelete(rec) : undefined}
                      />
                    }
                  />
                ))}
              </View>
            )}
          </RegisterBox>
        </SheetShell>
      </SheetPage>

      <IssueReturnDetailModal recordId={viewingId} onClose={() => setViewingId(null)} onEdit={openEdit} canEdit={rights.canEdit} canDelete={rights.canDelete} />
    </View>
  );
}

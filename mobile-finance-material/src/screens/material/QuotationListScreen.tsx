// RN port of src/pages/material/Quotation.tsx (QtList), on the drawing sheet as the web draws it: the title block with
// New quotation; the quotation register — its count, a search box, the status keys (All / Draft / Sent / Partially
// quoted / Quoted / Closed) and one ruled row per request for quotation with its company and project, how many tagged
// suppliers have quoted, the items, its status and keys (Edit while Draft, Delete with the right). The register is
// one list with no paging, as on the web. A row opens QuotationDetailModal; New and Edit open the form as its own page
// (QuotationFormScreen).
import { useMemo, useState } from "react";
import { View, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { usePageRights } from "@/hooks/usePageRights";
import type { MainStackParamList } from "@/navigation/MainStack";
import { getQuotations, deleteQuotation, type Quotation } from "@/api/quotationApi";
import { Body, Key, Notice, RegisterHead, SearchBox, SheetMark, SheetShell } from "@/components/sheet/Sheet";
import { Facts, KeyRow, NoAccess, RecordRow, RegisterBox, RegisterLoading, RowKeys, SheetPage, fmtDate } from "@/components/sheet/Register";
import { QuotationDetailModal } from "./quotation/QuotationDetailModal";
import { qtStatusLabel, qtStatusTone } from "./quotation/status";

const STATUS = ["", "Draft", "Sent", "PartiallyQuoted", "Quoted", "Closed"];

export default function QuotationListScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const queryClient = useQueryClient();
  const rights = usePageRights("quotation");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);

  const { data: records = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["qt-list", status],
    queryFn: () => getQuotations({ status: status || undefined }),
    enabled: rights.canView,
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) => [r.DocNo, r.CompanyName, r.ProjectName].some((v) => (v ?? "").toLowerCase().includes(q)));
  }, [records, search]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleDelete = (qt: Quotation) =>
    Alert.alert("Delete quotation?", `${qt.DocNo || `QT-${qt.QuotationId}`} will be permanently removed.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteQuotation(qt.QuotationId);
            queryClient.invalidateQueries({ queryKey: ["qt-list"] });
          } catch (err: any) {
            Alert.alert("Could not delete", err.message ?? "Something went wrong.");
          }
        },
      },
    ]);

  if (!rights.canView) return <NoAccess eyebrow="CivilierERP · Material" title="Quotations" what="quotations" />;

  return (
    <View style={{ flex: 1 }}>
      <SheetPage refreshing={refreshing} onRefresh={onRefresh}>
        <SheetShell
          eyebrow="CivilierERP · Material"
          title="Quotations"
          subtitle="Request and compare supplier quotes against a tagged material request."
          action={
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {rights.canCreate && <Key tone="ink" label="New quotation" icon={<Plus size={13} color={S.paper} />} onPress={() => navigation.navigate("QuotationForm")} />}
              <Key label={isFetching ? "Reading…" : "Refresh"} icon={<RefreshCw size={13} color={S.ink} />} onPress={() => refetch()} />
            </View>
          }
        >
          <RegisterBox>
            <RegisterHead title="Quotation register" count={rows.length} unit={["record", "records"]} />
            <SearchBox value={search} onChange={setSearch} placeholder="Search doc no, company, project…" />
            <KeyRow options={STATUS.map((s) => ({ value: s, label: s ? qtStatusLabel(s) : "All" }))} value={status} onChange={setStatus} />

            {isLoading ? (
              <RegisterLoading />
            ) : isError ? (
              <Notice>Could not load the quotations. Pull down to try again.</Notice>
            ) : rows.length === 0 ? (
              <Body color={S.graphite}>{search ? "No quotation matches that search." : "No quotations found. Use New quotation to raise one."}</Body>
            ) : (
              <View style={{ borderTopWidth: 1, borderTopColor: S.ink }}>
                {rows.map((qt, i) => (
                  <RecordRow
                    key={qt.QuotationId}
                    last={i === rows.length - 1}
                    title={qt.DocNo || `QT-${qt.QuotationId}`}
                    date={fmtDate(qt.DocDate)}
                    side={`${qt.SubmittedCount || 0}/${qt.SupplierCount || 0}`}
                    sideNote="quoted"
                    onPress={() => setViewingId(qt.QuotationId)}
                    lines={[
                      [qt.CompanyName, qt.ProjectName].filter(Boolean).join(" · ") || "—",
                      <Facts key="f" items={[["Items", Number(qt.ItemCount) || 0], ["MR", qt.SourceMRDocNo], ["Due", qt.DueDate ? fmtDate(qt.DueDate) : null]]} />,
                    ]}
                    marks={<SheetMark text={qtStatusLabel(qt.Status || "Draft")} tone={qtStatusTone(qt.Status)} />}
                    actions={
                      <RowKeys
                        onView={() => setViewingId(qt.QuotationId)}
                        onEdit={rights.canEdit && (qt.Status || "Draft") === "Draft" ? () => navigation.navigate("QuotationForm", { id: qt.QuotationId }) : undefined}
                        onDelete={rights.canDelete ? () => handleDelete(qt) : undefined}
                      />
                    }
                  />
                ))}
              </View>
            )}
          </RegisterBox>
        </SheetShell>
      </SheetPage>

      <QuotationDetailModal
        recordId={viewingId}
        onClose={() => setViewingId(null)}
        onEdit={rights.canEdit ? (id) => { setViewingId(null); navigation.navigate("QuotationForm", { id }); } : undefined}
        canEdit={rights.canEdit}
        canDelete={rights.canDelete}
      />
    </View>
  );
}

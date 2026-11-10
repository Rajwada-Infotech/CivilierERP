// RN port of src/pages/material/VehicleInOut.tsx (web), on the drawing sheet as the web draws it: the title block with
// New entry; the entry register — its count, a search box beside the financial-year key, and the entries grouped by
// project, each a ruled row with the vehicle number, supplier, PO, challan, entry time, attachments, its approval mark
// and keys. A row opens VehicleInOutDetailModal; New and Edit open the form as its own page (VehicleInOutFormScreen).
// CSV import/export and print stay web-only.
import { fmtWallClock } from "@/utils/istTime";
import { useMemo, useState } from "react";
import { View, Text, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, SlidersHorizontal } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { usePageRights } from "@/hooks/usePageRights";
import type { MainStackParamList } from "@/navigation/MainStack";
import { getVehicleInOuts, deleteVehicleInOut, fetchFinYearOptions, type VehicleInOutRecord } from "@/api/vehicleInOutApi";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { OptionPickerModal, type PickerOption } from "@/screens/finance/payment/OptionPicker";
import { IconKey, Key, Notice, RegisterHead, SearchBox, SheetShell } from "@/components/sheet/Sheet";
import { Facts, NoAccess, ProjectGroups, RecordRow, RegisterBox, RegisterFoot, RegisterLoading, RowKeys, SheetPage, fmtDate } from "@/components/sheet/Register";
import { VehicleInOutDetailModal } from "./vehicleInOut/VehicleInOutDetailModal";

const PAGE_SIZE = 15;

// Entry / exit times are stored as the IST digits that were typed; show those digits, not the phone's zone.
const fmtDateTime = (d: string | null | undefined) => fmtWallClock(d, { dateStyle: "short", timeStyle: "short" });

export default function VehicleInOutListScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const queryClient = useQueryClient();
  const rights = usePageRights("vehicle-in-out");
  const [search, setSearch] = useState("");
  const [finYear, setFinYear] = useState("");
  const [fyPickerOpen, setFyPickerOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);

  const { data: finYears = [] } = useQuery({ queryKey: ["veh-list-finyears"], queryFn: fetchFinYearOptions });

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage, refetch, isFetching } = useInfiniteQuery({
    queryKey: ["vehicle-in-out-mobile", finYear],
    queryFn: ({ pageParam }) => getVehicleInOuts({ page: pageParam, limit: PAGE_SIZE, finYear: finYear || undefined }),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (pages.length < (last?.totalPages ?? 1) ? pages.length + 1 : undefined),
    enabled: rights.canView,
  });

  const records: VehicleInOutRecord[] = useMemo(() => (data?.pages ?? []).flatMap((p) => p?.data ?? []), [data]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) => [r.DocNo, r.VehicleNo, r.ChallanNo, r.SupplierName, r.PONumber].some((v) => (v ?? "").toLowerCase().includes(q)));
  }, [records, search]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleDelete = (rec: VehicleInOutRecord) =>
    Alert.alert("Delete entry?", `${rec.DocNo || "This vehicle in / out entry"} will be permanently removed.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteVehicleInOut(rec.VehicleInOutID);
            queryClient.invalidateQueries({ queryKey: ["vehicle-in-out-mobile"], exact: false });
          } catch (err: any) {
            Alert.alert("Could not delete", err.message ?? "Something went wrong.");
          }
        },
      },
    ]);

  if (!rights.canView) return <NoAccess eyebrow="CivilierERP · Material" title="Vehicle in / out" what="vehicle in / out entries" />;

  const finYearOptions: PickerOption[] = finYears.map((f) => ({ key: f.label, label: f.label }));

  return (
    <View style={{ flex: 1 }}>
      <SheetPage refreshing={refreshing} onRefresh={onRefresh} onEndReached={() => hasNextPage && !isFetchingNextPage && fetchNextPage()}>
        <SheetShell
          eyebrow="CivilierERP · Material"
          title="Vehicle in / out"
          subtitle="Vehicles arriving at site against purchase orders: what they carried, what was received and its quality."
          action={
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {rights.canCreate && <Key tone="ink" label="New entry" icon={<Plus size={13} color={S.paper} />} onPress={() => navigation.navigate("VehicleInOutForm")} />}
              <Key label={isFetching && !isFetchingNextPage ? "Reading…" : "Refresh"} icon={<RefreshCw size={13} color={S.ink} />} onPress={() => refetch()} />
            </View>
          }
        >
          <RegisterBox>
            <RegisterHead title="Vehicle register" count={filtered.length} unit={["entry loaded", "entries loaded"]} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <SearchBox value={search} onChange={setSearch} placeholder="Search doc no, vehicle, supplier, PO…" />
              </View>
              <IconKey onPress={() => setFyPickerOpen(true)} size={44}>
                <SlidersHorizontal size={15} color={finYear ? S.blue : S.ink} />
              </IconKey>
            </View>
            {!!finYear && (
              <Text style={{ fontFamily: fonts.body.regular, fontSize: 12, color: S.graphite }}>
                {"Financial year "}
                <Text style={{ fontFamily: fonts.body.semibold, color: S.ink }}>{finYear}</Text>
                <Text onPress={() => setFinYear("")} style={{ color: S.blue, fontFamily: fonts.body.medium }}>{"  · Clear"}</Text>
              </Text>
            )}

            {isLoading ? (
              <RegisterLoading />
            ) : isError ? (
              <Notice>Could not load the vehicle entries. Pull down to try again.</Notice>
            ) : (
              <>
                <ProjectGroups
                  items={filtered}
                  getProject={(r) => r.ProjectName}
                  keyOf={(r) => r.VehicleInOutID}
                  unit={["entry", "entries"]}
                  expandAll={!!search.trim()}
                  emptyText={search ? "No entry matches that search." : "No vehicle entries yet."}
                  renderItem={(rec, last) => (
                    <RecordRow
                      last={last}
                      title={rec.DocNo || "—"}
                      date={fmtDate(rec.DocDate)}
                      side={rec.VehicleNo || "—"}
                      sideNote="vehicle"
                      onPress={() => setViewingId(rec.VehicleInOutID)}
                      lines={[
                        rec.SupplierName || "—",
                        <Facts
                          key="f"
                          items={[
                            ["PO", rec.PONumber],
                            ["Challan", rec.ChallanNo],
                            ["In", rec.EntryTime ? fmtDateTime(rec.EntryTime) : null],
                            ["Files", rec.AttachmentCount ? rec.AttachmentCount : null],
                          ]}
                        />,
                      ]}
                      marks={<ApprovalStatusChain table="VehicleInOut" recordId={rec.VehicleInOutID} />}
                      actions={
                        <RowKeys
                          onView={() => setViewingId(rec.VehicleInOutID)}
                          onEdit={rights.canEdit ? () => navigation.navigate("VehicleInOutForm", { id: rec.VehicleInOutID }) : undefined}
                          onDelete={rights.canDelete ? () => handleDelete(rec) : undefined}
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

      <OptionPickerModal
        visible={fyPickerOpen}
        title="Financial year"
        options={finYearOptions}
        selectedKey={finYear}
        onSelect={(k) => { setFinYear(k); setFyPickerOpen(false); }}
        onClose={() => setFyPickerOpen(false)}
        clearable
      />
      <VehicleInOutDetailModal
        recordId={viewingId}
        onClose={() => setViewingId(null)}
        onEdit={rights.canEdit ? (id) => { setViewingId(null); navigation.navigate("VehicleInOutForm", { id }); } : undefined}
      />
    </View>
  );
}

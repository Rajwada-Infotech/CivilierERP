// RN port of src/pages/finance/Contract.tsx's list view, on the drawing sheet as the web draws it: the sheet's title
// block with "New contract", four figures (contracts, active, draft or pending, contract value), then the contract
// register — its heading and count, a search box, and one ruled row per contract with its approval status and the
// View / Edit / Delete keys the web row has (each shown only with the matching right on finance-contracts).
import { useMemo, useState } from "react";
import { View, Text, ScrollView, RefreshControl, Alert } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Eye, FileText, Plus, Trash2 } from "lucide-react-native";
import { deleteContract, getContracts, type ContractListItem } from "@/api/contractApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { usePageRights } from "@/hooks/usePageRights";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, IconKey, Key, Notice, Press, RegisterHead, SearchBox, SheetMark, SheetShell, Skel, StatRow } from "@/components/sheet/Sheet";

function fmtDate(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const fmtAmt = (n: number | null | undefined) => (n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—");

/** Web's StatusBadge: active / approved settled, expired / deleted / rejected stopped, the rest waiting. */
function StatusMark({ status }: { status: string }) {
  const s = (status || "Draft").toLowerCase();
  const tone = s === "active" || s === "approved" ? "done" : s === "expired" || s === "deleted" || s === "rejected" ? "stopped" : "waiting";
  return <SheetMark text={status || "Draft"} tone={tone} />;
}

function ContractRow({
  item,
  last,
  onView,
  onEdit,
  onDelete,
}: {
  item: ContractListItem;
  last: boolean;
  onView: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <Press
      onPress={onView}
      style={(pressed) => ({ paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: S.ruleSoft, backgroundColor: pressed ? S.blueWash : "transparent" })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text numberOfLines={1} style={{ fontFamily: fonts.heading.semibold, fontSize: 13, letterSpacing: 0.2, color: S.ink }}>{item.DocNo || "—"}</Text>
          <Text numberOfLines={1} style={{ fontFamily: fonts.body.medium, fontSize: 12.5, color: S.ink }}>{item.CompanyName || "—"}</Text>
          {!!item.ProjectName && <Text numberOfLines={1} style={{ fontFamily: fonts.body.regular, fontSize: 11.5, color: S.graphite }}>{item.ProjectName}</Text>}
        </View>
        <ApprovalStatusChain table="Contract" recordId={item.ContractId} fallback={<StatusMark status={item.Status} />} />
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 2, marginTop: 8 }}>
        <Body size={11.5} color={S.graphite}>{fmtDate(item.DocDate)}</Body>
        {!!item.ContactPerson && <Body size={11.5} color={S.graphite}>{item.ContactPerson}</Body>}
        {!!item.NatureOfContract && <Body size={11.5} color={S.graphite}>{item.NatureOfContract}</Body>}
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
        <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 16, letterSpacing: -0.3, color: S.ink }}>{fmtAmt(item.ContractAmount)}</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <IconKey onPress={onView} size={32}>
            <Eye size={14} color={S.ink} />
          </IconKey>
          {onEdit && (
            <IconKey onPress={onEdit} size={32}>
              <FileText size={14} color={S.ink} />
            </IconKey>
          )}
          {onDelete && (
            <IconKey onPress={onDelete} size={32} red>
              <Trash2 size={14} color={S.red} />
            </IconKey>
          )}
        </View>
      </View>
    </Press>
  );
}

export default function ContractListScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const queryClient = useQueryClient();
  const rights = usePageRights("finance-contracts");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["contracts"],
    queryFn: getContracts,
    staleTime: 60 * 1000,
  });
  const contracts = data ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return contracts;
    const q = search.trim().toLowerCase();
    return contracts.filter((c) => [c.DocNo, c.ContactPerson, c.NatureOfContract, c.CompanyName, c.ProjectName].some((f) => f?.toLowerCase().includes(q)));
  }, [contracts, search]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const confirmDelete = (c: ContractListItem) =>
    Alert.alert("Delete contract?", `${c.DocNo || "This contract"} will be deleted. This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteContract(c.ContractId);
            await queryClient.invalidateQueries({ queryKey: ["contracts"] });
          } catch (e) {
            Alert.alert("Could not delete", e instanceof Error ? e.message : "Something went wrong.");
          }
        },
      },
    ]);

  const value = contracts.reduce((sum, c) => sum + (Number(c.ContractAmount) || 0), 0);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: 96 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={S.ink} />}
    >
      <SheetShell
        eyebrow="CivilierERP · Finance"
        title="Contracts"
        subtitle="Create and manage contracts"
        action={rights.canCreate ? <Key tone="ink" label="New contract" icon={<Plus size={13} color={S.paper} />} onPress={() => navigation.navigate("NewContract")} style={{ alignSelf: "flex-start" }} /> : undefined}
      >
        {!isLoading && (
          <StatRow
            items={[
              { label: "Contracts", value: contracts.length.toLocaleString("en-IN"), note: "in the register" },
              { label: "Active", value: contracts.filter((c) => /^(active|approved)$/i.test(c.Status || "")).length.toLocaleString("en-IN"), note: "in force" },
              { label: "Draft or pending", value: contracts.filter((c) => /^(draft|pending)$/i.test(c.Status || "Draft")).length.toLocaleString("en-IN"), note: "not yet in force" },
              { label: "Contract value", value: fmtAmt(value), note: "all contracts listed" },
            ]}
          />
        )}

        {isError && <Notice>Could not load the contracts. Pull down to try again.</Notice>}

        <View style={{ borderWidth: 1, borderColor: S.ink, padding: 12, gap: 12 }}>
          <RegisterHead title="Contract register" count={contracts.length} />
          <SearchBox value={search} onChange={setSearch} placeholder="Search contract, company…" />
          {isLoading ? (
            <>
              <Skel h={70} />
              <Skel h={70} />
              <Skel h={70} />
            </>
          ) : filtered.length === 0 ? (
            <Body color={S.graphite}>{search ? "No contract matches that search." : "No contracts yet. Tap New contract to create one."}</Body>
          ) : (
            <View>
              {filtered.map((c, i) => (
                <ContractRow
                  key={c.ContractId}
                  item={c}
                  last={i === filtered.length - 1}
                  onView={() => navigation.navigate("ContractDetail", { id: c.ContractId })}
                  onEdit={rights.canEdit ? () => navigation.navigate("NewContract", { id: c.ContractId }) : undefined}
                  onDelete={rights.canDelete ? () => confirmDelete(c) : undefined}
                />
              ))}
            </View>
          )}
        </View>
      </SheetShell>
    </ScrollView>
  );
}

// RN port of src/pages/material/Stock.tsx (web) — a current-balance
// (item × godown) view, not a transaction ledger, despite the page's
// pageKey being "stock-ledger". Web's 10-column desktop table (with a #
// index column and a Customer Rate/Stock Value pair that's always empty —
// CustomerRate is hard-coded NULL server-side today) becomes a card list
// here, dropping the dead-weight rate/value columns. Company/Project/
// Godown filtering stays client-side against the one full godowns list,
// matching web exactly. Tapping a card opens the ledger drill-down
// (StockLedgerScreen) scoped to that item+godown — a mobile-only addition
// since web never wired up its own (otherwise unused) ledger endpoint.
import { useEffect, useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { Package, Layers, TrendingUp, TrendingDown, ListTree, ShieldOff, AlertCircle } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { usePageRights } from "@/hooks/usePageRights";
import { getGodowns, getCompanies, getProjects, getInventoryMaster, type Godown, type InventoryMasterRow } from "@/api/stockApi";
import { PickerRow, OptionPickerModal, type PickerOption } from "@/screens/finance/payment/OptionPicker";
import type { MainStackParamList } from "@/navigation/MainStack";

function todayISO() { return new Date().toISOString().slice(0, 10); }

function fmtNum(n: number | null | undefined) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(n) || 0);
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string; icon: any; color: string }) {
  return (
    <View style={{ flex: 1, minWidth: "47%", borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80` }} className="rounded-xl px-3 py-2.5">
      <View className="flex-row items-center gap-1.5 mb-1">
        <Icon size={12} color={color} />
        <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.medium, textTransform: "uppercase" }}>{label}</Text>
      </View>
      <Text style={{ color, fontSize: 15, fontFamily: fonts.heading.bold }}>{value}</Text>
    </View>
  );
}

function StockItemCard({ row, onPress }: { row: InventoryMasterRow; onPress: () => void }) {
  const closingColor = row.ClosingStock > 0 ? "#059669" : row.ClosingStock < 0 ? colors.destructive : colors.mutedForeground;
  return (
    <Pressable onPress={onPress} className="rounded-2xl p-3.5 mb-2.5" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
      <View className="flex-row items-start justify-between gap-2 mb-2">
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.bold }}>{row.ItemName || row.ItemID}</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 10, marginTop: 2 }}>{[row.ItemGroupName, row.UOMSymbol || row.UOMName].filter(Boolean).join(" · ") || "—"}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Closing</Text>
          <Text style={{ color: closingColor, fontSize: 15, fontFamily: fonts.heading.bold }}>{fmtNum(row.ClosingStock)}</Text>
        </View>
      </View>
      <View className="flex-row" style={{ gap: 16 }}>
        <View>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Opening</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 11.5, marginTop: 1 }}>{fmtNum(row.OpeningStock)}</Text>
        </View>
        <View>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>In</Text>
          <Text style={{ color: row.StockIn > 0 ? "#059669" : colors.mutedForeground, fontSize: 11.5, marginTop: 1 }}>{row.StockIn > 0 ? `+${fmtNum(row.StockIn)}` : "—"}</Text>
        </View>
        <View>
          <Text style={{ color: colors.mutedForeground, fontSize: 9, textTransform: "uppercase" }}>Out</Text>
          <Text style={{ color: row.StockOut > 0 ? colors.destructive : colors.mutedForeground, fontSize: 11.5, marginTop: 1 }}>{row.StockOut > 0 ? `-${fmtNum(row.StockOut)}` : "—"}</Text>
        </View>
      </View>
    </Pressable>
  );
}

export default function StockScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const rights = usePageRights("stock-ledger");
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [godownId, setGodownId] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState(todayISO());
  const [search, setSearch] = useState("");
  const [picker, setPicker] = useState<"company" | "project" | "godown" | null>(null);

  const { data: godowns = [] } = useQuery({ queryKey: ["stock-godowns"], queryFn: getGodowns, enabled: rights.canView });
  const { data: companies = [] } = useQuery({ queryKey: ["stock-companies"], queryFn: getCompanies, enabled: rights.canView });
  const { data: projects = [] } = useQuery({ queryKey: ["stock-projects"], queryFn: getProjects, enabled: rights.canView });

  const filteredGodowns = useMemo(
    () => godowns.filter((g) => (companyId ? String(g.companyId) === companyId : true) && (projectId ? String(g.projectId) === projectId : true)),
    [godowns, companyId, projectId],
  );

  useEffect(() => {
    if (godownId != null && filteredGodowns.length > 0 && !filteredGodowns.some((g) => g.id === godownId)) {
      setGodownId(filteredGodowns[0]?.id ?? null);
    }
  }, [filteredGodowns, godownId]);

  const selectedGodown: Godown | undefined = godowns.find((g) => g.id === godownId);

  const { data: inventory, isLoading, isFetching, isError } = useQuery({
    queryKey: ["inventory-master", godownId, dateFrom, dateTo],
    queryFn: () => getInventoryMaster(dateTo || todayISO(), godownId, dateFrom || undefined, dateTo || undefined),
    enabled: rights.canView && godownId != null,
  });

  const rows = inventory?.data ?? [];
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (r.ItemName || "").toLowerCase().includes(q) || (r.ItemGroupName || "").toLowerCase().includes(q));
  }, [rows, search]);

  const totals = useMemo(
    () => rows.reduce((acc, r) => ({
      opening: acc.opening + (r.OpeningStock || 0), in: acc.in + (r.StockIn || 0), out: acc.out + (r.StockOut || 0), closing: acc.closing + (r.ClosingStock || 0),
    }), { opening: 0, in: 0, out: 0, closing: 0 }),
    [rows],
  );

  const companyOptions: PickerOption[] = companies.map((c) => ({ key: c.id, label: c.name }));
  const projectOptions: PickerOption[] = projects.map((p) => ({ key: p.id, label: p.name }));
  const godownOptions: PickerOption[] = filteredGodowns.map((g) => ({ key: String(g.id), label: g.name, sublabel: g.code ?? undefined }));

  const goToLedger = (row?: InventoryMasterRow) => {
    navigation.navigate("StockLedger", {
      itemId: row?.ItemID, itemName: row?.ItemName ?? undefined,
      godownId: godownId ?? undefined, godownName: selectedGodown?.name,
      dateFrom: dateFrom || undefined, dateTo: dateTo || undefined,
    });
  };

  if (!rights.canView) {
    return (
      <View className="flex-1 items-center justify-center px-8" style={{ backgroundColor: colors.background }}>
        <ShieldOff size={28} color={colors.mutedForeground} />
        <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold, marginTop: 12 }}>No access</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, marginTop: 4, textAlign: "center" }}>
          You don't have permission to view Stock.
        </Text>
      </View>
    );
  }

  const ListHeader = (
    <View>
      <View className="flex-row items-center gap-2.5 mb-3">
        <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: "#8b5cf626", borderWidth: 1, borderColor: "#8b5cf64d" }}>
          <Package size={16} color="#8b5cf6" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 18 }}>Stock Overview</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>Current stock levels by godown</Text>
        </View>
        {godownId != null && (
          <Pressable onPress={() => goToLedger()} className="flex-row items-center gap-1 px-2.5 py-2 rounded-lg" style={{ borderWidth: 1, borderColor: colors.border }}>
            <ListTree size={12} color={colors.primary} />
            <Text style={{ color: colors.primary, fontSize: 10.5, fontFamily: fonts.heading.medium }}>Ledger</Text>
          </Pressable>
        )}
      </View>

      <PickerRow label="Company" value={companies.find((c) => c.id === companyId)?.name ?? ""} placeholder="All" onPress={() => setPicker("company")} />
      <PickerRow label="Project" value={projects.find((p) => p.id === projectId)?.name ?? ""} placeholder="All" onPress={() => setPicker("project")} />
      <PickerRow label="Godown" value={selectedGodown?.name ?? ""} placeholder="Select a godown" onPress={() => setPicker("godown")} />

      <View className="flex-row gap-2 mb-3">
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.medium, marginBottom: 5, textTransform: "uppercase" }}>From</Text>
          <TextInput
            value={dateFrom} onChangeText={setDateFrom} placeholder="YYYY-MM-DD" placeholderTextColor={`${colors.mutedForeground}99`}
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: colors.foreground, fontSize: 13 }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.medium, marginBottom: 5, textTransform: "uppercase" }}>To</Text>
          <TextInput
            value={dateTo} onChangeText={setDateTo} placeholder="YYYY-MM-DD" placeholderTextColor={`${colors.mutedForeground}99`}
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: colors.foreground, fontSize: 13 }}
          />
        </View>
      </View>

      {godownId == null ? null : !!selectedGodown && (
        <View className="rounded-xl px-3.5 py-3 mb-3" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80` }}>
          <View className="flex-row items-center justify-between">
            <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold, flex: 1, marginRight: 8 }}>{selectedGodown.name}</Text>
            {!selectedGodown.isActive && (
              <View className="px-1.5 py-0.5 rounded" style={{ backgroundColor: `${colors.mutedForeground}1a`, borderWidth: 1, borderColor: `${colors.mutedForeground}40` }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 8.5, fontFamily: fonts.heading.bold }}>INACTIVE</Text>
              </View>
            )}
          </View>
          <Text style={{ color: colors.mutedForeground, fontSize: 10.5, marginTop: 2 }}>
            {[selectedGodown.code, selectedGodown.companyName, selectedGodown.projectName, selectedGodown.location].filter(Boolean).join(" · ") || "—"}
          </Text>
        </View>
      )}

      {godownId != null && (
        <View className="flex-row flex-wrap gap-2 mb-3">
          <StatCard label="Opening" value={fmtNum(totals.opening)} icon={Layers} color="#059669" />
          <StatCard label="Stock In" value={`+${fmtNum(totals.in)}`} icon={TrendingUp} color="#059669" />
          <StatCard label="Stock Out" value={`-${fmtNum(totals.out)}`} icon={TrendingDown} color={colors.destructive} />
          <StatCard label="Closing" value={fmtNum(totals.closing)} icon={Package} color="#8b5cf6" />
        </View>
      )}

      {godownId != null && rows.length > 0 && (
        <TextInput
          value={search} onChangeText={setSearch} placeholder="Search item…" placeholderTextColor={`${colors.mutedForeground}99`}
          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: colors.foreground, fontSize: 13, marginBottom: 10 }}
        />
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {godownId == null ? (
        <View style={{ padding: 16 }}>
          {ListHeader}
          <View className="rounded-xl px-3.5 py-6 items-center" style={{ borderWidth: 1, borderColor: colors.border, borderStyle: "dashed" }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, textAlign: "center" }}>Select a godown to see stock levels.</Text>
          </View>
        </View>
      ) : isLoading ? (
        <View style={{ padding: 16 }}>{ListHeader}<View className="py-16 items-center"><ActivityIndicator color={colors.mutedForeground} /></View></View>
      ) : isError ? (
        <View style={{ padding: 16 }}>
          {ListHeader}
          <View className="items-center py-10">
            <AlertCircle size={20} color={colors.destructive} />
            <Text style={{ color: colors.destructive, fontSize: 12, marginTop: 8, textAlign: "center" }}>Failed to load stock data. Please try again.</Text>
          </View>
        </View>
      ) : (
        <FlatList
          data={filteredRows}
          keyExtractor={(r) => r.ItemID}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          ListHeaderComponent={ListHeader}
          renderItem={({ item }) => <StockItemCard row={item} onPress={() => goToLedger(item)} />}
          ListEmptyComponent={
            <View className="items-center py-10">
              <AlertCircle size={20} color={`${colors.mutedForeground}80`} />
              <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 8 }}>No stock data found for this godown.</Text>
            </View>
          }
          ListFooterComponent={isFetching ? <View className="py-4 items-center"><ActivityIndicator size="small" color={colors.mutedForeground} /></View> : null}
        />
      )}

      <OptionPickerModal visible={picker === "company"} title="Select Company" options={companyOptions} selectedKey={companyId ?? ""}
        onSelect={(k) => { setCompanyId(k || null); setPicker(null); }} onClose={() => setPicker(null)} searchable clearable />
      <OptionPickerModal visible={picker === "project"} title="Select Project" options={projectOptions} selectedKey={projectId ?? ""}
        onSelect={(k) => { setProjectId(k || null); setPicker(null); }} onClose={() => setPicker(null)} searchable clearable />
      <OptionPickerModal visible={picker === "godown"} title="Select Godown" options={godownOptions} selectedKey={godownId != null ? String(godownId) : ""}
        onSelect={(k) => { setGodownId(k ? Number(k) : null); setPicker(null); }} onClose={() => setPicker(null)} searchable />
    </View>
  );
}

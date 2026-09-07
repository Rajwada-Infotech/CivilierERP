// RN port of src/pages/finance/Contract.tsx's list view ("Contract
// Register") — same content as the Invoice register screen: search, a card
// per contract, status pill, tap to view detail. The New/Edit form (doc-type
// picker, contact-person picker, file upload, T&C picker) isn't ported —
// same "not built on mobile yet" convention as Invoice's row actions.
import { useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl, TextInput } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { FileText, Search, X, Plus, RefreshCw, ChevronRight } from "lucide-react-native";
import { getContracts, type ContractListItem } from "@/api/contractApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

const ACCENT = "#8b5cf6";

const STATUS_STYLE: Record<string, string> = {
  Active: "#8b5cf6",
  Expired: "#ef4444",
  Draft: "#f59e0b",
  Approved: "#10b981",
  Pending: "#f59e0b",
};

function fmtDate(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtAmt(n: number | null) {
  return n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—";
}

function StatusPill({ status }: { status: string }) {
  const color = STATUS_STYLE[status] ?? colors.mutedForeground;
  return (
    <View className="px-2 py-1 rounded-md" style={{ backgroundColor: `${color}22`, borderWidth: 1, borderColor: `${color}40` }}>
      <Text style={{ color, fontSize: 10, fontFamily: fonts.heading.semibold }}>{status || "Draft"}</Text>
    </View>
  );
}

function ContractCard({ item, onPress }: { item: ContractListItem; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="rounded-xl p-3.5 mb-2.5" style={{ backgroundColor: `${colors.card}b3`, borderWidth: 1, borderColor: `${colors.border}80` }}>
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1 min-w-0">
          <Text numberOfLines={1} style={{ color: ACCENT, fontSize: 12.5, fontFamily: fonts.heading.semibold }}>
            {item.DocNo || "—"}
          </Text>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.body.medium, marginTop: 2 }}>
            {item.CompanyName || "—"}{item.ProjectName ? ` · ${item.ProjectName}` : ""}
          </Text>
        </View>
        <StatusPill status={item.Status} />
      </View>

      <View className="flex-row flex-wrap gap-x-4 gap-y-1 mt-2.5">
        <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular }}>
          Date: <Text style={{ color: colors.foreground }}>{fmtDate(item.DocDate)}</Text>
        </Text>
        {!!item.ContactPerson && (
          <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular }}>
            Contact: <Text style={{ color: colors.foreground }}>{item.ContactPerson}</Text>
          </Text>
        )}
        {!!item.NatureOfContract && (
          <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular }}>
            Type: <Text style={{ color: colors.foreground }}>{item.NatureOfContract}</Text>
          </Text>
        )}
      </View>

      <View className="flex-row items-center justify-between pt-2.5 mt-2.5" style={{ borderTopWidth: 1, borderTopColor: `${colors.border}60` }}>
        <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 14 }}>{fmtAmt(item.ContractAmount)}</Text>
        <ChevronRight size={15} color={colors.mutedForeground} />
      </View>
    </Pressable>
  );
}

export default function ContractListScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["contracts"],
    queryFn: getContracts,
    staleTime: 60 * 1000,
  });

  const filtered = useMemo(() => {
    const rows = data ?? [];
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter((c) =>
      [c.DocNo, c.ContactPerson, c.NatureOfContract, c.CompanyName, c.ProjectName].some((f) => f?.toLowerCase().includes(q)),
    );
  }, [data, search]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {/* Header */}
      <View className="flex-row items-center gap-2.5 mb-1">
        <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: `${ACCENT}26`, borderWidth: 1, borderColor: `${ACCENT}4d` }}>
          <FileText size={16} color={ACCENT} />
        </View>
        <View className="flex-1">
          <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 20 }}>Contracts</Text>
          <Text style={{ color: `${colors.mutedForeground}b3`, fontSize: 10.5, fontFamily: fonts.body.regular, marginTop: 1 }}>
            Create and manage contracts
          </Text>
        </View>
        <Pressable onPress={() => refetch()} disabled={isFetching} hitSlop={8} className="p-2 rounded-lg" style={{ borderWidth: 1, borderColor: colors.border }}>
          {isFetching ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : <RefreshCw size={14} color={colors.mutedForeground} />}
        </Pressable>
      </View>

      <Pressable
        onPress={() => navigation.navigate("NewContract")}
        className="flex-row items-center justify-center gap-1.5 rounded-xl mt-3 mb-1"
        style={{ backgroundColor: ACCENT, paddingVertical: 11 }}
      >
        <Plus size={14} color="#fff" />
        <Text style={{ color: "#fff", fontSize: 12.5, fontFamily: fonts.heading.semibold }}>New Contract</Text>
      </Pressable>

      {isError && (
        <View className="mt-3 flex-row items-center gap-2 px-4 py-2.5 rounded-xl" style={{ backgroundColor: `${colors.destructive}1a`, borderWidth: 1, borderColor: `${colors.destructive}33` }}>
          <Text style={{ color: colors.destructive, fontSize: 11, fontFamily: fonts.body.medium, flex: 1 }}>
            Could not reach the server — showing cached data.
          </Text>
        </View>
      )}

      {/* Search */}
      <View className="mt-5 mb-1">
        <Text style={{ color: `${colors.mutedForeground}b3`, fontSize: 10.5, fontFamily: fonts.body.regular, marginBottom: 8 }}>
          {filtered.length} record{filtered.length !== 1 ? "s" : ""}
        </Text>
        <View className="flex-row items-center rounded-xl px-3" style={{ backgroundColor: `${colors.card}b3`, borderWidth: 1, borderColor: `${colors.border}80` }}>
          <Search size={13} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search contract, company…"
            placeholderTextColor={`${colors.mutedForeground}99`}
            style={{ flex: 1, color: colors.foreground, fontSize: 12.5, paddingVertical: 10, paddingHorizontal: 8, fontFamily: fonts.body.regular }}
          />
          {!!search && (
            <Pressable onPress={() => setSearch("")} hitSlop={8}>
              <X size={13} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
      </View>

      {/* List */}
      {isLoading ? (
        <View className="py-14 items-center">
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : filtered.length === 0 ? (
        <View className="py-12 items-center">
          <Text style={{ color: `${colors.mutedForeground}80`, fontSize: 12.5, fontFamily: fonts.body.regular }}>
            No contracts yet. Tap "New Contract" to create one.
          </Text>
        </View>
      ) : (
        <View className="mt-1">
          {filtered.map((c) => (
            <ContractCard key={c.ContractId} item={c} onPress={() => navigation.navigate("ContractDetail", { id: c.ContractId })} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

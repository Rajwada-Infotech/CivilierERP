// RN port of src/pages/admin/ApprovalInbox.tsx (web) — same endpoint, same
// module filter + card list, rebuilt as a single-column mobile list instead
// of the desktop table/mobile-card split web does inline. Tapping a card
// opens ApprovalInboxDetailModal (full record + approve/reject); the
// desktop table's inline actions column doesn't apply here — the card
// itself is the tap target, matching every other RN list screen in
// mobile-admin/mobile.
//
// Header (title + module chips) is passed as FlatList's ListHeaderComponent
// rather than rendered as a sibling above it — same structure
// GRNListScreen.tsx/MaterialRequestListScreen.tsx use in mobile/. Rendering
// it as a sibling `View` next to the FlatList left a large dead gap between
// the two on-device: with the header outside the scrollable content, Yoga's
// flex layout pass for a horizontal-scrolling ScrollView sibling to a
// non-flexed FlatList doesn't settle to natural content height reliably. As
// one measured tree it lays out exactly like every other list screen here.
import { useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, ScrollView, ActivityIndicator, RefreshControl, useWindowDimensions } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, RefreshCw, CheckCircle2 } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { fetchInbox, type InboxItem } from "@/api/approvalInboxApi";
import { MODULE_CONFIG, ALL_MODULES } from "./approvalInboxConfig";
import { StatusBadge } from "./StatusBadge";
import { ApprovalInboxDetailModal } from "./ApprovalInboxDetailModal";

const fmtDate = (d: string | null) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  } catch {
    return "—";
  }
};

function ModuleChip({
  label, icon: Icon, color, count, active, onPress,
}: { label: string; icon?: React.ComponentType<{ size?: number; color?: string }>; color?: string; count: number; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 999,
        marginRight: 8,
        borderWidth: 1,
        borderColor: active ? (color ?? colors.primary) : colors.border,
        backgroundColor: active ? (color ?? colors.primary) : "transparent",
      }}
    >
      {Icon && <Icon size={11} color={active ? "#fff" : (color ?? colors.mutedForeground)} />}
      <Text style={{ color: active ? "#fff" : colors.mutedForeground, fontSize: 11, fontFamily: fonts.heading.medium }}>{label}</Text>
      {count > 0 && (
        <View style={{ paddingHorizontal: 5, borderRadius: 999, backgroundColor: active ? "rgba(255,255,255,0.25)" : colors.muted }}>
          <Text style={{ color: active ? "#fff" : colors.foreground, fontSize: 9.5, fontFamily: fonts.heading.bold }}>{count}</Text>
        </View>
      )}
    </Pressable>
  );
}

function InboxCard({ item, onPress }: { item: InboxItem; onPress: () => void }) {
  const cfg = MODULE_CONFIG[item.Module];
  const Icon = cfg?.icon ?? Inbox;
  const party = item.SupplierName || item.ContractorName || item.CreatedBy || "—";

  return (
    <Pressable
      onPress={onPress}
      style={{ borderRadius: 16, padding: 14, marginBottom: 10, backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
          <View style={{ width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: `${cfg?.color ?? colors.mutedForeground}1f` }}>
            <Icon size={14} color={cfg?.color ?? colors.mutedForeground} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold }}>{item.ModuleLabel}</Text>
            <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular }}>{item.Reference || `#${item.RecordId}`}</Text>
          </View>
        </View>
        <StatusBadge status={item.Status} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 11.5, fontFamily: fonts.body.regular, flex: 1, marginRight: 8 }}>{party}</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular }}>{fmtDate(item.RecordDate)}</Text>
      </View>
      <Text style={{ color: colors.foreground, fontSize: 13.5, fontFamily: fonts.heading.semibold, marginTop: 4 }}>{formatINR(item.Amount, { decimals: 2 })}</Text>
    </Pressable>
  );
}

export default function ApprovalInboxScreen() {
  const queryClient = useQueryClient();
  const { width } = useWindowDimensions();
  const [activeModule, setActiveModule] = useState<string | null>(null);
  const [selected, setSelected] = useState<InboxItem | null>(null);
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set());

  const { data: allItems = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ["approval-inbox"],
    queryFn: fetchInbox,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const items = useMemo(
    () =>
      (activeModule ? allItems.filter((i) => i.Module === activeModule) : allItems).filter(
        (i) => !removedKeys.has(`${i.Module}-${i.RecordId}`),
      ),
    [allItems, activeModule, removedKeys],
  );

  const countFor = (mod: string) => allItems.filter((i) => i.Module === mod).length;
  const totalCount = allItems.length;

  const handleActionDone = (recordId: string, module: string) => {
    setRemovedKeys((prev) => new Set(prev).add(`${module}-${recordId}`));
    queryClient.invalidateQueries({ queryKey: ["approval-inbox"] });
  };

  const ListHeader = (
    <View style={{ width: width - 32 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ color: colors.foreground, fontSize: 15, fontFamily: fonts.heading.bold }}>Approval Inbox</Text>
          {totalCount > 0 && (
            <View style={{ minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: colors.destructive }}>
              <Text style={{ color: "#fff", fontSize: 10.5, fontFamily: fonts.heading.bold }}>{totalCount}</Text>
            </View>
          )}
        </View>
        <Pressable onPress={() => refetch()} disabled={isFetching} hitSlop={8} style={{ padding: 6 }}>
          {isFetching ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : <RefreshCw size={14} color={colors.mutedForeground} />}
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -16, marginBottom: 14 }}
        contentContainerStyle={{ paddingHorizontal: 16, alignItems: "center" }}
      >
        <ModuleChip label="All" count={totalCount} active={activeModule === null} onPress={() => setActiveModule(null)} />
        {ALL_MODULES.map((mod) => {
          const cfg = MODULE_CONFIG[mod];
          const count = countFor(mod);
          if (count === 0 && activeModule !== mod) return null;
          return (
            <ModuleChip
              key={mod}
              label={cfg.label}
              icon={cfg.icon}
              color={cfg.color}
              count={count}
              active={activeModule === mod}
              onPress={() => setActiveModule(activeModule === mod ? null : mod)}
            />
          );
        })}
      </ScrollView>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => `${item.Module}-${item.RecordId}`}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingTop: 12 }}
          refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />}
          ListHeaderComponent={ListHeader}
          renderItem={({ item }) => <InboxCard item={item} onPress={() => setSelected(item)} />}
          ListEmptyComponent={
            <View style={{ alignItems: "center", paddingVertical: 48 }}>
              <CheckCircle2 size={28} color={`${colors.mutedForeground}4d`} />
              <Text style={{ color: `${colors.mutedForeground}99`, fontSize: 13, fontFamily: fonts.body.medium, marginTop: 12 }}>
                {activeModule ? "No pending items in this module." : "All clear!"}
              </Text>
              <Text style={{ color: `${colors.mutedForeground}66`, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 3 }}>
                {activeModule ? "Switch to All to see the full inbox." : "No records are awaiting approval right now."}
              </Text>
            </View>
          }
        />
      )}

      <ApprovalInboxDetailModal item={selected} onClose={() => setSelected(null)} onActionDone={handleActionDone} />
    </View>
  );
}

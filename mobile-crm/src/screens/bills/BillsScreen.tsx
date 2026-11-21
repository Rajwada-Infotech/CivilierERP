// Maintenance Bills — All/Active/Cancelled filter tabs. Tap a bill to see
// its full printed-ledger view (BillViewScreen); "+ Create Bill" opens
// BillFormScreen (create/edit both live there, same as web's dialog).
import { useMemo, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Receipt, ChevronRight, Plus } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { DataList, Line, Pill } from "@/components/list/DataList";
import { usePageRights } from "@/hooks/usePageRights";
import { getMaintenanceBills, type MaintenanceBillListRow } from "@/api/maintenanceBillApi";
import type { MainStackParamList } from "@/navigation/MainStack";

const ACCENT = "#65a30d";
const FILTERS = ["All", "Active", "Cancelled"] as const;

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export default function BillsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const rights = usePageRights("maintenance-bills");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const query = useQuery({ queryKey: ["maint-bills-all"], queryFn: () => getMaintenanceBills() });

  const items = useMemo(() => {
    const rows = query.data ?? [];
    if (filter === "All") return rows;
    return rows.filter((b) => b.Status === filter);
  }, [query.data, filter]);

  return (
    <DataList<MaintenanceBillListRow>
      query={query}
      items={items}
      keyOf={(b) => String(b.Id)}
      filters={FILTERS}
      activeFilter={filter}
      onFilter={(f) => setFilter(f as (typeof FILTERS)[number])}
      emptyText="No bills to show."
      header={
        rights.canCreate ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 16, alignItems: "flex-end" }}>
            <Pressable
              onPress={() => navigation.navigate("BillForm", {})}
              style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: ACCENT }}
            >
              <Plus size={13} color="#1a1a1a" />
              <Text style={{ color: "#1a1a1a", fontSize: 12, fontFamily: fonts.heading.bold }}>Create Bill</Text>
            </Pressable>
          </View>
        ) : undefined
      }
      renderCard={(b) => {
        const overdue = b.Status === "Active" && !!b.DueDate && new Date(b.DueDate) < new Date();
        const statusLabel = overdue ? "Overdue" : b.Status;
        return (
          <Pressable
            onPress={() => navigation.navigate("BillView", { billId: b.Id })}
            style={({ pressed }) => ({
              backgroundColor: pressed ? colors.muted : colors.card,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.border,
              padding: 12,
              marginBottom: 8,
            })}
          >
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
              <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: overdue ? "rgba(239,68,68,0.14)" : "rgba(101,163,13,0.14)", alignItems: "center", justifyContent: "center" }}>
                <Receipt size={14} color={overdue ? "#f87171" : "#bef264"} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>{b.BillNo}</Text>
                  <Pill label={statusLabel} tone={overdue ? "#f87171" : undefined} />
                </View>
                <Line>{b.CustomerName ?? "—"}{b.UnitNo ? ` · ${b.UnitNo}` : ""}</Line>
                {b.DueDate && <Line>Due {fmtDate(b.DueDate)}</Line>}
              </View>
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.bold }}>{formatINR(b.GrandTotal)}</Text>
                <ChevronRight size={14} color={colors.mutedForeground} />
              </View>
            </View>
          </Pressable>
        );
      }}
    />
  );
}

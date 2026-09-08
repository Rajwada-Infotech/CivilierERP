// Maintenance Bills — read-only list (creation stays on web, same rule as
// maintenanceBillApi.ts documents). All/Active/Cancelled filter tabs.
import { useMemo, useState } from "react";
import { View, Text } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Receipt } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { DataList, Card, Line, Pill } from "@/components/list/DataList";
import { getMaintenanceBills, type MaintenanceBillListRow } from "@/api/maintenanceBillApi";

const FILTERS = ["All", "Active", "Cancelled"] as const;

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export default function BillsScreen() {
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
      renderCard={(b) => {
        const overdue = b.Status === "Active" && !!b.DueDate && new Date(b.DueDate) < new Date();
        const statusLabel = overdue ? "Overdue" : b.Status;
        return (
          <Card>
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
              <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.bold }}>{formatINR(b.GrandTotal)}</Text>
            </View>
          </Card>
        );
      }}
    />
  );
}

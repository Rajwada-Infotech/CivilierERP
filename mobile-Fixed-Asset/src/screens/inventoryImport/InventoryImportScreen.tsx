// Inventory Import — opening-stock imports that mint fixed assets
// (/api/fixed-asset-inventory-import). Read-only; importing is done on web.
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { Card, DataList, Line, Pill } from "@/components/list/DataList";
import { Fab } from "@/components/Fab";
import { usePageRights } from "@/hooks/usePageRights";
import { navigate } from "@/navigation/navigationRef";
import { getInventoryImports, type InventoryImportListItem } from "@/api/fixedAssetApi";

const FILTERS = ["All", "Active", "Reversed"] as const;

export default function InventoryImportScreen() {
  const [filter, setFilter] = useState<string>("All");
  const rights = usePageRights("fixed-asset-inventory-import");
  const query = useQuery({ queryKey: ["fa-inv-import"], queryFn: () => getInventoryImports() });

  const filtered = useMemo(() => {
    const list = query.data ?? [];
    return filter === "All" ? list : list.filter((r) => r.Status === filter);
  }, [query.data, filter]);

  return (
    <DataList<InventoryImportListItem>
      query={query}
      items={filtered}
      keyOf={(r) => String(r.ImportId)}
      filters={FILTERS}
      activeFilter={filter}
      onFilter={setFilter}
      emptyText="No inventory imports."
      footer={rights.canCreate ? <Fab label="Import" onPress={() => navigate("InventoryImportForm")} /> : null}
      renderCard={(item) => (
        <Pressable onPress={() => navigate("InventoryImportDetail", { id: item.ImportId })}>
        <Card>
          <View className="flex-row items-center justify-between">
            <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.semibold }}>
              {item.DocNo || `#${item.ImportId}`}
            </Text>
            <Pill label={item.Status} />
          </View>
          <Line>{item.ItemName || item.ItemId}{item.AssetCategory ? ` · ${item.AssetCategory}` : ""}</Line>
          <Line>{item.GodownName || "no godown"}{item.DocDate ? ` · ${new Date(item.DocDate).toLocaleDateString("en-IN")}` : ""}</Line>
          <View className="flex-row items-center justify-between" style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: `${colors.border}80` }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>
              {item.CompanyName || "—"}{item.ProjectName ? ` · ${item.ProjectName}` : ""}
            </Text>
            <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.bold }}>
              Qty {item.Quantity}{item.Rate ? ` @ ${formatINR(item.Rate, { decimals: 2 })}` : ""}
            </Text>
          </View>
        </Card>
        </Pressable>
      )}
    />
  );
}

// FA Inventory — fixed-asset tagging batches (/api/fixed-asset-tagging).
// Read-only; tagging is done on web.
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Card, DataList, Line, Pill } from "@/components/list/DataList";
import { getFixedAssetTaggings, type TaggingListItem } from "@/api/fixedAssetApi";

const FILTERS = ["All", "Tagged", "Cancelled"] as const;

export default function TaggingScreen() {
  const [filter, setFilter] = useState<string>("All");
  const query = useQuery({ queryKey: ["fa-tagging"], queryFn: getFixedAssetTaggings });

  const filtered = useMemo(() => {
    const list = query.data ?? [];
    return filter === "All" ? list : list.filter((t) => t.Status === filter);
  }, [query.data, filter]);

  return (
    <DataList<TaggingListItem>
      query={query}
      items={filtered}
      keyOf={(t) => String(t.TagId)}
      filters={FILTERS}
      activeFilter={filter}
      onFilter={setFilter}
      emptyText="No FA inventory tagging entries."
      renderCard={(item) => (
        <Card>
          <View className="flex-row items-center justify-between">
            <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.semibold }}>
              {item.DocNo || `#${item.TagId}`}
            </Text>
            <Pill label={item.Status} />
          </View>
          <Line>{item.AssetName || "—"}{item.AssetCategory ? ` · ${item.AssetCategory}` : ""}</Line>
          <Line>{item.FAItemCode || "—"} · {item.GodownName || "no godown"}</Line>
          <View className="flex-row items-center justify-between" style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: `${colors.border}80` }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>
              {item.CompanyName || "—"}{item.ProjectName ? ` · ${item.ProjectName}` : ""}
            </Text>
            <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.bold }}>
              Qty {item.TaggedQty}
            </Text>
          </View>
        </Card>
      )}
    />
  );
}

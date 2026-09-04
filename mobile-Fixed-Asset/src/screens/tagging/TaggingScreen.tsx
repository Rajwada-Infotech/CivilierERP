// FA Inventory — fixed-asset tagging batches (/api/fixed-asset-tagging).
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Card, DataList, Line, Pill } from "@/components/list/DataList";
import { navigate } from "@/navigation/navigationRef";
import { getFixedAssetTaggings, type TaggingListItem } from "@/api/fixedAssetApi";

const FILTERS = ["All", "Record: Pending", "Record: Done"] as const;

export default function TaggingScreen() {
  const [filter, setFilter] = useState<string>("All");
  const query = useQuery({ queryKey: ["fa-tagging"], queryFn: () => getFixedAssetTaggings() });

  const filtered = useMemo(() => {
    const list = query.data ?? [];
    if (filter === "Record: Pending") return list.filter((t) => t.RecordStatus === "Pending");
    if (filter === "Record: Done") return list.filter((t) => t.RecordStatus === "Done");
    return list;
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
        <Pressable onPress={() => navigate("TaggingDetail", { id: item.TagId })}>
        <Card>
          <View className="flex-row items-center justify-between">
            <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.semibold }}>
              {item.DocNo || `#${item.TagId}`}
            </Text>
            <View className="flex-row items-center gap-1.5">
              {item.RecordStatus && <Pill label={item.RecordStatus} />}
              <Pill label={item.Status} />
            </View>
          </View>
          <Line>{item.AssetName || "—"}{item.AssetCategory ? ` · ${item.AssetCategory}` : ""}</Line>
          <Line>{item.FAItemCode || "—"} · {item.GodownName || "no godown"}</Line>
          <Line>
            Record: {item.RecordStatus ?? "—"}
            {item.RecordStatus === "Done" ? " (Fixed Asset Record created)" : item.RecordStatus === "Pending" ? " (awaiting record)" : ""}
          </Line>
          <View className="flex-row items-center justify-between" style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: `${colors.border}80` }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>
              {item.CompanyName || "—"}{item.ProjectName ? ` · ${item.ProjectName}` : ""}
            </Text>
            <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.bold }}>
              Qty {item.TaggedQty}
            </Text>
          </View>
        </Card>
        </Pressable>
      )}
    />
  );
}

// Owner & Quality Checking — periodic condition checks + follow-ups
// (/api/fixed-asset-quality-check). Read-only; checks are recorded on web.
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Card, DataList, Line, Pill } from "@/components/list/DataList";
import { Fab } from "@/components/Fab";
import { usePageRights } from "@/hooks/usePageRights";
import { useRefetchOnFocus } from "@/hooks/useRefetchOnFocus";
import { navigate } from "@/navigation/navigationRef";
import { getQualityChecks, type QualityCheckItem } from "@/api/fixedAssetApi";

const FILTERS = ["All", "Pending", "Overdue", "Completed"] as const;

export default function QualityCheckScreen() {
  const [filter, setFilter] = useState<string>("All");
  const rights = usePageRights("fixed-asset-quality-check");
  const query = useQuery({ queryKey: ["fa-quality"], queryFn: () => getQualityChecks() });
  useRefetchOnFocus(query.refetch);

  const filtered = useMemo(() => {
    const list = query.data ?? [];
    if (filter === "All") return list;
    if (filter === "Overdue") return list.filter((q) => q.IsOverdue === 1 && q.FollowUpStatus === "Pending");
    return list.filter((q) => q.FollowUpStatus === filter);
  }, [query.data, filter]);

  return (
    <DataList<QualityCheckItem>
      query={query}
      items={filtered}
      keyOf={(q) => String(q.QualityCheckId)}
      filters={FILTERS}
      activeFilter={filter}
      onFilter={setFilter}
      emptyText="No quality checks."
      footer={rights.canCreate ? <Fab label="Check" onPress={() => navigate("QualityCheckForm")} /> : null}
      renderCard={(item) => {
        const overdue = item.IsOverdue === 1 && item.FollowUpStatus === "Pending";
        return (
          <Pressable onPress={() => navigate("QualityCheckDetail", { id: item.QualityCheckId })}>
          <Card>
            <View className="flex-row items-center justify-between">
              <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.semibold }}>
                {item.DocNo || `#${item.QualityCheckId}`}
              </Text>
              <View className="flex-row gap-1.5">
                <Pill label={item.QualityStatus} />
                <Pill label={overdue ? "Overdue" : item.FollowUpStatus} />
              </View>
            </View>
            <Line>{item.ItemName || "—"}{item.FAItemCode ? ` · ${item.FAItemCode}` : ""}</Line>
            <Line>Holder: {item.CurrentUserName || "—"} · Resp: {item.ResponsibleUserName || "—"}</Line>
            <View className="flex-row items-center justify-between" style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: `${colors.border}80` }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>
                {item.FollowUpType || "Follow-up"}
              </Text>
              <Text style={{ color: overdue ? "#ef4444" : "#5c6270", fontSize: 10, fontFamily: fonts.body.medium }}>
                {item.NextFollowUpDate ? `next ${new Date(item.NextFollowUpDate).toLocaleDateString("en-IN")}` : "—"}
              </Text>
            </View>
          </Card>
          </Pressable>
        );
      }}
    />
  );
}

// Assignment — every fixed-asset custody assignment (/api/fixed-asset-
// assignment). Rows created on web (or auto-created by a transfer) show up
// here; the list refetches whenever the screen regains focus.
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
import { getAssignments, type AssignmentListItem } from "@/api/fixedAssetApi";

const FILTERS = ["All", "Current"] as const;

export default function AssignmentScreen() {
  const [filter, setFilter] = useState<string>("All");
  const rights = usePageRights("fixed-asset-assignment");
  const query = useQuery({ queryKey: ["fa-assignment"], queryFn: () => getAssignments(), staleTime: 0 });
  useRefetchOnFocus(query.refetch);

  const filtered = useMemo(() => {
    const list = query.data ?? [];
    return filter === "Current" ? list.filter((a) => a.IsCurrent) : list;
  }, [query.data, filter]);

  return (
    <DataList<AssignmentListItem>
      query={query}
      items={filtered}
      keyOf={(a) => String(a.AssignmentId)}
      filters={FILTERS}
      activeFilter={filter}
      onFilter={setFilter}
      emptyText="No assignments."
      footer={rights.canCreate ? <Fab label="Assign" onPress={() => navigate("AssignmentForm")} /> : null}
      renderCard={(item) => (
        <Pressable onPress={() => navigate("AssignmentDetail", { id: item.AssignmentId })}>
        <Card>
          <View className="flex-row items-center justify-between">
            <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.semibold }}>
              {item.DocNo || `#${item.AssignmentId}`}
            </Text>
            <Pill label={item.IsCurrent ? "Current" : "Superseded"} tone={item.IsCurrent ? undefined : "#818898"} />
          </View>
          <Line>{item.AssetName || "—"}{item.FAItemCode ? ` · ${item.FAItemCode}` : ""}</Line>
          <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.medium, marginTop: 4 }}>
            Holder: {item.UserName || "—"}
          </Text>
          <Line>Responsible: {item.ResponsibleUserName || "—"}</Line>
          <View className="flex-row items-center justify-between" style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: `${colors.border}80` }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>
              {item.CompanyName || "—"}{item.ProjectName ? ` · ${item.ProjectName}` : ""}
            </Text>
            {item.SourceTransferDocNo && (
              <Text style={{ color: "#5c6270", fontSize: 10, fontFamily: fonts.body.regular }}>
                via {item.SourceTransferDocNo}
              </Text>
            )}
          </View>
        </Card>
        </Pressable>
      )}
    />
  );
}

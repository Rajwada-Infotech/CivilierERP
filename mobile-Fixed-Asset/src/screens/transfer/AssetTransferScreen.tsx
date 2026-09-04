// User-Wise Asset Transfer — custody moves from one user to another
// (/api/asset-transfer). Read-only; transfers are raised on web.
import { Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Card, DataList, Line } from "@/components/list/DataList";
import { getAssetTransfers, type TransferListItem } from "@/api/fixedAssetApi";

export default function AssetTransferScreen() {
  const query = useQuery({ queryKey: ["fa-transfer"], queryFn: getAssetTransfers });

  return (
    <DataList<TransferListItem>
      query={query}
      keyOf={(t) => String(t.Id)}
      emptyText="No asset transfers."
      renderCard={(item) => (
        <Card>
          <View className="flex-row items-center justify-between">
            <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.semibold }}>
              {item.DocNo || `#${item.Id}`}
            </Text>
            <Text style={{ color: "#5c6270", fontSize: 10, fontFamily: fonts.body.regular }}>
              {(item.TransferDate || item.DocDate)
                ? new Date(item.TransferDate || item.DocDate!).toLocaleDateString("en-IN")
                : ""}
            </Text>
          </View>
          <Line>{item.AssetName || "—"}{item.FAItemCode ? ` · ${item.FAItemCode}` : ""}</Line>
          <View className="flex-row items-center gap-2" style={{ marginTop: 6 }}>
            <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.medium }}>{item.FromUserName || "—"}</Text>
            <ArrowRight size={13} color="#eab308" />
            <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.semibold }}>{item.ToUserName || "—"}</Text>
          </View>
          <View className="flex-row items-center justify-between" style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: `${colors.border}80` }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>
              {item.DepartmentName || item.ProjectName || item.CompanyName || "—"}
            </Text>
            {item.TransferredByName && (
              <Text style={{ color: "#5c6270", fontSize: 10, fontFamily: fonts.body.regular }}>by {item.TransferredByName}</Text>
            )}
          </View>
        </Card>
      )}
    />
  );
}

// Customer Directory — read-only list (creation/edit stays on web, same
// rule as every other master in this app). Server-side search via the
// existing getMaintenanceDirectory(search) param, debounced.
import { useEffect, useState } from "react";
import { View, Text, TextInput } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Search, Users } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { DataList, Card, Line } from "@/components/list/DataList";
import { getMaintenanceDirectory, type MaintenanceDirectoryRow } from "@/api/maintenanceApi";

export default function DirectoryScreen() {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const query = useQuery({
    queryKey: ["maint-directory", debounced],
    queryFn: () => getMaintenanceDirectory(debounced || undefined),
  });

  return (
    <DataList<MaintenanceDirectoryRow>
      query={query}
      keyOf={(c) => String(c.Id)}
      emptyText={debounced ? "No customers match your search." : "No customers on file yet."}
      header={
        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
            <Search size={13} color={colors.mutedForeground} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search by name, unit, booking no…"
              placeholderTextColor={`${colors.mutedForeground}99`}
              style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 12.5, paddingVertical: 10 }}
            />
          </View>
        </View>
      }
      renderCard={(c) => (
        <Card>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
            <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: "rgba(101,163,13,0.14)", alignItems: "center", justifyContent: "center" }}>
              <Users size={14} color="#bef264" />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>
                {c.CustomerName ?? "—"}
              </Text>
              <Line>{[c.BlockName, c.UnitNo].filter(Boolean).join(" / ") || "No unit assigned"}</Line>
              <Line>{c.BookingNo}{c.ProjectName ? ` · ${c.ProjectName}` : ""}</Line>
              {c.ContactNumber && <Line>{c.ContactNumber}</Line>}
            </View>
          </View>
        </Card>
      )}
    />
  );
}

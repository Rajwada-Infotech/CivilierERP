// Customer Directory — read-only list (creation/edit stays on web, same
// rule as every other master in this app). Server-side search via the
// existing getMaintenanceDirectory(search) param, debounced. Row layout
// mirrors the web app's own telephone-directory style
// (src/pages/maintenance/MaintenanceDirectory.tsx): initials avatar, name,
// phone/unit/project meta, booking no + date, tap through to a profile.
// Its own "Resident Directory" violet identity in the header — distinct
// from Security's cyan ops board and Electricity's amber live grid.
import { useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Search, Phone, Home, Building2, Users, MapPinned } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { DataList } from "@/components/list/DataList";
import { getMaintenanceDirectory, type MaintenanceDirectoryRow } from "@/api/maintenanceApi";
import type { MainStackParamList } from "@/navigation/MainStack";

const DIR_VIOLET = "#a78bfa";
const DIR_INK = "#150f28";

function initialOf(name: string | null | undefined): string {
  return (name || "?").trim().charAt(0).toUpperCase();
}

function StatTile({ label, value, icon: Icon }: {
  label: string; value: string | number; icon: React.ComponentType<{ size?: number; color?: string }>;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: `${DIR_VIOLET}28`, padding: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <Icon size={12} color={DIR_VIOLET} />
        <Text style={{ fontSize: 9, fontFamily: fonts.heading.semibold, color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 0.5 }}>
          {label}
        </Text>
      </View>
      <Text style={{ fontSize: 18, fontFamily: fonts.heading.bold, color: colors.foreground, fontVariant: ["tabular-nums"] }}>{value}</Text>
    </View>
  );
}

export default function DirectoryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
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

  // Unfiltered fetch purely for the header stats — they should describe
  // the whole directory, not whatever the search box currently narrows
  // the list to.
  const allQuery = useQuery({
    queryKey: ["maint-directory-all"],
    queryFn: () => getMaintenanceDirectory(),
    staleTime: 5 * 60 * 1000,
  });
  const stats = useMemo(() => {
    const rows = allQuery.data ?? [];
    const units = new Set(rows.filter((r) => r.UnitNo).map((r) => `${r.BlockName ?? ""}/${r.UnitNo}`));
    const projects = new Set(rows.filter((r) => r.ProjectName).map((r) => r.ProjectName));
    return { total: rows.length, units: units.size, projects: projects.size };
  }, [allQuery.data]);

  return (
    <DataList<MaintenanceDirectoryRow>
      query={query}
      keyOf={(c) => String(c.Id)}
      emptyText={debounced ? "No customers match your search." : "No customers on file yet."}
      header={
        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <LinearGradient
            colors={[DIR_INK, "#241a3d", DIR_INK]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ borderRadius: 18, padding: 16, marginBottom: 10, overflow: "hidden", borderWidth: 1, borderColor: `${DIR_VIOLET}30` }}
          >
            <View style={{ position: "absolute", right: -12, top: -8, opacity: 0.09 }}>
              <Users size={96} color={DIR_VIOLET} />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: DIR_VIOLET }} />
              <Text style={{ color: DIR_VIOLET, fontSize: 9.5, fontFamily: fonts.heading.bold, letterSpacing: 2 }}>RESIDENT DIRECTORY</Text>
            </View>
            <Text style={{ color: "#ede9fe", fontSize: 30, fontFamily: fonts.heading.bold, fontVariant: ["tabular-nums"] }}>
              {stats.total}
            </Text>
            <Text style={{ color: "rgba(237,233,254,0.65)", fontSize: 11, fontFamily: fonts.body.regular, marginTop: 3 }}>
              confirmed customers on file
            </Text>
          </LinearGradient>

          <View style={{ flexDirection: "row", gap: 10, marginBottom: 14 }}>
            <StatTile label="Units Occupied" value={stats.units} icon={Home} />
            <StatTile label="Projects" value={stats.projects} icon={MapPinned} />
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
            <Search size={13} color={colors.mutedForeground} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search name, mobile, unit…"
              placeholderTextColor={`${colors.mutedForeground}99`}
              style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 12.5, paddingVertical: 10 }}
            />
          </View>
        </View>
      }
      renderCard={(c) => (
        <Pressable
          onPress={() => navigation.navigate("CustomerProfile", { bookingId: c.Id, customerName: c.CustomerName })}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 14,
            backgroundColor: pressed ? colors.muted : colors.card,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: pressed ? `${DIR_VIOLET}40` : `${DIR_VIOLET}18`,
            paddingVertical: 16,
            paddingHorizontal: 16,
            marginBottom: 10,
          })}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: `${DIR_VIOLET}18`,
              borderWidth: 1.5,
              borderColor: `${DIR_VIOLET}40`,
            }}
          >
            <Text style={{ color: DIR_VIOLET, fontSize: 16, fontFamily: fonts.heading.bold }}>
              {initialOf(c.CustomerName)}
            </Text>
          </View>

          <View style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
            <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>
              {c.CustomerName || "Unnamed Customer"}
            </Text>

            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 8 }}>
              {(c.UnitNo || c.BlockName) && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: `${DIR_VIOLET}14`, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3.5 }}>
                  <Home size={9} color={DIR_VIOLET} />
                  <Text style={{ color: DIR_VIOLET, fontSize: 10, fontFamily: fonts.heading.semibold }}>
                    {[c.BlockName, c.UnitNo].filter(Boolean).join(" / ")}
                  </Text>
                </View>
              )}
              {c.ProjectName && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Building2 size={10} color={colors.mutedForeground} />
                  <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular, maxWidth: 130 }}>
                    {c.ProjectName}
                  </Text>
                </View>
              )}
            </View>

            {c.ContactNumber && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 8 }}>
                <Phone size={10} color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular }}>
                  {c.ContactNumber}
                </Text>
              </View>
            )}
          </View>
        </Pressable>
      )}
    />
  );
}

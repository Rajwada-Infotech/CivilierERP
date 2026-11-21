// Any CRM list (crmRegisters.ts) on the phone: a search box, the statuses present as filter chips, and one card per
// row — tap through to the booking, the customer or the document. Read-only, the same rows the web page shows.
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Search } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { DataList, Pill } from "@/components/list/DataList";
import { crmGet, type Row } from "@/api/crmApi";
import { openDocument } from "@/utils/documents";
import { useAuth } from "@/auth/AuthContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { registerByKey, type CrmOpen } from "./crmRegisters";
import { CRM } from "./ui";

const ALL = "All";

/** The pages a card may open: a booking with Bookings or Payment Milestones rights, a customer with Customer 360. */
export function useCrmCanOpen() {
  const { canAccessPage } = useAuth();
  return (o: CrmOpen | null | undefined): o is CrmOpen =>
    !!o && (o.to === "document" || (o.to === "booking" ? canAccessPage("crm-bookings") || canAccessPage("crm-payments") : canAccessPage("crm-customer-360")));
}

export function useCrmOpen() {
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const canOpen = useCrmCanOpen();
  return (o: CrmOpen | null | undefined) => {
    if (!canOpen(o)) return;
    if (o.to === "booking") nav.navigate("CrmBooking", { bookingId: o.bookingId, title: o.title });
    else if (o.to === "customer") nav.navigate("CrmCustomer", { customerId: o.customerId, title: o.title });
    else openDocument(o.path, o.name).catch((e: Error) => Alert.alert("Could not open", e.message));
  };
}

export default function CrmRegisterScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmRegister">>();
  const reg = registerByKey(params.register)!;
  const open = useCrmOpen();
  const canOpen = useCrmCanOpen();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filter, setFilter] = useState(ALL);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const serverTerm = reg.serverSearch ? debounced : "";
  const query = useQuery({
    queryKey: ["crm", reg.key, serverTerm],
    queryFn: async () => {
      const qs = reg.serverSearch ? `?page=1&pageSize=200${serverTerm ? `&search=${encodeURIComponent(serverTerm)}` : ""}` : "";
      return reg.rows(await crmGet(`${reg.path}${qs}`));
    },
  });

  const rows = query.data ?? [];
  const statuses = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => { const v = reg.status?.(r); if (v) s.add(v); });
    return s.size > 1 ? [ALL, ...s] : [];
  }, [rows, reg]);

  const items = useMemo(() => {
    const term = reg.serverSearch ? "" : debounced.toLowerCase();
    return rows.filter((r) =>
      (filter === ALL || reg.status?.(r) === filter) &&
      (!term || (reg.searchIn?.(r) ?? []).some((v) => v != null && String(v).toLowerCase().includes(term))));
  }, [rows, filter, debounced, reg]);

  return (
    <DataList<Row>
      query={query}
      items={items}
      keyOf={reg.id}
      filters={statuses}
      activeFilter={filter}
      onFilter={setFilter}
      emptyText={debounced || filter !== ALL ? "Nothing matches." : reg.empty}
      header={
        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
            <Search size={13} color={colors.mutedForeground} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search name, mobile, booking, unit…"
              placeholderTextColor={`${colors.mutedForeground}99`}
              style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 12.5, paddingVertical: 10 }}
            />
          </View>
          {query.data ? (
            <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 8 }}>
              {items.length === rows.length ? `${rows.length} shown` : `${items.length} of ${rows.length} shown`}
            </Text>
          ) : null}
        </View>
      }
      renderCard={(r) => {
        const t = reg.open?.(r);
        const target = canOpen(t) ? t : null;
        const status = reg.status?.(r);
        const amount = reg.amount?.(r);
        const lines = (reg.lines?.(r) ?? []).filter((l): l is string => typeof l === "string" && l.trim() !== "");
        return (
          <Pressable
            disabled={!target}
            onPress={() => open(target)}
            style={({ pressed }) => ({
              backgroundColor: pressed ? colors.muted : colors.card, borderRadius: 14, borderWidth: 1,
              borderColor: pressed ? `${CRM}55` : colors.border, padding: 14, marginBottom: 10,
            })}
          >
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{reg.title(r) || "—"}</Text>
                {reg.sub(r) ? <Text numberOfLines={1} style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 2 }}>{reg.sub(r)}</Text> : null}
              </View>
              {amount ? (
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ fontSize: 14, fontFamily: fonts.heading.bold, color: colors.foreground, fontVariant: ["tabular-nums"] }}>{amount.value}</Text>
                  <Text style={{ fontSize: 9.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{amount.label}</Text>
                </View>
              ) : null}
            </View>
            {status ? <View style={{ flexDirection: "row", marginTop: 8 }}><Pill label={status} /></View> : null}
            {lines.map((l, i) => (
              <Text key={i} numberOfLines={2} style={{ fontSize: 11, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 4 }}>{l}</Text>
            ))}
          </Pressable>
        );
      }}
    />
  );
}

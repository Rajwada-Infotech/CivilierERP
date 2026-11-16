// Engineering → BOQ on the phone: the Bills of Quantities register (read-only), a search box, and one ruled row per
// BOQ. Tapping a row opens the BOQ, where it can be printed / shared as the invoice-style PDF (same format as the web).
import { useMemo, useState } from "react";
import { View, Text, ScrollView, RefreshControl } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Eye } from "lucide-react-native";
import { getBoqs, type BoqListItem } from "@/api/boqApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, IconKey, Notice, Press, RegisterHead, SearchBox, SheetMark, SheetShell, Skel, StatRow, statusTone } from "@/components/sheet/Sheet";

const fmtDate = (d?: string | null) => {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};
const fmtAmt = (n: number | null | undefined) => (n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—");

export default function BoqListScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["boq-list"], queryFn: getBoqs, staleTime: 60 * 1000 });
  const boqs = data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return boqs;
    return boqs.filter((b) => [b.BoqNo, b.DocNo, b.CompanyName, b.ProjectName, b.Description].some((f) => f?.toLowerCase().includes(q)));
  }, [boqs, search]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const value = boqs.filter((b) => b.Status !== "Rejected").reduce((s, b) => s + (Number(b.TotalAmount) || 0), 0);
  const open = (b: BoqListItem) => navigation.navigate("BoqDetail", { id: b.BoqID });

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: 96 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={S.ink} />}
    >
      <SheetShell eyebrow="CivilierERP · Engineering" title="Bills of Quantities" subtitle="View and print BOQs">
        {!isLoading && (
          <StatRow
            items={[
              { label: "BOQs", value: boqs.length.toLocaleString("en-IN"), note: "in the register" },
              { label: "Approved", value: boqs.filter((b) => b.Status === "Approved").length.toLocaleString("en-IN"), note: "locked" },
              { label: "Pending", value: boqs.filter((b) => b.Status === "Pending").length.toLocaleString("en-IN"), note: "awaiting approval" },
              { label: "Value", value: fmtAmt(value), note: "excluding rejected" },
            ]}
          />
        )}

        {isError && <Notice>Could not load the BOQs. Pull down to try again.</Notice>}

        <View style={{ borderWidth: 1, borderColor: S.ink, padding: 12, gap: 12 }}>
          <RegisterHead title="BOQ register" count={boqs.length} />
          <SearchBox value={search} onChange={setSearch} placeholder="Search BOQ, project, company…" />
          {isLoading ? (
            <>
              <Skel h={70} />
              <Skel h={70} />
              <Skel h={70} />
            </>
          ) : filtered.length === 0 ? (
            <Body color={S.graphite}>{search ? "No BOQ matches that search." : "No BOQs yet."}</Body>
          ) : (
            <View>
              {filtered.map((b, i) => (
                <Press
                  key={b.BoqID}
                  onPress={() => open(b)}
                  style={(pressed) => ({ paddingVertical: 12, borderBottomWidth: i === filtered.length - 1 ? 0 : 1, borderBottomColor: S.ruleSoft, backgroundColor: pressed ? S.blueWash : "transparent" })}
                >
                  <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                    <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                      <Text numberOfLines={1} style={{ fontFamily: fonts.heading.semibold, fontSize: 13, letterSpacing: 0.2, color: S.ink }}>{b.BoqNo || b.DocNo || `#${b.BoqID}`}</Text>
                      <Text numberOfLines={1} style={{ fontFamily: fonts.body.medium, fontSize: 12.5, color: S.ink }}>{b.ProjectName || "—"}</Text>
                      {!!b.CompanyName && <Text numberOfLines={1} style={{ fontFamily: fonts.body.regular, fontSize: 11.5, color: S.graphite }}>{b.CompanyName}</Text>}
                    </View>
                    <SheetMark text={b.Status || "Draft"} tone={/draft/i.test(b.Status || "Draft") ? "draft" : statusTone(b.Status || "")} />
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
                    <View style={{ gap: 2 }}>
                      <Body size={11.5} color={S.graphite}>{fmtDate(b.BoqDate)}</Body>
                      <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 16, letterSpacing: -0.3, color: S.ink }}>{fmtAmt(b.TotalAmount)}</Text>
                    </View>
                    <IconKey onPress={() => open(b)} size={32}>
                      <Eye size={14} color={S.ink} />
                    </IconKey>
                  </View>
                </Press>
              ))}
            </View>
          )}
        </View>
      </SheetShell>
    </ScrollView>
  );
}

// Amendment — every activity ever sent back for rework (via Quality Check or an Approval rejection), and
// what became of it. Read-only; the mobile take on the web's src/pages/civilworkdpr/Amendment.tsx, same
// GET /api/dependency-activity-assignment/amendments endpoint. A table becomes one card per rework.
import { useMemo, useState } from "react";
import { RefreshControl, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { ArrowRight, CalendarDays, MapPin, RotateCcw, Search, ShieldCheck, UserRound, X } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { usePageRights } from "@/hooks/usePageRights";
import { STATUS_COLOR, STATUS_LABEL } from "@/components/StatusPill";
import { getAmendments, type AmendmentRecord } from "@/api/cwdApi";
import { dependencyAutoName, matchesAutoNameSearch } from "@/utils/dependencyAutoName";

const autoNameOf = (r: AmendmentRecord) =>
  dependencyAutoName({ flatName: r.flatName, alias: r.alias, roomName: r.roomName, storey: r.storey, activityName: r.activityName });
import { ACCENT, Empty, ErrorText, Loading, card } from "@/screens/activities/tabs/ui";

const SOURCE = {
  QC: { label: "Quality Check", color: "#d946ef", Icon: ShieldCheck },
  APPROVAL: { label: "Approval", color: "#f59e0b", Icon: RotateCcw },
} as const;

type Filter = "ALL" | "QC" | "APPROVAL";

const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

function Pill({ text, color }: { text: string; color: string }) {
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: `${color}22` }}>
      <Text style={{ fontSize: 9.5, fontFamily: fonts.heading.bold, color, textTransform: "uppercase", letterSpacing: 0.3 }}>{text}</Text>
    </View>
  );
}

function AmendmentCard({ r, onOpen }: { r: AmendmentRecord; onOpen: () => void }) {
  const src = r.reworkSource ? SOURCE[r.reworkSource] : null;
  const now = r.currentStatus;
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onOpen} style={{ ...card, gap: 10, borderLeftWidth: 3, borderLeftColor: src?.color ?? colors.border }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={2} style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{r.sequenceNo}. {r.activityName}</Text>
          <Text numberOfLines={2} style={{ fontSize: 10.5, fontFamily: fonts.body.medium, color: ACCENT }}>{autoNameOf(r)}</Text>
        </View>
        {src && <Pill text={src.label} color={src.color} />}
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <MapPin size={11} color={colors.mutedForeground} />
        <Text numberOfLines={2} style={{ flex: 1, fontSize: 11, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>
          {r.projectName ? `${r.projectName} › ` : ""}{r.scopePath}
        </Text>
      </View>

      {/* The reason is the point of this page — give it its own block. */}
      <View style={{ borderRadius: 10, backgroundColor: colors.muted, padding: 10 }}>
        <Text style={{ fontSize: 9.5, fontFamily: fonts.heading.bold, color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 }}>Reason</Text>
        <Text style={{ fontSize: 12, fontFamily: r.reworkReason ? fonts.body.regular : fonts.body.regular, fontStyle: r.reworkReason ? "normal" : "italic", color: r.reworkReason ? colors.foreground : colors.mutedForeground }}>
          {r.reworkReason || "No reason recorded"}
        </Text>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 12, rowGap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <UserRound size={11} color={colors.mutedForeground} />
          <Text numberOfLines={1} style={{ fontSize: 11, fontFamily: fonts.body.regular, color: colors.mutedForeground, maxWidth: 170 }}>{r.engineerNames || "—"}</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <CalendarDays size={11} color={colors.mutedForeground} />
          <Text style={{ fontSize: 11, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{fmtDate(r.updatedAt)}</Text>
        </View>
      </View>

      {/* Attempt N  →  where the activity is now. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
        <Pill text={`Attempt ${r.attemptNo}`} color={STATUS_COLOR.REWORK} />
        <ArrowRight size={12} color={colors.mutedForeground} />
        <Text style={{ fontSize: 10.5, fontFamily: fonts.body.medium, color: colors.mutedForeground }}>Now</Text>
        {now ? (
          <Pill text={`${STATUS_LABEL[now] ?? now}${r.currentAttemptNo ? ` · #${r.currentAttemptNo}` : ""}`} color={STATUS_COLOR[now] ?? colors.mutedForeground} />
        ) : (
          <Text style={{ fontSize: 11, color: colors.mutedForeground }}>—</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function AmendmentScreen() {
  const rights = usePageRights("civilworkdpr-amendment");
  const navigation = useNavigation<any>();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const q = useQuery({ queryKey: ["cwd-amendments"], queryFn: getAmendments, enabled: rights.canView });
  const rows = q.data ?? [];

  const counts = useMemo(() => ({
    ALL: rows.length,
    QC: rows.filter((r) => r.reworkSource === "QC").length,
    APPROVAL: rows.filter((r) => r.reworkSource === "APPROVAL").length,
  }), [rows]);

  const shown = useMemo(() => {
    // Auto Name wise: every word typed must appear somewhere in the record (words in any order).
    return rows.filter((r) =>
      (filter === "ALL" || r.reworkSource === filter) &&
      matchesAutoNameSearch(search, [autoNameOf(r), r.activityName, r.alias, r.scopePath, r.projectName, r.engineerNames, r.reworkReason]),
    );
  }, [rows, search, filter]);

  if (!rights.canView) {
    return <View style={{ flex: 1, backgroundColor: colors.background, padding: 16 }}><Empty text="You don't have access to Amendment." /></View>;
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingHorizontal: 10, paddingTop: 14, paddingBottom: 96, gap: 12 }}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} tintColor={colors.mutedForeground} />}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: 12, paddingHorizontal: 12 }}>
        <Search size={14} color={colors.mutedForeground} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by Auto Name, location, engineer, reason…"
          placeholderTextColor={`${colors.mutedForeground}99`}
          style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, paddingVertical: 10 }}
        />
        {!!search && <TouchableOpacity onPress={() => setSearch("")} hitSlop={8}><X size={14} color={colors.mutedForeground} /></TouchableOpacity>}
      </View>

      {/* Summary + filter in one: tap a tile to filter by how it was sent back. */}
      <View style={{ flexDirection: "row", gap: 8 }}>
        {([
          { key: "ALL", label: "All reworks", color: ACCENT },
          { key: "QC", label: "Quality Check", color: SOURCE.QC.color },
          { key: "APPROVAL", label: "Approval", color: SOURCE.APPROVAL.color },
        ] as const).map((t) => {
          const on = filter === t.key;
          return (
            <TouchableOpacity key={t.key} onPress={() => setFilter(t.key)} style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: on ? t.color : colors.border, backgroundColor: on ? `${t.color}1f` : colors.card }}>
              <Text style={{ fontSize: 18, fontFamily: fonts.heading.bold, color: on ? t.color : colors.foreground }}>{counts[t.key]}</Text>
              <Text numberOfLines={1} style={{ fontSize: 10, fontFamily: fonts.body.medium, color: colors.mutedForeground }}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {q.isLoading ? <Loading /> : q.error ? <ErrorText error={q.error} /> : shown.length === 0 ? (
        <Empty text={rows.length === 0 ? "No activity has ever been sent back for rework." : "No amendments match your search."} />
      ) : (
        shown.map((r) => <AmendmentCard key={r.assignmentId} r={r} onOpen={() => navigation.navigate("ActivityDetail", { rungId: r.rungId })} />)
      )}
    </ScrollView>
  );
}

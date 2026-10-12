// "Find an activity by Auto Name": type the Auto Name (or any words of it, in any order), pick a match and that
// activity's details show in their own card below. Matching is done by the server (every word must match the
// flat, room, activity, chain, project or engineer) — the same search the web's Work Allocation / Reporting /
// Dependency pages use.
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { ActivityRow } from "@/components/ActivityRow";
import { StatusPill, displayStatus } from "@/components/StatusPill";
import { PriorityBadge } from "@/components/PriorityBadge";
import { dependencyAutoName } from "@/utils/dependencyAutoName";
import { getActivityAssignment, searchActivitiesByAutoName, type ActivityAssignment } from "@/api/cwdApi";

const ACCENT = "#0891b2";
const LIMIT = 25;

export const autoNameOf = (a: Pick<ActivityAssignment, "flatName" | "alias" | "roomName" | "storey" | "activityName">) =>
  dependencyAutoName({ flatName: a.flatName, alias: a.alias, roomName: a.roomName, storey: a.storey, activityName: a.activityName });

export function AutoNameLookup({ onOpen, title = "Find an activity by Auto Name" }: { onOpen: (rungId: number) => void; title?: string }) {
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [picked, setPicked] = useState<ActivityAssignment | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { const s = query.trim(); setTerm(s.length >= 2 ? s : ""); }, 400);
    return () => clearTimeout(t);
  }, [query]);

  const matchesQ = useQuery({
    queryKey: ["cwd-autoname-lookup", term],
    queryFn: () => searchActivitiesByAutoName(term, LIMIT),
    enabled: !!term,
    placeholderData: (prev) => prev,
  });
  const matches = matchesQ.data ?? [];

  // Re-read the picked activity so its status / progress stay current.
  const freshQ = useQuery({
    queryKey: ["cwd-autoname-picked", picked?.rungId],
    queryFn: () => getActivityAssignment(picked!.rungId),
    enabled: !!picked,
  });
  const shown = freshQ.data ?? picked;

  return (
    <View style={{ borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 12, marginBottom: 12 }}>
      <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: colors.foreground, marginBottom: 8 }}>{title}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, borderRadius: 12, paddingHorizontal: 12 }}>
        <Search size={14} color={colors.mutedForeground} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="e.g. NS/n1/101, Hall Room and 2.1 Column…"
          placeholderTextColor={`${colors.mutedForeground}99`}
          autoCapitalize="none"
          style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, paddingVertical: 9 }}
        />
        {!!query && <TouchableOpacity onPress={() => setQuery("")} hitSlop={8}><X size={14} color={colors.mutedForeground} /></TouchableOpacity>}
      </View>

      {!!term && (
        <View style={{ marginTop: 10 }}>
          {matchesQ.isFetching && matches.length === 0 ? (
            <ActivityIndicator color={colors.mutedForeground} />
          ) : matches.length === 0 ? (
            <Text style={{ fontSize: 11.5, fontStyle: "italic", color: colors.mutedForeground, fontFamily: fonts.body.regular }}>No activity matches "{term}".</Text>
          ) : (
            <>
              <Text style={{ fontSize: 10.5, color: colors.mutedForeground, fontFamily: fonts.body.regular, marginBottom: 6 }}>
                {matches.length}{matches.length === LIMIT ? "+" : ""} match{matches.length === 1 ? "" : "es"} — pick one to see its details
              </Text>
              <View style={{ borderRadius: 10, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
                {matches.map((m, i) => (
                  <TouchableOpacity
                    key={m.assignmentId}
                    onPress={() => { setPicked(m); setQuery(""); }}
                    style={{ paddingHorizontal: 10, paddingVertical: 9, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border, gap: 2 }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={{ flex: 1, fontSize: 12.5, fontFamily: fonts.body.medium, color: colors.foreground }}>{autoNameOf(m)}</Text>
                      <PriorityBadge priority={m.priority} />
                      <StatusPill status={displayStatus(m.status, m.resumedAt)} />
                    </View>
                    <Text numberOfLines={1} style={{ fontSize: 10.5, color: colors.mutedForeground, fontFamily: fonts.body.regular }}>
                      {[m.projectName, m.scopePath].filter(Boolean).join(" · ")}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
        </View>
      )}

      {shown && (
        <View style={{ marginTop: 12, borderRadius: 12, borderWidth: 1, borderColor: `${ACCENT}55`, backgroundColor: `${ACCENT}0d`, padding: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 9.5, fontFamily: fonts.heading.bold, color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 0.4 }}>Auto Name</Text>
              <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{autoNameOf(shown)}</Text>
            </View>
            <TouchableOpacity onPress={() => setPicked(null)} hitSlop={8}><X size={15} color={colors.mutedForeground} /></TouchableOpacity>
          </View>
          <ActivityRow a={shown} onPress={() => onOpen(shown.rungId)} />
        </View>
      )}
    </View>
  );
}

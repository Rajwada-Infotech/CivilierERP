// "Find an activity by Auto Name": type the Auto Name (or any words of it, in any order), pick a match and that
// activity's details show in their own card below. Matching is done by the server (every word must match the
// flat, room, activity, chain, project or engineer) — the same search the web's Work Allocation / Reporting /
// Dependency pages use.
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { Label } from "@/components/sheet/Sheet";
import { fonts } from "@/theme/fonts";
import { ActivityRow } from "@/components/ActivityRow";
import { StatusPill, displayStatus } from "@/components/StatusPill";
import { PriorityBadge } from "@/components/PriorityBadge";
import { dependencyAutoName } from "@/utils/dependencyAutoName";
import { getActivityAssignment, searchActivitiesByAutoName, type ActivityAssignment } from "@/api/cwdApi";

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
    <View style={{ borderWidth: 1, borderColor: S.ink, backgroundColor: S.paper }}>
      <View style={{ paddingHorizontal: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: S.ink }}>
        <Label color={S.ink}>{title}</Label>
      </View>
      <View style={{ padding: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: S.line40, backgroundColor: S.paper, paddingHorizontal: 12 }}>
        <Search size={14} color={S.graphite} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="e.g. NS/n1/101, Hall Room and 2.1 Column…"
          placeholderTextColor={S.faint}
          autoCapitalize="none"
          style={{ flex: 1, color: S.ink, fontFamily: fonts.body.regular, fontSize: 14, minHeight: 44 }}
        />
        {!!query && <TouchableOpacity onPress={() => setQuery("")} hitSlop={8}><X size={14} color={S.graphite} /></TouchableOpacity>}
      </View>

      {!!term && (
        <View style={{ marginTop: 10 }}>
          {matchesQ.isFetching && matches.length === 0 ? (
            <ActivityIndicator color={S.graphite} />
          ) : matches.length === 0 ? (
            <Text style={{ fontSize: 11.5, fontStyle: "italic", color: S.graphite, fontFamily: fonts.body.regular }}>No activity matches "{term}".</Text>
          ) : (
            <>
              <Text style={{ fontSize: 11.5, color: S.graphite, fontFamily: fonts.body.regular, marginBottom: 6 }}>
                {matches.length}{matches.length === LIMIT ? "+" : ""} match{matches.length === 1 ? "" : "es"} — pick one to see its details
              </Text>
              <View style={{ borderTopWidth: 1, borderTopColor: S.ink }}>
                {matches.map((m, i) => (
                  <TouchableOpacity
                    key={m.assignmentId}
                    onPress={() => { setPicked(m); setQuery(""); }}
                    style={{ paddingHorizontal: 2, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: S.ruleSoft, gap: 3 }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={{ flex: 1, fontSize: 13, fontFamily: fonts.body.semibold, color: S.ink }}>{autoNameOf(m)}</Text>
                      <PriorityBadge priority={m.priority} />
                      <StatusPill status={displayStatus(m.status, m.resumedAt)} />
                    </View>
                    <Text numberOfLines={1} style={{ fontSize: 11.5, color: S.graphite, fontFamily: fonts.body.regular }}>
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
        <View style={{ marginTop: 12, borderWidth: 1.5, borderColor: S.blue }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderBottomWidth: 1, borderBottomColor: S.rule, backgroundColor: S.blueWash }}>
            <View style={{ flex: 1, gap: 3 }}>
              <Label>Auto Name</Label>
              <Text style={{ fontSize: 13.5, fontFamily: fonts.heading.semibold, color: S.ink }}>{autoNameOf(shown)}</Text>
            </View>
            <TouchableOpacity onPress={() => setPicked(null)} hitSlop={8}><X size={15} color={S.graphite} /></TouchableOpacity>
          </View>
          <ActivityRow a={shown} onPress={() => onOpen(shown.rungId)} />
        </View>
      )}
      </View>
    </View>
  );
}

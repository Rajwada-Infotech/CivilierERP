// Tag an activity: type to search the DPR Tag Master, tap a suggestion, or type a brand-new tag (it is added to the
// Tag Master when saved). Same behaviour as the web's Tag box in Activity Reporting.
import { useEffect, useMemo, useState } from "react";
import { Text, TextInput, TouchableOpacity, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Tag as TagIcon, X } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { getDprTags, setActivityTag } from "@/api/cwdApi";
import { Btn } from "@/screens/activities/tabs/ui";

export function TagField({ rungId, current, canEdit, onSaved }: { rungId: number; current: string | null | undefined; canEdit: boolean; onSaved: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState(current ?? "");
  const [focused, setFocused] = useState(false);
  useEffect(() => setText(current ?? ""), [current, rungId]);

  const tagsQ = useQuery({ queryKey: ["cwd-dpr-tags"], queryFn: getDprTags, staleTime: 30_000 });
  const q = text.trim().toLowerCase();
  const matches = useMemo(
    () => (tagsQ.data ?? []).filter((t) => t.isActive && (!q || t.tagName.toLowerCase().includes(q))).slice(0, 8),
    [tagsQ.data, q],
  );
  const exact = (tagsQ.data ?? []).some((t) => t.tagName.toLowerCase() === q);

  const save = useMutation({
    mutationFn: () => setActivityTag(rungId, text.trim()),
    onSuccess: () => {
      toast.success(text.trim() ? "Tag saved" : "Tag cleared");
      qc.invalidateQueries({ queryKey: ["cwd-dpr-tags"] });
      qc.invalidateQueries({ queryKey: ["cwd-report"] });
      setFocused(false);
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const changed = text.trim() !== (current ?? "");

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: 12, paddingHorizontal: 12 }}>
        <TagIcon size={14} color={colors.mutedForeground} />
        <TextInput
          value={text}
          onChangeText={setText}
          onFocus={() => setFocused(true)}
          editable={canEdit}
          maxLength={100}
          placeholder="Search or type a new tag…"
          placeholderTextColor={`${colors.mutedForeground}99`}
          style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, paddingVertical: 10 }}
        />
        {!!text && canEdit && <TouchableOpacity onPress={() => setText("")} hitSlop={8}><X size={14} color={colors.mutedForeground} /></TouchableOpacity>}
      </View>

      {focused && canEdit && (matches.length > 0 || (!!q && !exact)) && (
        <View style={{ borderRadius: 10, borderWidth: 1, borderColor: colors.border, overflow: "hidden", backgroundColor: colors.card }}>
          {matches.map((t, i) => (
            <TouchableOpacity key={t.id} onPress={() => { setText(t.tagName); setFocused(false); }} style={{ paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
              <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.foreground }}>{t.tagName}</Text>
            </TouchableOpacity>
          ))}
          {!!q && !exact && (
            <TouchableOpacity onPress={() => setFocused(false)} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: matches.length ? 1 : 0, borderTopColor: colors.border }}>
              <Plus size={13} color="#0891b2" />
              <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: "#0891b2" }}>Add new tag "{text.trim()}"</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {canEdit && <Btn label="Save tag" busy={save.isPending} disabled={!changed} onPress={() => save.mutate()} />}
    </View>
  );
}

// Notices from HR (all employees, or this employee's department). Tap to read; that marks it read.
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Pin } from "lucide-react-native";
import { api, type Notice } from "@/api/employeeApi";
import { Body, Label, Panel, Skel } from "@/components/sheet/Sheet";
import { sheet as S } from "@/theme/colors";
import { fmtDate } from "@/utils/format";

export function useNotices() {
  const qc = useQueryClient();
  // Re-checked every 2 minutes and whenever Home is pulled down, so a new notice from HR shows up without restarting.
  const q = useQuery({ queryKey: ["notices"], queryFn: api.notices, staleTime: 30_000, refetchInterval: 120_000 });
  const read = useMutation({ mutationFn: api.readNotice, onSuccess: () => qc.invalidateQueries({ queryKey: ["notices"] }) });
  const [openId, setOpenId] = useState<number | null>(null);
  const toggle = (n: Notice) => { setOpenId((id) => (id === n.NoticeId ? null : n.NoticeId)); if (!n.IsRead) read.mutate(n.NoticeId); };
  return { ...q, openId, toggle };
}

function Row({ n, open, onPress }: { n: Notice; open: boolean; onPress: () => void }) {
  const important = n.Priority === "Important";
  return (
    <Pressable onPress={onPress} style={{ borderLeftWidth: important ? 3 : 0, borderLeftColor: S.red, paddingLeft: important ? 8 : 0, gap: 3, borderBottomWidth: 1, borderBottomColor: S.ruleSoft, paddingBottom: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {!n.IsRead && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: S.ink }} />}
        {n.IsPinned && <Pin size={12} color={S.ink} />}
        <Body weight={n.IsRead ? "medium" : "semibold"} style={{ flex: 1 }}>{n.Title}</Body>
        {important && <Label color={S.red}>Important</Label>}
      </View>
      <Body size={11} color={S.graphite}>{fmtDate(n.PublishFrom)} · {n.ForWhom} · {n.PostedBy ?? "HR"}</Body>
      {open && <Body size={13} style={{ marginTop: 4 }}>{n.Body}</Body>}
    </Pressable>
  );
}

/** Home panel: the latest notices (all when `all`). Hidden when there are none. */
export default function NoticesPanel({ all }: { all?: boolean }) {
  const { data, isLoading, openId, toggle } = useNotices();
  if (isLoading) return all ? <Skel h={60} /> : null;
  const list = all ? data ?? [] : (data ?? []).slice(0, 3);
  if (!list.length) return all ? <Panel title="Notices" icon={<Megaphone size={14} color={S.ink} />}><Body color={S.graphite}>No notices right now.</Body></Panel> : null;
  const unread = (data ?? []).filter((n) => !n.IsRead).length;
  return (
    <Panel title={`Notices${unread ? ` · ${unread} new` : ""}`} icon={<Megaphone size={14} color={S.ink} />}>
      {list.map((n) => <Row key={n.NoticeId} n={n} open={openId === n.NoticeId} onPress={() => toggle(n)} />)}
    </Panel>
  );
}

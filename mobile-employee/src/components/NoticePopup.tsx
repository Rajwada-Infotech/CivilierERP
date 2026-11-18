// New-notice popup: when HR publishes a notice for this employee, it pops up over any screen with a short chime and a
// vibration. "Got it" marks it read; "Later" hides it until the app is opened again (it stays unread on Home).
// Notices are re-checked every minute and whenever the app comes back to the front.
import { useEffect, useRef, useState } from "react";
import { AppState, Modal, ScrollView, Vibration, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAudioPlayer, setAudioModeAsync } from "expo-audio";
import { Megaphone } from "lucide-react-native";
import { api, type Notice } from "@/api/employeeApi";
import { Body, Key, Label, TitleText } from "@/components/sheet/Sheet";
import { sheet as S } from "@/theme/colors";
import { fmtDate } from "@/utils/format";

const chime = require("../../assets/sounds/notice.wav");

export default function NoticePopup() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["notices"], queryFn: api.notices, staleTime: 30_000, refetchInterval: 60_000 });
  const read = useMutation({ mutationFn: api.readNotice, onSuccess: () => qc.invalidateQueries({ queryKey: ["notices"] }) });
  const player = useAudioPlayer(chime);
  const seen = useRef(new Set<number>()); // shown in this run of the app ("Later" keeps it hidden until the next start)
  const [current, setCurrent] = useState<Notice | null>(null);

  // Play through the speaker even in silent-ish modes the OS allows; never interrupt other audio for long.
  useEffect(() => { setAudioModeAsync({ playsInSilentMode: true, interruptionMode: "mixWithOthers" }).catch(() => {}); }, []);

  // Back to the front → check for new notices.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") qc.invalidateQueries({ queryKey: ["notices"] }); });
    return () => sub.remove();
  }, [qc]);

  // The next unread notice not shown yet (pinned / important first — the server's order).
  useEffect(() => {
    if (current) return;
    const next = (data ?? []).find((n) => !n.IsRead && !seen.current.has(n.NoticeId));
    if (!next) return;
    seen.current.add(next.NoticeId);
    setCurrent(next);
    try { player.seekTo(0); player.play(); } catch { /* sound is optional */ }
    Vibration.vibrate(next.Priority === "Important" ? [0, 250, 120, 250, 120, 250] : [0, 220]);
  }, [data, current, player]);

  if (!current) return null;
  const important = current.Priority === "Important";
  const close = (markRead: boolean) => { if (markRead) read.mutate(current.NoticeId); setCurrent(null); };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => close(false)}>
      <View style={{ flex: 1, backgroundColor: "#000000aa", justifyContent: "center", padding: 20 }}>
        <View style={{ backgroundColor: S.paper, borderWidth: 1, borderColor: S.ink, borderTopWidth: 5, borderTopColor: important ? S.red : S.ink, maxHeight: "80%" }}>
          <View style={{ padding: 18, gap: 8, borderBottomWidth: 1, borderBottomColor: S.ruleSoft }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Megaphone size={16} color={important ? S.red : S.ink} />
              <Label color={important ? S.red : S.ink}>{important ? "Important notice" : "New notice"}</Label>
            </View>
            <TitleText size={20}>{current.Title}</TitleText>
            <Body size={11.5} color={S.graphite}>{fmtDate(current.PublishFrom)} · {current.ForWhom} · {current.PostedBy ?? "HR"}</Body>
          </View>
          <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ padding: 18 }}>
            <Body size={14} style={{ lineHeight: 21 }}>{current.Body}</Body>
          </ScrollView>
          <View style={{ flexDirection: "row", gap: 10, padding: 14, borderTopWidth: 1, borderTopColor: S.ruleSoft }}>
            <Key label="Later" onPress={() => close(false)} style={{ flex: 1 }} />
            <Key tone="ink" label="Got it" onPress={() => close(true)} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

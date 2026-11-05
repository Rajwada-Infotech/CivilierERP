// Discussion for one activity, limited by the server to the engineers allocated to it and its approvers.
// The web app streams over a socket; the phone polls every few seconds while this tab is open, and a message
// you send appears at once (marked sending / failed with a retry) and is matched to the saved one by clientId.
import { useMemo, useState } from "react";
import { Text, TextInput, TouchableOpacity, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Lock, RotateCcw, Send } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { useAuth } from "@/auth/AuthContext";
import { ApiError } from "@/services/fetchWithAuth";
import { getComments, postComment, type ActivityComment } from "@/api/cwdApi";
import { ACCENT, Empty, ErrorText, Loading, card, fmtClock } from "./ui";

const MAX_LEN = 2000;
type Local = ActivityComment & { state?: "sending" | "failed"; error?: string };
const newClientId = () => `c${Date.now()}${Math.random().toString(36).slice(2, 10)}`.slice(0, 50);
const dayLabel = (iso: string) => {
  const d = new Date(iso), t = new Date(), y = new Date();
  y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

export function CommentsTab({ rungId }: { rungId: number }) {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Local[]>([]);
  const key = ["cwd-comments", rungId];

  const q = useQuery({
    queryKey: key,
    queryFn: () => getComments(rungId),
    refetchInterval: 6000,
    retry: (n, e) => !(e instanceof ApiError && e.status === 403) && n < 2,
  });

  const messages = useMemo<Local[]>(() => {
    const saved = q.data?.messages ?? [];
    const savedIds = new Set(saved.map((m) => m.clientId).filter(Boolean));
    return [...saved, ...pending.filter((p) => !savedIds.has(p.clientId))];
  }, [q.data, pending]);

  const send = async (clientId: string, body: string) => {
    try {
      await postComment(rungId, body, clientId);
      setPending((p) => p.filter((m) => m.clientId !== clientId));
      qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setPending((p) => p.map((m) => (m.clientId === clientId ? { ...m, state: "failed", error: (e as Error).message } : m)));
    }
  };
  const submit = () => {
    const body = draft.trim();
    if (!body || body.length > MAX_LEN) return;
    const clientId = newClientId();
    setPending((p) => [...p, { id: null, clientId, authorUserId: Number(currentUser?.id ?? 0), authorName: currentUser?.name ?? "You", body, createdAt: new Date().toISOString(), state: "sending" }]);
    setDraft("");
    void send(clientId, body);
  };
  const retry = (m: Local) => {
    setPending((p) => p.map((x) => (x.clientId === m.clientId ? { ...x, state: "sending", error: undefined } : x)));
    void send(m.clientId!, m.body);
  };

  if (q.error instanceof ApiError && q.error.status === 403) {
    return (
      <View style={{ alignItems: "center", gap: 8, paddingVertical: 36 }}>
        <Lock size={20} color={colors.mutedForeground} />
        <Text style={{ textAlign: "center", fontSize: 12, color: colors.mutedForeground, fontFamily: fonts.body.regular }}>Comments are limited to the engineers allocated to this activity and its approvers.</Text>
      </View>
    );
  }
  if (q.isLoading) return <Loading />;
  if (q.error && !q.data) return <ErrorText error={q.error} />;

  const meId = Number(currentUser?.id ?? -1);
  let lastDay = "";
  return (
    <View style={{ gap: 10 }}>
      {messages.length === 0 && <Empty text="No messages yet — start the discussion." />}
      {messages.map((m, i) => {
        const mine = m.authorUserId === meId;
        const day = dayLabel(m.createdAt);
        const header = day !== lastDay ? day : null;
        lastDay = day;
        return (
          <View key={m.id ?? m.clientId ?? i}>
            {header && <Text style={{ textAlign: "center", fontSize: 10, color: colors.mutedForeground, fontFamily: fonts.heading.semibold, marginVertical: 6 }}>{header}</Text>}
            <View style={{ alignItems: mine ? "flex-end" : "flex-start" }}>
              <View style={{ ...card, maxWidth: "85%", padding: 10, backgroundColor: mine ? `${ACCENT}22` : colors.card, borderColor: m.state === "failed" ? colors.destructive : mine ? `${ACCENT}55` : colors.border, opacity: m.state === "sending" ? 0.6 : 1 }}>
                {!mine && <Text style={{ fontSize: 10.5, fontFamily: fonts.heading.semibold, color: ACCENT, marginBottom: 2 }}>{m.authorName}</Text>}
                <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: colors.foreground }}>{m.body}</Text>
                <Text style={{ fontSize: 9.5, color: colors.mutedForeground, fontFamily: fonts.body.regular, marginTop: 3, alignSelf: "flex-end" }}>{m.state === "sending" ? "Sending…" : fmtClock(m.createdAt)}</Text>
              </View>
              {m.state === "failed" && (
                <TouchableOpacity onPress={() => retry(m)} style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
                  <AlertCircle size={11} color={colors.destructive} />
                  <Text style={{ fontSize: 10.5, color: colors.destructive, fontFamily: fonts.body.medium }}>{m.error || "Couldn't send"} · </Text>
                  <RotateCcw size={10} color={colors.destructive} />
                  <Text style={{ fontSize: 10.5, color: colors.destructive, fontFamily: fonts.heading.semibold }}>Retry</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        );
      })}

      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, marginTop: 6 }}>
        <TextInput value={draft} onChangeText={setDraft} multiline maxLength={MAX_LEN} placeholder="Write a message…" placeholderTextColor={`${colors.mutedForeground}99`} style={{ flex: 1, maxHeight: 110, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9 }} />
        <TouchableOpacity disabled={!draft.trim()} onPress={submit} style={{ width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: ACCENT, opacity: draft.trim() ? 1 : 0.4 }}>
          <Send size={16} color="#04181d" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

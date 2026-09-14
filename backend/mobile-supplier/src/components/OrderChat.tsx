// RN counterpart to src/components/orders/OrderChat.tsx (web) — same
// backend contract (GET/POST /api/supplier-portal/orders/:id/comment(s)),
// but polling instead of a live socket.io connection: this scaffold has
// no socket client wired up yet (socket.io-client is an installed but
// unused dependency — see README "Known gaps"), and a short refetch
// interval gets "close enough to live" for a chat that isn't
// high-frequency without that extra plumbing.
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, MessageCircle } from "lucide-react-native";
import * as spApi from "@/api/supplierPortalApi";
import { fonts } from "@/theme/fonts";

function fmtTime(d: string) {
  return new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}
function fmtDay(d: string) {
  const date = new Date(d);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function OrderChat({ poId, currentUserId }: { poId: number; currentUserId: number }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<ScrollView>(null);

  const commentsQ = useQuery({
    queryKey: ["supplier-order-comments", poId],
    queryFn: () => spApi.getSupplierOrderComments(poId),
    refetchInterval: 8000,
  });
  const messages = commentsQ.data ?? [];

  const sendMutation = useMutation({
    mutationFn: (comment: string) => spApi.postSupplierOrderComment(poId, comment),
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["supplier-order-comments", poId] });
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    },
  });

  const onSend = () => {
    const text = draft.trim();
    if (!text || sendMutation.isPending) return;
    sendMutation.mutate(text);
  };

  return (
    <View style={{ borderRadius: 14, borderWidth: 1, borderColor: "#272735", backgroundColor: "#15151e", overflow: "hidden" }}>
      <View className="flex-row items-center gap-2" style={{ paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#272735" }}>
        <MessageCircle size={13} color="#818898" />
        <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: "#e7e9ef" }}>
          Conversation <Text style={{ color: "#818898", fontFamily: fonts.body.regular }}>· {messages.length}</Text>
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ maxHeight: 320 }}
        contentContainerStyle={{ padding: 12, gap: 10 }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {commentsQ.isLoading ? (
          <View className="items-center justify-center" style={{ paddingVertical: 20 }}>
            <ActivityIndicator color="#818898" size="small" />
          </View>
        ) : messages.length === 0 ? (
          <View className="items-center justify-center" style={{ paddingVertical: 24 }}>
            <MessageCircle size={20} color="rgba(129,136,152,0.4)" />
            <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: "#818898", marginTop: 8 }}>
              No messages yet — start the conversation.
            </Text>
          </View>
        ) : (
          messages.map((m, i) => {
            const mine = m.author_id === currentUserId;
            const showDay = i === 0 || fmtDay(messages[i - 1].created_at) !== fmtDay(m.created_at);
            return (
              <View key={m.Id ?? i}>
                {showDay && (
                  <Text style={{ textAlign: "center", fontSize: 10, color: "#818898", marginBottom: 8, fontFamily: fonts.body.regular }}>
                    {fmtDay(m.created_at)}
                  </Text>
                )}
                <View style={{ alignItems: mine ? "flex-end" : "flex-start" }}>
                  <View
                    style={{
                      maxWidth: "80%",
                      borderRadius: 14,
                      borderTopRightRadius: mine ? 4 : 14,
                      borderTopLeftRadius: mine ? 14 : 4,
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      backgroundColor: mine ? "#059669" : "#21212c",
                    }}
                  >
                    {!mine && (
                      <Text style={{ fontSize: 10, fontFamily: fonts.heading.semibold, color: "#6ee7b7", marginBottom: 2 }}>
                        {m.author_name}
                      </Text>
                    )}
                    <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: "#fff", lineHeight: 17 }}>{m.comment}</Text>
                  </View>
                  <Text style={{ fontSize: 9, color: "#818898", marginTop: 2 }}>{fmtTime(m.created_at)}</Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      <View className="flex-row items-end gap-2" style={{ padding: 10, borderTopWidth: 1, borderTopColor: "#272735" }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Write a reply…"
          placeholderTextColor="rgba(148,163,184,0.4)"
          multiline
          style={{
            flex: 1,
            maxHeight: 90,
            borderRadius: 18,
            backgroundColor: "#0c0c12",
            borderWidth: 1,
            borderColor: "#272735",
            color: "#e7e9ef",
            paddingHorizontal: 14,
            paddingVertical: 8,
            fontSize: 12,
          }}
        />
        <Pressable
          disabled={!draft.trim() || sendMutation.isPending}
          onPress={onSend}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#059669",
            opacity: !draft.trim() || sendMutation.isPending ? 0.5 : 1,
          }}
        >
          {sendMutation.isPending ? <ActivityIndicator size="small" color="#fff" /> : <Send size={14} color="#fff" />}
        </Pressable>
      </View>
    </View>
  );
}

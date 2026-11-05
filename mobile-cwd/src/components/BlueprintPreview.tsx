// The room's reference blueprint for one activity — the activity's own marked-up copy if someone has drawn on it
// (annotation thumbnail), otherwise the raw blueprint uploaded in Flat Master. Same data as the web Work
// Allocation's "Reference Blueprint"; drawing the markup itself stays on the web (its Konva editor).
import { useState } from "react";
import { Image, Modal, Pressable, Text, TouchableOpacity, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { FileText, X } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { getBlueprintAnnotation, getRoomBlueprint } from "@/api/cwdApi";

export function BlueprintPreview({ rungId, roomId, title }: { rungId: number; roomId: number; title?: string }) {
  const [full, setFull] = useState(false);
  const bp = useQuery({ queryKey: ["cwd-room-blueprint", roomId], queryFn: () => getRoomBlueprint(roomId), staleTime: 5 * 60_000 });
  const ann = useQuery({ queryKey: ["cwd-blueprint-annotation", rungId, roomId], queryFn: () => getBlueprintAnnotation(rungId, roomId).catch(() => null) });

  const marked = !!ann.data?.thumbnailBase64;
  const isPdf = bp.data?.mimeType === "application/pdf";
  const uri = marked
    ? `data:image/png;base64,${ann.data!.thumbnailBase64}`
    : bp.data && !isPdf ? `data:${bp.data.mimeType};base64,${bp.data.dataBase64}` : null;

  if (bp.isLoading) {
    return <View style={{ height: 140, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.muted }} />;
  }
  if (!bp.data && !marked) {
    return (
      <Text style={{ fontSize: 11.5, fontStyle: "italic", color: colors.mutedForeground, fontFamily: fonts.body.regular }}>
        No blueprint uploaded for this room yet — upload one from Setup › Flat Master.
      </Text>
    );
  }

  return (
    <>
      <TouchableOpacity activeOpacity={0.8} disabled={!uri} onPress={() => setFull(true)} style={{ borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: "hidden", backgroundColor: "#fff" }}>
        {uri ? (
          <Image source={{ uri }} resizeMode="contain" style={{ width: "100%", height: 170 }} />
        ) : (
          <View style={{ height: 120, alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.muted }}>
            <FileText size={22} color={colors.mutedForeground} />
            <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: fonts.body.regular }}>PDF blueprint — open it on the web to view</Text>
          </View>
        )}
        {marked && (
          <View style={{ position: "absolute", top: 8, right: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: "#10b981" }}>
            <Text style={{ fontSize: 10, color: "#fff", fontFamily: fonts.heading.bold }}>Marked</Text>
          </View>
        )}
        {!!uri && (
          <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingVertical: 4, backgroundColor: "rgba(0,0,0,0.55)" }}>
            <Text style={{ textAlign: "center", fontSize: 10.5, color: "#fff", fontFamily: fonts.body.medium }}>Tap to view full screen</Text>
          </View>
        )}
      </TouchableOpacity>

      <Modal visible={full} transparent animationType="fade" onRequestClose={() => setFull(false)}>
        <Pressable onPress={() => setFull(false)} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.92)", justifyContent: "center" }}>
          <View style={{ position: "absolute", top: 48, left: 16, right: 16, flexDirection: "row", alignItems: "center", gap: 10, zIndex: 2 }}>
            <Text numberOfLines={1} style={{ flex: 1, color: "#fff", fontSize: 13, fontFamily: fonts.heading.semibold }}>{title || "Blueprint"}{marked ? " · marked" : ""}</Text>
            <TouchableOpacity onPress={() => setFull(false)} hitSlop={10}><X size={22} color="#fff" /></TouchableOpacity>
          </View>
          {!!uri && <Image source={{ uri }} resizeMode="contain" style={{ width: "100%", height: "80%" }} />}
        </Pressable>
      </Modal>
    </>
  );
}

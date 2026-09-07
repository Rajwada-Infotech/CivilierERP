// Bottom-sheet confirmation for destructive or financial actions (delete,
// cancel, reverse, post). Optional `children` slot renders extra context —
// a PostingPreviewCard, a reversal plan — above the buttons.
import type { ReactNode } from "react";
import { Modal, Pressable, View, Text, ActivityIndicator, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

export function ConfirmSheet({
  visible,
  title,
  message,
  confirmLabel = "Confirm",
  tone = "danger",
  loading,
  onConfirm,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const accent = tone === "danger" ? colors.destructive : "#eab308";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={loading ? undefined : onClose}>
        <Pressable
          onPress={() => {}}
          style={{
            position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "82%",
            backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
            borderWidth: 1, borderColor: colors.border, paddingTop: 8,
          }}
        >
          <View style={{ alignItems: "center", paddingBottom: 6 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: `${colors.mutedForeground}4d` }} />
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 12 }}>
            <Text style={{ color: colors.foreground, fontSize: 15, fontFamily: fonts.heading.bold }}>{title}</Text>
            {message && (
              <Text style={{ color: colors.mutedForeground, fontSize: 12.5, fontFamily: fonts.body.regular, lineHeight: 18, marginTop: 6 }}>
                {message}
              </Text>
            )}
            {children && <View style={{ marginTop: 14 }}>{children}</View>}
          </ScrollView>

          <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 18, paddingBottom: insets.bottom + 14, paddingTop: 4 }}>
            <Pressable
              onPress={loading ? undefined : onClose}
              style={{ flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}
            >
              <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={loading ? undefined : onConfirm}
              style={{ flex: 1.4, paddingVertical: 13, borderRadius: 12, alignItems: "center", backgroundColor: accent, opacity: loading ? 0.7 : 1 }}
            >
              {loading ? (
                <ActivityIndicator color="#1a1a1a" size="small" />
              ) : (
                <Text style={{ color: "#1a1a1a", fontSize: 13, fontFamily: fonts.heading.bold }}>{confirmLabel}</Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

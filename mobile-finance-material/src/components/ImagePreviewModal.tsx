import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X } from "lucide-react-native";
import { AuthImage } from "@/components/AuthImage";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

/** Full-screen view of one picture. Tap anywhere or the X to close. */
export function ImagePreviewModal({
  visible, url, localUri, title, onClose,
}: {
  visible: boolean;
  url?: string | null;
  localUri?: string | null;
  title?: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.94)" }} onPress={onClose}>
        <View style={{ flex: 1, paddingTop: insets.top + 48, paddingBottom: insets.bottom + 16, paddingHorizontal: 8 }}>
          <AuthImage url={url} localUri={localUri} resizeMode="contain" style={{ flex: 1, width: "100%" }} />
          {!!title && (
            <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 11.5, fontFamily: fonts.body.regular, textAlign: "center", marginTop: 10 }}>
              {title}
            </Text>
          )}
        </View>
        <Pressable
          onPress={onClose}
          hitSlop={10}
          style={{ position: "absolute", top: insets.top + 10, right: 14, width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" }}
        >
          <X size={18} color="#fff" />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

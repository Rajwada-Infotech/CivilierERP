// In-app front camera (expo-camera). The photo is taken inside the app, so Android never sends the app to the background
// (with the system camera app it could close the app to free memory and the photos taken so far were lost).
// Returns a ~640 px JPEG data URL.
import { useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { X } from "lucide-react-native";
import { Body, Key } from "@/components/sheet/Sheet";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

export function CameraCapture({ open, title, hint, onClose, onPhoto }: {
  open: boolean; title: string; hint?: string; onClose: () => void; onPhoto: (dataUrl: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const cam = useRef<CameraView>(null);
  const [perm, requestPerm] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const snap = async () => {
    if (!cam.current || busy) return;
    setBusy(true); setErr(null);
    try {
      const shot = await cam.current.takePictureAsync({ quality: 0.8, skipProcessing: false });
      if (!shot?.uri) throw new Error("No photo");
      const small = await manipulateAsync(shot.uri, [{ resize: { width: 640 } }], { compress: 0.7, format: SaveFormat.JPEG, base64: true });
      if (!small.base64) throw new Error("Could not read the photo");
      onPhoto(`data:image/jpeg;base64,${small.base64}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not take the photo. Try again.");
    } finally { setBusy(false); }
  };

  return (
    <Modal visible={open} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose} onShow={() => setReady(false)}>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, paddingTop: Math.max(insets.top, 28) + 16 }}>
          <Text style={{ color: "#fff", fontFamily: fonts.heading.semibold, fontSize: 16 }}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12}><X size={22} color="#fff" /></Pressable>
        </View>
        {!perm ? <ActivityIndicator color="#fff" /> : !perm.granted ? (
          <View style={{ padding: 24, gap: 12 }}>
            <Body color="#fff">Allow camera access so the app can take your photo.</Body>
            <Key tone="ink" label="Allow camera" onPress={requestPerm} />
          </View>
        ) : (
          <>
            <View style={{ flex: 1 }}>
              <CameraView ref={cam} style={{ flex: 1 }} facing="front" mirror onCameraReady={() => setReady(true)} />
              {/* face guide */}
              <View pointerEvents="none" style={{ position: "absolute", left: "18%", right: "18%", top: "16%", bottom: "24%", borderWidth: 2, borderColor: "#ffffffb0", borderRadius: 999 }} />
            </View>
            <View style={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 32 }}>
              {hint && <Body size={12} color="#ddd">{hint}</Body>}
              {err && <Body size={12} color="#ff8a8a">{err}</Body>}
              <Pressable onPress={snap} disabled={!ready || busy} style={{ alignSelf: "center", width: 74, height: 74, borderRadius: 37, borderWidth: 4, borderColor: "#fff", alignItems: "center", justifyContent: "center", opacity: ready ? 1 : 0.4 }}>
                {busy ? <ActivityIndicator color="#fff" /> : <View style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: "#fff" }} />}
              </Pressable>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

// Image capture/pick field → emits a `data:image/jpeg;base64,...` string,
// the exact shape the FA endpoints validate (JPG/PNG/WEBP data URI). Camera
// or library; enforces the caller's byte budget (routes cap item pictures at
// ~4 MB, assignment user photos at ~400 KB).
import { useState } from "react";
import { View, Text, Pressable, Image, ActivityIndicator } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Camera, ImagePlus, RefreshCw, Trash2 } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { FieldLabel } from "./Form";

export function ImageCaptureField({
  label,
  value,
  onChange,
  maxBytes = 4 * 1024 * 1024,
  hint,
}: {
  label: string;
  value: string;
  onChange: (dataUri: string) => void;
  maxBytes?: number;
  hint?: string;
}) {
  const [busy, setBusy] = useState(false);

  const pick = async (from: "camera" | "library") => {
    try {
      setBusy(true);
      const perm = from === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        toast.error(`${from === "camera" ? "Camera" : "Photo library"} permission denied`);
        return;
      }
      const opts: ImagePicker.ImagePickerOptions = {
        mediaTypes: ["images"],
        base64: true,
        quality: 0.5,
        allowsEditing: true,
      };
      const res = from === "camera"
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets?.[0]?.base64) return;

      const asset = res.assets[0];
      const mime = (asset.mimeType || "image/jpeg").replace("jpg", "jpeg");
      const dataUri = `data:${mime};base64,${asset.base64}`;
      // Rough byte size of the base64 payload.
      const bytes = Math.ceil((asset.base64!.length * 3) / 4);
      if (bytes > maxBytes) {
        toast.error(`Image is too large (${(bytes / 1024 / 1024).toFixed(1)} MB) — max ${(maxBytes / 1024 / 1024).toFixed(1)} MB`);
        return;
      }
      onChange(dataUri);
    } catch (e) {
      toast.error((e as Error).message || "Could not open the image");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ marginBottom: 14 }}>
      <FieldLabel label={label} />
      {value ? (
        <View style={{ flexDirection: "row", gap: 12, alignItems: "center", borderWidth: 1, borderColor: S.rule, borderRadius: 0, padding: 10, backgroundColor: S.paper }}>
          <Image source={{ uri: value }} style={{ width: 68, height: 68, borderRadius: 0, borderWidth: 1, borderColor: S.rule }} />
          <View style={{ flex: 1, gap: 8 }}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <SmallBtn icon={RefreshCw} label="Change" onPress={() => pick("library")} />
              <SmallBtn icon={Trash2} label="Remove" danger onPress={() => onChange("")} />
            </View>
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: 10 }}>
          <BigBtn icon={Camera} label={busy ? "…" : "Camera"} onPress={() => pick("camera")} disabled={busy} />
          <BigBtn icon={ImagePlus} label={busy ? "…" : "Gallery"} onPress={() => pick("library")} disabled={busy} />
        </View>
      )}
      {hint && <Text style={{ color: S.graphite, fontSize: 9.5, fontFamily: fonts.body.regular, marginTop: 5 }}>{hint}</Text>}
      {busy && !value && (
        <View style={{ marginTop: 8, alignItems: "center" }}><ActivityIndicator size="small" color={S.graphite} /></View>
      )}
    </View>
  );
}

function BigBtn({ icon: Icon, label, onPress, disabled }: { icon: typeof Camera; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={{
        flex: 1, alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 16,
        borderWidth: 1, borderColor: S.rule, borderStyle: "dashed", borderRadius: 0,
        backgroundColor: S.paper, opacity: disabled ? 0.5 : 1,
      }}
    >
      <Icon size={17} color={S.graphite} />
      <Text style={{ color: S.graphite, fontSize: 11, fontFamily: fonts.body.medium }}>{label}</Text>
    </Pressable>
  );
}

function SmallBtn({ icon: Icon, label, onPress, danger }: { icon: typeof Camera; label: string; onPress: () => void; danger?: boolean }) {
  const c = danger ? S.red : S.ink;
  return (
    <Pressable
      onPress={onPress}
      style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 0, borderWidth: 1, borderColor: S.rule }}
    >
      <Icon size={12} color={c} />
      <Text style={{ color: c, fontSize: 11, fontFamily: fonts.body.medium }}>{label}</Text>
    </Pressable>
  );
}

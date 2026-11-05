// Small pieces shared by the activity detail tabs.
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Text, TouchableOpacity, View, type ImageStyle, type StyleProp } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { apiUrl } from "@/utils/apiBase";
import { getToken } from "@/services/authStorage";
import { toast } from "@/components/Toast";

export const ACCENT = "#0891b2";
export const card = { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14 } as const;

/** Local calendar date as YYYY-MM-DD (never via toISOString — that shifts the day in IST). */
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const todayYmd = () => ymd(new Date());
export const fromYmd = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const fmtDay = (s: string) => fromYmd(s).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
export const fmtClock = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

export function Loading() {
  return <ActivityIndicator color={colors.mutedForeground} style={{ paddingVertical: 36 }} />;
}

export function Empty({ text }: { text: string }) {
  return (
    <Text style={{ textAlign: "center", color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, paddingVertical: 32 }}>{text}</Text>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  return <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular, paddingVertical: 12 }}>{(error as Error)?.message || "Something went wrong."}</Text>;
}

export function Btn({
  label, onPress, icon, tone = "accent", disabled, busy,
}: { label: string; onPress: () => void; icon?: React.ReactNode; tone?: "accent" | "outline" | "danger"; disabled?: boolean; busy?: boolean }) {
  const filled = tone === "accent";
  const c = tone === "danger" ? colors.destructive : ACCENT;
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      disabled={disabled || busy}
      onPress={onPress}
      style={{
        flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12,
        backgroundColor: filled ? ACCENT : "transparent", borderWidth: filled ? 0 : 1, borderColor: c, opacity: disabled || busy ? 0.4 : 1,
      }}
    >
      {busy ? <ActivityIndicator size="small" color={filled ? "#04181d" : c} /> : icon}
      <Text style={{ fontFamily: fonts.heading.bold, fontSize: 12, color: filled ? "#04181d" : c }}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Open the camera and return the captured image's uri (null if cancelled or refused). Downscaled — photos are
 *  stored as base64 in the database, so size decides how slow a day of uploads gets. */
export async function takePhoto(): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    toast.error("Camera permission denied");
    return null;
  }
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.5, allowsEditing: false });
  return res.canceled || !res.assets?.[0]?.uri ? null : res.assets[0].uri;
}

/** An image served behind the API's bearer token (a plain URI can't carry the header, this can). */
export function AuthImage({ path, style }: { path: string; style: StyleProp<ImageStyle> }) {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => { getToken().then(setToken); }, []);
  if (!token) return <View style={[{ backgroundColor: colors.muted }, style as object]} />;
  return <Image source={{ uri: apiUrl(path), headers: { Authorization: `Bearer ${token}` } }} style={style} />;
}

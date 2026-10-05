import { useEffect, useState } from "react";
import { ActivityIndicator, Image, ImageStyle, StyleProp, View } from "react-native";
import { ImageOff } from "lucide-react-native";
import { apiUrl } from "@/utils/apiBase";
import { getToken } from "@/services/authStorage";
import { colors } from "@/theme/colors";

export type AuthImageSource = { uri: string; headers?: Record<string, string> };

/**
 * Resolves what <Image> needs to show a picture the backend serves behind
 * login: a full URL plus the Bearer token. A plain `{ uri: "/api/..." }` has no
 * host and no auth header, so it renders blank. `localUri` (a photo that was
 * just picked on this phone) wins when present — instant, and needs no network.
 */
export function useAuthImageSource(url: string | null | undefined, localUri?: string | null): AuthImageSource | null {
  const [source, setSource] = useState<AuthImageSource | null>(localUri ? { uri: localUri } : null);
  useEffect(() => {
    if (localUri) {
      setSource({ uri: localUri });
      return;
    }
    if (!url) {
      setSource(null);
      return;
    }
    let cancelled = false;
    getToken().then((token) => {
      if (cancelled) return;
      setSource({ uri: apiUrl(url), headers: token ? { Authorization: `Bearer ${token}` } : undefined });
    });
    return () => {
      cancelled = true;
    };
  }, [url, localUri]);
  return source;
}

export function AuthImage({
  url, localUri, style, resizeMode = "cover",
}: {
  url?: string | null;
  localUri?: string | null;
  style?: StyleProp<ImageStyle>;
  resizeMode?: "cover" | "contain";
}) {
  const source = useAuthImageSource(url, localUri);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url, localUri]);

  if (failed) {
    return (
      <View style={[{ alignItems: "center", justifyContent: "center", backgroundColor: `${colors.muted}40` }, style as object]}>
        <ImageOff size={18} color={colors.mutedForeground} />
      </View>
    );
  }
  if (!source) {
    return (
      <View style={[{ alignItems: "center", justifyContent: "center", backgroundColor: `${colors.muted}40` }, style as object]}>
        <ActivityIndicator size="small" color={colors.mutedForeground} />
      </View>
    );
  }
  return <Image source={source} style={style} resizeMode={resizeMode} onError={() => setFailed(true)} />;
}

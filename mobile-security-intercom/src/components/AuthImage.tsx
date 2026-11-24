import { useEffect, useState } from "react";
import { ActivityIndicator, Image, ImageStyle, StyleProp, View } from "react-native";
import { ImageOff } from "lucide-react-native";
import { apiUrl } from "@/utils/apiBase";
import { getToken } from "@/services/authStorage";
import { fetchWithAuth } from "@/services/fetchWithAuth";
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
    // A picture stored in the database itself (profile photos are saved as data:image/...;base64,...) is shown as it is:
    // putting the server address in front of it, or a login header on it, breaks it.
    if (/^data:/i.test(url)) {
      setSource({ uri: url });
      return;
    }
    // The picture is downloaded through the app's own signed-in request and shown from memory (a data: URI). Handing
    // <Image> the URL plus an Authorization header isn't reliable: on iOS with React Native's new architecture the
    // header can be dropped, the server answers 401 and the picture stays blank (seen with visitor photos).
    const cached = photoCache.get(url);
    if (cached) {
      setSource({ uri: cached });
      return;
    }
    let cancelled = false;
    setSource(null);
    (async () => {
      try {
        const res = await fetchWithAuth(url, { skipActivityLog: true });
        if (!res.ok) throw new Error(String(res.status));
        const dataUri = await blobToDataUri(await res.blob());
        remember(url, dataUri);
        if (!cancelled) setSource({ uri: dataUri });
      } catch {
        // Last resort: let <Image> try the URL with the header itself.
        const token = await getToken();
        if (!cancelled) setSource({ uri: apiUrl(url), headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, localUri]);
  return source;
}

// A few recent pictures kept in memory, so a screen that re-renders (a timer, a re-read) doesn't download them again.
const photoCache = new Map<string, string>();
function remember(url: string, dataUri: string) {
  photoCache.delete(url);
  photoCache.set(url, dataUri);
  while (photoCache.size > 20) photoCache.delete(photoCache.keys().next().value as string);
}
function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
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

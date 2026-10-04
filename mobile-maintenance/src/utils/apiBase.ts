// Mirrors src/lib/apiBase.ts on the web app, but RN has no dev-server proxy
// for "/api" — every request needs a fully-qualified backend URL.
//
// Resolution order:
//   1. EXPO_PUBLIC_API_URL from .env / eas.json — always wins (Expo inlines
//      EXPO_PUBLIC_* at build time). Use this for real builds / staging.
//   2. Dev only: derive the host from the Metro bundler URL (the machine
//      running `npm start`) and assume the backend is on :5000 there. This
//      is what makes a physical phone on the same Wi‑Fi "just work" without
//      anyone editing .env — the #1 cause of "Network error" on the login
//      screen was localhost resolving to the phone itself.
//   3. Fallback: http://localhost:5000 (works for web / iOS simulator).
//
// Android emulator note: localhost/127.0.0.1 is rewritten to 10.0.2.2, the
// emulator's alias for the host machine.
import Constants from "expo-constants";
import { Platform } from "react-native";

const DEFAULT_BACKEND_PORT = 5000;

/** The host:port Metro is served from, e.g. "192.168.29.110:8081". */
function metroHost(): string | null {
  const c = Constants as unknown as {
    expoConfig?: { hostUri?: string };
    expoGoConfig?: { debuggerHost?: string; hostUri?: string };
    manifest2?: { extra?: { expoClient?: { hostUri?: string } } };
    manifest?: { debuggerHost?: string; hostUri?: string };
  };
  return (
    c.expoConfig?.hostUri ||
    c.expoGoConfig?.hostUri ||
    c.expoGoConfig?.debuggerHost ||
    c.manifest2?.extra?.expoClient?.hostUri ||
    c.manifest?.hostUri ||
    c.manifest?.debuggerHost ||
    null
  );
}

function rewriteLoopbackForAndroid(host: string): string {
  if (Platform.OS === "android" && (host === "localhost" || host === "127.0.0.1")) {
    return "10.0.2.2";
  }
  return host;
}

function resolveApiBase(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit;

  if (__DEV__) {
    const mh = metroHost();
    if (mh) {
      const host = rewriteLoopbackForAndroid(mh.split(":")[0]);
      if (host) return `http://${host}:${DEFAULT_BACKEND_PORT}`;
    }
  }

  return rewriteLoopbackForAndroid("localhost") === "10.0.2.2"
    ? `http://10.0.2.2:${DEFAULT_BACKEND_PORT}`
    : `http://localhost:${DEFAULT_BACKEND_PORT}`;
}

export const API_BASE_URL = resolveApiBase().replace(/\/+$/, "");

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("/")) return `${API_BASE_URL}${path}`;
  return `${API_BASE_URL}/${path}`;
}

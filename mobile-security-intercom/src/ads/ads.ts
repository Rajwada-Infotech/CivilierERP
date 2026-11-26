// Video ads for residents (uploaded by super admins in the web app: Maintenance → Ads). Two kinds:
//   POPUP   a pop-up when the resident opens the dashboard (AdPopup.tsx)
//   BANNER  the dashboard's ad space (AdBanner.tsx)
// The videos are behind the resident's sign-in, so the player is given the Authorization header.
//
// expo-video is a native module: Expo Go has it, and so do app builds from 1.2.0 on. An older installed build that
// receives this code by an over-the-air update doesn't, so it is loaded defensively and ads simply don't show there.
import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth } from "@/services/fetchWithAuth";
import { getToken } from "@/services/authStorage";
import { apiUrl } from "@/utils/apiBase";
import * as SecureStore from "expo-secure-store";

export type AdKind = "POPUP" | "BANNER";
export interface Ad {
  id: number;
  kind: AdKind;
  title: string;
  videoPath: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let Video: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Video = require("expo-video");
  if (!Video?.useVideoPlayer || !Video?.VideoView) Video = null;
} catch {
  Video = null;
}

async function fetchAds(): Promise<Ad[]> {
  const res = await fetchWithAuth("/api/security-portal/ads", { skipActivityLog: true });
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

/** The switched-on ads, with the sign-in header the video requests need. Only call it for residents. */
export function useAds(enabled: boolean) {
  const ads = useQuery({ queryKey: ["security-ads"], queryFn: fetchAds, enabled: enabled && !!Video, staleTime: 5 * 60_000, refetchInterval: 10 * 60_000 });
  const token = useQuery({ queryKey: ["security-ads-token"], queryFn: getToken, enabled: enabled && !!Video, staleTime: 60_000 });
  const list = ads.data ?? [];
  return {
    ready: !!Video && ads.isSuccess && token.isSuccess,
    popups: list.filter((a) => a.kind === "POPUP"),
    banners: list.filter((a) => a.kind === "BANNER"),
    sourceOf: (a: Ad) => ({ uri: apiUrl(a.videoPath), headers: token.data ? { Authorization: `Bearer ${token.data}` } : undefined }),
  };
}

// Pop-ups are picked at random (once per app launch), never the same one as last time when there are several. The
// last one shown is kept on the phone, so this holds across app launches.
const LAST_POPUP_KEY = "security-ads-last-popup";
let popupShownThisLaunch = false;
export async function pickPopup(popups: Ad[]): Promise<Ad | null> {
  if (!popups.length) return null;
  let last: number | null = null;
  try {
    last = Number(await SecureStore.getItemAsync(LAST_POPUP_KEY)) || null;
  } catch {
    /* first time, or storage unavailable */
  }
  const pool = popups.length > 1 ? popups.filter((p) => p.id !== last) : popups;
  const ad = pool[Math.floor(Math.random() * pool.length)] ?? popups[0];
  SecureStore.setItemAsync(LAST_POPUP_KEY, String(ad.id)).catch(() => {});
  return ad;
}

/** A shuffled copy (Fisher–Yates). */
export function shuffled<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export const popupAlreadyShown = () => popupShownThisLaunch;
export const markPopupShown = () => {
  popupShownThisLaunch = true;
};

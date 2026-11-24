// When this person last opened the Notifications page, so the bell counts only what came after (the guard's answers).
// Kept on the phone; shared by every component through a tiny listener list.
import { useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";

const KEY = "security-notifications-seen-at";
let seenAt: number | null = null;
const listeners = new Set<(t: number) => void>();

async function load() {
  if (seenAt !== null) return seenAt;
  try {
    seenAt = Number(await SecureStore.getItemAsync(KEY)) || Date.now();
  } catch {
    seenAt = Date.now();
  }
  return seenAt;
}

export async function markNotificationsSeen() {
  seenAt = Date.now();
  listeners.forEach((l) => l(seenAt!));
  try {
    await SecureStore.setItemAsync(KEY, String(seenAt));
  } catch {
    /* counted again after a restart */
  }
}

export function useNotificationsSeenAt() {
  const [t, setT] = useState<number>(seenAt ?? Date.now());
  useEffect(() => {
    listeners.add(setT);
    void load().then(setT);
    return () => {
      listeners.delete(setT);
    };
  }, []);
  return t;
}

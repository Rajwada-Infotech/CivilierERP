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

// Single answers the guard has already seen on the request's own screen (they waited for it there, or opened it): the
// bell leaves these out even if Notifications wasn't opened since.
const REQ_KEY = "security-notifications-seen-requests";
let seenRequests: Set<number> | null = null;
const reqListeners = new Set<(s: Set<number>) => void>();

async function loadRequests() {
  if (seenRequests) return seenRequests;
  try {
    seenRequests = new Set(JSON.parse((await SecureStore.getItemAsync(REQ_KEY)) || "[]") as number[]);
  } catch {
    seenRequests = new Set();
  }
  return seenRequests;
}

export async function isRequestSeen(requestId: number) {
  return (await loadRequests()).has(requestId);
}

export async function markRequestSeen(requestId: number) {
  const s = await loadRequests();
  if (s.has(requestId)) return;
  s.add(requestId);
  // Keep the last 200; older answers are long past the "seen at" time anyway.
  const kept = [...s].slice(-200);
  seenRequests = new Set(kept);
  reqListeners.forEach((l) => l(seenRequests!));
  try {
    await SecureStore.setItemAsync(REQ_KEY, JSON.stringify(kept));
  } catch {
    /* counted again after a restart */
  }
}

export function useSeenRequests() {
  const [s, setS] = useState<Set<number>>(seenRequests ?? new Set());
  useEffect(() => {
    const l = (n: Set<number>) => setS(new Set(n));
    reqListeners.add(l);
    void loadRequests().then(l);
    return () => {
      reqListeners.delete(l);
    };
  }, []);
  return s;
}

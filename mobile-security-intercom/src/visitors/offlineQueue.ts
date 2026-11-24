// The guard's visitor requests that couldn't be sent (no network). Kept in a file on the phone and sent again every
// 15 seconds and whenever the app comes forward. Each one carries the id the phone gave it (clientRequestId), so the
// server stores it once however many times it is sent. A request the server refuses (no resident, no gate today) is
// dropped from the queue with its reason, so it doesn't retry forever.
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { createVisitor, VisitorRefused, type NewVisitor, type VisitorDetail } from "@/api/visitorsApi";

const FILE = `${FileSystem.documentDirectory ?? ""}visitor-queue.json`;

export interface QueuedVisitor extends NewVisitor {
  queuedAt: string;
}

let queue: QueuedVisitor[] | null = null;
let flushing = false;
const listeners = new Set<(n: number) => void>();
/** Requests the server refused while queued, for the guard to see once. */
export const refusedWhileQueued: { flat: string; error: string }[] = [];
/** Requests that went through from the queue, so the screen that is waiting on one can follow it. */
const sentListeners = new Set<(clientRequestId: string, request: VisitorDetail) => void>();

async function load(): Promise<QueuedVisitor[]> {
  if (queue) return queue;
  try {
    const info = await FileSystem.getInfoAsync(FILE);
    queue = info.exists ? JSON.parse(await FileSystem.readAsStringAsync(FILE)) : [];
  } catch {
    queue = [];
  }
  return queue!;
}

async function save() {
  try {
    await FileSystem.writeAsStringAsync(FILE, JSON.stringify(queue ?? []));
  } catch {
    /* the queue stays in memory for this session */
  }
  listeners.forEach((l) => l(queue?.length ?? 0));
}

export async function enqueue(v: NewVisitor) {
  const q = await load();
  if (!q.some((x) => x.clientRequestId === v.clientRequestId)) q.push({ ...v, queuedAt: new Date().toISOString() });
  await save();
}

/** Sends what is queued, oldest first; stops at the first network failure. */
export async function flushQueue() {
  if (flushing) return;
  flushing = true;
  try {
    const q = await load();
    while (q.length) {
      const v = q[0];
      try {
        const sent = await createVisitor(v);
        sentListeners.forEach((l) => l(v.clientRequestId, sent));
      } catch (e) {
        if (!(e instanceof VisitorRefused)) break; // still offline: try again later
        refusedWhileQueued.push({ flat: v.block ? `${v.block}-${v.flatNo}` : v.flatNo, error: e.message });
      }
      q.shift();
      await save();
    }
  } finally {
    flushing = false;
  }
}

export function onQueuedSent(fn: (clientRequestId: string, request: VisitorDetail) => void) {
  sentListeners.add(fn);
  return () => {
    sentListeners.delete(fn);
  };
}

/** How many requests are waiting to be sent; keeps sending them while the app is open. */
export function useVisitorQueue(enabled: boolean) {
  const [count, setCount] = useState(queue?.length ?? 0);
  useEffect(() => {
    if (!enabled) return;
    listeners.add(setCount);
    void load().then((q) => setCount(q.length));
    void flushQueue();
    const t = setInterval(() => void flushQueue(), 15000);
    const sub = AppState.addEventListener("change", (s) => s === "active" && void flushQueue());
    return () => {
      listeners.delete(setCount);
      clearInterval(t);
      sub.remove();
    };
  }, [enabled]);
  return count;
}

/** A random v4 UUID for a new request (unique enough to tell one guard's requests apart; the server checks it). */
export function newRequestId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

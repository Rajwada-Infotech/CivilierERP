// Opens the incoming-call screen when someone calls this person: at once over the socket, and by asking the server
// every 20 s while the app is open (in case the socket is down and the push is late). The push itself, tapped
// from the lock screen, opens the same screen through App.tsx.
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { navigationRef } from "@/navigation/navigationRef";
import { useSecurityView } from "@/navigation/securityRole";
import { incomingCall } from "@/api/securityMoreApi";
import { useSocketEvent } from "@/visitors/useSecuritySocket";

const shown = new Set<number>();

/** Opens the call screen for this incoming call, once. */
export function openIncomingCall(callId: number) {
  if (shown.has(callId) || !navigationRef.isReady()) return;
  shown.add(callId);
  navigationRef.navigate("Call", { callId, incoming: true });
}

export function IncomingCallWatcher() {
  const { view } = useSecurityView();
  const active = useRef(true);

  const check = async () => {
    if (!view || !active.current) return;
    try {
      const c = await incomingCall(view);
      if (c && c.status === "RINGING") openIncomingCall(c.callId);
    } catch {
      /* offline */
    }
  };

  useSocketEvent<{ callId: number; status: string }>("security:call", !!view, (e) => {
    if (e.status === "RINGING") openIncomingCall(e.callId);
  });

  useEffect(() => {
    if (!view) return;
    void check();
    const t = setInterval(() => void check(), 20000);
    const sub = AppState.addEventListener("change", (s) => {
      active.current = s === "active";
      if (active.current) void check();
    });
    return () => {
      clearInterval(t);
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  return null;
}

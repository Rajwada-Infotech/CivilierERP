// The guard's "Patrol" panel on the home page: Start patrol begins a round at their gate, End patrol closes it. The
// route is the shift's location sharing between the two times, so residents can replay the round (Menu → Patrol).
// A round left open ends by itself after 4 hours.
import { useEffect, useState } from "react";
import { View, Text, Alert } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Footprints } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, Key, Label, Notice } from "@/components/sheet/Sheet";
import { fetchWithAuth } from "@/services/fetchWithAuth";
import { isTracking } from "./guardTracking";

type Patrol = { id: number; startedAt: string; gateName: string } | null;

async function call(path: string, method: "GET" | "POST" = "GET"): Promise<Patrol> {
  const res = await fetchWithAuth(`/api/security/patrols/${path}`, { method });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `The request failed (${res.status}).`);
  return body.patrol ?? null;
}

const time = (s: string) => new Date(s).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

export function PatrolCard({ onDuty }: { onDuty: boolean }) {
  const qc = useQueryClient();
  const { data: patrol } = useQuery({ queryKey: ["security-patrol-current"], queryFn: () => call("current"), refetchInterval: 60000 });
  const [busy, setBusy] = useState(false);
  const [tracking, setTracking] = useState(true);
  // Minutes since the start, ticking while a round is on.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!patrol) return;
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, [patrol]);
  useEffect(() => {
    void isTracking().then(setTracking);
  }, [patrol, onDuty]);

  const act = async (path: "start" | "end") => {
    setBusy(true);
    try {
      qc.setQueryData(["security-patrol-current"], await call(path, "POST"));
    } catch (e) {
      Alert.alert("Patrol", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const mins = patrol ? Math.max(0, Math.round((Date.now() - new Date(patrol.startedAt).getTime()) / 60000)) : 0;
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 16, gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Footprints size={18} color={patrol ? S.blue : S.graphite} />
        <View style={{ flex: 1 }}>
          <Label>Patrol</Label>
          <Text style={{ fontFamily: fonts.body.semibold, fontSize: 14, color: patrol ? S.ink : S.ink2, marginTop: 2 }}>
            {patrol ? `On patrol since ${time(patrol.startedAt)} · ${mins} min` : onDuty ? "Not on patrol" : "Patrols start during your shift"}
          </Text>
        </View>
      </View>
      {patrol && !tracking && <Notice>Location sharing is off, so this round's route isn't being recorded. Turn it on above.</Notice>}
      {patrol ? (
        <Key tone="red" label={busy ? "Ending…" : "End patrol"} onPress={() => void act("end")} disabled={busy} />
      ) : (
        <Key tone="ink" label={busy ? "Starting…" : "Start patrol"} icon={<Footprints size={15} color={S.paper} />} onPress={() => void act("start")} disabled={busy || !onDuty} />
      )}
      {!patrol && onDuty && <Body size={11.5} color={S.graphite}>Residents can replay each round you walk.</Body>}
    </View>
  );
}

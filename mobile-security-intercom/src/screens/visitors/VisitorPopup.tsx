// Residents: a visitor at the gate pops up over whatever screen is open — the guard's photo, who and why, and
// Approve / Deny right there. It appears the moment the request arrives (socket, or the bell's re-read), closes by itself
// if another resident of the flat answers first, and "Later" leaves it in the bell. One visitor at a time, newest first.
import { useEffect, useMemo, useState } from "react";
import { Modal, View, Text, Platform, Pressable } from "react-native";
import { Check, X } from "lucide-react-native";
import { useQueryClient } from "@tanstack/react-query";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, Key, Label, Notice } from "@/components/sheet/Sheet";
import { AuthImage } from "@/components/AuthImage";
import { decideVisitor, residentPhotoUrl } from "@/api/visitorsApi";
import { useSecurityNotifications } from "@/notifications/useSecurityNotifications";
import { navigationRef } from "@/navigation/navigationRef";

const GREEN = "#1f9d55";
const flatOf = (b: string | null, f: string) => (b ? `${b}-${f}` : f);

export function VisitorPopup() {
  const qc = useQueryClient();
  const { view, visitors, refetch } = useSecurityNotifications();
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<{ name?: string; id?: number }>({});

  // Don't pop up over the request's own screen.
  useEffect(() => {
    const read = () => {
      const r = navigationRef.getCurrentRoute();
      setRoute({ name: r?.name, id: (r?.params as { id?: number } | undefined)?.id });
    };
    read();
    return navigationRef.addListener?.("state", read);
  }, []);

  const current = useMemo(() => {
    if (view !== "customer") return null;
    return (
      [...visitors]
        .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime())
        .find((v) => v.status === "PENDING" && !dismissed.has(v.id) && !(route.name === "VisitorDecision" && route.id === v.id)) ?? null
    );
  }, [view, visitors, dismissed, route]);

  useEffect(() => setError(null), [current?.id]);

  const close = (id: number) => setDismissed((d) => new Set(d).add(id));

  const decide = async (d: "approve" | "deny") => {
    if (!current) return;
    setBusy(d);
    setError(null);
    try {
      await decideVisitor(current.id, d, { platform: Platform.OS });
      close(current.id);
      void refetch();
      void qc.invalidateQueries({ queryKey: ["security-dashboard"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!current) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => close(current.id)}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "center", padding: 18 }}>
        <View style={{ backgroundColor: S.paper, borderWidth: 1.5, borderColor: S.ink }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: S.ink }}>
            <Label color={S.blue}>Visitor at {current.gateName} · flat {flatOf(current.block, current.flat)}</Label>
            <Pressable onPress={() => close(current.id)} hitSlop={10} accessibilityLabel="Later">
              <X size={18} color={S.ink} />
            </Pressable>
          </View>
          {current.hasPhoto ? (
            <AuthImage url={residentPhotoUrl(current.id)} style={{ width: "100%", aspectRatio: 4 / 3 }} />
          ) : null}
          <View style={{ padding: 14, gap: 4 }}>
            <Text style={{ fontFamily: fonts.heading.bold, fontSize: 22, color: S.ink }}>{current.visitorName || "Visitor"}</Text>
            <Body size={14} color={S.ink2}>{current.reason}</Body>
            {!!current.vehicleNo && <Body size={13} color={S.ink2}>Vehicle {current.vehicleNo}</Body>}
            <Body size={12} color={S.graphite}>
              Asked {new Date(current.requestedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              {current.guardName ? ` by ${current.guardName}` : ""}
            </Body>
          </View>
          <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 10 }}>
            {error && <Notice>{error}</Notice>}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Key tone="red" label={busy === "deny" ? "Denying…" : "Deny"} icon={<X size={16} color="#ffffff" />} onPress={() => void decide("deny")} disabled={!!busy} style={{ flex: 1, minHeight: 54 }} />
              <Key tone="ink" onPress={() => void decide("approve")} disabled={!!busy} style={{ flex: 1, minHeight: 54, backgroundColor: GREEN, borderColor: GREEN }} icon={<Check size={16} color="#ffffff" />}>
                <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: "uppercase", color: "#ffffff" }}>{busy === "approve" ? "Approving…" : "Approve"}</Text>
              </Key>
            </View>
            <Key label="Later" onPress={() => close(current.id)} disabled={!!busy} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

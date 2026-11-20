// Construction — how far the home has got (the unit, else its tower or project), notes from the site team, the handover
// readiness checks and inspection, snags and whether each is fixed, the possession notice, and the handover itself.
import { useEffect, useState } from "react";
import { Image, Modal, Pressable, Text, TextInput, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Camera, CheckCircle2, Circle, ClipboardCheck, FileCheck2, FileText, HardHat, History, Home, Megaphone, Wrench, X } from "lucide-react-native";
import { toast } from "@/components/Toast";
import { portal, pdfPath, type Timeline } from "@/api/customerPortalApi";
import { apiUrl } from "@/utils/apiBase";
import { getToken } from "@/services/authStorage";
import { openDocument } from "@/utils/documents";
import { useBrand } from "@/theme/ThemeContext";
import { fonts } from "@/theme/fonts";
import { useCustomer } from "@/customer/CustomerContext";
import { ActionBanner, Bar, Button, Divider, ErrorText, ListRow, Loading, Muted, Page, Panel, Pill, Row, fmtDate } from "@/customer/ui";

/** The handover readiness checks (CrmPrePossession), in the buyer's words. */
const READINESS: { key: "duesCleared" | "documentation" | "quality" | "utilities"; label: string }[] = [
  { key: "duesCleared", label: "Payments settled" },
  { key: "documentation", label: "Papers ready" },
  { key: "quality", label: "Quality inspection passed" },
  { key: "utilities", label: "Water, power and other utilities ready" },
];

type Photo = NonNullable<Timeline["sitePhotos"]>[number];

/** Site photos: a grid of the latest, tap one to see it large with what it shows. Images load signed in. */
function SitePhotos({ photos, appId }: { photos: Photo[]; appId: number }) {
  const brand = useBrand();
  const [token, setToken] = useState<string | null>(null);
  const [shown, setShown] = useState<Photo | null>(null);
  useEffect(() => { getToken().then((t) => setToken(t || null)).catch(() => setToken(null)); }, []);
  if (!token) return null;
  const src = (p: Photo) => ({ uri: apiUrl(pdfPath.sitePhoto(appId, p.id)), headers: { Authorization: `Bearer ${token}` } });
  const caption = (p: Photo) => [p.activity, p.room, fmtDate(p.day || p.at)].filter(Boolean).join(" · ");
  return (
    <Panel title="Photos from site" icon={Camera}>
      <Muted>Taken by our site engineers as work is done — your unit, and shared work on your tower.</Muted>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {photos.map((p) => (
          <Pressable key={p.id} onPress={() => setShown(p)} accessibilityRole="imagebutton" accessibilityLabel={caption(p)}
            style={{ width: "31.5%", aspectRatio: 1, borderRadius: 12, overflow: "hidden", backgroundColor: brand.surfaceGlass }}>
            <Image source={src(p)} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
          </Pressable>
        ))}
      </View>
      <Modal visible={!!shown} transparent animationType="fade" onRequestClose={() => setShown(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.92)", justifyContent: "center", padding: 16, gap: 14 }}>
          <Pressable onPress={() => setShown(null)} accessibilityLabel="Close" hitSlop={12}
            style={{ position: "absolute", top: 48, right: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center", zIndex: 2 }}>
            <X size={22} color="#fff" />
          </Pressable>
          {shown ? (
            <>
              <Image source={src(shown)} style={{ width: "100%", aspectRatio: 3 / 4, borderRadius: 12 }} resizeMode="contain" />
              <View style={{ gap: 4 }}>
                <Text style={{ color: "#fff", fontSize: 16, fontFamily: fonts.heading.semibold }}>{shown.activity}</Text>
                <Text style={{ color: "rgba(255,255,255,0.75)", fontSize: 13, fontFamily: fonts.body.regular }}>
                  {[shown.work, shown.room, shown.ownUnit ? "Your unit" : "Shared work", fmtDate(shown.day || shown.at)].filter(Boolean).join(" · ")}
                </Text>
                {shown.note ? <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 13, fontFamily: fonts.body.regular }}>{shown.note}</Text> : null}
              </View>
            </>
          ) : null}
        </View>
      </Modal>
    </Panel>
  );
}

export default function CustomerConstructionScreen() {
  const brand = useBrand();
  const { timeline, appId, readOnly } = useCustomer();
  const qc = useQueryClient();
  const [disputing, setDisputing] = useState(false);
  const [reason, setReason] = useState("");

  const respond = useMutation({
    mutationFn: (decision: "Acknowledge" | "Dispute") =>
      portal.respondPossession(appId as number, decision, decision === "Dispute" ? reason.trim() : undefined),
    onSuccess: (_r, decision) => {
      toast.success(decision === "Acknowledge" ? "Possession notice acknowledged" : "Dispute sent");
      setDisputing(false); setReason("");
      qc.invalidateQueries({ queryKey: ["portal-timeline"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not send it"),
  });

  const t = timeline.data;
  if (timeline.isLoading) return <Page><Loading /></Page>;
  if (timeline.error)     return <Page><ErrorText error={timeline.error} /></Page>;

  const mine    = t?.constructionProgress;
  const live    = mine?.unit || null;
  const unit    = t?.booking?.UnitNo || "Your booked unit";
  // Whose progress this is: the unit itself, or — until the site records the unit — its tower or the whole project.
  const scopeNote = mine?.scope === "tower" ? `Your unit's own progress isn't recorded yet, so this is ${mine.towerName ? `tower ${mine.towerName}` : "your tower"} as a whole.`
    : mine?.scope === "project" ? "Your unit's own progress isn't recorded yet, so this is the whole project." : null;
  const notes = t?.siteNotes || [];
  const pre = t?.prePossession;
  const snags = t?.snags || [];
  const snagsOpen = snags.filter((x) => x.IsOpen).length;
  const notice  = t?.possessionNotice;
  const handover = t?.handover;

  return (
    <Page onRefresh={() => timeline.refetch()}>
      <Muted>Updates for your booked unit: {unit}.</Muted>

      {/* Progress panel */}
      {live ? (
        <Panel title={mine?.scope === "unit" ? "Your home's progress" : mine?.scope === "tower" ? "Tower progress" : "Project progress"} icon={HardHat}>
          {scopeNote ? <Muted>{scopeNote}</Muted> : null}
          {/* Big percentage */}
          <View style={{ alignItems: "center", paddingVertical: 12 }}>
            <Text style={{ fontSize: 52, fontFamily: fonts.heading.semibold, color: live.pct >= 100 ? brand.success : brand.gold }}>
              {live.pct}%
            </Text>
            <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: brand.textSecondary, marginTop: 4 }}>
              {live.allDone
                ? "Construction complete ✓"
                : live.now.length
                ? `Underway: ${live.now.slice(0, 2).map((w) => `${w.name} ${w.pct}%`).join(" · ")}`
                : "Construction not started yet"}
              {!live.allDone && live.next ? ` · Coming next: ${live.next}` : ""}
            </Text>
          </View>
          <Bar pct={live.pct} />
          {/* Per-work breakdown */}
          {live.works.map((w) => (
            <View key={w.name} style={{ gap: 5 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{
                  fontSize: 12.5,
                  fontFamily: w.pct > 0 && w.pct < 100 ? fonts.body.semibold : fonts.body.regular,
                  color: w.pct > 0 ? brand.textPrimary : brand.textFaint,
                }}>
                  {w.pct >= 100 ? "✓ " : ""}{w.name}
                </Text>
                <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: w.pct >= 100 ? brand.success : brand.textSecondary }}>
                  {w.pct}%
                </Text>
              </View>
              <Bar pct={w.pct} />
            </View>
          ))}
        </Panel>
      ) : (
        <Panel>
          <Muted>Progress isn't recorded for your project yet. It will appear here as soon as the site team starts recording work.</Muted>
        </Panel>
      )}

      {t?.sitePhotos?.length && appId != null ? <SitePhotos photos={t.sitePhotos} appId={appId} /> : null}

      {/* Notes the site team writes for buyers */}
      {notes.length ? (
        <Panel title="From the site team" icon={Megaphone}>
          {notes.map((n, i) => (
            <View key={n.Id} style={{ gap: 4 }}>
              {i ? <Divider /> : null}
              <Text style={{ fontSize: 12, fontFamily: fonts.body.semibold, color: brand.textSecondary }}>
                {[fmtDate(n.UpdateDate), n.Stage, n.PercentComplete != null ? `${Number(n.PercentComplete)}% complete` : null].filter(Boolean).join(" · ")}
              </Text>
              <Text style={{ fontSize: 14, lineHeight: 20, fontFamily: fonts.body.regular, color: brand.textPrimary }}>{n.Summary}</Text>
            </View>
          ))}
        </Panel>
      ) : null}

      {/* Activity feed */}
      {mine?.feed?.length ? (
        <Panel title="Recent Updates" icon={History}>
          {mine.feed.map((f, i) => (
            <View key={`${f.at}-${i}`}>
              {i ? <Divider /> : null}
              <ListRow
                title={f.activity}
                sub={[f.work, f.room, fmtDate(f.at)].filter(Boolean).join(" · ")}
                right={f.completed ? "Done" : f.to != null ? `${f.to}%` : undefined}
              />
            </View>
          ))}
        </Panel>
      ) : null}

      {/* Possession notice */}
      {notice ? (
        <Panel title={`Possession Notice — ${notice.NoticeNo}`} icon={FileCheck2}>
          {notice.Status === "Sent" && !readOnly ? (
            <ActionBanner
              title="Possession Notice Requires Your Response"
              sub={[notice.OfferedDate ? `Offered for ${fmtDate(notice.OfferedDate)}` : "", notice.ResponseDeadline ? `Respond by ${fmtDate(notice.ResponseDeadline)}` : ""].filter(Boolean).join(" · ")}
              tone="gold"
            />
          ) : null}
          <Muted>
            {notice.OfferedDate ? `Offered for ${fmtDate(notice.OfferedDate)}` : "Offer details pending"}
            {notice.ResponseDeadline ? ` · respond by ${fmtDate(notice.ResponseDeadline)}` : ""}
          </Muted>
          <Button
            label="View Letter" kind="line" icon={FileText}
            onPress={() => openDocument(pdfPath.possessionLetter(appId as number, notice.Id), notice.NoticeNo).catch((e) => toast.error(e.message))}
          />
          {notice.Status === "Sent" && !readOnly && !disputing ? (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button label="Acknowledge" icon={CheckCircle2} busy={respond.isPending} onPress={() => respond.mutate("Acknowledge")} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Dispute" kind="line" icon={AlertTriangle} onPress={() => setDisputing(true)} />
              </View>
            </View>
          ) : null}
          {disputing ? (
            <>
              <TextInput
                value={reason} onChangeText={setReason} multiline numberOfLines={3}
                placeholder="Reason for dispute…" placeholderTextColor={brand.textFaint}
                style={{ borderWidth: 1, borderColor: brand.danger, borderRadius: 12, padding: 12, minHeight: 80, textAlignVertical: "top", color: brand.textPrimary, fontFamily: fonts.body.regular, fontSize: 13, backgroundColor: brand.surface }}
              />
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1 }}><Button label="Cancel" kind="line" onPress={() => setDisputing(false)} /></View>
                <View style={{ flex: 1 }}>
                  <Button label="Dispute" busy={respond.isPending}
                    onPress={() => reason.trim() ? respond.mutate("Dispute") : toast.error("A reason is required to dispute")} />
                </View>
              </View>
            </>
          ) : null}
          {notice.Status === "Acknowledged" ? <Muted>You acknowledged this notice on {fmtDate(notice.AcknowledgedAt)}</Muted> : null}
          {notice.Status === "Disputed" ? <Muted>You disputed this notice on {fmtDate(notice.DisputedAt)}{notice.DisputeReason ? ` — ${notice.DisputeReason}` : ""}</Muted> : null}
        </Panel>
      ) : null}

      {/* Before handover: the readiness checks and the inspection visit */}
      {pre ? (
        <Panel title="Getting ready for handover" icon={ClipboardCheck} right={<Pill label={pre.status} />}>
          {READINESS.map((c) => (
            <View key={c.key} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              {pre.checks[c.key] ? <CheckCircle2 size={18} color={brand.success} /> : <Circle size={18} color={brand.textFaint} />}
              <Text style={{ flex: 1, fontSize: 14, fontFamily: fonts.body.regular, color: pre.checks[c.key] ? brand.textPrimary : brand.textSecondary }}>{c.label}</Text>
              <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: pre.checks[c.key] ? brand.success : brand.textFaint }}>{pre.checks[c.key] ? "Done" : "Pending"}</Text>
            </View>
          ))}
          <Divider />
          {pre.completedDate ? <Row label="Inspection done" value={fmtDate(pre.completedDate)} tone={brand.success} />
            : pre.scheduledDate ? <Row label="Inspection visit" value={fmtDate(pre.scheduledDate)} />
            : <Muted>We'll tell you the date of your inspection visit once the checks above are done.</Muted>}
        </Panel>
      ) : null}

      {/* Snags found at the inspection and whether each is fixed */}
      {snags.length ? (
        <Panel title={`Snags (${snagsOpen ? `${snagsOpen} being fixed` : "all fixed"})`} icon={Wrench}>
          <Muted>Small faults noted at the inspection. We fix each one before you move in.</Muted>
          {snags.map((x, i) => (
            <View key={x.Id}>
              {i ? <Divider /> : null}
              <ListRow title={x.Description} pill={<Pill label={x.Status.replace(/([a-z])([A-Z])/g, "$1 $2")} />}
                sub={[x.Category, `noted ${fmtDate(x.CreatedAt)}`, x.ResolvedAt ? `fixed ${fmtDate(x.ResolvedAt)}` : null].filter(Boolean).join(" · ")} />
            </View>
          ))}
        </Panel>
      ) : null}

      {/* Handover */}
      {handover ? (
        <Panel title={handover.ActualHandoverDate ? "Handed Over 🏠" : "Handover Scheduled"} icon={Home}>
          <Row
            label={handover.ActualHandoverDate ? "Handed over" : "Planned for"}
            value={handover.ActualHandoverDate ? fmtDate(handover.ActualHandoverDate) : handover.ScheduledDate ? fmtDate(handover.ScheduledDate) : handover.Status}
            tone={handover.ActualHandoverDate ? brand.success : undefined}
          />
        </Panel>
      ) : null}
    </Page>
  );
}

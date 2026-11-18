// Construction — premium redesign. Same data as before.
import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileCheck2, FileText, HardHat, History, Home } from "lucide-react-native";
import { toast } from "@/components/Toast";
import { portal, pdfPath } from "@/api/customerPortalApi";
import { openDocument } from "@/utils/documents";
import { useBrand } from "@/theme/ThemeContext";
import { fonts } from "@/theme/fonts";
import { useCustomer } from "@/customer/CustomerContext";
import { ActionBanner, Bar, Button, Divider, ErrorText, ListRow, Loading, Muted, Page, Panel, Row, fmtDate } from "@/customer/ui";

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
  const live    = mine?.scope === "unit" ? mine.unit : null;
  const unit    = t?.booking?.UnitNo || "Your booked unit";
  const notice  = t?.possessionNotice;
  const handover = t?.handover;

  return (
    <Page onRefresh={() => timeline.refetch()}>
      <Muted>Updates for your booked unit: {unit}.</Muted>

      {/* Progress panel */}
      {live ? (
        <Panel title="Construction Progress" icon={HardHat}>
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
          <Muted>Unit-specific progress is not available yet. It will appear automatically when site updates are recorded for your booked unit.</Muted>
        </Panel>
      )}

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

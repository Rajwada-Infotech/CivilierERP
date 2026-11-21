// One service ticket: what it is, the buyer (Call / WhatsApp, their booking), its dates and resolution, and the steps
// the web's Service Tickets page offers at each status (CrmServiceTickets.tsx) — Assign, Start, Resolve (with
// notes), Close, Reopen (with a reason) — for staff with the edit right, through the same routes.
import { useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { CheckCircle2, Play, RotateCcw, UserPlus, XCircle } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import {
  assignServiceTicket, closeServiceTicket, getAssignableStaff, getServiceTicket, markTicketInProgress, reopenServiceTicket, resolveServiceTicket,
} from "@/api/serviceTicketApi";
import { OptionPickerModal } from "@/components/OptionPicker";
import { toast } from "@/components/Toast";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { NotePrompt } from "./CrmForms";
import { useCrmOpen } from "./CrmRegisterScreen";
import { ActionKey, CRM, ContactKeys, Empty, Kv, LinkRow, Section, fmtDate, joinDot, Pill, useCardStyle } from "./ui";

const PRIORITY_TONE: Record<string, string> = { Urgent: "#ef4444", High: "#f97316", Normal: "#0ea5e9", Low: colors.mutedForeground };
const words = (s?: string | null) => (s ? s.replace(/([a-z])([A-Z])/g, "$1 $2") : "");

export default function TicketScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmTicket">>();
  const card = useCardStyle();
  const id = params.ticketId;
  const qc = useQueryClient();
  const { canAccessPage, canDoAction } = useAuth();
  const open = useCrmOpen();
  const canEdit = canDoAction("crm-service-tickets", "edit");
  const q = useQuery({ queryKey: ["crm-ticket", id], queryFn: () => getServiceTicket(id), enabled: canAccessPage("crm-service-tickets") });
  const staffQ = useQuery({ queryKey: ["sa-users"], queryFn: getAssignableStaff, staleTime: 5 * 60_000, enabled: canEdit });
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [prompt, setPrompt] = useState<"resolve" | "reopen" | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      ["crm-ticket", "crm", "crm-booking-tickets", "maint-service-requests", "crm-dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setPrompt(null);
      setPicker(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!canAccessPage("crm-service-tickets")) {
    return <View style={{ flex: 1, backgroundColor: colors.background, padding: 16 }}><Empty text="You don't have a right on Service Tickets." /></View>;
  }

  const t = q.data;
  const st = t?.Status;
  const overdue = !!t?.SlaDueDate && !["Resolved", "Closed"].includes(st ?? "") && new Date(t.SlaDueDate).getTime() < Date.now();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await q.refetch(); setRefreshing(false); }} tintColor={CRM} />}
    >
      {q.isLoading ? <ActivityIndicator color={colors.mutedForeground} style={{ paddingVertical: 60 }} />
        : q.error ? <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular }}>{(q.error as Error).message}</Text>
        : !t ? <Empty text="This ticket was not found." />
        : (
          <>
            <View style={{ ...card, padding: 18, marginBottom: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ flex: 1, fontSize: 12, fontFamily: fonts.heading.semibold, color: colors.mutedForeground }}>{t.TicketNo}</Text>
                <Pill label={t.Status} />
              </View>
              <Text style={{ fontSize: 17, fontFamily: fonts.heading.bold, color: colors.foreground, marginTop: 8 }}>{t.Subject}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                <Pill label={`${t.Priority} priority`} tone={PRIORITY_TONE[t.Priority]} />
                <Pill label={words(t.Category)} tone="#8b5cf6" />
                {t.RaisedByCustomer ? <Pill label="Raised by customer" tone="#0ea5e9" /> : null}
                {overdue ? <Pill label="Past SLA" tone="#ef4444" /> : null}
              </View>
              {t.Description ? <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: colors.foreground, marginTop: 10, lineHeight: 19 }}>{t.Description}</Text> : null}
            </View>

            {canEdit && st !== "Closed" ? (
              <View style={{ gap: 10, marginBottom: 12 }}>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  {st === "Open" || st === "Assigned" || st === "InProgress" ? (
                    <ActionKey label={st === "Open" ? "Assign" : "Reassign"} icon={UserPlus} outline onPress={() => setPicker(true)} />
                  ) : null}
                  {st === "Assigned" || st === "Reopened" ? (
                    <ActionKey label={st === "Reopened" ? "Start work" : "Start"} icon={Play} outline onPress={() => run(() => markTicketInProgress(id), "Work started")} />
                  ) : null}
                </View>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  {st === "Assigned" || st === "InProgress" || st === "Reopened" ? (
                    <ActionKey label="Resolve" icon={CheckCircle2} tone="#10b981" onPress={() => setPrompt("resolve")} />
                  ) : null}
                  {st === "Resolved" ? <ActionKey label="Close" icon={XCircle} onPress={() => run(() => closeServiceTicket(id), "Ticket closed")} /> : null}
                  {st === "Resolved" ? <ActionKey label="Reopen" icon={RotateCcw} tone={colors.destructive} outline onPress={() => setPrompt("reopen")} /> : null}
                </View>
              </View>
            ) : null}
            {canEdit && st === "Closed" ? (
              <View style={{ flexDirection: "row", marginBottom: 12 }}>
                <ActionKey label="Reopen" icon={RotateCcw} tone={colors.destructive} outline onPress={() => setPrompt("reopen")} />
              </View>
            ) : null}
            {busy ? <ActivityIndicator color={CRM} style={{ marginBottom: 12 }} /> : null}

            <Section title="Buyer">
              <LinkRow title={t.ApplicantName || "—"} sub={joinDot(t.BookingNo, t.ProjectName, t.UnitNo)}
                onPress={canAccessPage("crm-bookings") || canAccessPage("crm-payments") ? () => open({ to: "booking", bookingId: t.BookingId, title: t.BookingNo }) : undefined} />
              <View style={{ paddingBottom: 8 }}><ContactKeys mobile={t.Mobile} /></View>
            </Section>

            <Section title="Ticket">
              <Kv label="Assigned to" value={t.AssigneeName || "Not assigned"} />
              <Kv label="Raised" value={fmtDate(t.CreatedAt)} />
              <Kv label="SLA due" value={fmtDate(t.SlaDueDate)} tone={overdue ? "#ef4444" : undefined} />
              {t.ResolvedAt ? <Kv label="Resolved" value={fmtDate(t.ResolvedAt)} /> : null}
              {t.CustomerRating ? <Kv label="Customer rating" value={`${t.CustomerRating} / 5`} /> : null}
            </Section>

            {t.ResolutionNotes ? (
              <Section title="Resolution">
                <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: colors.foreground, paddingVertical: 8, lineHeight: 19 }}>{t.ResolutionNotes}</Text>
              </Section>
            ) : null}
          </>
        )}

      <OptionPickerModal visible={picker} title={st === "Open" ? "Assign to" : "Reassign to"} searchable loading={staffQ.isLoading}
        options={(staffQ.data ?? []).map((u) => ({ key: String(u.Id), label: u.Name }))}
        selectedKey={t?.AssignedTo ? String(t.AssignedTo) : null}
        onSelect={(k) => { const u = (staffQ.data ?? []).find((x) => String(x.Id) === k); if (u) run(() => assignServiceTicket(id, u.Id), `Assigned to ${u.Name}`); }}
        onClose={() => setPicker(false)} />
      <NotePrompt open={prompt === "resolve"} title={`Resolve ${t?.TicketNo ?? ""}`} hint="Describe what was done to resolve the issue. It stays on the ticket."
        placeholder="Resolution notes…" submitLabel="Mark resolved" busy={busy}
        onSubmit={(text) => run(() => resolveServiceTicket(id, text), "Ticket resolved")} onClose={() => setPrompt(null)} />
      <NotePrompt open={prompt === "reopen"} title={`Reopen ${t?.TicketNo ?? ""}`} hint="Explain why it needs reopening. It's kept for the audit trail."
        placeholder="Reason for reopening…" submitLabel="Reopen" danger busy={busy}
        onSubmit={(text) => run(() => reopenServiceTicket(id, text), "Ticket reopened")} onClose={() => setPrompt(null)} />
    </ScrollView>
  );
}

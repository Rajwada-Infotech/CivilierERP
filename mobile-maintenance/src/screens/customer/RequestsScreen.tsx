// Help & Support — ask for help, and follow each request: tap one for what was asked, when we aim to reply,
// what we did, and (once resolved) rate how it was handled.
import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, LifeBuoy, Plus, Star } from "lucide-react-native";
import { useBrand } from "@/theme/ThemeContext";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { portal, TICKET_CATEGORIES, type Ticket } from "@/api/customerPortalApi";
import { useCustomer } from "@/customer/CustomerContext";
import { Button, Divider, ErrorText, ListRow, Loading, Muted, Page, Panel, Pill, Row, fmtDate, Tap } from "@/customer/ui";

const label = (c: string) => c.replace(/([A-Z])/g, " $1").trim();
const isDone = (t: Ticket) => t.Status === "Resolved" || t.Status === "Closed";

/** A resolved request that isn't actually fixed: reopen it with what is still wrong. */
function ReopenRequest({ t, onDone }: { t: Ticket; onDone: () => void }) {
  const brand = useBrand();
  const { appId } = useCustomer();
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState("");
  const send = useMutation({
    mutationFn: () => portal.reopenTicket(appId as number, t.Id, why.trim()),
    onSuccess: () => { toast.success("Reopened. Our team will look at it again."); setOpen(false); setWhy(""); onDone(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not reopen it"),
  });
  if (!open) return <Button label="Still not fixed? Reopen it" kind="line" onPress={() => setOpen(true)} />;
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: brand.textPrimary }}>What is still wrong?</Text>
      <TextInput value={why} onChangeText={setWhy} multiline placeholder="e.g. The leak started again yesterday" placeholderTextColor={brand.textFaint}
        style={{ borderWidth: 1, borderColor: brand.border, borderRadius: 12, padding: 10, minHeight: 70, textAlignVertical: "top", color: brand.textPrimary, fontFamily: fonts.body.regular, fontSize: 13 }} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}><Button label="Cancel" kind="line" onPress={() => setOpen(false)} /></View>
        <View style={{ flex: 1 }}><Button label="Reopen" busy={send.isPending} onPress={() => (why.trim() ? send.mutate() : toast.error("Tell us what is still wrong"))} /></View>
      </View>
    </View>
  );
}

/** Rate how a resolved request was handled (1–5 stars, optional comment); can be changed later. */
function RateRequest({ t, onDone }: { t: Ticket; onDone: () => void }) {
  const brand = useBrand();
  const { appId } = useCustomer();
  const [stars, setStars] = useState(t.CustomerRating || 0);
  const [note, setNote] = useState(t.CustomerFeedback || "");
  const [editing, setEditing] = useState(!t.CustomerRating);
  const save = useMutation({
    mutationFn: () => portal.rateTicket(appId as number, t.Id, stars, note.trim()),
    onSuccess: () => { toast.success("Thank you for your feedback"); setEditing(false); onDone(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save it"),
  });
  const StarRow = ({ value, onPick }: { value: number; onPick?: (n: number) => void }) => (
    <View style={{ flexDirection: "row", gap: 6 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Tap key={n} disabled={!onPick} onPress={() => onPick?.(n)} accessibilityLabel={`${n} star${n > 1 ? "s" : ""}`} hitSlop={6}>
          <Star size={26} color={brand.gold} fill={n <= value ? brand.gold : "transparent"} />
        </Tap>
      ))}
    </View>
  );
  if (!editing) {
    return (
      <View style={{ gap: 6 }}>
        <Text style={{ fontSize: 12, fontFamily: fonts.body.semibold, color: brand.textSecondary }}>Your rating</Text>
        <StarRow value={t.CustomerRating || 0} />
        {t.CustomerFeedback ? <Muted>"{t.CustomerFeedback}"</Muted> : null}
        <Tap onPress={() => setEditing(true)} style={{ alignSelf: "flex-start", paddingVertical: 4 }}>
          <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: brand.gold }}>Change rating</Text>
        </Tap>
      </View>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: brand.textPrimary }}>How did we do?</Text>
      <StarRow value={stars} onPick={setStars} />
      <TextInput value={note} onChangeText={setNote} placeholder="Anything to add? (optional)" placeholderTextColor={brand.textFaint} multiline
        style={{ borderWidth: 1, borderColor: brand.border, borderRadius: 12, padding: 10, minHeight: 60, textAlignVertical: "top", color: brand.textPrimary, fontFamily: fonts.body.regular, fontSize: 13 }} />
      <Button label="Send rating" busy={save.isPending} onPress={() => (stars ? save.mutate() : toast.error("Tap a star to rate"))} />
    </View>
  );
}

export default function CustomerRequestsScreen() {
  const brand = useBrand();
  const inputStyle = {
    borderWidth: 1,
    borderColor: brand.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: brand.textPrimary,
    fontFamily: fonts.body.regular,
    fontSize: 13,
    backgroundColor: brand.surface,
  } as const;
  const qc = useQueryClient();
  const { appId, readOnly, timeline } = useCustomer();
  const lookedAfterBy = timeline.data?.booking?.LookedAfterBy;
  const list = useQuery({ queryKey: ["portal-tickets", appId], queryFn: () => portal.tickets(appId as number), enabled: appId != null });
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(TICKET_CATEGORIES[0]);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);

  const raise = useMutation({
    mutationFn: () => portal.raiseTicket(appId as number, { category, subject: subject.trim(), description: description.trim() || undefined }),
    onSuccess: (r) => {
      toast.success(`Sent — your request number is ${r.TicketNo}`);
      setOpen(false); setSubject(""); setDescription("");
      qc.invalidateQueries({ queryKey: ["portal-tickets", appId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not raise it"),
  });

  const openCount  = (list.data || []).filter((t) => t.Status !== "Resolved" && t.Status !== "Closed").length;
  const totalCount = (list.data || []).length;

  return (
    <Page onRefresh={() => list.refetch()}>

      {/* Stats strip */}
      {totalCount > 0 ? (
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1, borderRadius: 14, backgroundColor: brand.surfaceCard, borderWidth: 1, borderColor: brand.border, padding: 14, gap: 2 }}>
            <Text style={{ fontSize: 10, fontFamily: fonts.heading.semibold, letterSpacing: 0.8, textTransform: "uppercase", color: brand.textFaint }}>Total</Text>
            <Text style={{ fontSize: 24, fontFamily: fonts.heading.semibold, color: brand.textPrimary }}>{totalCount}</Text>
          </View>
          <View style={{ flex: 1, borderRadius: 14, backgroundColor: openCount > 0 ? brand.warningSoft : brand.successSoft, borderWidth: 1, borderColor: openCount > 0 ? brand.warning : brand.success, padding: 14, gap: 2 }}>
            <Text style={{ fontSize: 10, fontFamily: fonts.heading.semibold, letterSpacing: 0.8, textTransform: "uppercase", color: openCount > 0 ? brand.warning : brand.success }}>Open</Text>
            <Text style={{ fontSize: 24, fontFamily: fonts.heading.semibold, color: openCount > 0 ? brand.warning : brand.success }}>{openCount}</Text>
          </View>
        </View>
      ) : null}

      {lookedAfterBy ? <Muted>{lookedAfterBy} looks after your booking and will see every request you raise here.</Muted> : null}

      {/* Raise ticket CTA */}
      {!readOnly && !open ? (
        <Button label="Ask for help or report a problem" icon={Plus} onPress={() => setOpen(true)} />
      ) : null}

      {/* New ticket form */}
      {open ? (
        <Panel title="Ask for help" icon={Plus}>
          <Muted>Tell us what you need. Our team will reply here and you will get a notification.</Muted>

          <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, letterSpacing: 0.5, color: brand.textSecondary }}>What is it about?</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {TICKET_CATEGORIES.map((c) => {
              const on = c === category;
              return (
                <Tap key={c} onPress={() => setCategory(c)}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 100, borderWidth: 1.5,
                    backgroundColor: on ? brand.goldSoft : "transparent",
                    borderColor: on ? brand.gold : brand.border,
                  }}>
                  <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: on ? brand.gold : brand.textSecondary }}>{label(c)}</Text>
                </Tap>
              );
            })}
          </View>

          <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, letterSpacing: 0.5, color: brand.textSecondary }}>In one line</Text>
          <TextInput
            value={subject} onChangeText={setSubject}
            style={inputStyle} placeholderTextColor={brand.textFaint}
            placeholder="e.g. Water leak in the kitchen" maxLength={300}
          />

          <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, letterSpacing: 0.5, color: brand.textSecondary }}>Details (optional)</Text>
          <TextInput
            value={description} onChangeText={setDescription}
            placeholder="Anything that helps us understand" placeholderTextColor={brand.textFaint}
            multiline numberOfLines={4}
            style={[inputStyle, { minHeight: 96, textAlignVertical: "top" }]}
          />

          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}><Button label="Cancel" kind="line" onPress={() => setOpen(false)} /></View>
            <View style={{ flex: 1 }}>
              <Button label="Send" busy={raise.isPending}
                onPress={() => subject.trim() ? raise.mutate() : toast.error("Please write what it is about in one line")} />
            </View>
          </View>
        </Panel>
      ) : null}

      {/* Ticket list */}
      <Panel title="Your requests" icon={LifeBuoy}>
        {list.isLoading ? <Loading /> : list.error ? <ErrorText error={list.error} /> : !list.data?.length ? (
          <Muted>You have not asked for help yet. If something is wrong or you have a question, tap the button above.</Muted>
        ) : list.data.map((t, i) => {
          const shown = openId === t.Id;
          return (
            <View key={t.Id} style={{ gap: 10 }}>
              {i ? <Divider /> : null}
              <Tap onPress={() => setOpenId(shown ? null : t.Id)} accessibilityRole="button" accessibilityState={{ expanded: shown }}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 8, opacity: pressed ? 0.7 : 1 })}>
                <View style={{ flex: 1 }}>
                  <ListRow title={t.Subject} pill={<Pill label={label(t.Status)} />} sub={`${t.TicketNo} · ${label(t.Category)} · ${fmtDate(t.CreatedAt)}`} />
                </View>
                {shown ? <ChevronUp size={18} color={brand.textFaint} /> : <ChevronDown size={18} color={brand.textFaint} />}
              </Tap>
              {shown ? (
                <View style={{ gap: 8, padding: 12, borderRadius: 12, backgroundColor: brand.surface, borderWidth: 1, borderColor: brand.border }}>
                  {t.Description ? <Muted>{t.Description}</Muted> : null}
                  <Row label="Asked on" value={fmtDate(t.CreatedAt)} />
                  {!isDone(t) && t.SlaDueDate ? <Row label="We aim to sort it by" value={fmtDate(t.SlaDueDate)} /> : null}
                  {t.ResolvedAt ? <Row label="Resolved on" value={fmtDate(t.ResolvedAt)} tone={brand.success} /> : null}
                  {t.ResolutionNotes ? (
                    <View style={{ padding: 10, borderRadius: 10, backgroundColor: brand.successSoft, borderWidth: 1, borderColor: brand.success, gap: 2 }}>
                      <Text style={{ fontSize: 11, fontFamily: fonts.body.semibold, color: brand.success }}>{t.Status === "Reopened" ? "WHY IT WAS REOPENED" : "WHAT WE DID"}</Text>
                      <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: brand.success }}>{t.ResolutionNotes}</Text>
                    </View>
                  ) : !isDone(t) ? <Muted>Our team is on it. You'll get a notification when there's an update.</Muted> : null}
                  {isDone(t) && !readOnly ? <RateRequest t={t} onDone={() => qc.invalidateQueries({ queryKey: ["portal-tickets", appId] })} /> : null}
                  {isDone(t) && !readOnly ? <ReopenRequest t={t} onDone={() => qc.invalidateQueries({ queryKey: ["portal-tickets", appId] })} /> : null}
                </View>
              ) : null}
            </View>
          );
        })}
      </Panel>
    </Page>
  );
}

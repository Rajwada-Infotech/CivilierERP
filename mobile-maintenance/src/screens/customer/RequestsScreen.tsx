// Support Tickets — premium redesign. Same logic as before.
import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LifeBuoy, Plus } from "lucide-react-native";
import { useBrand } from "@/theme/ThemeContext";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { portal, TICKET_CATEGORIES } from "@/api/customerPortalApi";
import { useCustomer } from "@/customer/CustomerContext";
import { Button, Divider, ErrorText, ListRow, Loading, Muted, Page, Panel, Pill, fmtDate, Tap } from "@/customer/ui";

const label = (c: string) => c.replace(/([A-Z])/g, " $1").trim();

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
  const { appId, readOnly } = useCustomer();
  const list = useQuery({ queryKey: ["portal-tickets", appId], queryFn: () => portal.tickets(appId as number), enabled: appId != null });
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(TICKET_CATEGORIES[0]);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");

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
        ) : list.data.map((t, i) => (
          <View key={t.Id}>
            {i ? <Divider /> : null}
            <ListRow
              title={t.Subject}
              pill={<Pill label={t.Status} />}
              sub={`${t.TicketNo} · ${label(t.Category)} · ${fmtDate(t.CreatedAt)}`}
            />
            {t.ResolutionNotes ? (
              <View style={{ marginTop: 6, padding: 10, borderRadius: 10, backgroundColor: brand.successSoft, borderWidth: 1, borderColor: brand.success }}>
                <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: brand.success }}>{t.ResolutionNotes}</Text>
              </View>
            ) : null}
          </View>
        ))}
      </Panel>
    </Page>
  );
}

import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Mail, MessageCircle, MessageSquare, RefreshCw, Send, Settings2, type LucideIcon } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { getMessagingStatus, sendMessagingTest, type MessagingChannel, type MessagingStatus } from "@/api/communicatorConfigApi";
import { FIELD, HEAD, KEY_INK, KEY_LINE, LBL, RULE, TAG } from "./integrations/styles";
import { ConnectionsSection } from "./integrations/ConnectionsSection";
import { PartnerKeysSection } from "./integrations/PartnerKeysSection";

const CHANNELS: Record<MessagingChannel, { label: string; Icon: LucideIcon; setup: string; fromLabel: string; testLabel: string; placeholder: string }> = {
  email: { label: "Email", Icon: Mail, setup: "/admin/communicator/email-setup", fromLabel: "Sends from", testLabel: "Test to email", placeholder: "you@company.com" },
  sms: { label: "SMS", Icon: MessageSquare, setup: "/admin/communicator/sms-setup", fromLabel: "Sender ID", testLabel: "Test to mobile", placeholder: "98765 43210" },
  whatsapp: { label: "WhatsApp", Icon: MessageCircle, setup: "/admin/communicator/whatsapp-setup", fromLabel: "Phone number ID", testLabel: "Test to mobile", placeholder: "98765 43210" },
};

const FIELD_NAMES: Record<string, string> = {
  smtpHost: "SMTP host", smtpPort: "SMTP port", fromEmail: "from address",
  apiUrl: "API URL", apiKey: "API key", senderId: "sender ID",
  accessToken: "access token", phoneNumberId: "phone number ID",
};

const ChannelCard: React.FC<{ s: MessagingStatus; canTest: boolean }> = ({ s, canTest }) => {
  const meta = CHANNELS[s.channel];
  const [to, setTo] = useState("");
  const test = useMutation({ mutationFn: () => sendMessagingTest(s.channel, to.trim()) });
  const ready = s.saved && s.missing.length === 0;
  const sending = ready && s.active;

  return (
    <div className={`bg-card flex flex-col border ${sending ? "border-foreground" : "border-dashed border-foreground/50"}`}>
      <div className="flex items-start justify-between gap-3 px-4 py-3" style={{ borderBottom: "1px solid hsl(var(--foreground) / 0.2)" }}>
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-8 h-8 flex items-center justify-center border border-foreground shrink-0"><meta.Icon size={15} /></span>
          <div className="min-w-0">
            <p className="font-heading text-base font-bold tracking-tight text-foreground">{meta.label}</p>
            <p className="text-xs text-muted-foreground truncate">{s.provider || "No provider named"}</p>
          </div>
        </div>
        {sending ? <SheetMark text="Sending" tone="done" /> : ready ? <SheetMark text="Switched off" tone="waiting" /> : <span className={`${TAG} text-muted-foreground border-foreground/40`}>Not set up</span>}
      </div>

      <div className="px-4 py-3 space-y-2.5 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className={LBL}>{meta.fromLabel}</span>
          <span className="text-sm text-foreground truncate">{s.from || "—"}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className={LBL}>Last saved</span>
          <span className="text-sm text-foreground tabular-nums">{s.updatedAt ? new Date(s.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"}</span>
        </div>
        {s.saved && s.missing.length > 0 && (
          <p className="text-xs text-destructive">Missing {s.missing.map((k) => FIELD_NAMES[k] || k).join(", ")}.</p>
        )}
        {ready && !s.active && <p className="text-xs text-muted-foreground">Set up, but its Active switch is off — nothing is sent automatically.</p>}
      </div>

      <div className="px-4 py-3 space-y-2" style={{ borderTop: "1px solid hsl(var(--foreground) / 0.2)" }}>
        {canTest && (
          <>
            <label className={`${LBL} block`} htmlFor={`test-${s.channel}`}>{meta.testLabel}</label>
            <div className="flex gap-2">
              <input
                id={`test-${s.channel}`}
                className={FIELD}
                value={to}
                placeholder={meta.placeholder}
                inputMode={s.channel === "email" ? "email" : "tel"}
                onChange={(e) => { setTo(e.target.value); test.reset(); }}
                onKeyDown={(e) => e.key === "Enter" && ready && to.trim() && !test.isPending && test.mutate()}
                disabled={!ready}
              />
              <button type="button" className={`${KEY_INK} h-9 px-3 shrink-0`} disabled={!ready || !to.trim() || test.isPending} onClick={() => test.mutate()}>
                {test.isPending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Send test
              </button>
            </div>
            {test.isSuccess && <SheetMark text={`Handed to the provider — check ${to.trim()}`} tone="done" />}
            {test.isError && <p className="text-xs text-destructive break-words">{(test.error as Error).message}</p>}
          </>
        )}
        <Link to={meta.setup} className={`${KEY_LINE} h-9 px-3 w-full`}>
          <Settings2 size={12} /> {s.saved ? "Settings" : "Set up"}
        </Link>
      </div>
    </div>
  );
};

export default function ApiIntegrationPage() {
  const rights = usePageRights("api-integration");
  const { data: channels = [], isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["communicator-messaging-status"],
    queryFn: getMessagingStatus,
  });

  const ready = channels.filter((c) => c.saved && c.missing.length === 0);
  const sending = ready.filter((c) => c.active);

  return (
    <>
      <Breadcrumbs items={["Admin", "Integrations"]} />
      <SheetShell
        eyebrow="CivilierERP · Admin"
        title="Integrations"
        subtitle="Every outside service CivilierERP talks to: the SMS, WhatsApp and email providers that message customers and leads, the Meta and Google logins Sales Automation runs ads through, and the keys channel partners use to send leads in."
        action={
          <button type="button" onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 px-3`}>
            <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} /> Re-read
          </button>
        }
      >
        <div className="bg-card" style={{ border: RULE }}>
          <div className="statrow" style={{ padding: "16px 16px 18px" }}>
            {[
              { label: "Sending", value: sending.length, note: "set up and switched on" },
              { label: "Switched off", value: ready.length - sending.length, note: "set up, sending nothing" },
              { label: "Not set up", value: channels.length - ready.length, note: "settings missing" },
            ].map((x) => (
              <div key={x.label}>
                <p className="label">{x.label}</p>
                <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value}</p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card" style={{ border: RULE }}>
          <div className="px-4 py-3" style={{ borderBottom: RULE }}>
            <span className={HEAD}>Messaging channels</span>
          </div>
          <div className="p-4">
            {isError ? (
              <p className="text-sm text-destructive">Could not read the channels. Use Re-read to try again.</p>
            ) : isLoading ? (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                {[0, 1, 2].map((i) => <div key={i} className="h-64 border border-dashed border-foreground/30 animate-pulse" />)}
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                {channels.map((s) => <ChannelCard key={s.channel} s={s} canTest={rights.canEdit} />)}
              </div>
            )}
          </div>
        </div>

        <ConnectionsSection />
        <PartnerKeysSection canEdit={rights.canEdit} />
      </SheetShell>
    </>
  );
}

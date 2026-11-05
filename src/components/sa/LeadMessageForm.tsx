import React, { useState } from "react";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { translateError } from "@/lib/translateError";
import { useSaMessagingStatus, useSendLeadMessage, type LeadMessageChannel } from "@/hooks/useLeadActivities";

interface LeadMessageFormProps {
  leadId: number | null;
  /** The lead's own mobile / email — a channel the lead has no address for can't be picked. */
  mobile?: string | null;
  email?: string | null;
}

/** Sends an SMS / WhatsApp / Email to the lead's customer through the providers
 * set up in Admin → Integrations. A channel that isn't set up shows a note
 * instead of being offered. */
export const LeadMessageForm: React.FC<LeadMessageFormProps> = ({ leadId, mobile, email }) => {
  const { data: channels = [], isLoading, isError } = useSaMessagingStatus();
  const { sendMessage, sending } = useSendLeadMessage();
  const [channel, setChannel] = useState<LeadMessageChannel | "">("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");

  const hasAddress = (c: LeadMessageChannel) => (c === "Email" ? !!email?.trim() : !!mobile?.trim());
  const ready = channels.filter((c) => c.ready);
  const notReady = channels.filter((c) => !c.ready);
  const picked = channel || ready.find((c) => hasAddress(c.type))?.type || "";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leadId || !picked) return;
    if (!text.trim()) return toast.error("Write the message first");
    if (picked === "Email" && !subject.trim()) return toast.error("An email needs a subject");
    try {
      await sendMessage(leadId, { channel: picked, subject: subject.trim() || undefined, text: text.trim() });
      toast.success(`${picked} sent — recorded in the lead's history`);
      setText("");
      setSubject("");
    } catch (err: any) {
      toast.error(translateError(err.message));
    }
  };

  if (isLoading) return <p className="text-xs text-muted-foreground">Checking messaging channels…</p>;
  if (isError) return <p className="text-xs text-destructive">Could not read the messaging channels.</p>;

  return (
    <div className="space-y-3">
      {notReady.length > 0 && (
        <p className="text-xs rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-3 py-2">
          {notReady.map((c) => c.type).join(", ")} {notReady.length === 1 ? "is" : "are"} not set up
          {notReady.some((c) => c.saved && !c.active) ? " or switched off" : ""} — ask an admin to set {notReady.length === 1 ? "it" : "them"} up in Admin → Integrations.
        </p>
      )}

      {ready.length > 0 && (
        <form onSubmit={submit} className="space-y-3">
          <div className="flex gap-1.5 flex-wrap" role="radiogroup" aria-label="Send by">
            {ready.map((c) => {
              const usable = hasAddress(c.type);
              return (
                <button key={c.type} type="button" role="radio" aria-checked={picked === c.type} disabled={!usable}
                  title={usable ? undefined : `This lead has no ${c.type === "Email" ? "email address" : "mobile number"}`}
                  onClick={() => setChannel(c.type)}
                  className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    picked === c.type ? "btn-module text-white border-transparent" : "border-border text-muted-foreground hover:bg-muted"
                  }`}>
                  {c.type}
                </button>
              );
            })}
          </div>
          {picked === "Email" && (
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject"
              className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
          )}
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3}
            placeholder={picked ? `Message to send by ${picked}` : "This lead has no mobile or email for the channels that are set up"}
            disabled={!picked}
            className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none disabled:opacity-50" />
          <button type="submit" disabled={sending || !picked || !text.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 btn-module text-white text-sm font-medium rounded-lg disabled:opacity-40 transition-colors">
            <Send size={13} /> {sending ? "Sending..." : picked ? `Send ${picked}` : "Send"}
          </button>
        </form>
      )}
    </div>
  );
};

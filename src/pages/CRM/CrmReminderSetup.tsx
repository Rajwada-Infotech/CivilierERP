// CRM → Setup → Reminder Setup: who is reminded about what, when and how (migration 700). Every rule, recipient,
// channel and message is a database row edited here; the server engine (services/crmReminderEngine.js) sends them
// hourly and logs each send. Sections, stacked: the rules, day-by-day counts, paused bookings, the send log.
import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BellRing, CheckCircle2, ChevronDown, Clock3, Pause, Pencil, Play, Plus, RefreshCw, Smartphone, UsersRound } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { SearchableSelect } from "@/components/SearchableSelect";
import { DateInput } from "@/components/ui/date-input";
import { GridDialog, GridFormField, GridFormSection, GRID_BTN, GRID_BTN_BRAND, GRID_INPUT } from "@/components/crm/CrmDataTable";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { cn } from "@/lib/utils";
import { KEY_LINE, LBL, RULE, RULE_SOFT } from "./customers/config";

const API = "/api/crm/reminders";
const PAGE_KEY = "crm-reminder-setup";
const NUM = "font-heading tabular-nums";

type Situation = { key: string; label: string; description: string; starts: string[]; fields: string[] };
type Ready = Record<string, { ready: boolean; missing: string[]; saved: boolean; active: boolean }>;
type Meta = { situations: Situation[]; channels: Record<"Staff" | "Customer", string[]>; stages: string[]; limits: { offset: number; repeat: number; max: number; escalate: number }; ready?: Ready };
type Check = {
  pending: number; due: number; toSend: number; alreadySent: number; bookings: number; byChannel: Record<string, number>; withinHours: boolean;
  hours: { from: string | null; until: string | null };
  samples: { bookingNo: string; customer: string; stage: string; occurrence: number; audience: string; channel: string; recipient: string; title: string | null; body: string }[];
};
type Options = { roles: { id: number; name: string; users: number }[]; users: { id: number; name: string; role: string | null }[]; projects: { id: number; name: string }[] };
type Recipient = { Stage: string; RoleId: number | null; UserId: number | null; RoleName?: string; UserName?: string; ActiveUsers?: number | null; UserActive?: boolean | null };
type Channel = { Audience: "Staff" | "Customer"; Channel: string; Title: string | null; Body: string; TemplateName: string | null; TemplateLanguage: string | null; IsActive: boolean };
type Rule = {
  Id: number; Name: string; Situation: string; SituationLabel: string; ProjectId: number | null; ProjectName: string | null; StartFrom: string; OffsetDays: number;
  RepeatEveryDays: number | null; MaxTimes: number | null; EscalateAfterDays: number | null; NotifyBookingOwner: boolean; Notes: string | null; IsActive: boolean;
  SendFrom: string | null; SendUntil: string | null; Recipients: Recipient[]; Channels: Channel[]; Activity: { Sends30: number; Sent30: number; LastSentAt: string | null };
};

// How each start and channel reads on screen.
const START_LABEL: Record<string, string> = { BookingDate: "booking date", DueDate: "due date", DemandDate: "demand date" };
const CHANNEL_LABEL: Record<string, string> = { Bell: "Staff bell and phone", App: "Customer app", Portal: "Customer portal", SMS: "SMS", WhatsApp: "WhatsApp", Email: "E-mail" };
const HAS_TITLE = new Set(["Bell", "App", "Portal", "Email"]);
const STATUS_TONE: Record<string, "done" | "waiting" | "stopped" | "draft"> = { Sent: "done", NotSent: "draft", Failed: "stopped", Pending: "waiting" };
const STATUS_LABEL: Record<string, string> = { Sent: "Sent", NotSent: "Not sent", Failed: "Failed", Pending: "Sending" };

const getJson = async (url: string) => {
  const r = await fetchWithAuth(url);
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.error || `Could not load (${r.status}).`);
  return d;
};
const send = async (url: string, method: string, body?: unknown) => {
  const r = await fetchWithAuth(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
  return d;
};
const fmtDay = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const fmtTime = (d?: string | null) => (d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

/** "7 days after the booking date, then every 7 days (at most 3 times)". */
function describeWhen(r: Pick<Rule, "OffsetDays" | "StartFrom" | "RepeatEveryDays" | "MaxTimes">) {
  const start = START_LABEL[r.StartFrom] || r.StartFrom;
  const first = r.OffsetDays === 0 ? `On the ${start}` : `${Math.abs(r.OffsetDays)} day${Math.abs(r.OffsetDays) === 1 ? "" : "s"} ${r.OffsetDays > 0 ? "after" : "before"} the ${start}`;
  const every = r.RepeatEveryDays === 1 ? "every day" : `every ${r.RepeatEveryDays} days`;
  const repeat = r.RepeatEveryDays ? `, then ${every}${r.MaxTimes ? ` (at most ${r.MaxTimes} times)` : " while pending"}` : ", once";
  return first + repeat;
}

/** "Sends 10:00 to 19:00" — null when the rule sends at any time. */
function describeHours(from?: string | null, until?: string | null) {
  if (!from && !until) return null;
  if (from && until) return `Sends ${from} to ${until}`;
  return from ? `Sends from ${from}` : `Sends until ${until}`;
}

// What a rule would send if it ran now (nothing is sent to show this).
const CheckPanel: React.FC<{ c: Check }> = ({ c }) => (
  <div className="space-y-2 text-xs">
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {[["Would send now", c.toSend], ["Bookings", c.bookings], ["Still pending", c.pending], ["Already sent", c.alreadySent]].map(([label, v]) => (
        <div key={String(label)} className="rounded-md px-3 py-2" style={{ border: RULE_SOFT }}><p className={LBL}>{label}</p><p className={cn(NUM, "text-base font-semibold")}>{Number(v).toLocaleString("en-IN")}</p></div>
      ))}
    </div>
    {c.toSend === 0 && <p className="text-muted-foreground">Nothing is due right now.</p>}
    {!c.withinHours && c.toSend > 0 && <p className="text-amber-700 dark:text-amber-400">Outside the send hours ({describeHours(c.hours.from, c.hours.until)}): these go out when the hours open.</p>}
    {Object.keys(c.byChannel).length > 0 && <p className="text-muted-foreground">{Object.entries(c.byChannel).map(([k, n]) => `${CHANNEL_LABEL[k.split(":")[1]] || k}: ${n}`).join(" · ")}</p>}
    {c.samples.length > 0 && (
      <div className="max-h-56 overflow-y-auto rounded-md" style={{ border: RULE_SOFT }}>
        {c.samples.map((x, i) => (
          <div key={i} className="px-3 py-1.5" style={{ borderBottom: RULE_SOFT }}>
            <p><span className={cn(NUM, "font-semibold")}>{x.bookingNo}</span> · {x.customer} · {CHANNEL_LABEL[x.channel] || x.channel} · {x.stage === "Escalate" ? "Escalation" : `Reminder ${x.occurrence}`}</p>
            {x.title && <p className="font-medium">{x.title}</p>}<p className="text-muted-foreground">{x.body}</p>
          </div>
        ))}
      </div>
    )}
  </div>
);

const Section: React.FC<{ title: string; note?: string; action?: React.ReactNode; children: React.ReactNode }> = ({ title, note, action, children }) => (
  <section className="bg-card" style={{ border: RULE }}>
    <div className="flex flex-wrap items-end justify-between gap-3 px-4 py-3" style={{ borderBottom: RULE_SOFT }}>
      <div className="min-w-0"><h2 className="text-sm font-semibold">{title}</h2>{note && <p className="text-xs text-muted-foreground mt-0.5">{note}</p>}</div>
      {action}
    </div>
    {children}
  </section>
);
const Th: React.FC<{ children?: React.ReactNode; right?: boolean }> = ({ children, right }) => <th className={cn(LBL, "px-3 py-2 font-semibold whitespace-nowrap", right ? "text-right" : "text-left")}>{children}</th>;
const Empty: React.FC<{ cols: number; text: string }> = ({ cols, text }) => <tr><td colSpan={cols} className="px-3 py-6 text-center text-xs text-muted-foreground">{text}</td></tr>;

/** What would stop this plan reaching people, in plain words (empty = nothing). A staff-only or customer-only plan is
 * fine; a role with nobody in it, a user who has left or a message channel that isn't set up is not. */
function reminderHealth(rule: Rule, ready?: Ready): string[] {
  const out: string[] = [];
  const staffOn = rule.Channels.some((x) => x.Audience === "Staff" && x.IsActive);
  const customerOn = rule.Channels.filter((x) => x.Audience === "Customer" && x.IsActive);
  if (!staffOn && !customerOn.length) out.push("Nobody receives this plan: turn on a staff or customer channel.");
  if (staffOn && !rule.NotifyBookingOwner && !rule.Recipients.some((x) => x.Stage === "Remind")) out.push("Choose who in your team is told.");
  for (const r of rule.Recipients) {
    if (r.RoleId != null && r.ActiveUsers === 0) out.push(`The ${r.RoleName} role has no active users, so nobody in it is told.`);
    if (r.UserId != null && r.UserActive === false) out.push(`${r.UserName} is no longer an active user.`);
  }
  for (const c of customerOn) if (ready?.[c.Channel] && !ready[c.Channel].ready) out.push(`${CHANNEL_LABEL[c.Channel] || c.Channel} isn't set up in Communicator, so it won't reach the customer.`);
  return [...new Set(out)];
}

function recipientSummary(rule: Rule) {
  const selected = rule.Recipients.filter((x) => x.Stage === "Remind").map((x) => x.RoleName ? `${x.RoleName} role` : x.UserName).filter(Boolean);
  return [rule.NotifyBookingOwner ? "Booking salesperson" : null, ...selected].filter(Boolean).join(", ") || "No staff recipient";
}

/** A live, read-only answer for the card: no sends, no cached guesses. */
const PlanStatus: React.FC<{ rule: Rule; issues: string[] }> = ({ rule, issues }) => <>
  {issues.length > 0 && <ul className="mt-3 space-y-1 rounded bg-amber-500/10 px-2.5 py-2 text-xs text-amber-800 dark:text-amber-300">{issues.map((x) => <li key={x}>{x}</li>)}</ul>}
  <PlanState rule={rule} />
</>;
const PlanState: React.FC<{ rule: Rule }> = ({ rule }) => {
  const q = useQuery<Check>({ queryKey: [PAGE_KEY, "plan-status", rule.Id], queryFn: () => send(`${API}/check`, "POST", { ruleId: rule.Id }), enabled: !!rule.IsActive, staleTime: 60_000 });
  if (!rule.IsActive) return <p className="mt-3 text-xs text-muted-foreground">This plan is saved but switched off.</p>;
  if (q.isLoading) return <p className="mt-3 text-xs text-muted-foreground">Checking current reminders…</p>;
  if (q.isError) return <p className="mt-3 text-xs text-muted-foreground">Open “Check now” to view the current delivery status.</p>;
  if (!q.data?.pending) return <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400"><CheckCircle2 size={13} /> No customer action is pending</p>;
  if (!q.data.withinHours) return <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">{q.data.toSend} {q.data.toSend === 1 ? "delivery" : "deliveries"} waiting for the configured send hours</p>;
  if (q.data.toSend) return <p className="mt-3 text-xs font-medium text-primary">{q.data.toSend} {q.data.toSend === 1 ? "delivery" : "deliveries"} due now for {q.data.bookings} booking{q.data.bookings === 1 ? "" : "s"}</p>;
  return <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400"><CheckCircle2 size={13} /> {q.data.pending} pending item{q.data.pending === 1 ? "" : "s"}; nothing due right now</p>;
};

const PlanHistory: React.FC<{ ruleId: number; canEdit: boolean }> = ({ ruleId, canEdit }) => {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const [restoring, setRestoring] = useState<number | null>(null);
  const q = useQuery<{ rows: { Id: number; Action: string; Detail: string | null; ChangedAt: string; ChangedByName: string | null; HasSnapshot: boolean }[] }>({
    queryKey: [PAGE_KEY, "history", ruleId], queryFn: () => getJson(`${API}/rules/${ruleId}/history`), enabled: open, staleTime: 30_000,
  });
  const restore = async (id: number) => {
    if (!window.confirm("Restore this saved reminder plan? It will be switched off and must be previewed again before it can send.")) return;
    setRestoring(id);
    try { await send(`${API}/rules/${ruleId}/restore/${id}`, "POST"); toast.success("Previous plan restored. Review it and preview before switching it on."); qc.invalidateQueries({ queryKey: [PAGE_KEY] }); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setRestoring(null); }
  };
  return <details className="mt-3 text-xs" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
    <summary className="cursor-pointer text-muted-foreground">Change history</summary>
    <div className="mt-2 space-y-1.5 border-l border-border pl-3">
      {q.isLoading && <p className="text-muted-foreground">Loading history…</p>}
      {q.isError && <p className="text-destructive">Could not load change history.</p>}
      {q.data?.rows.map((x) => <div key={x.Id} className="flex flex-wrap items-center gap-x-1 gap-y-1"><p><span className="font-medium">{x.Action}</span>{x.Detail ? ` — ${x.Detail}` : ""}<span className="text-muted-foreground"> · {x.ChangedByName || "System"} · {fmtTime(x.ChangedAt)}</span></p>{canEdit && x.HasSnapshot && <button type="button" disabled={restoring != null} onClick={() => restore(x.Id)} className={`${KEY_LINE} h-6 px-1.5 text-[0.6875rem]`}>{restoring === x.Id ? "Restoring…" : "Restore this version"}</button>}</div>)}
      {q.data && !q.data.rows.length && <p className="text-muted-foreground">No change history yet.</p>}
    </div>
  </details>;
};

// ── Rule dialog ──────────────────────────────────────────────────────────────────────────────────────────────────
type Form = {
  Name: string; Situation: string; ProjectId: string; StartFrom: string; OffsetDays: string; RepeatEveryDays: string; MaxTimes: string;
  EscalateAfterDays: string; NotifyBookingOwner: boolean; Notes: string; IsActive: boolean; Recipients: Recipient[]; Channels: Record<string, Channel>;
  SendFrom: string; SendUntil: string;
};
const chKey = (a: string, c: string) => `${a}:${c}`;
function toForm(meta: Meta, r?: Rule, duplicate = false): Form {
  const channels: Record<string, Channel> = {};
  for (const [aud, list] of Object.entries(meta.channels)) for (const c of list) {
    const found = r?.Channels.find((x) => x.Audience === aud && x.Channel === c);
    channels[chKey(aud, c)] = found ? { ...found, IsActive: !!found.IsActive } : { Audience: aud as Channel["Audience"], Channel: c, Title: "", Body: "", TemplateName: "", TemplateLanguage: "", IsActive: false };
  }
  const sit = meta.situations.find((s) => s.key === r?.Situation) || meta.situations[0];
  return {
    Name: r ? (duplicate ? `${r.Name} - copy` : r.Name) : "", Situation: sit?.key || "", ProjectId: r?.ProjectId ? String(r.ProjectId) : "", StartFrom: r?.StartFrom || sit?.starts[0] || "",
    OffsetDays: String(r?.OffsetDays ?? 0), RepeatEveryDays: r?.RepeatEveryDays ? String(r.RepeatEveryDays) : "", MaxTimes: r?.MaxTimes ? String(r.MaxTimes) : "",
    EscalateAfterDays: r?.EscalateAfterDays != null ? String(r.EscalateAfterDays) : "", NotifyBookingOwner: r ? !!r.NotifyBookingOwner : true,
    SendFrom: r?.SendFrom || "", SendUntil: r?.SendUntil || "",
    Notes: r?.Notes || "", IsActive: duplicate ? false : r ? !!r.IsActive : false, Recipients: r?.Recipients.map((x) => ({ Stage: x.Stage, RoleId: x.RoleId, UserId: x.UserId })) || [], Channels: channels,
  };
}

type Saved = { Id: number; Name: string; requiresPreview: boolean };
const RuleDialog: React.FC<{ meta: Meta; options: Options; rule?: Rule; duplicate?: boolean; onClose: () => void; onSaved: (saved: Saved) => void }> = ({ meta, options, rule, duplicate = false, onClose, onSaved }) => {
  const [f, setF] = useState<Form>(() => toForm(meta, rule, duplicate));
  const [saving, setSaving] = useState(false);
  const sit = meta.situations.find((s) => s.key === f.Situation);
  const set = (p: Partial<Form>) => { setCheck(null); setF((x) => ({ ...x, ...p })); };
  const setCh = (k: string, p: Partial<Channel>) => { setCheck(null); setF((x) => ({ ...x, Channels: { ...x.Channels, [k]: { ...x.Channels[k], ...p } } })); };
  const addRecipient = (stage: string, kind: "RoleId" | "UserId", id: string) => {
    if (!id) return;
    const n = Number(id);
    if (f.Recipients.some((r) => r.Stage === stage && r[kind] === n)) return;
    set({ Recipients: [...f.Recipients, { Stage: stage, RoleId: kind === "RoleId" ? n : null, UserId: kind === "UserId" ? n : null }] });
  };
  const roleOf = (id: number | null) => options.roles.find((x) => x.id === id);
  const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
  const nameOf = (r: Recipient) => (r.RoleId ? `${roleOf(r.RoleId)?.name ?? `Role ${r.RoleId}`} (role · ${people(roleOf(r.RoleId)?.users ?? 0)})` : options.users.find((x) => x.id === r.UserId)?.name ?? `User ${r.UserId}`);

  const [check, setCheck] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
  const body = () => ({
    Name: f.Name, Situation: f.Situation, ProjectId: f.ProjectId || null, StartFrom: f.StartFrom, OffsetDays: Number(f.OffsetDays || 0),
    RepeatEveryDays: f.RepeatEveryDays || null, MaxTimes: f.MaxTimes || null, EscalateAfterDays: f.EscalateAfterDays === "" ? null : f.EscalateAfterDays,
    NotifyBookingOwner: f.NotifyBookingOwner, Notes: f.Notes, IsActive: f.IsActive, Recipients: f.Recipients, SendFrom: f.SendFrom, SendUntil: f.SendUntil,
    // A channel switched off keeps its wording for later.
    Channels: Object.values(f.Channels).filter((c) => c.IsActive || c.Body.trim()),
  });
  // Check first: what this reminder, as typed, would send now — on real bookings, sending nothing.
  const runCheck = async () => {
    setChecking(true);
    try { setCheck(await send(`${API}/check`, "POST", { ...body(), Id: rule?.Id ?? null })); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setChecking(false); }
  };
  const save = async () => {
    setSaving(true);
    try {
      // The server saves every new or changed plan switched off; switching it on goes through the check of its saved
      // form (the next dialog), so a plan never starts sending unseen.
      const editing = !!rule && !duplicate;
      const d = editing ? await send(`${API}/rules/${rule!.Id}`, "PUT", body()) : await send(`${API}/rules`, "POST", body());
      toast.success(editing ? "Reminder updated" : "Reminder created");
      onSaved({ Id: editing ? rule!.Id : d.id, Name: f.Name.trim(), requiresPreview: !!d.requiresPreview });
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const recipientList = (stage: string) => (
    <div className="flex flex-wrap gap-1.5">
      {f.Recipients.filter((r) => r.Stage === stage).map((r, i) => (
        <span key={i} className={cn("inline-flex items-center gap-1 h-6 px-2 rounded-full border text-xs", r.RoleId != null && !roleOf(r.RoleId)?.users ? "border-amber-500 text-amber-700 dark:text-amber-400" : "border-border")}>
          {nameOf(r)}
          <button type="button" aria-label="Remove" className="text-muted-foreground hover:text-destructive" onClick={() => set({ Recipients: f.Recipients.filter((x) => x !== r) })}>×</button>
        </span>
      ))}
      {!f.Recipients.some((r) => r.Stage === stage) && <span className="text-xs text-muted-foreground">No one chosen.</span>}
    </div>
  );
  const roleOptions = options.roles.map((r) => ({ value: String(r.id), label: `${r.name} · ${people(r.users)}` }));
  const userOptions = options.users.map((u) => ({ value: String(u.id), label: u.role ? `${u.name} · ${u.role}` : u.name }));

  return (
    <GridDialog onClose={onClose} icon={BellRing} width="max-w-5xl" title={rule && !duplicate ? `Set up: ${rule.Name}` : duplicate ? `Use ${rule?.Name} as a template` : "Create a reminder"}
      description="Complete these four simple choices. The system checks live booking and payment data before sending anything."
      footer={<><button type="button" onClick={onClose} className={GRID_BTN}>Cancel</button><button type="button" onClick={runCheck} disabled={checking} className={GRID_BTN} title="See what it would send now, on real bookings — nothing is sent">{checking ? "Checking…" : "Check First"}</button><button type="button" onClick={save} disabled={saving} className={GRID_BTN_BRAND}>{saving ? "Saving…" : rule ? "Save Changes" : "Create Reminder"}</button></>}>
      <GridFormSection title="1. What needs a reminder?">
        <GridFormField label="Reminder name" required hint="A clear internal name, for example: Booking payment follow-up."><input className={GRID_INPUT} value={f.Name} onChange={(e) => set({ Name: e.target.value })} placeholder="e.g. Booking payment follow-up" /></GridFormField>
        <GridFormField label="Reminder type" required hint={sit?.description}>
          <select className={GRID_INPUT} value={f.Situation} onChange={(e) => { const s = meta.situations.find((x) => x.key === e.target.value); set({ Situation: e.target.value, StartFrom: s?.starts[0] || "" }); }}>
            {meta.situations.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </GridFormField>
      </GridFormSection>

      <GridFormSection title="2. When should it go out?">
        <GridFormField label="Start counting from" required>
          <select className={GRID_INPUT} value={f.StartFrom} onChange={(e) => set({ StartFrom: e.target.value })}>
            {(sit?.starts || []).map((s) => <option key={s} value={s}>The {START_LABEL[s] || s}</option>)}
          </select>
        </GridFormField>
        <GridFormField label="Send the first reminder after" required hint="Use a negative value only if you need a reminder before a due date.">
          <input type="number" className={cn(GRID_INPUT, NUM)} value={f.OffsetDays} onChange={(e) => set({ OffsetDays: e.target.value })} />
        </GridFormField>
        <GridFormField label="Repeat interval (days)" hint="Leave blank to send once only.">
          <input type="number" min={1} className={cn(GRID_INPUT, NUM)} value={f.RepeatEveryDays} onChange={(e) => set({ RepeatEveryDays: e.target.value })} />
        </GridFormField>
        <GridFormField label="Send from" hint="India time. Blank = any time.">
          <input type="time" className={cn(GRID_INPUT, NUM)} value={f.SendFrom} onChange={(e) => set({ SendFrom: e.target.value })} />
        </GridFormField>
        <GridFormField label="Send until" hint="Outside these hours, reminders wait for the next opening.">
          <input type="time" className={cn(GRID_INPUT, NUM)} value={f.SendUntil} onChange={(e) => set({ SendUntil: e.target.value })} />
        </GridFormField>
        <GridFormField label="Your reminder plan" wide><p className="text-xs font-medium">{describeWhen({ OffsetDays: Number(f.OffsetDays || 0), StartFrom: f.StartFrom, RepeatEveryDays: f.RepeatEveryDays ? Number(f.RepeatEveryDays) : null, MaxTimes: f.MaxTimes ? Number(f.MaxTimes) : null })}.{describeHours(f.SendFrom, f.SendUntil) ? ` ${describeHours(f.SendFrom, f.SendUntil)}.` : ""}</p></GridFormField>
      </GridFormSection>

      <GridFormSection title="3. Who in your team should know?">
        <GridFormField label="At each reminder" wide>
          <label className="flex items-center gap-2 text-xs mb-2"><input type="checkbox" checked={f.NotifyBookingOwner} onChange={(e) => set({ NotifyBookingOwner: e.target.checked })} /> The booking's salesperson</label>
          {recipientList("Remind")}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            <SearchableSelect value="" onChange={(v: string) => addRecipient("Remind", "RoleId", v)} placeholder="Add a role (all its users)" searchPlaceholder="Search roles…" options={roleOptions} />
            <SearchableSelect value="" onChange={(v: string) => addRecipient("Remind", "UserId", v)} placeholder="Add a user" searchPlaceholder="Search users…" options={userOptions} />
          </div>
        </GridFormField>
        <GridFormField label="Escalation (optional)" hint="Only needed when a missed payment needs management attention." wide>
          {recipientList("Escalate")}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            <SearchableSelect value="" onChange={(v: string) => addRecipient("Escalate", "RoleId", v)} placeholder="Add a role (all its users)" searchPlaceholder="Search roles…" options={roleOptions} />
            <SearchableSelect value="" onChange={(v: string) => addRecipient("Escalate", "UserId", v)} placeholder="Add a user" searchPlaceholder="Search users…" options={userOptions} />
          </div>
        </GridFormField>
      </GridFormSection>

      <section>
        <h3 className="pb-2 mb-1 text-[0.8125rem] font-semibold border-b border-border">4. How should people receive it?</h3>
        <p className="text-xs text-muted-foreground mb-3">Turn on the channels you want. Customer messages only send while the payment or action is still pending.</p>
        <div className="space-y-3">
          {(["Staff", "Customer"] as const).flatMap((aud) => meta.channels[aud].map((c) => {
            const k = chKey(aud, c);
            const ch = f.Channels[k];
            return (
              <div key={k} className="rounded-md p-3" style={{ border: RULE_SOFT, opacity: ch.IsActive ? 1 : 0.75 }}>
                <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={ch.IsActive} onChange={(e) => setCh(k, { IsActive: e.target.checked })} />{CHANNEL_LABEL[c] || c}<span className="font-normal text-muted-foreground">· {aud === "Staff" ? "the staff above" : "the customer"}</span></label>
                {ch.IsActive && meta.ready?.[c] && !meta.ready[c].ready && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{CHANNEL_LABEL[c] || c} isn&apos;t set up in Communicator yet, so these will be logged as Not sent until it is.</p>}
                {ch.IsActive && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                    {HAS_TITLE.has(c) && <input className={GRID_INPUT} value={ch.Title || ""} onChange={(e) => setCh(k, { Title: e.target.value })} placeholder={c === "Email" ? "Subject" : "Title"} maxLength={200} />}
                    <textarea className={cn(GRID_INPUT, "h-auto min-h-[3.5rem] py-2 sm:col-span-2")} value={ch.Body} onChange={(e) => setCh(k, { Body: e.target.value })} placeholder="Message" maxLength={1000} />
                    {/* Tap a field to add it to the message: no need to know or type the {Field} names. */}
                    <div className="flex flex-wrap gap-1 sm:col-span-2">
                      {(sit?.fields || []).map((x) => <button key={x} type="button" onClick={() => setCh(k, { Body: `${ch.Body}${ch.Body && !ch.Body.endsWith(" ") ? " " : ""}{${x}}` })} className="h-6 rounded border border-border px-1.5 text-[0.6875rem] text-muted-foreground hover:border-primary hover:text-primary">+ {`{${x}}`}</button>)}
                    </div>
                    {c === "WhatsApp" && <>
                      <input className={GRID_INPUT} value={ch.TemplateName || ""} onChange={(e) => setCh(k, { TemplateName: e.target.value })} placeholder="Approved template name (outside the 24-hour window)" />
                      <input className={GRID_INPUT} value={ch.TemplateLanguage || ""} onChange={(e) => setCh(k, { TemplateLanguage: e.target.value })} placeholder="Template language code, e.g. en" />
                      <p className="text-xs text-muted-foreground sm:col-span-2">With a template, its parameters are the fields of the message above, in order.</p>
                    </>}
                  </div>
                )}
              </div>
            );
          }))}
        </div>
      </section>

      <details className="border border-border px-3 py-2 text-xs">
        <summary className="cursor-pointer font-semibold">More options: project, escalation and message fields</summary>
        <div className="pt-3 space-y-3">
          <GridFormSection title="Optional controls">
            <GridFormField label="Apply to">
              <select className={GRID_INPUT} value={f.ProjectId} onChange={(e) => set({ ProjectId: e.target.value })}>
                <option value="">All projects</option>
                {options.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </GridFormField>
            <GridFormField label="Stop after this many sends" hint="Leave blank to keep repeating while it is pending.">
              <input type="number" min={1} className={cn(GRID_INPUT, NUM)} value={f.MaxTimes} onChange={(e) => set({ MaxTimes: e.target.value })} disabled={!f.RepeatEveryDays} />
            </GridFormField>
            <GridFormField label="Escalate after (days)" hint="Escalation is sent only to the escalation recipients above.">
              <input type="number" min={0} className={cn(GRID_INPUT, NUM)} value={f.EscalateAfterDays} onChange={(e) => set({ EscalateAfterDays: e.target.value })} />
            </GridFormField>
            <GridFormField label="Available message fields" wide><p className="text-muted-foreground">{(sit?.fields || []).map((x) => <code key={x} className="mx-0.5 px-1 rounded bg-muted">{`{${x}}`}</code>)}</p></GridFormField>
          </GridFormSection>
        </div>
      </details>

      {check && (
        <section>
          <h3 className="pb-2 mb-2 text-[0.8125rem] font-semibold border-b border-border">If it ran now</h3>
          <CheckPanel c={check} />
        </section>
      )}

      <GridFormSection title="Status">
        <GridFormField label="Notes" wide><input className={GRID_INPUT} value={f.Notes} onChange={(e) => set({ Notes: e.target.value })} maxLength={500} /></GridFormField>
        <GridFormField label="Active" wide><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={f.IsActive} onChange={(e) => set({ IsActive: e.target.checked })} /> Send this reminder (the hourly run picks it up)</label></GridFormField>
      </GridFormSection>
    </GridDialog>
  );
};

// ── Check before sending: Run and switching a reminder on show what would go out first ─────────────────────────
const ConfirmDialog: React.FC<{ rule: Pick<Rule, "Id" | "Name">; action: "run" | "on"; onClose: () => void; onConfirm: () => Promise<void> }> = ({ rule, action, onClose, onConfirm }) => {
  const [busy, setBusy] = useState(false);
  // Only this check (switching on) counts as the review the server requires before a saved plan may send.
  const q = useQuery<Check>({ queryKey: [PAGE_KEY, "check", rule.Id, action], queryFn: () => send(`${API}/check`, "POST", { ruleId: rule.Id, authorize: action === "on" }), staleTime: 0, gcTime: 0 });
  const go = async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } };
  return (
    <GridDialog onClose={onClose} icon={action === "run" ? Play : BellRing} width="max-w-3xl" title={action === "run" ? `Run: ${rule.Name}` : `Switch on: ${rule.Name}`}
      description={action === "run" ? "This is what would go out now." : "This is what the next run would send as soon as it is switched on."}
      footer={<><button type="button" onClick={onClose} className={GRID_BTN}>Cancel</button><button type="button" onClick={go} disabled={busy || q.isLoading || q.isError || (action === "run" && q.data?.toSend === 0)}className={GRID_BTN_BRAND}>{busy ? "Working…" : action === "run" ? "Send Now" : "Switch On"}</button></>}>
      {q.isLoading && <p className="text-xs text-muted-foreground">Checking…</p>}
      {q.isError && <p className="text-xs text-destructive">{(q.error as Error).message}</p>}
      {q.data && <CheckPanel c={q.data} />}
    </GridDialog>
  );
};

// ── Pause dialog ─────────────────────────────────────────────────────────────────────────────────────────────────
/** Start from a live database plan rather than asking a CRM user to assemble a rule from scratch. */
const PlanPicker: React.FC<{ rules: Rule[]; onPick: (rule: Rule) => void; onBlank: () => void; onClose: () => void }> = ({ rules, onPick, onBlank, onClose }) => (
  <GridDialog onClose={onClose} icon={BellRing} width="max-w-3xl" title="Start a reminder plan"
    description="Use an existing plan as a template. Its recipients, channels and wording are copied from the database; you can change them before saving."
    footer={<><button type="button" onClick={onClose} className={GRID_BTN}>Cancel</button><button type="button" onClick={onBlank} className={GRID_BTN}>Start blank</button></>}>
    <div className="grid gap-2">
      {rules.map((r) => <button key={r.Id} type="button" onClick={() => onPick(r)} className="w-full border border-border p-3 text-left hover:bg-primary/5">
        <p className="text-sm font-semibold">{r.Name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{r.SituationLabel} · {describeWhen(r)} · {r.ProjectName || "All projects"}</p>
        <p className="mt-2 text-xs">Copies: {recipientSummary(r)} · {r.Channels.filter((c) => c.Audience === "Customer" && c.IsActive).map((c) => CHANNEL_LABEL[c.Channel] || c.Channel).join(", ") || "no customer channel"}</p>
      </button>)}
      {!rules.length && <p className="py-6 text-center text-xs text-muted-foreground">No saved plan is available yet. Start with a blank plan.</p>}
    </div>
  </GridDialog>
);

const PauseDialog: React.FC<{ rules: Rule[]; onClose: () => void; onSaved: () => void }> = ({ rules, onClose, onSaved }) => {
  const [search, setSearch] = useState("");
  const [bookingId, setBookingId] = useState("");
  const [ruleId, setRuleId] = useState("");
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [saving, setSaving] = useState(false);
  const { data: found = [] } = useQuery({ queryKey: [PAGE_KEY, "bookings", search], queryFn: async () => (await getJson(`${API}/bookings?q=${encodeURIComponent(search)}`)).rows as any[], enabled: search.trim().length >= 2 });
  const save = async () => {
    setSaving(true);
    try { await send(`${API}/pauses`, "POST", { BookingId: bookingId, RuleId: ruleId || null, Reason: reason, PausedUntil: until || null }); toast.success("Reminders paused"); onSaved(); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };
  return (
    <GridDialog onClose={onClose} icon={Pause} title="Pause a Booking's Reminders" description="The booking stays pending; nothing is sent to anyone about it until the pause ends."
      footer={<><button type="button" onClick={onClose} className={GRID_BTN}>Cancel</button><button type="button" onClick={save} disabled={saving || !bookingId || !reason.trim()} className={GRID_BTN_BRAND}>{saving ? "Pausing…" : "Pause"}</button></>}>
      <GridFormSection>
        <GridFormField label="Booking" required wide>
          <input className={GRID_INPUT} value={search} onChange={(e) => { setSearch(e.target.value); setBookingId(""); }} placeholder="Booking no. or customer name (2+ letters)" />
          {found.length > 0 && !bookingId && (
            <div className="mt-1 max-h-48 overflow-y-auto rounded-md" style={{ border: RULE_SOFT }}>
              {found.map((b) => <button key={b.Id} type="button" className="block w-full text-left px-3 py-1.5 text-xs hover:bg-muted" onClick={() => { setBookingId(String(b.Id)); setSearch(`${b.BookingNo} · ${b.ApplicantName}`); }}><span className={NUM}>{b.BookingNo}</span> · {b.ApplicantName} · {b.ProjectName} {b.UnitNo}</button>)}
            </div>
          )}
        </GridFormField>
        <GridFormField label="Which reminders">
          <select className={GRID_INPUT} value={ruleId} onChange={(e) => setRuleId(e.target.value)}>
            <option value="">All reminders</option>
            {rules.map((r) => <option key={r.Id} value={r.Id}>{r.Name}</option>)}
          </select>
        </GridFormField>
        <GridFormField label="Until" hint="Blank = until someone resumes them."><DateInput className={GRID_INPUT} value={until} onChange={(e) => setUntil(e.target.value)} /></GridFormField>
        <GridFormField label="Reason" required wide><input className={GRID_INPUT} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Customer on an agreed payment plan" /></GridFormField>
      </GridFormSection>
    </GridDialog>
  );
};

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────
const CrmReminderSetup: React.FC = () => {
  const rights = usePageRights(PAGE_KEY);
  const qc = useQueryClient();
  const [days, setDays] = useState(30);
  const [dialog, setDialog] = useState<{ kind: "rule"; rule?: Rule; duplicate?: boolean } | { kind: "template" } | { kind: "pause" } | { kind: "confirm"; rule: Pick<Rule, "Id" | "Name">; action: "run" | "on" } | null>(null);
  const [logFilter, setLogFilter] = useState({ ruleId: "", status: "", channel: "", q: "", page: 1 });
  const [liveFilter, setLiveFilter] = useState({ ruleId: "", q: "", page: 1 });
  const [running, setRunning] = useState<number | "all" | null>(null);

  const { data: meta } = useQuery<Meta>({ queryKey: [PAGE_KEY, "meta"], queryFn: () => getJson(`${API}/situations`), staleTime: 300_000 });
  const { data: options } = useQuery<Options>({ queryKey: [PAGE_KEY, "options"], queryFn: () => getJson(`${API}/options`), staleTime: 300_000 });
  const rulesQ = useQuery<{ rules: Rule[] }>({ queryKey: [PAGE_KEY, "rules"], queryFn: () => getJson(`${API}/rules`) });
  const dailyQ = useQuery<{ rows: any[]; today?: string }>({ queryKey: [PAGE_KEY, "daily", days], queryFn: () => getJson(`${API}/daily?days=${days}`) });
  const pausesQ = useQuery<{ rows: any[] }>({ queryKey: [PAGE_KEY, "pauses"], queryFn: () => getJson(`${API}/pauses`) });
  const logQs = useMemo(() => { const p = new URLSearchParams({ page: String(logFilter.page), pageSize: "50" }); (["ruleId", "status", "channel", "q"] as const).forEach((k) => logFilter[k] && p.set(k, logFilter[k])); return p.toString(); }, [logFilter]);
  const logQ = useQuery<{ rows: any[]; total: number; page: number; pageSize: number }>({ queryKey: [PAGE_KEY, "log", logQs], queryFn: () => getJson(`${API}/log?${logQs}`) });
  const liveQs = useMemo(() => { const p = new URLSearchParams({ page: String(liveFilter.page), pageSize: "50" }); (["ruleId", "q"] as const).forEach((k) => liveFilter[k] && p.set(k, liveFilter[k])); return p.toString(); }, [liveFilter]);
  const liveQ = useQuery<{ rows: any[]; total: number; pageSize: number; today: string }>({ queryKey: [PAGE_KEY, "live", liveQs], queryFn: () => getJson(`${API}/live?${liveQs}`) });
  const rules = rulesQ.data?.rules || [];
  const refreshAll = () => qc.invalidateQueries({ queryKey: [PAGE_KEY] });

  // Switching on shows what it would send first; switching off is immediate.
  const toggle = async (r: Rule) => {
    if (!r.IsActive) { setDialog({ kind: "confirm", rule: r, action: "on" }); return; }
    try { await send(`${API}/rules/${r.Id}/active`, "PATCH", { IsActive: !r.IsActive }); toast.success(r.IsActive ? "Reminder switched off" : "Reminder switched on"); refreshAll(); }
    catch (e: any) { toast.error(translateError(e.message)); }
  };
  const runNow = async (ruleId?: number) => {
    setRunning(ruleId ?? "all");
    try {
      const d = await send(`${API}/run`, "POST", ruleId ? { ruleId } : {});
      const rows: any[] = d.summary || [];
      const sent = rows.reduce((a, x) => a + (x.sent || 0), 0);
      const failed = rows.find((x) => x.error);
      if (failed) toast.error(`${failed.rule}: ${failed.error}`);
      else if (sent) toast.success(`${sent} reminder${sent === 1 ? "" : "s"} sent`);
      else if (rows.some((x) => x.outsideHours && x.due)) toast.message("Outside the send hours: they go out when the hours open.");
      else toast.success("Nothing was due");
      refreshAll();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setRunning(null); }
  };
  const resend = async (id: number) => {
    try {
      const d = await send(`${API}/log/${id}/resend`, "POST");
      if (d.status === "Sent") toast.success("Sent"); else toast.error(d.detail || "Still not sent");
      refreshAll();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };
  const endPause = async (id: number) => {
    try { await send(`${API}/pauses/${id}/end`, "PUT"); toast.success("Reminders resumed"); refreshAll(); }
    catch (e: any) { toast.error(translateError(e.message)); }
  };

  const daily = dailyQ.data?.rows || [];
  // The business day, from the server (the browser's own date can differ).
  const today = dailyQ.data?.today || new Date().toLocaleDateString("en-CA");
  const sum = (rows: any[], k: string) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
  const todayRows = daily.filter((r) => String(r.Day).slice(0, 10) === today);
  const livePauses = (pausesQ.data?.rows || []).filter((p) => p.IsLive).length;
  const figures = [
    { label: "Reminders", value: `${rules.filter((r) => r.IsActive).length} of ${rules.length}`, note: "switched on" },
    { label: "Sent today", value: sum(todayRows, "Sent").toLocaleString("en-IN"), note: `${todayRows.length ? new Set(todayRows.map((r) => r.RuleId)).size : 0} reminder(s)` },
    { label: `Sent, last ${days} days`, value: sum(daily, "Sent").toLocaleString("en-IN"), note: `${sum(daily, "NotSent") + sum(daily, "Failed")} not sent or failed`, red: sum(daily, "Failed") > 0 },
    { label: "Paused bookings", value: livePauses.toLocaleString("en-IN"), note: "nothing sent about them" },
  ];
  // Day-wise: one block per day.
  const byDay = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const r of daily) { const d = String(r.Day).slice(0, 10); m.set(d, [...(m.get(d) || []), r]); }
    return [...m.entries()];
  }, [daily]);

  return (
    <>
      <Breadcrumbs items={["CRM", "Setup", "Reminder Setup"]} />
      <SheetShell eyebrow="CivilierERP · CRM · Setup" title="Reminder setup"
        subtitle="Who is reminded about what, when and how. Each reminder counts its days from the booking, due or demand date, repeats while the matter is pending, stops by itself once it is resolved, and logs every send."
        action={<div className="flex gap-2">
          <button type="button" onClick={refreshAll} className={`${KEY_LINE} h-9 w-9`} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={rulesQ.isFetching ? "animate-spin" : ""} /></button>
        </div>}>

        <div className="bg-card" style={{ border: RULE }}>
          <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
            {figures.map((x) => (
              <div key={x.label}>
                <p className="label">{x.label}</p>
                <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9, color: x.red ? "var(--red)" : undefined }}>{rulesQ.isLoading ? "…" : x.value}</p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
              </div>
            ))}
          </div>
        </div>

        {rulesQ.isError && <div className="px-4 py-2.5 text-xs text-destructive bg-card" style={{ border: "1px solid hsl(var(--destructive))" }}>{(rulesQ.error as Error)?.message}</div>}

        <div className="grid gap-3 md:grid-cols-3">
          {[
            { n: "1", title: "Choose the event", text: "Booking payment, payment milestone due, or agreement pending." },
            { n: "2", title: "Choose who knows", text: "Your salesperson, a role such as Director, and selected people." },
            { n: "3", title: "Choose customer channels", text: "Portal, app, SMS, WhatsApp or e-mail — only the ones you enable." },
          ].map((step) => <div key={step.n} className="flex gap-3 bg-card p-3" style={{ border: RULE }}>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{step.n}</span>
            <div><p className="text-xs font-semibold">{step.title}</p><p className="mt-0.5 text-xs text-muted-foreground">{step.text}</p></div>
          </div>)}
        </div>

        <Section title="Your reminder plans" note="Open a plan to change it. The system sends only while its booking, payment or agreement is still pending."
          action={rights.canCreate && meta && options && <button type="button" onClick={() => setDialog({ kind: "template" })} className={GRID_BTN_BRAND}><Plus size={13} className="mr-1" />New Reminder</button>}>
          {!rules.length && <div className="px-4 py-8 text-center text-xs text-muted-foreground">{rulesQ.isLoading ? "Loading…" : "No reminder plan yet. Create one when you are ready."}</div>}
          <div className="grid gap-3 p-3 xl:grid-cols-2">
            {rules.map((r) => {
              const customerChannels = r.Channels.filter((c) => c.Audience === "Customer" && c.IsActive);
              const issues = reminderHealth(r, meta?.ready);
              return <article key={r.Id} className="bg-background p-4" style={{ border: RULE }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="text-sm font-semibold">{r.Name}</p><p className="mt-0.5 text-xs text-muted-foreground">{r.SituationLabel} · {r.ProjectName || "All projects"}</p></div>
                  {/* The state, and a plain key to change it: the mark alone was not seen as a button. */}
                  <div className="flex shrink-0 items-center gap-2">
                    <SheetMark text={r.IsActive ? "On" : "Off"} tone={r.IsActive ? "done" : "draft"} />
                    {rights.canEdit && <button type="button" onClick={() => toggle(r)} className={r.IsActive ? `${KEY_LINE} h-8 px-2.5 text-xs` : GRID_BTN_BRAND}>{r.IsActive ? <><Pause size={12} className="mr-1" />Switch Off</> : <><Play size={12} className="mr-1" />Switch On</>}</button>}
                  </div>
                </div>
                <PlanStatus rule={r} issues={issues} />
                <div className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
                  <div><p className="flex items-center gap-1 text-muted-foreground"><Clock3 size={12} /> When</p><p className="mt-1 font-medium">{describeWhen(r)}</p></div>
                  <div><p className="flex items-center gap-1 text-muted-foreground"><UsersRound size={12} /> Team</p><p className="mt-1 font-medium">{recipientSummary(r)}</p></div>
                  <div><p className="flex items-center gap-1 text-muted-foreground"><Smartphone size={12} /> Customer</p><p className="mt-1 font-medium">{customerChannels.length ? customerChannels.map((c) => CHANNEL_LABEL[c.Channel] || c.Channel).join(", ") : "No customer channel"}</p></div>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3"><p className="text-xs text-muted-foreground">{r.Activity.Sent30} sent in 30 days{r.Activity.LastSentAt ? ` · last ${fmtTime(r.Activity.LastSentAt)}` : ""}</p><div className="flex gap-2">{rights.canEdit && meta && options && <button type="button" onClick={() => setDialog({ kind: "rule", rule: r })} className={`${KEY_LINE} h-8 px-2.5 text-xs`}><Pencil size={12} className="mr-1" />Set up</button>}{rights.canEdit && r.IsActive && <button type="button" onClick={() => setDialog({ kind: "confirm", rule: r, action: "run" })} disabled={running != null} className={`${KEY_LINE} h-8 px-2.5 text-xs`}><Play size={12} className="mr-1" />{running === r.Id ? "Running…" : "Check now"}</button>}</div></div>
                <PlanHistory ruleId={r.Id} canEdit={rights.canEdit} />
              </article>;
            })}
          </div>
        </Section>

        <Section title="Bookings being reminded" note="Each booking still pending, its reminder number so far and when the last one went. It leaves this list by itself once the matter is resolved.">
          <div className="flex flex-wrap gap-2 px-4 py-3" style={{ borderBottom: RULE_SOFT }}>
            <input className={cn(GRID_INPUT, "w-56")} value={liveFilter.q} onChange={(e) => setLiveFilter((x) => ({ ...x, q: e.target.value, page: 1 }))} placeholder="Booking no. or customer" />
            <select className={cn(GRID_INPUT, "w-56")} value={liveFilter.ruleId} onChange={(e) => setLiveFilter((x) => ({ ...x, ruleId: e.target.value, page: 1 }))}><option value="">All reminders</option>{rules.map((r) => <option key={r.Id} value={r.Id}>{r.Name}</option>)}</select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr style={{ borderBottom: RULE_SOFT }}><Th>Booking</Th><Th>Reminder</Th><Th right>Reminder no.</Th><Th right>Sent</Th><Th>Started</Th><Th>Last sent</Th><Th>Today</Th></tr></thead>
              <tbody>
                {!(liveQ.data?.rows || []).length && <Empty cols={7} text={liveQ.isLoading ? "Loading…" : "No booking is being reminded."} />}
                {(liveQ.data?.rows || []).map((x) => (
                  <tr key={`${x.RuleId}-${x.EntityKey}`} style={{ borderBottom: RULE_SOFT }}>
                    <td className="px-3 py-2"><span className={cn(NUM, "font-semibold")}>{x.BookingNo}</span><p className="text-muted-foreground capitalize">{String(x.ApplicantName || "").toLowerCase()} · {x.ProjectName} {x.UnitNo}</p></td>
                    <td className="px-3 py-2">{x.RuleName}{x.Escalated && <p className="text-destructive">Escalated</p>}</td>
                    <td className={cn("px-3 py-2 text-right font-semibold", NUM)}>{x.ReminderNo ?? "—"}</td>
                    <td className={cn("px-3 py-2 text-right", NUM)}>{x.RemindersSent}{x.Problems > 0 && <p className="text-destructive font-sans">{x.Problems} not sent</p>}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDay(x.FirstAt)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtTime(x.LastAt)}</td>
                    <td className="px-3 py-2"><SheetMark text={x.SentToday ? "Sent" : "Not yet"} tone={x.SentToday ? "done" : "waiting"} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(liveQ.data?.total || 0) > (liveQ.data?.pageSize || 50) && (
            <div className="flex items-center justify-end gap-2 px-4 py-2.5 text-xs" style={{ borderTop: RULE_SOFT }}>
              <span className={NUM}>{((liveFilter.page - 1) * 50) + 1}–{Math.min(liveFilter.page * 50, liveQ.data?.total || 0)} of {liveQ.data?.total}</span>
              <button type="button" className={`${KEY_LINE} h-7 px-2`} disabled={liveFilter.page <= 1} onClick={() => setLiveFilter((x) => ({ ...x, page: x.page - 1 }))}>Previous</button>
              <button type="button" className={`${KEY_LINE} h-7 px-2`} disabled={liveFilter.page * 50 >= (liveQ.data?.total || 0)} onClick={() => setLiveFilter((x) => ({ ...x, page: x.page + 1 }))}>Next</button>
            </div>
          )}
        </Section>

        <Section title="Day by day" note="How many reminders went out each day, by reminder and channel. Not sent means there is no contact detail or its provider is not set up."
          action={<select className={cn(GRID_INPUT, "w-36")} value={days} onChange={(e) => setDays(Number(e.target.value))}>{[7, 30, 90, 365].map((d) => <option key={d} value={d}>Last {d} days</option>)}</select>}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr style={{ borderBottom: RULE_SOFT }}><Th>Day</Th><Th>Reminder</Th><Th>Channel</Th><Th right>Sent</Th><Th right>Not sent</Th><Th right>Failed</Th><Th right>Bookings</Th></tr></thead>
              <tbody>
                {!byDay.length && <Empty cols={7} text={dailyQ.isLoading ? "Loading…" : `No reminders in the last ${days} days.`} />}
                {byDay.map(([d, rows]) => (
                  <React.Fragment key={d}>
                    {rows.map((r, i) => (
                      <tr key={`${d}-${i}`} style={{ borderBottom: RULE_SOFT }}>
                        <td className={cn("px-3 py-1.5 whitespace-nowrap", i === 0 ? "font-semibold" : "text-transparent")}>{fmtDay(d)}</td>
                        <td className="px-3 py-1.5">{r.RuleName}</td>
                        <td className="px-3 py-1.5">{CHANNEL_LABEL[r.Channel] || r.Channel}</td>
                        <td className={cn("px-3 py-1.5 text-right", NUM)}>{r.Sent}</td>
                        <td className={cn("px-3 py-1.5 text-right", NUM, !r.NotSent && "text-muted-foreground")}>{r.NotSent}</td>
                        <td className={cn("px-3 py-1.5 text-right", NUM, r.Failed ? "text-destructive font-semibold" : "text-muted-foreground")}>{r.Failed}</td>
                        <td className={cn("px-3 py-1.5 text-right", NUM)}>{r.Bookings}</td>
                      </tr>
                    ))}
                    <tr style={{ borderBottom: RULE }} className="bg-muted/40">
                      <td className="px-3 py-1.5" /><td className="px-3 py-1.5 font-semibold" colSpan={2}>Day total</td>
                      <td className={cn("px-3 py-1.5 text-right font-semibold", NUM)}>{sum(rows, "Sent")}</td>
                      <td className={cn("px-3 py-1.5 text-right font-semibold", NUM)}>{sum(rows, "NotSent")}</td>
                      <td className={cn("px-3 py-1.5 text-right font-semibold", NUM)}>{sum(rows, "Failed")}</td>
                      <td className="px-3 py-1.5" />
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <details className="group bg-card" style={{ border: RULE }}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold">Activity, history and paused bookings <ChevronDown size={16} className="transition-transform group-open:rotate-180" /></summary>
          <div className="space-y-4 border-t border-border pt-4">
        <Section title="Paused bookings" note="Bookings whose reminders are on hold, with the reason."
          action={rights.canEdit && <button type="button" onClick={() => setDialog({ kind: "pause" })} className={GRID_BTN}><Pause size={13} className="mr-1" />Pause a Booking</button>}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr style={{ borderBottom: RULE_SOFT }}><Th>Booking</Th><Th>Reminders</Th><Th>Reason</Th><Th>Until</Th><Th>Paused</Th><Th>Status</Th><Th /></tr></thead>
              <tbody>
                {!(pausesQ.data?.rows || []).length && <Empty cols={7} text={pausesQ.isLoading ? "Loading…" : "No booking is paused."} />}
                {(pausesQ.data?.rows || []).map((p) => (
                  <tr key={p.Id} style={{ borderBottom: RULE_SOFT }}>
                    <td className="px-3 py-2"><span className={cn(NUM, "font-semibold")}>{p.BookingNo}</span><p className="text-muted-foreground capitalize">{String(p.ApplicantName || "").toLowerCase()}</p></td>
                    <td className="px-3 py-2">{p.RuleName || "All reminders"}</td>
                    <td className="px-3 py-2 max-w-[22rem]">{p.Reason}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{p.PausedUntil ? fmtDay(p.PausedUntil) : "Until resumed"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDay(p.PausedAt)}<p className="text-muted-foreground">{p.PausedByName || ""}</p></td>
                    <td className="px-3 py-2"><SheetMark text={p.IsLive ? "Paused" : p.EndedAt ? `Resumed ${fmtDay(p.EndedAt)}` : "Ended"} tone={p.IsLive ? "waiting" : "draft"} /></td>
                    <td className="px-3 py-2 text-right">{rights.canEdit && p.IsLive && <button type="button" onClick={() => endPause(p.Id)} className={`${KEY_LINE} h-7 px-2 text-xs`}>Resume</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Send log" note="Every reminder sent, newest first. Customer SMS, WhatsApp and e-mail also appear on the booking's Customer 360 timeline.">
          <div className="flex flex-wrap gap-2 px-4 py-3" style={{ borderBottom: RULE_SOFT }}>
            <input className={cn(GRID_INPUT, "w-56")} value={logFilter.q} onChange={(e) => setLogFilter((x) => ({ ...x, q: e.target.value, page: 1 }))} placeholder="Booking no. or customer" />
            <select className={cn(GRID_INPUT, "w-56")} value={logFilter.ruleId} onChange={(e) => setLogFilter((x) => ({ ...x, ruleId: e.target.value, page: 1 }))}><option value="">All reminders</option>{rules.map((r) => <option key={r.Id} value={r.Id}>{r.Name}</option>)}</select>
            <select className={cn(GRID_INPUT, "w-44")} value={logFilter.channel} onChange={(e) => setLogFilter((x) => ({ ...x, channel: e.target.value, page: 1 }))}><option value="">All channels</option>{Object.entries(CHANNEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select className={cn(GRID_INPUT, "w-36")} value={logFilter.status} onChange={(e) => setLogFilter((x) => ({ ...x, status: e.target.value, page: 1 }))}><option value="">Any status</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr style={{ borderBottom: RULE_SOFT }}><Th>When</Th><Th>Booking</Th><Th>Reminder</Th><Th>To</Th><Th>Message</Th><Th>Status</Th></tr></thead>
              <tbody>
                {!(logQ.data?.rows || []).length && <Empty cols={6} text={logQ.isLoading ? "Loading…" : "Nothing sent yet."} />}
                {(logQ.data?.rows || []).map((l) => (
                  <tr key={l.Id} className="align-top" style={{ borderBottom: RULE_SOFT }}>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtTime(l.SentAt)}</td>
                    <td className="px-3 py-2"><span className={cn(NUM, "font-semibold")}>{l.BookingNo}</span><p className="text-muted-foreground capitalize">{String(l.ApplicantName || "").toLowerCase()}</p></td>
                    <td className="px-3 py-2">{l.RuleName}<p className="text-muted-foreground">{l.Stage === "Escalate" ? "Escalation" : `Reminder ${l.Occurrence}`}{l.ClearedAt ? ` · resolved ${fmtDay(l.ClearedAt)}` : ""}</p></td>
                    <td className="px-3 py-2">{CHANNEL_LABEL[l.Channel] || l.Channel}<p className="text-muted-foreground">{l.UserName || (String(l.Recipient).startsWith("booking:") ? "The customer" : l.Recipient)}</p></td>
                    <td className="px-3 py-2 max-w-[26rem]">{l.Title && <p className="font-medium">{l.Title}</p>}<p className="text-muted-foreground">{l.Body}</p></td>
                    <td className="px-3 py-2"><SheetMark text={STATUS_LABEL[l.Status] || l.Status} tone={STATUS_TONE[l.Status] || "draft"} />{l.Detail && <p className="text-muted-foreground mt-0.5">{l.Detail}</p>}{l.Attempts > 1 && <p className="text-muted-foreground mt-0.5">{l.Attempts} attempts</p>}
                      {rights.canEdit && ["Failed", "NotSent"].includes(l.Status) && !l.ClearedAt && <button type="button" onClick={() => resend(l.Id)} className={`${KEY_LINE} h-6 px-2 text-xs mt-1`}>Send Again</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(logQ.data?.total || 0) > (logQ.data?.pageSize || 50) && (
            <div className="flex items-center justify-end gap-2 px-4 py-2.5 text-xs" style={{ borderTop: RULE_SOFT }}>
              <span className={NUM}>{((logFilter.page - 1) * 50) + 1}–{Math.min(logFilter.page * 50, logQ.data?.total || 0)} of {logQ.data?.total}</span>
              <button type="button" className={`${KEY_LINE} h-7 px-2`} disabled={logFilter.page <= 1} onClick={() => setLogFilter((x) => ({ ...x, page: x.page - 1 }))}>Previous</button>
              <button type="button" className={`${KEY_LINE} h-7 px-2`} disabled={logFilter.page * 50 >= (logQ.data?.total || 0)} onClick={() => setLogFilter((x) => ({ ...x, page: x.page + 1 }))}>Next</button>
            </div>
          )}
        </Section>
          </div>
        </details>
      </SheetShell>

      {dialog?.kind === "rule" && meta && options && <RuleDialog meta={meta} options={options} rule={dialog.rule} duplicate={dialog.duplicate} onClose={() => setDialog(null)} onSaved={(saved) => { refreshAll(); setDialog(saved.requiresPreview ? { kind: "confirm", rule: saved, action: "on" } : null); }} />}
      {dialog?.kind === "template" && <PlanPicker rules={rules} onClose={() => setDialog(null)} onBlank={() => setDialog({ kind: "rule" })} onPick={(rule) => setDialog({ kind: "rule", rule, duplicate: true })} />}
      {dialog?.kind === "confirm" && <ConfirmDialog rule={dialog.rule} action={dialog.action} onClose={() => setDialog(null)}
        onConfirm={async () => {
          if (dialog.action === "run") { setDialog(null); await runNow(dialog.rule.Id); return; }
          try { await send(`${API}/rules/${dialog.rule.Id}/active`, "PATCH", { IsActive: true }); toast.success("Reminder switched on"); setDialog(null); refreshAll(); }
          catch (e: any) { toast.error(translateError(e.message)); }
        }} />}
      {dialog?.kind === "pause" && <PauseDialog rules={rules} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); refreshAll(); }} />}
    </>
  );
};

// ── On a booking's payment milestones page: its reminders, where the salesperson works ──────────────────────────────
// Shows each running reminder's number and last send, and pauses / resumes them for this booking — the same rows and
// routes as this page's "Bookings being reminded" and "Paused bookings". Shows nothing when no reminder is running
// or paused for the booking.
export const BookingReminders: React.FC<{ bookingId: number; canEdit: boolean }> = ({ bookingId, canEdit }) => {
  const qc = useQueryClient();
  const [pausing, setPausing] = useState(false);
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const liveQ = useQuery<{ rows: any[] }>({ queryKey: [PAGE_KEY, "booking-live", bookingId], queryFn: () => getJson(`${API}/live?bookingId=${bookingId}`), enabled: bookingId > 0, retry: false });
  const pausesQ = useQuery<{ rows: any[] }>({ queryKey: [PAGE_KEY, "booking-pauses", bookingId], queryFn: () => getJson(`${API}/pauses?bookingId=${bookingId}`), enabled: bookingId > 0, retry: false });
  const live = liveQ.data?.rows || [];
  const pause = (pausesQ.data?.rows || []).find((p) => p.IsLive);
  if (!live.length && !pause) return null;
  const refresh = () => qc.invalidateQueries({ queryKey: [PAGE_KEY] });
  const doPause = async () => {
    setBusy(true);
    try { await send(`${API}/pauses`, "POST", { BookingId: bookingId, RuleId: null, Reason: reason, PausedUntil: until || null }); toast.success("Reminders paused"); setPausing(false); setReason(""); setUntil(""); refresh(); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setBusy(false); }
  };
  const doResume = async () => {
    setBusy(true);
    try { await send(`${API}/pauses/${pause.Id}/end`, "PUT"); toast.success("Reminders resumed"); refresh(); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setBusy(false); }
  };
  return (
    <section className="bg-card px-4 py-3 text-xs" style={{ border: RULE }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold"><BellRing size={14} /> Reminders</p>
        {canEdit && (pause
          ? <button type="button" onClick={doResume} disabled={busy} className={`${KEY_LINE} h-7 px-2 text-xs`}><Play size={11} className="mr-1" />Resume</button>
          : !pausing && <button type="button" onClick={() => setPausing(true)} className={`${KEY_LINE} h-7 px-2 text-xs`}><Pause size={11} className="mr-1" />Pause</button>)}
      </div>
      {pause && <p className="mt-2 text-amber-700 dark:text-amber-400">Paused{pause.PausedUntil ? ` until ${fmtDay(pause.PausedUntil)}` : ""}: {pause.Reason}{pause.PausedByName ? ` · ${pause.PausedByName}` : ""}</p>}
      {live.map((x) => (
        <p key={`${x.RuleId}-${x.EntityKey}`} className="mt-2">
          <span className="font-medium">{x.RuleName}</span> · <span className={cn(NUM, "font-semibold")}>Reminder {x.ReminderNo ?? "—"}</span>
          <span className="text-muted-foreground"> · last sent {fmtTime(x.LastAt)}{x.SentToday ? " (today)" : ""}{x.Escalated ? " · escalated" : ""}</span>
        </p>
      ))}
      {pausing && (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_11rem_auto]">
          <input className={GRID_INPUT} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Why pause? e.g. Customer on an agreed payment plan" autoFocus />
          <DateInput className={GRID_INPUT} value={until} onChange={(e) => setUntil(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" onClick={() => setPausing(false)} className={GRID_BTN}>Cancel</button>
            <button type="button" onClick={doPause} disabled={busy || !reason.trim()} className={GRID_BTN_BRAND}>{busy ? "Pausing…" : "Pause"}</button>
          </div>
          <p className="text-muted-foreground sm:col-span-3">Leave the date blank to pause until someone resumes them. The booking stays pending; nothing is sent about it while paused.</p>
        </div>
      )}
    </section>
  );
};

export default CrmReminderSetup;

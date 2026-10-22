// By User, right side: one person's figures and their activity, day by day.
import React from "react";
import { Loader2 } from "lucide-react";
import type { SessionEvent, UserActivitySummary, UserActivityType } from "@/api/userActivityApi";
import { describeActivity } from "./describeActivity";
import { ChangeDetails } from "./ChangeDetails";
import { KindTag, LBL, KEY_LINE, RULE, RoleTag, chip } from "./activityShared";
import { ago } from "./PeopleList";

const IST = "Asia/Kolkata";
const timeIst = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: IST });
const dayLabelIst = (key: string) =>
  new Date(`${key}T12:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", year: "numeric", timeZone: IST });

export const TYPES: { key: UserActivityType; label: string }[] = [
  { key: "changes", label: "Changes" },
  { key: "all", label: "Everything" },
  { key: "reads", label: "Pages opened" },
  { key: "logins", label: "Sign-ins" },
];

function EventRow({ e }: { e: SessionEvent }) {
  const d = describeActivity(e);
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-foreground/10 last:border-0">
      <span className="w-16 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">{timeIst(e.timestamp)}</span>
      <span className="w-[4.5rem] shrink-0">
        <KindTag kind={d.kind} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">
          {d.verb}
          {d.subject ? <span className="font-semibold"> {d.subject}</span> : null}
          {d.where ? <span className="text-muted-foreground"> · from {d.where}</span> : null}
        </p>
        <ChangeDetails d={d} />
        {(e.event !== "action" || e.ipAddress) && (
          <p className="text-[0.6875rem] text-muted-foreground truncate">
            {e.ipAddress && e.ipAddress !== "unknown" ? e.ipAddress : ""}
            {e.event === "login" && e.deviceInfo && e.deviceInfo !== "unknown" ? ` · ${e.deviceInfo}` : ""}
          </p>
        )}
      </div>
    </div>
  );
}

export const PersonActivity: React.FC<{
  current?: UserActivitySummary;
  type: UserActivityType;
  setType: (t: UserActivityType) => void;
  total: number;
  days: { key: string; items: SessionEvent[] }[];
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
}> = ({ current, type, setType, total, days, loading, hasMore, loadingMore, loadMore }) => (
  <div className="bg-card min-w-0" style={{ border: RULE }}>
    {!current ? (
      <p className="p-10 text-center text-sm text-muted-foreground">Pick a person to see what they did.</p>
    ) : (
      <>
        <div className="p-4 space-y-3" style={{ borderBottom: RULE }}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-heading text-lg font-bold tracking-tight text-foreground">{current.userName}</h3>
            {current.userRole && <RoleTag role={current.userRole} />}
            <span className="text-xs text-muted-foreground">{current.userEmail}</span>
            <span className={`${LBL} ml-auto`}>Last seen {ago(current.lastSeen)}</span>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-5" style={{ borderTop: "1px solid hsl(var(--foreground) / 0.2)", borderBottom: "1px solid hsl(var(--foreground) / 0.2)" }}>
            {[
              { label: "Sessions", value: current.sessions },
              { label: "Created", value: current.creates },
              { label: "Updated", value: current.updates, note: "approvals included" },
              { label: "Deleted", value: current.deletes, red: current.deletes > 0 },
              { label: "Pages opened", value: current.reads },
            ].map((s, i) => (
              <div key={s.label} className="px-3 py-2.5" style={i ? { borderLeft: "1px solid hsl(var(--foreground) / 0.12)" } : undefined}>
                <p className={LBL} title={s.note}>{s.label}</p>
                <p className={`font-heading text-lg font-bold tabular-nums mt-0.5 ${s.red ? "text-destructive" : "text-foreground"}`}>{s.value.toLocaleString("en-IN")}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {TYPES.map((t) => (
              <button key={t.key} onClick={() => setType(t.key)} aria-pressed={type === t.key} className={chip(type === t.key)}>
                {t.label}
              </button>
            ))}
            <span className={`${LBL} ml-auto`}>
              {total.toLocaleString("en-IN")} event{total === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        <div className="px-4 pb-4 lg:max-h-[calc(100vh-24rem)] overflow-y-auto">
          {loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </p>
          ) : days.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Nothing of this kind in the selected period.</p>
          ) : (
            days.map((g) => (
              <section key={g.key}>
                <h4 className="sticky top-0 z-[1] bg-card py-2 flex items-baseline gap-2" style={{ boxShadow: "inset 0 -1px 0 hsl(var(--foreground))" }}>
                  <span className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">{dayLabelIst(g.key)}</span>
                  <span className="font-heading text-[0.6875rem] tabular-nums text-muted-foreground">{g.items.length}</span>
                </h4>
                {g.items.map((e) => (
                  <EventRow key={e.id || `${e.timestamp}-${e.resource}`} e={e} />
                ))}
              </section>
            ))
          )}
          {hasMore && (
            <button onClick={loadMore} disabled={loadingMore} className={`${KEY_LINE} mt-3 w-full h-9`}>
              {loadingMore ? "Loading…" : "Load older"}
            </button>
          )}
        </div>
      </>
    )}
  </div>
);

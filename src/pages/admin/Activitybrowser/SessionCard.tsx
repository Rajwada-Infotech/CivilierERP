// One sign-in session: who, from where, for how long, and — opened — every action taken in it.
import React, { useState } from "react";
import { AlertTriangle, ChevronDown, Fingerprint, Globe, LogIn, LogOut, Monitor, Timer } from "lucide-react";
import type { GroupedSession } from "@/contexts/ActivityBrowserContext";
import { SheetMark } from "@/components/sheet/Sheet";
import { describeActivity } from "./describeActivity";
import { ChangeDetails } from "./ChangeDetails";
import { KindTag, LBL, RoleTag, fmtDate, fmtDuration, initials, parseUA, useUserAvatars } from "./activityShared";

export const SessionCard: React.FC<{ session: GroupedSession }> = ({ session }) => {
  const [expanded, setExpanded] = useState(false);
  const loginMeta = fmtDate(session.loginTime);
  const logoutMeta = fmtDate(session.logoutTime);
  const isActive = !session.logoutTime;

  const allIps = new Set(
    [session.loginEvent?.ipAddress, session.logoutEvent?.ipAddress, ...session.actions.map((a) => a.ipAddress)].filter(Boolean),
  );
  const multipleIps = allIps.size > 1;

  const { os, browser } = parseUA(session.deviceInfo);
  const avatarMap = useUserAvatars();
  const avatarUrl = avatarMap[String(session.userId)];
  const changes = session.actions.filter((a) => a.actionType && a.actionType !== "read").length;

  return (
    <div className={`bg-card border ${multipleIps ? "border-destructive" : "border-foreground/40"}`}>
      <button onClick={() => setExpanded((e) => !e)} className="w-full text-left hover:bg-primary/5 transition-colors" aria-expanded={expanded}>
        <div className="grid gap-4 p-4 md:grid-cols-[2fr_1.5fr_1.5fr_1fr_auto]">
          {/* User */}
          <div className="flex items-center gap-3">
            <div className="relative flex h-9 w-9 shrink-0 items-center justify-center border border-foreground font-heading text-xs font-bold text-foreground overflow-hidden">
              {avatarUrl ? <img src={avatarUrl} alt={session.userName} className="h-full w-full object-cover" /> : initials(session.userName)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{session.userName}</p>
              <p className="truncate text-[0.6875rem] text-muted-foreground">{session.userEmail}</p>
              <div className="mt-1">
                <RoleTag role={session.userRole} />
              </div>
            </div>
          </div>

          {/* Device / IP */}
          <div className="hidden space-y-1 md:block">
            <div className="flex items-center gap-1.5 text-xs">
              <Globe size={11} className="text-muted-foreground" />
              <span className="font-heading tabular-nums text-[0.6875rem] font-medium text-foreground">{session.ipAddress || "—"}</span>
              {multipleIps && <AlertTriangle size={11} className="text-destructive" />}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Monitor size={11} />
              <span>{browser} · {os}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Fingerprint size={11} />
              <span className="font-heading tabular-nums text-[0.625rem]">
                {session.deviceFingerprint !== "Unknown" ? session.deviceFingerprint.slice(0, 14) + "…" : "—"}
              </span>
            </div>
          </div>

          {/* Times */}
          <div className="hidden space-y-1.5 md:block">
            <div className="flex items-center gap-1.5 text-xs">
              <LogIn size={11} className="text-muted-foreground" />
              <span className="text-muted-foreground">
                {loginMeta.date} <span className="font-medium text-foreground">{loginMeta.time}</span>
              </span>
            </div>
            {session.logoutTime ? (
              <div className="flex items-center gap-1.5 text-xs">
                <LogOut size={11} className="text-muted-foreground" />
                <span className="text-muted-foreground">
                  {logoutMeta.date} <span className="font-medium text-foreground">{logoutMeta.time}</span>
                </span>
              </div>
            ) : (
              <SheetMark text="Signed in now" tone="waiting" />
            )}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Timer size={11} />
              {fmtDuration(session.durationMs)}
            </div>
          </div>

          {/* Counts */}
          <div className="hidden flex-col items-end justify-center gap-1.5 md:flex">
            <span className="text-xs text-muted-foreground">
              <span className="font-heading font-semibold tabular-nums text-foreground">{changes}</span> change{changes === 1 ? "" : "s"}
            </span>
            <span className="text-[0.6875rem] text-muted-foreground">
              {session.actions.length} action{session.actions.length === 1 ? "" : "s"} in all
            </span>
            {multipleIps && (
              <span className="inline-flex items-center gap-1 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-destructive border border-destructive px-1.5 py-0.5">
                <AlertTriangle size={10} /> Multi-IP
              </span>
            )}
            {isActive && !multipleIps && <span className={LBL}>Open session</span>}
          </div>

          <div className="flex items-center justify-end">
            <ChevronDown size={16} className={`text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-foreground/25 px-4 pb-4 pt-3">
          {session.actions.length === 0 ? (
            <p className="py-2 text-center text-xs text-muted-foreground">No actions recorded in this session.</p>
          ) : (
            <>
              <p className={`${LBL} mb-1`}>Actions in this session</p>
              {session.actions.map((action, i) => {
                const t = fmtDate(action.timestamp);
                const d = describeActivity(action);
                return (
                  <div key={action.id ?? i} className="flex items-start gap-3 py-2 text-xs border-b border-foreground/10 last:border-0">
                    <KindTag kind={d.kind} />
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate">
                        {d.verb}
                        {d.subject ? <span className="font-semibold"> {d.subject}</span> : null}
                        {d.where ? <span className="text-muted-foreground"> · from {d.where}</span> : null}
                      </p>
                      <ChangeDetails d={d} />
                      {action.requestUrl && (
                        <p className="truncate font-heading tabular-nums text-[0.625rem] text-muted-foreground">
                          {action.requestMethod} {action.requestUrl}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[0.6875rem] text-foreground tabular-nums">{t.time}</p>
                      <p className="text-[0.625rem] text-muted-foreground">{t.relative}</p>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
};

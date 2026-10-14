// One line of the flat audit log.
import React from "react";
import type { SessionEvent } from "@/api/userActivityApi";
import { describeActivity } from "./describeActivity";
import { KindTag, fmtDate, parseUA } from "./activityShared";

export const ActionRow: React.FC<{ event: SessionEvent }> = ({ event }) => {
  const t = fmtDate(event.timestamp);
  const { os, browser } = parseUA(event.deviceInfo);
  const d = describeActivity(event);
  return (
    <div className="grid grid-cols-[5.5rem_1fr_auto] gap-x-3 items-center border-b border-foreground/10 px-4 py-2.5 text-xs hover:bg-primary/5 transition-colors">
      <KindTag kind={d.kind} />
      <div className="min-w-0 space-y-0.5">
        <p className="truncate">
          <span className="font-semibold text-foreground">{event.userName}</span>
          <span className="text-muted-foreground"> · </span>
          <span className="text-foreground">
            {d.verb}
            {d.subject ? ` ${d.subject}` : ""}
          </span>
          {d.where ? <span className="text-muted-foreground"> · from {d.where}</span> : null}
        </p>
        <p className="flex gap-3 text-[0.625rem] text-muted-foreground flex-wrap">
          <span className="font-heading tabular-nums">{event.ipAddress || "—"}</span>
          <span>{browser} · {os}</span>
          {event.requestUrl && <span className="truncate max-w-[260px] font-heading tabular-nums">{event.requestMethod} {event.requestUrl}</span>}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-[0.6875rem] text-foreground tabular-nums">{t.time}</p>
        <p className="text-[0.625rem] text-muted-foreground">{t.relative || t.date}</p>
      </div>
    </div>
  );
};

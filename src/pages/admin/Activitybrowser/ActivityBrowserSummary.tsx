// pages/admin/activity-browser/ActivityBrowserSummary.tsx
import React from "react";

type Props = {
  groupedSessions: any[];
  rawSessions: any[];
};

export const ActivityBrowserSummary: React.FC<Props> = ({
  groupedSessions,
  rawSessions,
}) => {
  const completedSessions = groupedSessions.filter(
    (s) => !!s.logoutTime,
  ).length;
  const activeSessions = groupedSessions.filter((s) => !s.logoutTime).length;
  const totalActions = rawSessions.filter((e) => e.event === "action").length;

  return (
    <div className="grid grid-cols-2 gap-4 border-t border-border pt-6 text-xs md:grid-cols-4">
      <div className="text-center">
        <div className="text-lg font-heading text-foreground">
          {groupedSessions.length}
        </div>
        <div className="text-muted-foreground">Total Sessions</div>
      </div>
      <div className="text-center">
        <div className="text-lg font-heading text-foreground">
          {totalActions}
        </div>
        <div className="text-muted-foreground">Tracked Actions</div>
      </div>
      <div className="text-center">
        <div className="text-lg font-heading text-primary">
          {completedSessions}
        </div>
        <div className="text-muted-foreground">Completed Sessions</div>
      </div>
      <div className="text-center">
        <div className="text-lg font-heading text-emerald-600 dark:text-emerald-400">
          {activeSessions}
        </div>
        <div className="text-muted-foreground">Active Sessions</div>
      </div>
    </div>
  );
};

// pages/admin/activity-browser/ActivityBrowserAnalytics.tsx
import React, { useMemo } from "react";
import { TrendingUp, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { SessionEvent } from "@/api/userActivityApi";

type Props = {
  rawSessions: SessionEvent[];
};

export const ActivityBrowserAnalytics: React.FC<Props> = ({ rawSessions }) => {
  const analytics = useMemo(() => {
    const userCounts: Record<string, number> = {};
    const resourceCounts: Record<string, number> = {};

    rawSessions.forEach((event) => {
      if (event.event === "action") {
        userCounts[event.userName] = (userCounts[event.userName] || 0) + 1;
        const res = event.resource || "Unknown";
        resourceCounts[res] = (resourceCounts[res] || 0) + 1;
      }
    });

    return {
      topUsers: Object.entries(userCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3),
      topResources: Object.entries(resourceCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3),
    };
  }, [rawSessions]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card className="border-border/40 bg-card/20 backdrop-blur-sm">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-xs font-semibold flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
            <TrendingUp size={14} className="text-primary" /> Top Power Users
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="space-y-2">
            {analytics.topUsers.length > 0 ? (
              analytics.topUsers.map(([user, count]) => (
                <div
                  key={user}
                  className="flex items-center justify-between p-2 rounded-lg bg-muted/40 text-sm"
                >
                  <span className="font-medium">{user}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {count} actions
                  </Badge>
                </div>
              ))
            ) : (
              <div className="text-xs text-muted-foreground py-2 italic text-center">
                No action data
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/40 bg-card/20 backdrop-blur-sm">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-xs font-semibold flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
            <ShieldAlert size={14} className="text-amber-500" /> Hot Modules
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="space-y-2">
            {analytics.topResources.length > 0 ? (
              analytics.topResources.map(([res, count]) => (
                <div
                  key={res}
                  className="flex items-center justify-between p-2 rounded-lg bg-muted/40 text-sm"
                >
                  <span className="font-medium capitalize">{res}</span>
                  <Badge
                    variant="outline"
                    className="text-[10px] border-amber-500/20 text-amber-600"
                  >
                    {count} hits
                  </Badge>
                </div>
              ))
            ) : (
              <div className="text-xs text-muted-foreground py-2 italic text-center">
                No resource data
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

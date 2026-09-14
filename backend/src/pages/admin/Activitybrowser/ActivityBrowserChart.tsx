// pages/admin/activity-browser/ActivityBrowserChart.tsx
import React, { useMemo } from "react";
import { Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { format } from "date-fns";
import type { SessionEvent } from "@/api/userActivityApi";

const ActivityChartTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-lg border border-border bg-background p-3 shadow-md">
        <p className="mb-2 text-xs font-bold text-foreground">{label}</p>
        <div className="space-y-1.5">
          {payload.map((entry: any) => (
            <div
              key={entry.name}
              className="flex items-center justify-between gap-4 text-[11px]"
            >
              <div className="flex items-center gap-2">
                <div
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="text-muted-foreground">{entry.name}</span>
              </div>
              <span className="font-mono font-bold text-foreground">
                {entry.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

type Props = {
  rawSessions: SessionEvent[];
  dateRange: { from?: Date; to?: Date };
};

export const ActivityBrowserChart: React.FC<Props> = ({
  rawSessions,
  dateRange,
}) => {
  const chartData = useMemo(() => {
    if (!rawSessions.length && !dateRange.from) return [];

    const dataMap: Record<
      string,
      { date: string; actions: number; logins: number; fullDate: string }
    > = {};

    let start: Date;
    let end: Date;

    if (dateRange.from) {
      start = new Date(dateRange.from);
      end = dateRange.to ? new Date(dateRange.to) : new Date();
    } else {
      const timestamps = rawSessions.map((s) =>
        new Date(s.timestamp).getTime(),
      );
      start = new Date(Math.min(...timestamps));
      end = new Date(Math.max(...timestamps));
    }

    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    const curr = new Date(start);
    let safety = 0;
    while (curr <= end && safety < 90) {
      const key = format(curr, "yyyy-MM-dd");
      dataMap[key] = {
        date: format(curr, "dd MMM"),
        fullDate: key,
        actions: 0,
        logins: 0,
      };
      curr.setDate(curr.getDate() + 1);
      safety++;
    }

    rawSessions.forEach((event) => {
      const dayKey = format(new Date(event.timestamp), "yyyy-MM-dd");
      if (dataMap[dayKey]) {
        if (event.event === "action") dataMap[dayKey].actions++;
        if (event.event === "login") dataMap[dayKey].logins++;
      }
    });

    return Object.values(dataMap).sort((a, b) =>
      a.fullDate.localeCompare(b.fullDate),
    );
  }, [rawSessions, dateRange]);

  if (chartData.length === 0) return null;

  return (
    <Card className="border-border/50 bg-card/10 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Activity size={14} className="text-primary" />
          Activity Volume
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[200px] w-full mt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 0, right: 0, left: -20, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="hsl(var(--border))"
                opacity={0.4}
              />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                dy={10}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              />
              <Tooltip
                cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
                content={<ActivityChartTooltip />}
              />
              <Legend
                verticalAlign="top"
                align="right"
                iconType="circle"
                wrapperStyle={{
                  paddingBottom: 20,
                  fontSize: 11,
                  fontWeight: 500,
                }}
              />
              <Bar
                dataKey="actions"
                name="Actions"
                fill="hsl(var(--primary))"
                radius={[2, 2, 0, 0]}
                barSize={24}
              />
              <Bar
                dataKey="logins"
                name="Logins"
                fill="#10b981"
                radius={[2, 2, 0, 0]}
                barSize={24}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
};

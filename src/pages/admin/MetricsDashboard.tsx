import React, { useState, useEffect, useCallback } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import {
  Line,
  LineChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  TrendingUp,
  Database,
  HardDrive,
  Cpu,
  Users,
  Play,
  StopCircle,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { fetchMetrics, getDemoMetrics } from "@/api/metricsApi";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { API_BASE_URL } from "@/lib/apiBase";

interface SystemMetrics {
  rpm: number;
  activeUsers: number;
  memoryUsage: number;
  cacheHitRate: number;
  rpmHistory: number[];
  predictedHistory: number[];
  redisOk: boolean;
  workerOk: boolean;
  aofOk: boolean;
  lastUpdated?: number;
  topEngagedUsers?: string[];
}

const chartConfig = {
  rpm: { label: "RPM", color: "hsl(var(--primary))" },
  predicted: { label: "Predicted", color: "hsl(var(--muted))" },
} as const;

const MetricsDashboard = () => {
  const [baseURL, setBaseURL] = useState(
    API_BASE_URL.replace(/\/api$/, "") || "http://localhost:5000",
  );
  const [token, setToken] = useState("");
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(
    async (demo = false) => {
      setLoading(true);
      setError(null);
      try {
        let data: SystemMetrics;
        if (demo) {
          if (!import.meta.env.DEV) {
            throw new Error("Demo mode is available only in development");
          }
          data = getDemoMetrics();
        } else {
          data = await fetchMetrics(baseURL, token);
        }
        setMetrics(data);
        toast.success("Connected!", {
          description: `${data.rpm} RPM • ${data.activeUsers} active users • Cache: ${(data.cacheHitRate * 100).toFixed(0)}%`,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Connection failed";
        setError(message);
        toast.error("Connection Error", {
          description: message,
        });
      } finally {
        setLoading(false);
      }
    },
    [baseURL, token, toast],
  );

  useEffect(() => {
    if (live) {
      fetchData(false);
      const interval = setInterval(() => fetchData(false), 10000); // 10s poll
      return () => clearInterval(interval);
    }
  }, [live, fetchData]);

  const toggleLive = () => {
    if (live) {
      setLive(false);
    } else {
      fetchData(false);
      setLive(true);
    }
  };

  const labels = Array.from({ length: 12 }, (_, i) => {
    const hour = (new Date().getHours() - 11 + i + 24) % 24;
    return `${hour.toString().padStart(2, "0")}:00`;
  });

  const chartData = metrics
    ? labels.map((label, i) => ({
        label,
        rpm: metrics.rpmHistory[i],
        predicted: metrics.predictedHistory[i],
      }))
    : [];

  const topUsers = metrics?.topEngagedUsers
    ? metrics.topEngagedUsers.reduce(
        (acc: { name: string; score: number }[], item, i) => {
          if (i % 2 === 0)
            acc.push({
              name: item || "Unknown",
              score: parseFloat(
                (metrics.topEngagedUsers as string[])[i + 1] || "0",
              ),
            });
          return acc;
        },
        [],
      )
    : [];

  const StatusCard = ({
    title,
    status,
    Icon,
  }: {
    title: string;
    status: boolean;
    Icon: LucideIcon;
  }) => (
    <div
      className={cn(
        "rounded-xl border px-4 py-3 flex items-center justify-between transition-colors",
        status
          ? "border-emerald-500/20 bg-emerald-500/5"
          : "border-destructive/20 bg-destructive/5",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon
          size={14}
          className={cn(status ? "text-emerald-400" : "text-destructive")}
        />
        <span className="text-sm font-heading font-semibold text-foreground">
          {title}
        </span>
      </div>
      <span
        className={cn(
          "text-xs font-heading uppercase tracking-wide px-2 py-0.5 rounded-full border",
          status
            ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
            : "text-destructive bg-destructive/10 border-destructive/20",
        )}
      >
        {status ? "OK" : "DOWN"}
      </span>
    </div>
  );

  return (
    <>
      <Breadcrumbs items={["Admin", "Live Metrics"]} />

      <div className="space-y-8 mt-6">
        {/* ── Page header ─────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <TrendingUp size={17} className="text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-heading font-bold text-foreground">
                Live Metrics Dashboard
              </h1>
              <p className="text-xs font-body text-muted-foreground mt-0.5">
                Enter your backend URL and Bearer token to connect. "Start live" polls every 10 seconds.
              </p>
            </div>
          </div>
        </div>

        {/* ── Connect Panel ────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-2.5 px-6 py-4 border-b border-border bg-muted/30">
            <TrendingUp size={14} className="text-primary" />
            <span className="text-sm font-heading font-semibold text-foreground">
              Connection
            </span>
          </div>
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label
                  htmlFor="baseURL"
                  className="flex items-center gap-1.5 text-[11px] font-heading uppercase tracking-widest text-muted-foreground"
                >
                  Base URL
                </Label>
                <Input
                  id="baseURL"
                  value={baseURL}
                  onChange={(e) => setBaseURL(e.target.value)}
                  placeholder="http://localhost:5000"
                  className="font-body"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label
                  htmlFor="token"
                  className="flex items-center gap-1.5 text-[11px] font-heading uppercase tracking-widest text-muted-foreground"
                >
                  Bearer Token <span className="text-muted-foreground/50">(optional)</span>
                </Label>
                <Input
                  id="token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Bearer your-token-here"
                  className="font-body"
                />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <Button
                onClick={() => fetchData(false)}
                disabled={loading}
                className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto"
              >
                {loading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : null}
                {loading ? "Connecting..." : "Connect"}
              </Button>
              <Button
                variant={live ? "destructive" : "outline"}
                onClick={toggleLive}
                disabled={!metrics || loading}
                className="gap-1.5 shrink-0 font-semibold text-sm px-5 py-2 h-auto"
              >
                {live ? (
                  <StopCircle size={14} />
                ) : (
                  <Play size={14} />
                )}
                {live ? "Stop Live" : "Start Live"}
              </Button>
              {import.meta.env.DEV && (
                <Button
                  variant="outline"
                  onClick={() => fetchData(true)}
                  disabled={loading}
                  className="gap-1.5 shrink-0 font-semibold text-sm px-5 py-2 h-auto"
                >
                  Demo
                </Button>
              )}
            </div>
            {error && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 mr-2 inline" />
                {error}
              </div>
            )}
          </div>
        </div>

        {metrics && (
          <>
            {/* ── RPM Chart ───────────────────────────────────────────────── */}
            <div className="rounded-2xl border border-border bg-card overflow-hidden col-span-full">
              <div className="flex items-center gap-2.5 px-6 py-4 border-b border-border bg-muted/30">
                <TrendingUp size={14} className="text-primary" />
                <span className="text-sm font-heading font-semibold text-foreground">
                  RPM: Actual vs Predicted (12h history)
                </span>
                <p className="text-xs font-body text-muted-foreground ml-2">
                  Live requests per minute vs model predictions. Dashed line anticipates spikes.
                </p>
              </div>
              <div className="p-6 aspect-video">
                <ChartContainer config={chartConfig}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ left: -20 }}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        minTickGap={20}
                        tickFormatter={(value) => value.slice(0, 2)}
                      />
                      <YAxis />
                      <Tooltip content={<ChartTooltipContent />} />
                      <Legend content={<ChartLegendContent />} />
                      <Line
                        dataKey="rpm"
                        stroke="var(--color-rpm)"
                        strokeWidth={2}
                        dot={false}
                        name="Actual"
                      />
                      <Line
                        dataKey="predicted"
                        stroke="var(--color-predicted)"
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={false}
                        name="Predicted"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </div>
            </div>

            {/* ── Grid: Cache + Status + Top Users ───────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Cache Hit Rate */}
              <div className="rounded-2xl border border-border bg-card overflow-hidden transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5 hover:border-primary/30">
                <div className="flex items-center gap-2.5 px-6 py-4 border-b border-border bg-muted/30">
                  <Database size={14} className="text-primary" />
                  <span className="text-sm font-heading font-semibold text-foreground">
                    Cache Hit Rate
                  </span>
                </div>
                <div className="p-6">
                  <div className="text-2xl font-bold">
                    {(metrics.cacheHitRate * 100).toFixed(0)}%
                  </div>
                  <p className="text-xs font-body text-muted-foreground mt-1">
                    Target: 70%+ | TTLs may be too short if lower
                  </p>
                  <div className="flex items-center pt-3 gap-2">
                    <div className="flex-1 h-2 bg-muted rounded-full">
                      <div
                        className="h-2 bg-primary rounded-full transition-all"
                        style={{
                          width: `${Math.min(metrics.cacheHitRate * 100, 100)}%`,
                        }}
                      />
                    </div>
                    <Badge
                      variant={
                        metrics.cacheHitRate > 0.7 ? "default" : "secondary"
                      }
                      className="text-[10px] font-heading uppercase tracking-wide px-2 py-0.5"
                    >
                      {metrics.cacheHitRate > 0.7 ? "Good" : "Improve"}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Status Grid */}
              <div className="rounded-2xl border border-border bg-card overflow-hidden transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5 hover:border-primary/30">
                <div className="flex items-center gap-2.5 px-6 py-4 border-b border-border bg-muted/30">
                  <CheckCircle2 size={14} className="text-green-500" />
                  <span className="text-sm font-heading font-semibold text-foreground">
                    System Health
                  </span>
                </div>
                <div className="p-6 space-y-2">
                  <StatusCard title="Redis" status={metrics.redisOk} Icon={Database} />
                  <StatusCard title="Worker" status={metrics.workerOk} Icon={Cpu} />
                  <StatusCard title="Persistence" status={metrics.aofOk} Icon={HardDrive} />
                </div>
              </div>

              {/* Top Engaged Users */}
              <div className="rounded-2xl border border-border bg-card overflow-hidden transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5 hover:border-primary/30">
                <div className="flex items-center gap-2.5 px-6 py-4 border-b border-border bg-muted/30">
                  <Users size={14} className="text-primary" />
                  <span className="text-sm font-heading font-semibold text-foreground">
                    Top Engaged Users
                  </span>
                  <p className="text-xs font-body text-muted-foreground ml-2">
                    Power users driving ZSET score
                  </p>
                </div>
                <div className="p-6">
                  {topUsers.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 rounded-2xl border-2 border-dashed border-border bg-muted/10">
                      <Users size={24} className="text-muted-foreground/40 mb-2" />
                      <p className="text-sm font-heading font-semibold text-muted-foreground">
                        No engagement data yet
                      </p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-[11px] font-heading uppercase tracking-widest text-muted-foreground">User</TableHead>
                          <TableHead className="text-right text-[11px] font-heading uppercase tracking-widest text-muted-foreground">Score</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {topUsers.slice(0, 5).map((user, i) => (
                          <TableRow key={i} className="hover:bg-muted/30 transition-colors">
                            <TableCell className="font-heading font-semibold text-sm">
                              {user.name}
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge className="text-[10px] font-heading uppercase tracking-wide px-2 py-0.5">
                                {user.score.toFixed(0)}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </div>
            </div>

            {/* ── Live Stats ──────────────────────────────────────────────── */}
            <div className="rounded-2xl border border-border bg-card overflow-hidden transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5 hover:border-primary/30">
              <div className="flex items-center justify-between gap-2.5 px-6 py-4 border-b border-border bg-muted/30">
                <span className="text-sm font-heading font-semibold text-foreground">
                  Live Stats
                </span>
                {live && (
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-heading uppercase tracking-wide">
                    <Play size={10} />
                    Live (10s)
                  </span>
                )}
              </div>
              <div className="p-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold text-primary">
                      {metrics.rpm}
                    </div>
                    <p className="text-xs text-muted-foreground uppercase font-heading tracking-widest mt-1">
                      RPM
                    </p>
                  </div>
                  <div>
                    <div className="text-2xl font-bold">
                      {metrics.activeUsers}
                    </div>
                    <p className="text-xs text-muted-foreground uppercase font-heading tracking-widest mt-1">
                      Active
                    </p>
                  </div>
                  <div>
                    <div className="text-2xl font-bold">
                      {(metrics.memoryUsage * 100).toFixed(0)}%
                    </div>
                    <p className="text-xs text-muted-foreground uppercase font-heading tracking-widest mt-1">
                      Memory
                    </p>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-primary">
                      {new Date(metrics.lastUpdated || 0).toLocaleTimeString()}
                    </div>
                    <p className="text-xs text-muted-foreground uppercase font-heading tracking-widest mt-1">
                      Updated
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {!metrics && !loading && (
          <div className="flex flex-col items-center justify-center py-24 rounded-2xl border-2 border-dashed border-border bg-muted/10">
            <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
              <TrendingUp size={24} className="text-muted-foreground/40" />
            </div>
            <p className="text-sm font-heading font-semibold text-muted-foreground">
              Ready to monitor
            </p>
            <p className="text-xs font-body text-muted-foreground/60 mt-1">
              Connect to your backend and watch your metrics live
            </p>
            {import.meta.env.DEV && (
              <Button
                onClick={() => fetchData(true)}
                className="gradient-accent gap-1.5 font-semibold text-white text-sm px-5 py-2 h-auto mt-6"
              >
                Try Demo Mode
              </Button>
            )}
          </div>
        )}
      </div>
    </>
  );
};

export default MetricsDashboard;
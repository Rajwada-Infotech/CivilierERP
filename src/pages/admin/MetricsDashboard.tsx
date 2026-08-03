import React, { useState, useEffect, useCallback } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdminShell } from "@/components/admin/AdminShell";
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
  ChartTooltipContent,
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

      <AdminShell
        title="Live Metrics Dashboard"
        subtitle="Watch server health, request rates and cache performance in real time."
        icon={TrendingUp}
      >
        {/* ── Connect Panel ────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between gap-2.5 px-6 py-4 border-b border-border bg-muted/30">
            <div className="flex items-center gap-2">
              <TrendingUp size={14} className="text-primary" />
              <span className="text-sm font-heading font-semibold text-foreground">Connect to Backend</span>
            </div>
            {live && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-[11px] font-medium animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Live — refreshing every 10s
              </span>
            )}
          </div>
          <div className="p-6 space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="baseURL" className="text-xs font-semibold">
                  Server URL
                </Label>
                <Input
                  id="baseURL"
                  value={baseURL}
                  onChange={(e) => setBaseURL(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && fetchData(false)}
                  placeholder="http://localhost:5000"
                  className="font-mono text-sm"
                />
                <p className="text-[11px] text-muted-foreground">The address your backend is running on</p>
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="token" className="text-xs font-semibold flex items-center gap-2">
                  Auth Token
                  <span className="font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded text-[10px]">optional</span>
                </Label>
                <Input
                  id="token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Paste your bearer token here (from your login session)"
                  className="text-sm"
                />
                <p className="text-[11px] text-muted-foreground">Found in browser dev tools → Network → any request → Authorization header. Leave blank if your backend is open.</p>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-1 flex-wrap">
              <Button
                onClick={() => fetchData(false)}
                disabled={loading}
                className="bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm hover:opacity-90 gap-2 shrink-0 font-heading font-semibold text-white text-sm px-5 py-2 h-auto"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                {loading ? "Connecting…" : metrics ? "Refresh Now" : "Connect"}
              </Button>

              {metrics && (
                <Button
                  variant={live ? "destructive" : "outline"}
                  onClick={toggleLive}
                  disabled={loading}
                  className="gap-2 shrink-0 font-semibold text-sm px-5 py-2 h-auto"
                >
                  {live ? <StopCircle size={14} /> : <Play size={14} />}
                  {live ? "Stop Auto-Refresh" : "Start Auto-Refresh (10s)"}
                </Button>
              )}

              <Button
                variant="outline"
                onClick={() => fetchData(true)}
                disabled={loading}
                className="gap-2 shrink-0 text-sm px-5 py-2 h-auto text-muted-foreground"
              >
                Try Demo Data
              </Button>
            </div>

            {error && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
                <AlertTriangle size={15} className="text-destructive shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-destructive">Connection failed</p>
                  <p className="text-xs text-destructive/80 mt-0.5">{error}</p>
                  <p className="text-xs text-muted-foreground mt-1">Check that the server URL is correct and the backend is running.</p>
                </div>
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
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="flex flex-col items-center justify-center py-14 px-6 gap-6">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                <TrendingUp size={24} className="text-primary/50" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-heading font-semibold">No data yet</p>
                <p className="text-xs text-muted-foreground">Once connected you'll see RPM, cache hit rate, memory usage and active users here.</p>
              </div>

              {/* Quick-start steps */}
              <div className="w-full max-w-sm space-y-2">
                {[
                  { step: "1", text: "Enter your server URL above", sub: "e.g. http://localhost:5000" },
                  { step: "2", text: "Add your auth token (if needed)", sub: "From browser dev tools → Network → Authorization" },
                  { step: "3", text: 'Click "Connect"', sub: "Or press Enter in the URL field" },
                ].map(({ step, text, sub }) => (
                  <div key={step} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border">
                    <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">{step}</span>
                    <div>
                      <p className="text-xs font-semibold">{text}</p>
                      <p className="text-[11px] text-muted-foreground">{sub}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3">
                <div className="h-px w-16 bg-border" />
                <span className="text-xs text-muted-foreground">or</span>
                <div className="h-px w-16 bg-border" />
              </div>

              <Button
                onClick={() => fetchData(true)}
                variant="outline"
                className="gap-2 text-sm px-6 py-2 h-auto"
              >
                <Play size={13} /> Try with Demo Data
              </Button>
            </div>
          </div>
        )}
      </AdminShell>
    </>
  );
};

export default MetricsDashboard;
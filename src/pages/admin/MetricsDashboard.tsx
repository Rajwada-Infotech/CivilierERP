import React, { useState, useEffect, useCallback } from 'react';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { 
  Button } from '@/components/ui/button';
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from '@/components/ui/card';
import { 
  Input 
} from '@/components/ui/input';
import { 
  Label 
} from '@/components/ui/label';
import { 
  Badge 
} from '@/components/ui/badge';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  ChartContainer, 
  ChartTooltip, 
  ChartTooltipContent, 
  ChartLegend, 
  ChartLegendContent 
} from '@/components/ui/chart';
import { 
  Line, 
  LineChart, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer 
} from 'recharts';
import {
  TrendingUp,
  Database,
  HardDrive,
  Cpu,
  Users,
  Play,
  StopCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle
} from 'lucide-react';
import { fetchMetrics, getDemoMetrics } from '@/api/metricsApi';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

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
  rpm: { label: 'RPM', color: 'hsl(var(--primary))' },
  predicted: { label: 'Predicted', color: 'hsl(var(--muted))' },
} as const;

const MetricsDashboard = () => {
  const [baseURL, setBaseURL] = useState('http://localhost:5000');
  const [token, setToken] = useState('');
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchData = useCallback(async (demo = false) => {
    setLoading(true);
    setError(null);
    try {
      let data: SystemMetrics;
      if (demo) {
        data = getDemoMetrics();
      } else {
        data = await fetchMetrics(baseURL, token);
      }
      setMetrics(data);
      toast({
        title: 'Connected!',
        description: `${data.rpm} RPM • ${data.activeUsers} active users • Cache: ${(data.cacheHitRate * 100).toFixed(0)}%`
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      setError(message);
      toast({
        variant: 'destructive',
        title: 'Connection Error',
        description: message,
      });
    } finally {
      setLoading(false);
    }
  }, [baseURL, token, toast]);

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
    return `${hour.toString().padStart(2, '0')}:00`;
  });

  const chartData = metrics ? labels.map((label, i) => ({
    label,
    rpm: metrics.rpmHistory[i],
    predicted: metrics.predictedHistory[i],
  })) : [];

  const topUsers = metrics?.topEngagedUsers ? 
    metrics.topEngagedUsers.reduce((acc: {name: string, score: number}[], item, i) => {
      if (i % 2 === 0) acc.push({ name: item || 'Unknown', score: parseFloat((metrics.topEngagedUsers as string[])[i+1] || '0') });
      return acc;
    }, []) : [];

  const StatusCard = ({ title, status, Icon }: { title: string; status: boolean; Icon: React.ComponentType<{ className?: string }> }) => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className={cn('h-4 w-4', status ? 'text-green-500' : 'text-destructive')} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{status ? 'OK' : 'DOWN'}</div>
      </CardContent>
    </Card>
  );

  return (
    <>
      <Breadcrumbs items={['Admin', 'Live Metrics']} />
      
      <div className="space-y-6">
        {/* Connect Panel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Live Metrics Dashboard
            </CardTitle>
            <CardDescription>
              Enter your backend URL and Bearer token to connect. "Start live" polls every 10 seconds.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="baseURL">Base URL</Label>
                <Input
                  id="baseURL"
                  value={baseURL}
                  onChange={(e) => setBaseURL(e.target.value)}
                  placeholder="http://localhost:5000"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="token">Bearer Token (optional)</Label>
                <Input
                  id="token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Bearer your-token-here"
                />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <Button onClick={() => fetchData(false)} disabled={loading} className="flex-1">
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  'Connect'
                )}
              </Button>
              <Button 
                variant={live ? 'destructive' : 'default'}
                onClick={toggleLive}
                disabled={!metrics || loading}
              >
                {live ? <StopCircle className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
                {live ? 'Stop live' : 'Start live'}
              </Button>
              <Button variant="outline" onClick={() => fetchData(true)} disabled={loading}>
                Demo
              </Button>
            </div>
            {error && (
              <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-md">
                <AlertTriangle className="h-4 w-4 mr-2 inline" />
                {error}
              </div>
            )}
          </CardContent>
        </Card>

        {metrics && (
          <>
            {/* RPM Chart */}
            <Card className="col-span-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  RPM: Actual vs Predicted (12h history)
                </CardTitle>
                <CardDescription>
                  Live requests per minute vs model predictions. Dashed line anticipates spikes.
                </CardDescription>
              </CardHeader>
              <CardContent className="aspect-video">
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
                        tickFormatter={(value) => value.slice(0,2)}
                      />
                      <YAxis />
                      <Tooltip content={<ChartTooltipContent />} />
                      <Legend content={<ChartLegendContent />} />
                      <Line dataKey="rpm" stroke="var(--color-rpm)" strokeWidth={2} dot={false} name="Actual" />
                      <Line dataKey="predicted" stroke="var(--color-predicted)" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Predicted" />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </CardContent>
            </Card>

            {/* Grid: Cache + Status + Top Users */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Cache Hit Rate */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Cache Hit Rate</CardTitle>
                  <Database className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{(metrics.cacheHitRate * 100).toFixed(0)}%</div>
                  <p className="text-xs text-muted-foreground">
                    Target: 70%+ | TTLs may be too short if lower
                  </p>
                  <div className="flex items-center pt-2 gap-2">
                    <div className="flex-1 h-2 bg-muted rounded-full">
                      <div 
                        className="h-2 bg-primary rounded-full transition-all" 
                        style={{ width: `${Math.min(metrics.cacheHitRate * 100, 100)}%` }}
                      />
                    </div>
                    <Badge variant={metrics.cacheHitRate > 0.7 ? 'default' : 'secondary'}>
                      {metrics.cacheHitRate > 0.7 ? 'Good' : 'Improve'}
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              {/* Status Grid */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium flex items-center gap-1">
                    System Health <CheckCircle2 className="h-4 w-4 text-green-500" />
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                <StatusCard title="Redis" status={metrics.redisOk} Icon={Database} />
                <StatusCard title="Worker" status={metrics.workerOk} Icon={Cpu} />
                <StatusCard title="Persistence" status={metrics.aofOk} Icon={HardDrive} />
                </CardContent>
              </Card>

              {/* Top Engaged Users */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm font-medium">
                    <Users className="h-4 w-4" />
                    Top Engaged Users
                  </CardTitle>
                  <CardDescription>Power users driving ZSET score</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead className="text-right">Score</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topUsers.slice(0, 5).map((user, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{user.name}</TableCell>
                          <TableCell className="text-right">
                            <Badge>{user.score.toFixed(0)}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {topUsers.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No engagement data yet
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Live Stats */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Live Stats</CardTitle>
                {live && (
                  <Badge variant="outline" className="flex items-center gap-1">
                    <Play className="h-3 w-3" />
                    Live (10s)
                  </Badge>
                )}
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold text-primary">{metrics.rpm}</div>
                    <p className="text-xs text-muted-foreground uppercase font-heading">RPM</p>
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{metrics.activeUsers}</div>
                    <p className="text-xs text-muted-foreground uppercase font-heading">Active</p>
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{(metrics.memoryUsage * 100).toFixed(0)}%</div>
                    <p className="text-xs text-muted-foreground uppercase font-heading">Memory</p>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-primary">{new Date(metrics.lastUpdated || 0).toLocaleTimeString()}</div>
                    <p className="text-xs text-muted-foreground uppercase font-heading">Updated</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {!metrics && !loading && (
          <Card className="text-center py-12">
            <TrendingUp className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Ready to monitor</h3>
            <p className="text-muted-foreground mb-6">Connect to your backend and watch your metrics live</p>
            <Button onClick={() => fetchData(true)}>Try Demo Mode</Button>
          </Card>
        )}
      </div>
    </>
  );
};

export default MetricsDashboard;


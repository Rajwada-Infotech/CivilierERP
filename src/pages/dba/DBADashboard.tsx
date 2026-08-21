import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { DbaShell } from "@/components/dba/DbaShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Database,
  Terminal,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Activity,
  Server,
  HardDrive,
  Play,
  Trash2,
  XCircle,
  Loader2,
  ChevronDown,
  Check,
  Copy,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Clock,
  RotateCcw,
  Wifi,
  WifiOff,
  Users,
} from "lucide-react";
import { getSocket, connectSocket } from "@/lib/socket";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DbTable {
  table_name: string;
  schema_name: string;
  row_count: number;
  size_mb: number;
  last_write: string | null;
}

interface DbHealth {
  server_name: string;
  database_name: string;
  sql_version: string;
  total_tables: number;
  total_size_mb: number;
  total_queries: number;
}

interface QueryHistoryRow {
  id: number;
  executed_at: string;
  executed_by: string;
  tenant_id: string;
  query_text: string;
  rows_affected: number;
  status: string;
  error_message: string | null;
}

interface QueryResult {
  rows: Record<string, any>[];
  rowCount: number;
  message: string;
}

// ─── Smart cell renderer ──────────────────────────────────────────────────────
// Detects base64 image data URIs → renders a thumbnail.
// Truncates any other string longer than 80 chars with a title tooltip.
const BASE64_IMAGE_RE = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i;
const MAX_CELL_LEN = 80;

function QueryCellValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return (
      <span className="text-muted-foreground italic text-[10px]">null</span>
    );
  }

  const str = String(value);

  // Base64 image → thumbnail
  if (BASE64_IMAGE_RE.test(str)) {
    return (
      <img
        src={str}
        alt="img"
        loading="lazy"
        decoding="async"
        className="h-8 w-8 rounded object-cover border border-border"
      />
    );
  }

  // Long string → truncate, show full on hover via title
  if (str.length > MAX_CELL_LEN) {
    return (
      <span
        title={str}
        className="font-mono text-[10px] cursor-default"
        style={{ wordBreak: "break-all" }}
      >
        {str.slice(0, MAX_CELL_LEN)}
        <span className="text-muted-foreground">…</span>
      </span>
    );
  }

  return <span className="font-mono text-[10px]">{str}</span>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DBADashboard() {
  usePageRights("dba-dashboard");
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<
    "overview" | "tables" | "query" | "history"
  >("overview");
  const [queryText, setQueryText] = useState(
    "SELECT TOP 100 * FROM dbo.users WHERE discontinue = 0",
  );
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [tableSearch, setTableSearch] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingQuery, setPendingQuery] = useState("");
  const [dbPopoverOpen, setDbPopoverOpen] = useState(false);
  const [selectedDb, setSelectedDb] = useState<string | null>(null);
  const dbPopoverRef = useRef<HTMLDivElement>(null);

  // Table browser sort
  const [sortCol, setSortCol] = useState<keyof DbTable>("row_count");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Query runner timing
  const [lastRunMs, setLastRunMs] = useState<number | null>(null);
  const queryStartRef = useRef<number>(0);

  // Socket session tracking
  type DbaSession = { socketId: string; name: string; joinedAt: string };
  const [dbaSessions, setDbaSessions] = useState<DbaSession[]>([]);
  const [socketConnected, setSocketConnected] = useState(false);

  // Live query feed from other DBA sessions
  type LiveQueryLog = { name: string; query: string; rowCount: number; status: string; at: string };
  const [liveQueryFeed, setLiveQueryFeed] = useState<LiveQueryLog[]>([]);

  const tabs = [
    { key: "overview", label: "DB Overview", icon: Database },
    { key: "tables", label: "Table Browser", icon: HardDrive },
    { key: "query", label: "Query Runner", icon: Terminal },
    { key: "history", label: "Query History", icon: Activity },
  ];

  // ── Health / Overview ──────────────────────────────────────────────────────
  const {
    data: health,
    isLoading: healthLoading,
    refetch: refetchHealth,
  } = useQuery<DbHealth>({
    queryKey: ["dba-health"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/dba/health");
      if (!res.ok) throw new Error("Failed to fetch DB health");
      return res.json().catch(() => ({}));
    },
    staleTime: 30_000,
  });

  // ── Tables ─────────────────────────────────────────────────────────────────
  const {
    data: tables = [],
    isLoading: tablesLoading,
    refetch: refetchTables,
  } = useQuery<DbTable[]>({
    queryKey: ["dba-tables"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/dba/tables");
      if (!res.ok) throw new Error("Failed to fetch tables");
      return res.json().catch(() => ({}));
    },
    enabled: activeTab === "tables",
    staleTime: 60_000,
  });

  // ── Query History ──────────────────────────────────────────────────────────
  const {
    data: history = [],
    isLoading: historyLoading,
    refetch: refetchHistory,
  } = useQuery<QueryHistoryRow[]>({
    queryKey: ["dba-query-history"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/dba/query-history");
      if (!res.ok) throw new Error("Failed to fetch history");
      return res.json().catch(() => ({}));
    },
    enabled: activeTab === "history",
    staleTime: 30_000,
  });

  // ── Available Databases ────────────────────────────────────────────────────
  const { data: databases = [] } = useQuery<
    { name: string; current_db: string }[]
  >({
    queryKey: ["dba-databases"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/dba/databases");
      if (!res.ok) throw new Error("Failed to fetch databases");
      return res.json().catch(() => ({}));
    },
    staleTime: 60_000,
  });

  // ── Query Runner ───────────────────────────────────────────────────────────
  const queryMutation = useMutation({
    mutationFn: async (q: string) => {
      const effectiveQuery = selectedDb ? `USE [${selectedDb}];\n${q}` : q;
      const res = await fetchWithAuth("/api/dba/query", {
        method: "POST",
        body: JSON.stringify({ query: effectiveQuery }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Query failed");
      return data as QueryResult;
    },
    onSuccess: (data) => {
      const duration = Date.now() - queryStartRef.current;
      setLastRunMs(duration);
      setQueryResult(data);
      setQueryError(null);
      toast.success(`Query executed — ${data.rowCount} row(s) in ${duration}ms`);
      queryClient.invalidateQueries({ queryKey: ["dba-query-history"] });
      getSocket()?.emit("dba:query", { query: queryText, rowCount: data.rowCount, duration, status: "success" });
    },
    onError: (err: Error) => {
      const duration = Date.now() - queryStartRef.current;
      setLastRunMs(duration);
      setQueryError(err.message);
      setQueryResult(null);
      toast.error(err.message);
      queryClient.invalidateQueries({ queryKey: ["dba-query-history"] });
      getSocket()?.emit("dba:query", { query: queryText, rowCount: 0, duration, status: "error" });
    },
  });

  const runQuery = useCallback(() => {
    const isDangerous =
      /\b(DROP|TRUNCATE|ALTER|DELETE|INSERT|UPDATE|EXEC|EXECUTE)\b/i.test(queryText);
    if (isDangerous) {
      setPendingQuery(queryText);
      setConfirmOpen(true);
      return;
    }
    queryStartRef.current = Date.now();
    queryMutation.mutate(queryText);
  }, [queryText, queryMutation]);

  const executeConfirmed = useCallback(() => {
    setConfirmOpen(false);
    queryMutation.mutate(pendingQuery);
  }, [pendingQuery, queryMutation]);

  // ── Socket: join DBA room, track sessions & live query feed ────────────────
  useEffect(() => {
    const sock = getSocket() ?? connectSocket();
    if (!sock) return;

    const onConnect = () => {
      setSocketConnected(true);
      sock.emit("dba:join");
    };
    const onDisconnect = () => setSocketConnected(false);
    const onSessionUpdate = (data: { type: string; socketId: string; name: string; joinedAt: string }) => {
      if (data.type === "join") {
        setDbaSessions((prev) => [...prev.filter((s) => s.socketId !== data.socketId), { socketId: data.socketId, name: data.name, joinedAt: data.joinedAt }]);
      } else {
        setDbaSessions((prev) => prev.filter((s) => s.socketId !== data.socketId));
      }
    };
    const onQueryLog = (data: LiveQueryLog) => {
      setLiveQueryFeed((prev) => [data, ...prev].slice(0, 50));
    };

    if (sock.connected) onConnect();
    sock.on("connect", onConnect);
    sock.on("disconnect", onDisconnect);
    sock.on("dba:session-update", onSessionUpdate);
    sock.on("dba:query-log", onQueryLog);

    return () => {
      sock.off("connect", onConnect);
      sock.off("disconnect", onDisconnect);
      sock.off("dba:session-update", onSessionUpdate);
      sock.off("dba:query-log", onQueryLog);
    };
  }, []);

  // Sorted + filtered tables
  const filteredTables = useMemo(() => {
    const base = tables.filter((t) =>
      `${t.schema_name}.${t.table_name}`.toLowerCase().includes(tableSearch.toLowerCase())
    );
    return [...base].sort((a, b) => {
      const av = a[sortCol] ?? 0;
      const bv = b[sortCol] ?? 0;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [tables, tableSearch, sortCol, sortDir]);

  const maxSizeMb = useMemo(() => Math.max(...tables.map((t) => t.size_mb ?? 0), 1), [tables]);
  const maxRows   = useMemo(() => Math.max(...tables.map((t) => t.row_count ?? 0), 1), [tables]);

  function toggleSort(col: keyof DbTable) {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("desc"); }
  }

  function SortIcon({ col }: { col: keyof DbTable }) {
    if (sortCol !== col) return <ArrowUpDown size={11} className="text-muted-foreground/50" />;
    return sortDir === "asc" ? <ArrowUp size={11} className="text-primary" /> : <ArrowDown size={11} className="text-primary" />;
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <Breadcrumbs items={["DBA", "Database Console"]} />

      <DbaShell
        title="DBA Console"
        subtitle="Database access · Table browser · Query runner"
        icon={Database}
        action={
          <div className="flex items-center gap-2">
            {dbaSessions.length > 0 && (
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-blue-600 bg-blue-500/10 border border-blue-500/20 rounded-full px-2.5 py-1">
                <Users size={10} /> {dbaSessions.length} active
              </span>
            )}
            <span className={`flex items-center gap-1.5 text-[11px] font-medium rounded-full px-2.5 py-1 border ${socketConnected ? "text-green-600 bg-green-500/10 border-green-500/20" : "text-muted-foreground bg-muted border-border"}`}>
              {socketConnected ? <Wifi size={10} /> : <WifiOff size={10} />}
              {socketConnected ? "Live" : "Offline"}
            </span>
            <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-xs px-3">
              <Database size={10} className="mr-1" /> DBA
            </Badge>
          </div>
        }
      >
      {/* Stats strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[
          {
            label: "Total Tables",
            value: healthLoading ? "…" : (health?.total_tables ?? "—"),
            icon: HardDrive,
            color: "text-blue-500",
            border: "border-l-blue-500",
            bg: "bg-blue-500/8",
            clickable: false,
          },
          {
            label: "Database",
            value: healthLoading
              ? "…"
              : (selectedDb ?? health?.database_name ?? "—"),
            icon: Database,
            color: "text-emerald-500",
            border: "border-l-emerald-500",
            bg: "bg-emerald-500/8",
            clickable: true,
          },
          {
            label: "Total Size",
            value: healthLoading
              ? "…"
              : health
                ? `${(health.total_size_mb / 1024).toFixed(1)} GB`
                : "—",
            icon: Server,
            color: "text-violet-500",
            border: "border-l-violet-500",
            bg: "bg-violet-500/8",
            clickable: false,
          },
          {
            label: "Queries Logged",
            value: healthLoading ? "…" : (health?.total_queries ?? "—"),
            icon: Terminal,
            color: "text-orange-500",
            border: "border-l-orange-500",
            bg: "bg-orange-500/8",
            clickable: false,
          },
        ].map((s) =>
          s.clickable ? (
            <div key={s.label} className="relative" ref={dbPopoverRef}>
              <Card
                className={`cursor-pointer border-l-2 ${s.border} hover:shadow-md transition-all duration-150 select-none`}
                onClick={() => setDbPopoverOpen((o) => !o)}
              >
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${s.bg}`}>
                    <s.icon size={16} className={s.color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xl font-bold truncate leading-tight">{s.value}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{s.label}</p>
                  </div>
                  <ChevronDown
                    size={13}
                    className={`text-muted-foreground transition-transform duration-200 flex-shrink-0 ${dbPopoverOpen ? "rotate-180" : ""}`}
                  />
                </CardContent>
              </Card>

              {/* DB Switcher Dropdown */}
              {dbPopoverOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setDbPopoverOpen(false)} />
                  <div className="absolute top-full mt-2 left-0 z-50 w-64 rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-muted/30">
                      <Database size={12} className="text-emerald-500" />
                      <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                        Switch Database
                      </span>
                    </div>
                    <div className="p-1.5 max-h-60 overflow-y-auto">
                      {databases.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-4">Loading databases…</p>
                      ) : (
                        databases.map((db) => {
                          const isActive = (selectedDb ?? health?.database_name) === db.name;
                          return (
                            <button
                              key={db.name}
                              onClick={() => {
                                setSelectedDb(db.name);
                                setDbPopoverOpen(false);
                                toast.success(`Switched to database: ${db.name}`);
                              }}
                              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all duration-150 ${
                                isActive ? "bg-emerald-500/10 text-emerald-600" : "hover:bg-muted text-foreground"
                              }`}
                            >
                              <Database size={12} className={isActive ? "text-emerald-500" : "text-muted-foreground"} />
                              <span className="flex-1 truncate font-mono text-xs">{db.name}</span>
                              {isActive && <Check size={11} className="text-emerald-500 flex-shrink-0" />}
                            </button>
                          );
                        })
                      )}
                    </div>
                    {selectedDb && selectedDb !== health?.database_name && (
                      <div className="border-t border-border px-3 py-2">
                        <button
                          onClick={() => {
                            setSelectedDb(null);
                            setDbPopoverOpen(false);
                            toast.info(`Reverted to default: ${health?.database_name}`);
                          }}
                          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                          ↩ Reset to default ({health?.database_name})
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          ) : (
            <Card key={s.label} className={`border-l-2 ${s.border}`}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`p-2 rounded-lg ${s.bg}`}>
                  <s.icon size={16} className={s.color} />
                </div>
                <div>
                  <p className="text-xl font-bold leading-tight">{s.value}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          ),
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-5 p-1 bg-muted/50 rounded-lg w-fit border border-border">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md transition-all duration-150 ${
              activeTab === tab.key
                ? "bg-background text-foreground shadow-sm border border-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <tab.icon size={12} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {activeTab === "overview" && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <div className="p-1.5 rounded-md bg-primary/10">
                    <Database size={13} className="text-primary" />
                  </div>
                  Database Health
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => refetchHealth()}
                  disabled={healthLoading}
                >
                  <RefreshCw size={11} className={healthLoading ? "animate-spin" : ""} />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {healthLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 size={22} className="animate-spin text-muted-foreground" />
                </div>
              ) : health ? (
                <div className="space-y-3">
                  {/* Connection row */}
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "Server Name", value: health.server_name, mono: true, icon: Server, color: "text-blue-500", bg: "bg-blue-500/10" },
                      { label: "Database", value: health.database_name, mono: true, icon: Database, color: "text-emerald-500", bg: "bg-emerald-500/10" },
                    ].map((r) => (
                      <div key={r.label} className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3">
                        <div className={`p-1.5 rounded-md ${r.bg} shrink-0`}>
                          <r.icon size={13} className={r.color} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{r.label}</p>
                          <p className="text-sm font-heading font-semibold truncate mt-0.5">{String(r.value)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Metrics row */}
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "Total Tables", value: health.total_tables, mono: false, icon: HardDrive, color: "text-violet-500", bg: "bg-violet-500/10" },
                      { label: "Total Size", value: `${health.total_size_mb?.toFixed(1)} MB`, mono: false, icon: Server, color: "text-orange-500", bg: "bg-orange-500/10" },
                    ].map((r) => (
                      <div key={r.label} className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3">
                        <div className={`p-1.5 rounded-md ${r.bg} shrink-0`}>
                          <r.icon size={13} className={r.color} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{r.label}</p>
                          <p className="text-sm font-heading font-semibold truncate mt-0.5">{String(r.value)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* SQL Version — full width */}
                  <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3">
                    <div className="p-1.5 rounded-md bg-slate-500/10 shrink-0">
                      <Terminal size={13} className="text-slate-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">SQL Version</p>
                      <p className="text-xs font-mono font-semibold truncate mt-0.5">
                        {health.sql_version?.split("\n")[0] ?? health.sql_version}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">Failed to load health data</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── TABLE BROWSER ── */}
      {activeTab === "tables" && (
        <Card>
          <CardHeader className="pb-3 border-b border-border">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <div className="p-1.5 rounded-md bg-primary/10">
                  <HardDrive size={13} className="text-primary" />
                </div>
                Table Browser
                {!tablesLoading && (
                  <span className="text-xs text-muted-foreground font-normal bg-muted px-2 py-0.5 rounded-full">
                    {filteredTables.length} / {tables.length}
                  </span>
                )}
              </CardTitle>
              <div className="flex gap-2">
                <Input
                  placeholder="Search tables…"
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  className="h-8 text-xs w-48 bg-muted/40"
                />
                <Button variant="outline" size="sm" className="h-8 w-8 p-0"
                  onClick={() => refetchTables()} disabled={tablesLoading}>
                  <RefreshCw size={11} className={tablesLoading ? "animate-spin" : ""} />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {tablesLoading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Loader2 size={22} className="animate-spin text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Loading tables…</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableHead className="text-[11px] font-semibold pl-4">Table</TableHead>
                      <TableHead className="text-[11px] font-semibold">Schema</TableHead>
                      <TableHead
                        className="text-[11px] font-semibold cursor-pointer select-none"
                        onClick={() => toggleSort("row_count")}
                      >
                        <span className="flex items-center gap-1">Rows <SortIcon col="row_count" /></span>
                      </TableHead>
                      <TableHead
                        className="text-[11px] font-semibold cursor-pointer select-none"
                        onClick={() => toggleSort("size_mb")}
                      >
                        <span className="flex items-center gap-1">Size <SortIcon col="size_mb" /></span>
                      </TableHead>
                      <TableHead
                        className="text-[11px] font-semibold cursor-pointer select-none"
                        onClick={() => toggleSort("last_write")}
                      >
                        <span className="flex items-center gap-1">Last Write <SortIcon col="last_write" /></span>
                      </TableHead>
                      <TableHead className="text-right text-[11px] font-semibold pr-4" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTables.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-12">
                          No tables match your search
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredTables.map((t) => {
                        const sizeBar = Math.round(((t.size_mb ?? 0) / maxSizeMb) * 100);
                        const rowBar  = Math.round(((t.row_count ?? 0) / maxRows) * 100);
                        const recentWrite = t.last_write && (Date.now() - new Date(t.last_write).getTime()) < 86400000;
                        return (
                          <TableRow key={`${t.schema_name}.${t.table_name}`}
                            className="group text-xs hover:bg-muted/30 transition-colors">
                            <TableCell className="pl-4 py-3">
                              <div className="flex items-center gap-2">
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${recentWrite ? "bg-green-500" : "bg-muted-foreground/30"}`} />
                                <span className="font-mono font-semibold text-[11px] text-primary">{t.table_name}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground text-[11px]">{t.schema_name}</TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                <span className="text-[11px] font-medium">{(t.row_count ?? 0).toLocaleString()}</span>
                                <div className="w-20 h-0.5 bg-muted rounded-full">
                                  <div className="h-0.5 bg-blue-400 rounded-full" style={{ width: `${rowBar}%` }} />
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                <span className="text-[11px] text-muted-foreground">{t.size_mb?.toFixed(2) ?? "—"} MB</span>
                                <div className="w-20 h-0.5 bg-muted rounded-full">
                                  <div className={`h-0.5 rounded-full ${sizeBar > 70 ? "bg-orange-400" : "bg-emerald-400"}`} style={{ width: `${sizeBar}%` }} />
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground text-[11px] font-mono">
                              {t.last_write ? new Date(t.last_write).toLocaleDateString("en-IN") : "—"}
                            </TableCell>
                            <TableCell className="text-right pr-4">
                              <Button variant="ghost" size="sm"
                                className="h-6 text-[10px] gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() => { setQueryText(`SELECT TOP 100 * FROM ${t.schema_name}.[${t.table_name}]`); setActiveTab("query"); }}>
                                <Terminal size={10} /> Query
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── QUERY RUNNER ── */}
      {activeTab === "query" && (
        <div className="space-y-3">
          {/* Editor card */}
          <Card className="overflow-hidden">
            {/* IDE title bar */}
            <div className="flex items-center justify-between px-4 py-2 bg-muted/60 border-b border-border">
              <div className="flex items-center gap-2">
                <Terminal size={13} className="text-primary" />
                <span className="text-xs font-heading font-semibold">SQL Query Runner</span>
              </div>
              <div className="flex items-center gap-2">
                {(selectedDb ?? health?.database_name) && (
                  <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                    <Database size={9} /> {selectedDb ?? health?.database_name}
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground">Ctrl+Enter to run</span>
              </div>
            </div>

            {/* Textarea */}
            <div className="relative">
              <Textarea
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                onKeyDown={(e) => { if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); runQuery(); } }}
                className="font-mono text-xs min-h-[140px] resize-none rounded-none border-0 border-b border-border focus-visible:ring-0 bg-background text-foreground placeholder:text-muted-foreground px-4 py-3"
                placeholder="SELECT TOP 100 * FROM dbo.users WHERE discontinue = 0"
              />
              {/* Danger warning */}
              {/\b(DROP|TRUNCATE|ALTER|DELETE|INSERT|UPDATE|EXEC|EXECUTE)\b/i.test(queryText) && (
                <div className="absolute bottom-2 right-3 flex items-center gap-1 text-[10px] text-orange-400 bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded">
                  <AlertTriangle size={9} /> Destructive — will require confirmation
                </div>
              )}
            </div>

            {/* Status bar */}
            <div className="flex items-center justify-between px-4 py-2 bg-muted/40 border-t border-border">
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span>{queryText.length} chars</span>
                {lastRunMs !== null && (
                  <span className="flex items-center gap-1">
                    <Clock size={9} /> {lastRunMs}ms
                  </span>
                )}
                {queryResult && (
                  <span className="text-green-600 font-medium">{queryResult.rowCount} row(s) returned</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 text-muted-foreground"
                  onClick={() => navigator.clipboard.writeText(queryText)}>
                  <Copy size={9} /> Copy
                </Button>
                <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 text-muted-foreground"
                  onClick={() => { setQueryText(""); setQueryResult(null); setQueryError(null); setLastRunMs(null); }}>
                  <Trash2 size={9} /> Clear
                </Button>
                <Button size="sm" className="h-7 text-xs gap-1.5 bg-primary hover:bg-primary/90"
                  onClick={runQuery} disabled={queryMutation.isPending || !queryText.trim()}>
                  {queryMutation.isPending
                    ? <><Loader2 size={11} className="animate-spin" /> Running…</>
                    : <><Play size={11} /> Run Query</>}
                </Button>
              </div>
            </div>
          </Card>

          {/* Error */}
          {queryError && (
            <div className="rounded-lg bg-red-500/8 border border-red-500/20 px-4 py-3 flex items-start gap-3">
              <XCircle size={14} className="text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-red-600 mb-0.5">Query Error</p>
                <p className="text-xs text-red-500/80 font-mono">{queryError}</p>
              </div>
            </div>
          )}

          {/* Results */}
          {queryResult && queryResult.rows.length > 0 && (
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 bg-muted/40 border-b border-border">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={12} className="text-green-500" />
                  <span className="text-xs font-heading font-semibold">{queryResult.rowCount} row(s)</span>
                  {lastRunMs !== null && (
                    <span className="text-[10px] text-muted-foreground">· {lastRunMs}ms</span>
                  )}
                </div>
                <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1"
                  onClick={() => navigator.clipboard.writeText(
                    [Object.keys(queryResult.rows[0]).join("\t"),
                     ...queryResult.rows.map((r) => Object.values(r).join("\t"))].join("\n")
                  )}>
                  <Copy size={9} /> Copy as TSV
                </Button>
              </div>
              <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
                    <TableRow>
                      {Object.keys(queryResult.rows[0]).map((k) => (
                        <TableHead key={k} className="text-[11px] font-semibold whitespace-nowrap">{k}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {queryResult.rows.map((row, i) => (
                      <TableRow key={i} className={`text-xs ${i % 2 === 1 ? "bg-muted/20" : ""}`}>
                        {Object.values(row).map((v, j) => (
                          <TableCell key={j} className="align-middle py-1.5">
                            <QueryCellValue value={v} />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}

          {queryResult && queryResult.rowCount === 0 && (
            <div className="rounded-lg bg-muted/30 border border-border px-4 py-8 text-center">
              <CheckCircle2 size={18} className="text-green-500 mx-auto mb-2" />
              <p className="text-xs font-medium">Query executed successfully</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">0 rows returned</p>
            </div>
          )}
        </div>
      )}

      {/* ── QUERY HISTORY ── */}
      {activeTab === "history" && (
        <div className="space-y-3">
          {/* Live feed from other DBA sessions */}
          {liveQueryFeed.length > 0 && (
            <Card className="border-blue-500/20 bg-blue-500/5">
              <CardHeader className="pb-2 pt-3">
                <CardTitle className="text-xs flex items-center gap-2 text-blue-600">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                  Live — other DBA sessions
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-3 space-y-1.5">
                {liveQueryFeed.slice(0, 5).map((entry, i) => (
                  <div key={i} className="flex items-center gap-3 text-[11px]">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${entry.status === "success" ? "bg-green-500" : "bg-red-500"}`} />
                    <span className="text-muted-foreground w-24 shrink-0">{entry.name}</span>
                    <span className="font-mono text-foreground truncate flex-1">{entry.query}</span>
                    <span className="text-muted-foreground shrink-0">{entry.rowCount}r</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* History list */}
          <Card>
            <CardHeader className="pb-3 border-b border-border">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <div className="p-1.5 rounded-md bg-primary/10">
                    <Activity size={13} className="text-primary" />
                  </div>
                  Query History
                  {history.length > 0 && (
                    <span className="text-xs text-muted-foreground font-normal bg-muted px-2 py-0.5 rounded-full">
                      {history.length}
                    </span>
                  )}
                </CardTitle>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5"
                  onClick={() => refetchHistory()} disabled={historyLoading}>
                  <RefreshCw size={11} className={historyLoading ? "animate-spin" : ""} /> Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {historyLoading ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <Loader2 size={22} className="animate-spin text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Loading history…</p>
                </div>
              ) : history.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                  <Activity size={24} className="text-muted-foreground/40" />
                  <p className="text-xs text-muted-foreground">No query history yet</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {history.map((q) => (
                    <div key={q.id} className="group flex items-start gap-4 px-4 py-3 hover:bg-muted/20 transition-colors">
                      {/* Status dot + timeline line */}
                      <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
                        <span className={`w-2 h-2 rounded-full ${q.status === "success" ? "bg-green-500" : "bg-red-500"}`} />
                        <div className="w-px flex-1 bg-border min-h-[16px]" />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-mono text-muted-foreground">
                            {new Date(q.executed_at).toLocaleString("en-IN")}
                          </span>
                          {q.executed_by && (
                            <span className="text-[10px] text-muted-foreground">· {q.executed_by}</span>
                          )}
                          <Badge className={`text-[9px] px-1.5 py-0 h-4 ${q.status === "success" ? "bg-green-500/10 text-green-600 border-green-500/20" : "bg-red-500/10 text-red-600 border-red-500/20"}`}>
                            {q.status}
                          </Badge>
                          {q.rows_affected != null && (
                            <span className="text-[10px] text-muted-foreground">{q.rows_affected} rows</span>
                          )}
                        </div>
                        <p className="font-mono text-[11px] text-foreground bg-muted/40 rounded px-2 py-1 truncate">
                          {q.query_text}
                        </p>
                        {q.error_message && (
                          <p className="text-[10px] text-red-500 font-mono">{q.error_message}</p>
                        )}
                      </div>

                      {/* Re-run button */}
                      <Button variant="ghost" size="sm"
                        className="h-6 text-[10px] gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        onClick={() => { setQueryText(q.query_text); setActiveTab("query"); }}>
                        <RotateCcw size={9} /> Reuse
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
      </DbaShell>

      {/* Dangerous Query Confirm */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-500">
              <AlertTriangle size={18} /> Destructive Operation
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-muted-foreground">
              This query contains a write or destructive operation. Are you sure
              you want to execute?
            </p>
            <pre className="bg-muted p-3 rounded text-xs font-mono overflow-x-auto whitespace-pre-wrap">
              {pendingQuery}
            </pre>
            <p className="text-xs text-red-500 flex items-center gap-1">
              <AlertTriangle size={11} /> This action may be irreversible.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={executeConfirmed}
              disabled={queryMutation.isPending}
            >
              Execute Anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

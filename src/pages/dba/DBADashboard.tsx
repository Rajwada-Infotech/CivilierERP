import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { SheetShell, SheetMark, MarkSquare } from "@/components/sheet/Sheet";
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
  Activity,
  HardDrive,
  Play,
  Trash2,
  XCircle,
  Loader2,
  ChevronDown,
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
import { BodyPortal } from "@/components/ui/body-portal";
import { fmtIstDateTime } from "@/lib/istTime";

// The drawing-sheet ink styles (same as System Maintenance and the Activity Browser).
const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
const INPUT = "border border-foreground/40 focus:border-foreground bg-card text-foreground placeholder:text-muted-foreground/60 outline-none";
const TAGBOX = "inline-flex items-center gap-1.5 border border-foreground/40 px-2 py-1 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-foreground";

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
      <span className="italic text-[0.625rem] text-muted-foreground/70">null</span>
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
        className="h-8 w-8 object-cover border border-foreground/30"
      />
    );
  }

  // Long string → truncate, show full on hover via title
  if (str.length > MAX_CELL_LEN) {
    return (
      <span
        title={str}
        className="text-[0.6875rem] tabular-nums cursor-default"
        style={{ wordBreak: "break-all" }}
      >
        {str.slice(0, MAX_CELL_LEN)}
        <span className="text-muted-foreground">…</span>
      </span>
    );
  }

  return <span className="text-[0.6875rem] tabular-nums">{str}</span>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DBADashboard() {
  const rights = usePageRights("dba-dashboard");
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
  const dbName = selectedDb ?? health?.database_name;
  const stats: { label: string; value: string | number; switcher?: boolean }[] = [
    { label: "Total Tables", value: healthLoading ? "…" : (health?.total_tables ?? "—") },
    { label: "Database", value: healthLoading ? "…" : (dbName ?? "—"), switcher: true },
    { label: "Total Size", value: healthLoading ? "…" : health ? `${(health.total_size_mb / 1024).toFixed(1)} GB` : "—" },
    { label: "Queries Logged", value: healthLoading ? "…" : (health?.total_queries ?? "—") },
  ];

  return (
    <>
      <Breadcrumbs items={["DBA", "Database Console"]} />

      <SheetShell
        eyebrow="CivilierERP · DBA"
        title="DBA Console"
        subtitle="Database access · Table browser · Query runner"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {dbaSessions.length > 0 && (
              <span className={TAGBOX}>
                <Users size={10} /> {dbaSessions.length} active
              </span>
            )}
            <span className={TAGBOX}>
              {socketConnected ? <Wifi size={10} /> : <WifiOff size={10} />}
              <SheetMark text={socketConnected ? "Live" : "Offline"} tone={socketConnected ? "done" : "draft"} />
            </span>
            <span className={TAGBOX}>
              <Database size={10} /> DBA
            </span>
          </div>
        }
      >
        {/* Figures */}
        <div className="bg-card" style={{ border: RULE }}>
          <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
            {stats.map((s) => (
              <div key={s.label} className="relative" ref={s.switcher ? dbPopoverRef : undefined}>
                <p className={LBL}>{s.label}</p>
                {s.switcher ? (
                  <button
                    type="button"
                    onClick={() => setDbPopoverOpen((o) => !o)}
                    aria-expanded={dbPopoverOpen}
                    title="Switch database"
                    className="mt-2 flex w-full items-center gap-2 text-left"
                  >
                    <span className="font-heading text-xl font-bold tabular-nums truncate leading-tight">{s.value}</span>
                    <ChevronDown size={13} className={`shrink-0 text-muted-foreground transition-transform duration-200 ${dbPopoverOpen ? "rotate-180" : ""}`} />
                  </button>
                ) : (
                  <p className="mt-2 font-heading text-xl font-bold tabular-nums truncate leading-tight">{s.value}</p>
                )}

                {/* DB switcher */}
                {s.switcher && dbPopoverOpen && (
                  <>
                    <BodyPortal><div className="fixed inset-0 z-40" onClick={() => setDbPopoverOpen(false)} /></BodyPortal>
                    <div className="absolute top-full left-0 z-50 mt-2 w-64 bg-card" style={{ border: RULE, boxShadow: "4px 4px 0 hsl(var(--foreground) / 0.12)" }}>
                      <div className="flex items-center gap-2 px-3 py-2.5" style={{ borderBottom: RULE }}>
                        <Database size={12} className="text-foreground" />
                        <span className={HEAD}>Switch database</span>
                      </div>
                      <div className="max-h-60 overflow-y-auto">
                        {databases.length === 0 ? (
                          <p className="py-4 text-center text-xs text-muted-foreground">Loading databases…</p>
                        ) : (
                          databases.map((db) => {
                            const isActive = (selectedDb ?? health?.database_name) === db.name;
                            return (
                              <button
                                key={db.name}
                                type="button"
                                onClick={() => {
                                  setSelectedDb(db.name);
                                  setDbPopoverOpen(false);
                                  toast.success(`Switched to database: ${db.name}`);
                                }}
                                className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-primary/10 ${isActive ? "bg-primary/10" : ""}`}
                                style={{ borderBottom: "1px solid hsl(var(--border) / 0.55)" }}
                              >
                                <span className="flex-1 truncate text-xs font-medium">{db.name}</span>
                                {isActive && <MarkSquare tone="done" />}
                              </button>
                            );
                          })
                        )}
                      </div>
                      {selectedDb && selectedDb !== health?.database_name && (
                        <div className="px-3 py-2" style={{ borderTop: RULE }}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedDb(null);
                              setDbPopoverOpen(false);
                              toast.info(`Reverted to default: ${health?.database_name}`);
                            }}
                            className={`${LBL} hover:text-foreground`}
                          >
                            Reset to default ({health?.database_name})
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-end gap-1 overflow-x-auto" style={{ borderBottom: RULE }}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key as any)}
              aria-pressed={activeTab === tab.key}
              className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-3 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] transition-colors ${
                activeTab === tab.key ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <tab.icon size={12} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW ── */}
        {activeTab === "overview" && (
          <div className="bg-card" style={{ border: RULE }}>
            <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: RULE }}>
              <span className="flex items-center gap-2">
                <Database size={13} />
                <span className={HEAD}>Database health</span>
              </span>
              <button type="button" className={`${KEY_LINE} h-8 px-3`} onClick={() => refetchHealth()} disabled={healthLoading}>
                <RefreshCw size={11} className={healthLoading ? "animate-spin" : ""} />
                Refresh
              </button>
            </div>
            {healthLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 size={22} className="animate-spin text-muted-foreground" />
              </div>
            ) : health ? (
              <dl className="grid grid-cols-1 sm:grid-cols-2">
                {[
                  { label: "Server name", value: health.server_name },
                  { label: "Database", value: health.database_name },
                  { label: "Total tables", value: health.total_tables },
                  { label: "Total size", value: `${health.total_size_mb?.toFixed(1)} MB` },
                ].map((r, i) => (
                  <div key={r.label} className="min-w-0 px-4 py-3.5" style={{ borderBottom: "1px solid hsl(var(--border) / 0.55)", borderLeft: i % 2 ? "1px solid hsl(var(--border))" : undefined }}>
                    <dt className={LBL}>{r.label}</dt>
                    <dd className="mt-1.5 truncate font-heading text-sm font-semibold tabular-nums">{String(r.value)}</dd>
                  </div>
                ))}
                <div className="min-w-0 px-4 py-3.5 sm:col-span-2">
                  <dt className={LBL}>SQL version</dt>
                  <dd className="mt-1.5 truncate text-xs font-medium">{health.sql_version?.split("\n")[0] ?? health.sql_version}</dd>
                </div>
              </dl>
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">Failed to load health data</p>
            )}
          </div>
        )}

        {/* ── TABLE BROWSER ── */}
        {activeTab === "tables" && (
          <div className="bg-card" style={{ border: RULE }}>
            <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" style={{ borderBottom: RULE }}>
              <span className="flex items-center gap-2">
                <HardDrive size={13} />
                <span className={HEAD}>Table browser</span>
                {!tablesLoading && <span className={`${LBL} tabular-nums`}>{filteredTables.length} / {tables.length}</span>}
              </span>
              <div className="flex gap-2">
                <input
                  placeholder="Search tables…"
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  className={`${INPUT} h-8 w-48 px-3 text-xs`}
                />
                <button type="button" className={`${KEY_LINE} h-8 w-8`} onClick={() => refetchTables()} disabled={tablesLoading} aria-label="Refresh tables">
                  <RefreshCw size={11} className={tablesLoading ? "animate-spin" : ""} />
                </button>
              </div>
            </div>
            {tablesLoading ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16">
                <Loader2 size={22} className="animate-spin text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Loading tables…</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Table</TableHead>
                      <TableHead>Schema</TableHead>
                      <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("row_count")}>
                        <span className="flex items-center gap-1">Rows <SortIcon col="row_count" /></span>
                      </TableHead>
                      <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("size_mb")}>
                        <span className="flex items-center gap-1">Size <SortIcon col="size_mb" /></span>
                      </TableHead>
                      <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("last_write")}>
                        <span className="flex items-center gap-1">Last write <SortIcon col="last_write" /></span>
                      </TableHead>
                      <TableHead className="pr-4 text-right" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTables.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-12 text-center text-xs text-muted-foreground">
                          No tables match your search
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredTables.map((t) => {
                        const sizeBar = Math.round(((t.size_mb ?? 0) / maxSizeMb) * 100);
                        const rowBar = Math.round(((t.row_count ?? 0) / maxRows) * 100);
                        const recentWrite = t.last_write && Date.now() - new Date(t.last_write).getTime() < 86400000;
                        return (
                          <TableRow key={`${t.schema_name}.${t.table_name}`} className="group text-xs">
                            <TableCell className="py-3 pl-4">
                              <div className="flex items-center gap-2">
                                <span title={recentWrite ? "Written to in the last day" : "No writes in the last day"}>
                                  <MarkSquare tone={recentWrite ? "done" : "draft"} />
                                </span>
                                <span className="text-[0.75rem] font-semibold text-foreground">{t.table_name}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-[0.6875rem] text-muted-foreground">{t.schema_name}</TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                <span className="font-heading text-[0.6875rem] font-semibold tabular-nums">{(t.row_count ?? 0).toLocaleString("en-IN")}</span>
                                <div className="h-0.5 w-20 bg-foreground/10">
                                  <div className="h-0.5 bg-foreground/55" style={{ width: `${rowBar}%` }} />
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                <span className="font-heading text-[0.6875rem] font-semibold tabular-nums">{t.size_mb?.toFixed(2) ?? "—"} MB</span>
                                <div className="h-0.5 w-20 bg-foreground/10">
                                  <div className={`h-0.5 ${sizeBar > 70 ? "bg-foreground" : "bg-foreground/55"}`} style={{ width: `${sizeBar}%` }} />
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="font-heading text-[0.6875rem] tabular-nums text-muted-foreground">
                              {t.last_write ? fmtIstDateTime(t.last_write, { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                            </TableCell>
                            <TableCell className="pr-4 text-right">
                              <button
                                type="button"
                                className={`${KEY_LINE} h-6 px-2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100`}
                                onClick={() => { setQueryText(`SELECT TOP 100 * FROM ${t.schema_name}.[${t.table_name}]`); setActiveTab("query"); }}
                              >
                                <Terminal size={10} /> Query
                              </button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

        {/* ── QUERY RUNNER ── */}
        {activeTab === "query" && (
          <div className="space-y-4">
            {/* Editor */}
            <div className="bg-card" style={{ border: RULE }}>
              <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: RULE }}>
                <span className="flex items-center gap-2">
                  <Terminal size={13} />
                  <span className={HEAD}>SQL query runner</span>
                </span>
                <span className="flex items-center gap-3">
                  {dbName && (
                    <span className={TAGBOX}>
                      <Database size={9} /> {dbName}
                    </span>
                  )}
                  <span className={LBL}>Ctrl+Enter to run</span>
                </span>
              </div>

              <div className="relative">
                <textarea
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                  onKeyDown={(e) => { if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); runQuery(); } }}
                  className="block min-h-[140px] w-full resize-none border-0 bg-card px-4 py-3 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
                  placeholder="SELECT TOP 100 * FROM dbo.users WHERE discontinue = 0"
                  spellCheck={false}
                />
                {/\b(DROP|TRUNCATE|ALTER|DELETE|INSERT|UPDATE|EXEC|EXECUTE)\b/i.test(queryText) && (
                  <div className="absolute bottom-2 right-3 flex items-center gap-1 border border-destructive bg-card px-2 py-0.5 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-destructive">
                    <AlertTriangle size={9} /> Destructive — will require confirmation
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5" style={{ borderTop: RULE }}>
                <div className={`flex items-center gap-3 ${LBL}`}>
                  <span className="tabular-nums">{queryText.length} chars</span>
                  {lastRunMs !== null && (
                    <span className="flex items-center gap-1 tabular-nums">
                      <Clock size={9} /> {lastRunMs}ms
                    </span>
                  )}
                  {queryResult && <span className="tabular-nums text-foreground">{queryResult.rowCount} row(s) returned</span>}
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" className={`${KEY_LINE} h-7 px-2.5`} onClick={() => navigator.clipboard.writeText(queryText)}>
                    <Copy size={9} /> Copy
                  </button>
                  <button type="button" className={`${KEY_LINE} h-7 px-2.5`} onClick={() => { setQueryText(""); setQueryResult(null); setQueryError(null); setLastRunMs(null); }}>
                    <Trash2 size={9} /> Clear
                  </button>
                  {rights.canEdit && (
                    <button type="button" className={`${KEY_INK} h-7 px-3.5`} onClick={runQuery} disabled={queryMutation.isPending || !queryText.trim()}>
                      {queryMutation.isPending ? <><Loader2 size={11} className="animate-spin" /> Running…</> : <><Play size={11} /> Run query</>}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Error */}
            {queryError && (
              <div className="flex items-start gap-3 border border-destructive bg-destructive/5 px-4 py-3">
                <XCircle size={14} className="mt-0.5 shrink-0 text-destructive" />
                <div className="min-w-0">
                  <p className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-destructive">Query error</p>
                  <p className="mt-1 break-words font-mono text-xs text-destructive">{queryError}</p>
                </div>
              </div>
            )}

            {/* Results */}
            {queryResult && queryResult.rows.length > 0 && (
              <div className="bg-card" style={{ border: RULE }}>
                <div className="flex items-center justify-between gap-3 px-4 py-2.5" style={{ borderBottom: RULE }}>
                  <div className="flex items-center gap-2">
                    <MarkSquare tone="done" />
                    <span className={HEAD}>{queryResult.rowCount} row(s)</span>
                    {lastRunMs !== null && <span className={`${LBL} tabular-nums`}>· {lastRunMs}ms</span>}
                  </div>
                  <button
                    type="button"
                    className={`${KEY_LINE} h-7 px-2.5`}
                    onClick={() => navigator.clipboard.writeText(
                      [Object.keys(queryResult.rows[0]).join("\t"),
                       ...queryResult.rows.map((r) => Object.values(r).join("\t"))].join("\n")
                    )}
                  >
                    <Copy size={9} /> Copy as TSV
                  </button>
                </div>
                <div className="max-h-[400px] overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-card">
                      <TableRow>
                        {Object.keys(queryResult.rows[0]).map((k) => (
                          <TableHead key={k} className="whitespace-nowrap">{k}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {queryResult.rows.map((row, i) => (
                        <TableRow key={i} className="text-xs">
                          {Object.values(row).map((v, j) => (
                            <TableCell key={j} className="py-1.5 align-middle">
                              <QueryCellValue value={v} />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {queryResult && queryResult.rowCount === 0 && (
              <div className="border border-foreground/40 bg-card px-4 py-8 text-center">
                <div className="flex justify-center"><SheetMark text="Query executed successfully" tone="done" /></div>
                <p className="mt-2 text-[0.6875rem] text-muted-foreground">0 rows returned</p>
              </div>
            )}
          </div>
        )}

        {/* ── QUERY HISTORY ── */}
        {activeTab === "history" && (
          <div className="space-y-4">
            {/* Live feed from other DBA sessions */}
            {liveQueryFeed.length > 0 && (
              <div className="border border-dashed border-foreground/50 bg-card px-4 py-3">
                <div className="mb-2 flex items-center gap-2">
                  <MarkSquare tone="moving" />
                  <span className={HEAD}>Live — other DBA sessions</span>
                </div>
                <div className="space-y-1.5">
                  {liveQueryFeed.slice(0, 5).map((entry, i) => (
                    <div key={i} className="flex items-center gap-3 text-[0.6875rem]">
                      <MarkSquare tone={entry.status === "success" ? "done" : "stopped"} />
                      <span className="w-24 shrink-0 text-muted-foreground">{entry.name}</span>
                      <span className="flex-1 truncate font-mono text-foreground">{entry.query}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{entry.rowCount}r</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* History list */}
            <div className="bg-card" style={{ border: RULE }}>
              <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: RULE }}>
                <span className="flex items-center gap-2">
                  <Activity size={13} />
                  <span className={HEAD}>Query history</span>
                  {history.length > 0 && <span className={`${LBL} tabular-nums`}>{history.length}</span>}
                </span>
                <button type="button" className={`${KEY_LINE} h-8 px-3`} onClick={() => refetchHistory()} disabled={historyLoading}>
                  <RefreshCw size={11} className={historyLoading ? "animate-spin" : ""} /> Refresh
                </button>
              </div>
              {historyLoading ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16">
                  <Loader2 size={22} className="animate-spin text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Loading history…</p>
                </div>
              ) : history.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16">
                  <Activity size={24} className="text-muted-foreground/40" />
                  <p className="text-xs text-muted-foreground">No query history yet</p>
                </div>
              ) : (
                <div>
                  {history.map((q) => (
                    <div key={q.id} className="group flex items-start gap-4 px-4 py-3 transition-colors hover:bg-primary/5" style={{ borderBottom: "1px solid hsl(var(--border) / 0.55)" }}>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="font-heading text-[0.625rem] tabular-nums text-muted-foreground">
                            {fmtIstDateTime(q.executed_at, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })}
                          </span>
                          {q.executed_by && <span className="text-[0.625rem] text-muted-foreground">{q.executed_by}</span>}
                          <SheetMark text={q.status} tone={q.status === "success" ? "done" : "stopped"} />
                          {q.rows_affected != null && <span className="text-[0.625rem] tabular-nums text-muted-foreground">{q.rows_affected} rows</span>}
                        </div>
                        <p className="truncate border-l-2 border-foreground/30 pl-2 font-mono text-[0.6875rem] text-foreground">{q.query_text}</p>
                        {q.error_message && <p className="font-mono text-[0.625rem] text-destructive">{q.error_message}</p>}
                      </div>
                      <button
                        type="button"
                        className={`${KEY_LINE} h-6 shrink-0 px-2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100`}
                        onClick={() => { setQueryText(q.query_text); setActiveTab("query"); }}
                      >
                        <RotateCcw size={9} /> Reuse
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </SheetShell>

      {/* Dangerous query confirm */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sheet-frame max-w-md" style={{ margin: 0 }}>
          <DialogHeader>
            <div className="pb-3" style={{ borderBottom: RULE }}>
              <p className={LBL}>DBA Console</p>
              <DialogTitle className="mt-1 flex items-center gap-2 font-heading text-lg font-bold tracking-tight text-destructive">
                <AlertTriangle size={18} /> Destructive operation
              </DialogTitle>
            </div>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              This query contains a write or destructive operation. Are you sure you want to execute?
            </p>
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap border border-foreground/40 bg-card p-3 font-mono text-xs">
              {pendingQuery}
            </pre>
            <p className="flex items-center gap-1 text-xs text-destructive">
              <AlertTriangle size={11} /> This action may be irreversible.
            </p>
          </div>
          <DialogFooter className="pt-3" style={{ borderTop: RULE }}>
            <button type="button" className={`${KEY_LINE} h-9 px-4`} onClick={() => setConfirmOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className={`${KEY} h-9 border border-destructive bg-destructive px-5 text-destructive-foreground hover:bg-destructive/90`}
              onClick={executeConfirmed}
              disabled={queryMutation.isPending}
            >
              Execute anyway
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

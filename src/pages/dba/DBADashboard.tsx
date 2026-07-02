import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DbaShell } from "@/components/dba/DbaShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
} from "lucide-react";
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
    enabled: activeTab === "overview",
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
      setQueryResult(data);
      setQueryError(null);
      toast.success(`Query executed — ${data.rowCount} row(s) returned`);
      // Invalidate history so count + list stay fresh
      queryClient.invalidateQueries({ queryKey: ["dba-query-history"] });
    },
    onError: (err: Error) => {
      setQueryError(err.message);
      setQueryResult(null);
      toast.error(err.message);
      // Still invalidate — backend logs failed queries too
      queryClient.invalidateQueries({ queryKey: ["dba-query-history"] });
    },
  });

  const runQuery = useCallback(() => {
    const isDangerous =
      /\b(DROP|TRUNCATE|ALTER|DELETE|INSERT|UPDATE|EXEC|EXECUTE)\b/i.test(
        queryText,
      );
    if (isDangerous) {
      setPendingQuery(queryText);
      setConfirmOpen(true);
      return;
    }
    queryMutation.mutate(queryText);
  }, [queryText, queryMutation]);

  const executeConfirmed = useCallback(() => {
    setConfirmOpen(false);
    queryMutation.mutate(pendingQuery);
  }, [pendingQuery, queryMutation]);

  const filteredTables = tables.filter((t) =>
    `${t.schema_name}.${t.table_name}`
      .toLowerCase()
      .includes(tableSearch.toLowerCase()),
  );

  const _totalSizeMb = tables.reduce((s, t) => s + (t.size_mb ?? 0), 0);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <Breadcrumbs items={["DBA", "Database Console"]} />

      <DbaShell
        title="DBA Console"
        subtitle="Database access · Table browser · Query runner"
        icon={Database}
        action={
          <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-xs px-3">
            <Database size={10} className="mr-1" /> DBA
          </Badge>
        }
      >
      {/* Stats strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          {
            label: "Total Tables",
            value: healthLoading ? "…" : (health?.total_tables ?? "—"),
            icon: HardDrive,
            color: "text-blue-500",
            bg: "bg-blue-500/10",
            clickable: false,
          },
          {
            label: "Database",
            value: healthLoading
              ? "…"
              : (selectedDb ?? health?.database_name ?? "—"),
            icon: Database,
            color: "text-green-500",
            bg: "bg-green-500/10",
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
            color: "text-purple-500",
            bg: "bg-purple-500/10",
            clickable: false,
          },
          {
            label: "Queries Logged",
            value: history.length || "—",
            icon: Terminal,
            color: "text-orange-500",
            bg: "bg-orange-500/10",
            clickable: false,
          },
        ].map((s) =>
          s.clickable ? (
            <div key={s.label} className="relative" ref={dbPopoverRef}>
              <Card
                className="cursor-pointer hover:border-green-500/40 hover:shadow-md transition-all duration-150 select-none"
                onClick={() => setDbPopoverOpen((o) => !o)}
              >
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${s.bg}`}>
                    <s.icon size={18} className={s.color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-2xl font-bold truncate max-w-[110px]">
                      {s.value}
                    </p>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                  </div>
                  <ChevronDown
                    size={14}
                    className={`text-muted-foreground transition-transform duration-200 flex-shrink-0 ${dbPopoverOpen ? "rotate-180" : ""}`}
                  />
                </CardContent>
              </Card>

              {/* DB Switcher Dropdown */}
              {dbPopoverOpen && (
                <>
                  {/* Backdrop */}
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setDbPopoverOpen(false)}
                  />
                  <div className="absolute top-full mt-2 left-0 z-50 w-64 rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
                      <Database size={13} className="text-green-500" />
                      <span className="text-xs font-heading font-semibold text-foreground uppercase tracking-wider">
                        Switch Database
                      </span>
                    </div>
                    <div className="p-1.5 max-h-60 overflow-y-auto">
                      {databases.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-4">
                          Loading databases…
                        </p>
                      ) : (
                        databases.map((db) => {
                          const isActive =
                            (selectedDb ?? health?.database_name) === db.name;
                          return (
                            <button
                              key={db.name}
                              onClick={() => {
                                setSelectedDb(db.name);
                                setDbPopoverOpen(false);
                                toast.success(
                                  `Switched to database: ${db.name}`,
                                );
                              }}
                              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all duration-150 text-sm font-heading ${
                                isActive
                                  ? "bg-green-500/10 text-green-600"
                                  : "hover:bg-muted text-foreground"
                              }`}
                            >
                              <Database
                                size={13}
                                className={
                                  isActive
                                    ? "text-green-500"
                                    : "text-muted-foreground"
                                }
                              />
                              <span className="flex-1 truncate font-mono text-xs">
                                {db.name}
                              </span>
                              {isActive && (
                                <Check
                                  size={12}
                                  className="text-green-500 flex-shrink-0"
                                />
                              )}
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
                            toast.info(
                              `Reverted to default: ${health?.database_name}`,
                            );
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
            <Card key={s.label}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`p-2 rounded-lg ${s.bg}`}>
                  <s.icon size={18} className={s.color} />
                </div>
                <div>
                  <p className="text-2xl font-bold truncate max-w-[120px]">
                    {s.value}
                  </p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          ),
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {activeTab === "overview" && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Database size={16} className="text-primary" />
                Database Health
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1"
                onClick={() => refetchHealth()}
                disabled={healthLoading}
              >
                <RefreshCw
                  size={12}
                  className={healthLoading ? "animate-spin" : ""}
                />{" "}
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {healthLoading ? (
              <div className="flex justify-center py-12">
                <Loader2
                  size={24}
                  className="animate-spin text-muted-foreground"
                />
              </div>
            ) : health ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  {
                    label: "Server Name",
                    value: health.server_name,
                    mono: true,
                  },
                  {
                    label: "Database",
                    value: health.database_name,
                    mono: true,
                  },
                  { label: "Total Tables", value: health.total_tables },
                  {
                    label: "Total Size",
                    value: `${health.total_size_mb?.toFixed(1)} MB`,
                  },
                  {
                    label: "SQL Version",
                    value:
                      health.sql_version?.split("\n")[0] ?? health.sql_version,
                    mono: true,
                  },
                ].map((r) => (
                  <div
                    key={r.label}
                    className="flex flex-col gap-0.5 bg-muted/40 rounded-lg px-4 py-3"
                  >
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading">
                      {r.label}
                    </span>
                    <span
                      className={`text-sm font-semibold truncate ${r.mono ? "font-mono" : ""}`}
                    >
                      {String(r.value)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                Failed to load health data
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── TABLE BROWSER ── */}
      {activeTab === "tables" && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <HardDrive size={16} className="text-primary" /> Table Browser
                {!tablesLoading && (
                  <span className="text-xs text-muted-foreground font-normal">
                    ({filteredTables.length} / {tables.length})
                  </span>
                )}
              </CardTitle>
              <div className="flex gap-2">
                <Input
                  placeholder="Search table..."
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  className="h-8 text-xs w-44"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1"
                  onClick={() => refetchTables()}
                  disabled={tablesLoading}
                >
                  <RefreshCw
                    size={11}
                    className={tablesLoading ? "animate-spin" : ""}
                  />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {tablesLoading ? (
              <div className="flex justify-center py-12">
                <Loader2
                  size={24}
                  className="animate-spin text-muted-foreground"
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="text-xs">
                      <TableHead>Table</TableHead>
                      <TableHead>Schema</TableHead>
                      <TableHead>Rows</TableHead>
                      <TableHead>Size (MB)</TableHead>
                      <TableHead>Last Write</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTables.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="text-center text-xs text-muted-foreground py-8"
                        >
                          No tables found
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredTables.map((t) => (
                        <TableRow
                          key={`${t.schema_name}.${t.table_name}`}
                          className="text-xs"
                        >
                          <TableCell className="font-mono text-[11px] font-semibold text-primary">
                            {t.table_name}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {t.schema_name}
                          </TableCell>
                          <TableCell>
                            {(t.row_count ?? 0).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {t.size_mb?.toFixed(2) ?? "—"}
                          </TableCell>
                          <TableCell className="text-muted-foreground font-mono text-[10px]">
                            {t.last_write
                              ? new Date(t.last_write).toLocaleDateString(
                                  "en-IN",
                                )
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-[10px] gap-1"
                              onClick={() => {
                                setQueryText(
                                  `SELECT TOP 100 * FROM ${t.schema_name}.[${t.table_name}]`,
                                );
                                setActiveTab("query");
                              }}
                            >
                              <Terminal size={10} /> Query
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
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
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Terminal size={16} className="text-primary" /> SQL Query Runner
                {(selectedDb ?? health?.database_name) && (
                  <span className="ml-auto text-[10px] font-normal font-mono px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 border border-green-500/20">
                    <Database size={9} className="inline mr-1" />
                    {selectedDb ?? health?.database_name}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label className="text-xs">
                  SQL Query (SELECT only via safe endpoint)
                </Label>
                <Textarea
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                  className="font-mono text-xs min-h-[100px] resize-none"
                  placeholder="SELECT * FROM dbo.users"
                />
                {/\b(DROP|TRUNCATE|ALTER|DELETE|INSERT|UPDATE|EXEC|EXECUTE)\b/i.test(
                  queryText,
                ) && (
                  <p className="text-xs text-orange-500 flex items-center gap-1">
                    <AlertTriangle size={11} /> Write/destructive operation —
                    confirmation required before execution
                  </p>
                )}
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="gap-1 text-xs"
                  onClick={runQuery}
                  disabled={queryMutation.isPending}
                >
                  {queryMutation.isPending ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Play size={12} />
                  )}
                  {queryMutation.isPending ? "Running…" : "Run Query"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 text-xs"
                  onClick={() => {
                    setQueryText("");
                    setQueryResult(null);
                    setQueryError(null);
                  }}
                >
                  <Trash2 size={12} /> Clear
                </Button>
              </div>
            </CardContent>
          </Card>

          {queryError && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-xs text-red-600 flex items-center gap-2">
              <XCircle size={14} /> {queryError}
            </div>
          )}

          {queryResult && queryResult.rows.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-green-500" />
                  Result — {queryResult.rowCount} row(s)
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs">
                        {Object.keys(queryResult.rows[0]).map((k) => (
                          <TableHead key={k}>{k}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {queryResult.rows.map((row, i) => (
                        <TableRow key={i} className="text-xs">
                          {Object.values(row).map((v, j) => (
                            <TableCell key={j} className="align-middle">
                              <QueryCellValue value={v} />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {queryResult && queryResult.rowCount === 0 && (
            <div className="rounded-lg bg-muted/40 border border-border px-4 py-6 text-xs text-muted-foreground text-center">
              Query executed successfully — 0 rows returned
            </div>
          )}
        </div>
      )}

      {/* ── QUERY HISTORY ── */}
      {activeTab === "history" && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity size={16} className="text-primary" /> Query History
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1"
                onClick={() => refetchHistory()}
                disabled={historyLoading}
              >
                <RefreshCw
                  size={11}
                  className={historyLoading ? "animate-spin" : ""}
                />{" "}
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {historyLoading ? (
              <div className="flex justify-center py-12">
                <Loader2
                  size={24}
                  className="animate-spin text-muted-foreground"
                />
              </div>
            ) : history.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-12">
                No query history yet
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="text-xs">
                      <TableHead>Time</TableHead>
                      <TableHead>Executed By</TableHead>
                      <TableHead>Query</TableHead>
                      <TableHead>Rows</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((q) => (
                      <TableRow key={q.id} className="text-xs">
                        <TableCell className="font-mono text-muted-foreground text-[10px]">
                          {new Date(q.executed_at).toLocaleString("en-IN")}
                        </TableCell>
                        <TableCell className="text-[11px]">
                          {q.executed_by ?? "—"}
                        </TableCell>
                        <TableCell className="font-mono text-[10px] max-w-xs truncate">
                          {q.query_text}
                        </TableCell>
                        <TableCell>{q.rows_affected ?? 0}</TableCell>
                        <TableCell>
                          <Badge
                            className={`text-[10px] ${
                              q.status === "success"
                                ? "bg-green-500/15 text-green-600 border-green-500/30"
                                : "bg-red-500/15 text-red-600 border-red-500/30"
                            }`}
                          >
                            {q.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
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

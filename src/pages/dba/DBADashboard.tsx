import React, { useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Building2,
  Server,
  HardDrive,
  Cpu,
  Play,
  Trash2,
  Download,
  Upload,
  Search,
  Key,
  XCircle,
  Globe,
} from "lucide-react";
import { toast } from "sonner";

// ─── Tenant Master (fetched from masters) ────────────────────────────────────
const TENANT_MASTERS = [
  { id: "T-001", name: "Civilier Constructions Pvt Ltd", dbName: "civilier_prod", server: "sql-prod-01", status: "online", size: "2.8 GB", tables: 42, lastBackup: "2026-04-03 02:00" },
  { id: "T-002", name: "Buildtech Infrastructure Ltd", dbName: "buildtech_prod", server: "sql-prod-01", status: "online", size: "1.1 GB", tables: 38, lastBackup: "2026-04-03 02:05" },
  { id: "T-003", name: "Apex Realty Developers", dbName: "apex_prod", server: "sql-prod-02", status: "offline", size: "0.4 GB", tables: 36, lastBackup: "2026-03-15 02:00" },
  { id: "T-004", name: "Metro Projects Group", dbName: "metro_prod", server: "sql-prod-02", status: "online", size: "1.9 GB", tables: 40, lastBackup: "2026-04-03 02:10" },
];

const ALL_DB_TABLES = [
  { table: "dbo.users", tenantId: "T-001", rows: 18, size: "1.2 MB", lastWrite: "2026-04-03", health: "healthy" },
  { table: "dbo.enterprise", tenantId: "T-001", rows: 1, size: "0.1 MB", lastWrite: "2026-03-20", health: "healthy" },
  { table: "dbo.expense_booking", tenantId: "T-001", rows: 342, size: "8.4 MB", lastWrite: "2026-04-03", health: "healthy" },
  { table: "dbo.payment", tenantId: "T-001", rows: 156, size: "4.2 MB", lastWrite: "2026-04-02", health: "healthy" },
  { table: "dbo.purchase_orders", tenantId: "T-001", rows: 89, size: "3.1 MB", lastWrite: "2026-04-01", health: "warning" },
  { table: "dbo.users", tenantId: "T-002", rows: 9, size: "0.6 MB", lastWrite: "2026-04-02", health: "healthy" },
  { table: "dbo.expense_booking", tenantId: "T-002", rows: 121, size: "3.2 MB", lastWrite: "2026-04-02", health: "healthy" },
  { table: "dbo.users", tenantId: "T-004", rows: 14, size: "0.9 MB", lastWrite: "2026-04-03", health: "healthy" },
  { table: "dbo.purchase_orders", tenantId: "T-004", rows: 44, size: "1.8 MB", lastWrite: "2026-04-03", health: "healthy" },
];

const QUERY_HISTORY = [
  { time: "2026-04-03 10:14", tenant: "T-001", query: "SELECT * FROM dbo.users WHERE discontinue = 0", rows: 18, status: "success" },
  { time: "2026-04-03 09:45", tenant: "T-002", query: "UPDATE dbo.enterprise SET status = 'active' WHERE id = 1", rows: 1, status: "success" },
  { time: "2026-04-02 17:30", tenant: "T-001", query: "DELETE FROM dbo.expense_booking WHERE id = 442", rows: 1, status: "success" },
  { time: "2026-04-02 15:10", tenant: "T-004", query: "SELECT COUNT(*) FROM dbo.payment WHERE paid_date >= '2026-04-01'", rows: 1, status: "success" },
  { time: "2026-04-02 11:00", tenant: "T-003", query: "ALTER TABLE dbo.users ADD COLUMN tenant_id INT", rows: 0, status: "error" },
];

export default function DBADashboard() {
  const [activeTab, setActiveTab] = useState<"overview" | "tables" | "query" | "history">("overview");
  const [selectedTenant, setSelectedTenant] = useState<string>("all");
  const [queryText, setQueryText] = useState("SELECT TOP 100 * FROM dbo.users WHERE discontinue = 0");
  const [queryTenant, setQueryTenant] = useState("T-001");
  const [queryResult, setQueryResult] = useState<any[] | null>(null);
  const [queryRunning, setQueryRunning] = useState(false);
  const [tableSearch, setTableSearch] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingQuery, setPendingQuery] = useState("");

  const tabs = [
    { key: "overview", label: "DB Overview", icon: Database },
    { key: "tables", label: "Table Browser", icon: HardDrive },
    { key: "query", label: "Query Runner", icon: Terminal },
    { key: "history", label: "Query History", icon: Activity },
  ];

  const runQuery = () => {
    const isDangerous = /DROP|TRUNCATE|ALTER|DELETE\s+FROM\s+dbo\.(users|enterprise)/i.test(queryText);
    if (isDangerous) {
      setPendingQuery(queryText);
      setConfirmOpen(true);
      return;
    }
    executeQuery();
  };

  const executeQuery = () => {
    setConfirmOpen(false);
    setQueryRunning(true);
    setTimeout(() => {
      setQueryResult([
        { id: 1, name: "Rajesh Kumar", email: "rajesh@civilier.com", role: "user", discontinue: false },
        { id: 2, name: "Meena Patel", email: "meena@civilier.com", role: "user", discontinue: false },
        { id: 3, name: "Admin User", email: "admin@civilier.com", role: "admin", discontinue: false },
      ]);
      setQueryRunning(false);
      toast.success("Query executed — 3 rows returned");
    }, 800);
  };

  const filteredTables = ALL_DB_TABLES.filter(t =>
    (selectedTenant === "all" || t.tenantId === selectedTenant) &&
    t.table.toLowerCase().includes(tableSearch.toLowerCase())
  );

  const totalSize = TENANT_MASTERS.reduce((acc, t) => acc + parseFloat(t.size), 0).toFixed(1);
  const onlineCount = TENANT_MASTERS.filter(t => t.status === "online").length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <Breadcrumbs items={["DBA", "Database Console"]} />

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-emerald-500/10 rounded-lg">
          <Database className="text-emerald-500" size={22} />
        </div>
        <div>
          <h1 className="text-xl font-bold">DBA Console</h1>
          <p className="text-sm text-muted-foreground">Global database access · All tenants · Data manipulation</p>
        </div>
        <Badge className="ml-auto bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-xs px-3">
          <Database size={10} className="mr-1" /> DBA
        </Badge>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total Tenants", value: TENANT_MASTERS.length, icon: Building2, color: "text-blue-500", bg: "bg-blue-500/10" },
          { label: "Online DBs", value: `${onlineCount}/${TENANT_MASTERS.length}`, icon: Server, color: "text-green-500", bg: "bg-green-500/10" },
          { label: "Total Data", value: `${totalSize} GB`, icon: HardDrive, color: "text-purple-500", bg: "bg-purple-500/10" },
          { label: "Queries Today", value: QUERY_HISTORY.filter(q => q.time.startsWith("2026-04-03")).length, icon: Terminal, color: "text-orange-500", bg: "bg-orange-500/10" },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`p-2 rounded-lg ${s.bg}`}>
                <s.icon size={18} className={s.color} />
              </div>
              <div>
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-border">
        {tabs.map(tab => (
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

      {/* OVERVIEW */}
      {activeTab === "overview" && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Globe size={16} className="text-primary" />
                Tenant Database Registry
                <span className="text-xs text-muted-foreground font-normal">(fetched from tenant masters)</span>
              </CardTitle>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => toast.success("Refreshed")}>
                <RefreshCw size={12} /> Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Tenant ID</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>DB Name</TableHead>
                    <TableHead>Server</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Tables</TableHead>
                    <TableHead>Last Backup</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {TENANT_MASTERS.map(t => (
                    <TableRow key={t.id} className="text-xs">
                      <TableCell>
                        <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-primary font-semibold text-[11px]">{t.id}</span>
                      </TableCell>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">{t.dbName}</TableCell>
                      <TableCell className="text-muted-foreground">{t.server}</TableCell>
                      <TableCell>{t.size}</TableCell>
                      <TableCell>{t.tables}</TableCell>
                      <TableCell className="text-muted-foreground">{t.lastBackup}</TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] ${t.status === "online" ? "bg-green-500/15 text-green-600 border-green-500/30" : "bg-red-500/15 text-red-600 border-red-500/30"}`}>
                          {t.status === "online" ? <CheckCircle2 size={9} className="mr-1 inline" /> : <XCircle size={9} className="mr-1 inline" />}
                          {t.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end">
                          <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" onClick={() => { setQueryTenant(t.id); setActiveTab("query"); }}>
                            <Terminal size={10} /> Query
                          </Button>
                          <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" onClick={() => toast.success(`Backup triggered for ${t.dbName}`)}>
                            <Download size={10} /> Backup
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* TABLE BROWSER */}
      {activeTab === "tables" && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <HardDrive size={16} className="text-primary" /> Table Browser
              </CardTitle>
              <div className="flex gap-2">
                <Input
                  placeholder="Search table..."
                  value={tableSearch}
                  onChange={e => setTableSearch(e.target.value)}
                  className="h-8 text-xs w-40"
                />
                <Select value={selectedTenant} onValueChange={setSelectedTenant}>
                  <SelectTrigger className="h-8 w-32 text-xs">
                    <SelectValue placeholder="All tenants" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Tenants</SelectItem>
                    {TENANT_MASTERS.map(t => <SelectItem key={t.id} value={t.id}>{t.id} — {t.dbName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="text-xs">
                  <TableHead>Table</TableHead>
                  <TableHead>Tenant ID</TableHead>
                  <TableHead>Rows</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Last Write</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTables.map((t, i) => (
                  <TableRow key={i} className="text-xs">
                    <TableCell className="font-mono text-[11px]">{t.table}</TableCell>
                    <TableCell>
                      <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-primary text-[11px]">{t.tenantId}</span>
                    </TableCell>
                    <TableCell>{t.rows.toLocaleString()}</TableCell>
                    <TableCell className="text-muted-foreground">{t.size}</TableCell>
                    <TableCell className="text-muted-foreground">{t.lastWrite}</TableCell>
                    <TableCell>
                      <Badge className={`text-[10px] ${t.health === "healthy" ? "bg-green-500/15 text-green-600 border-green-500/30" : "bg-orange-500/15 text-orange-600 border-orange-500/30"}`}>
                        {t.health}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" onClick={() => {
                        setQueryTenant(t.tenantId);
                        setQueryText(`SELECT TOP 100 * FROM ${t.table}`);
                        setActiveTab("query");
                      }}>
                        <Terminal size={10} /> Query
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* QUERY RUNNER */}
      {activeTab === "query" && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Terminal size={16} className="text-primary" /> SQL Query Runner
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-3 items-end">
                <div className="space-y-1 flex-1">
                  <Label className="text-xs flex items-center gap-1">
                    <Key size={11} /> Target Tenant
                  </Label>
                  <Select value={queryTenant} onValueChange={setQueryTenant}>
                    <SelectTrigger className="text-xs h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TENANT_MASTERS.map(t => (
                        <SelectItem key={t.id} value={t.id}>
                          <span className="font-mono">{t.id}</span> — {t.dbName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="text-xs text-muted-foreground pb-2">
                  DB: <span className="font-mono text-primary">{TENANT_MASTERS.find(t => t.id === queryTenant)?.dbName}</span>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">SQL Query</Label>
                <Textarea
                  value={queryText}
                  onChange={e => setQueryText(e.target.value)}
                  className="font-mono text-xs min-h-[100px] resize-none"
                  placeholder="SELECT * FROM dbo.users"
                />
                {/DROP|TRUNCATE|ALTER/i.test(queryText) && (
                  <p className="text-xs text-orange-500 flex items-center gap-1">
                    <AlertTriangle size={11} /> Destructive operation detected — confirmation required
                  </p>
                )}
              </div>

              <div className="flex gap-2">
                <Button size="sm" className="gap-1 text-xs" onClick={runQuery} disabled={queryRunning}>
                  <Play size={12} /> {queryRunning ? "Running..." : "Run Query"}
                </Button>
                <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => { setQueryText(""); setQueryResult(null); }}>
                  <Trash2 size={12} /> Clear
                </Button>
              </div>
            </CardContent>
          </Card>

          {queryResult && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-green-500" />
                  Result — {queryResult.length} rows
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs">
                        {Object.keys(queryResult[0]).map(k => <TableHead key={k}>{k}</TableHead>)}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {queryResult.map((row, i) => (
                        <TableRow key={i} className="text-xs">
                          {Object.values(row).map((v, j) => (
                            <TableCell key={j}>{String(v)}</TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* HISTORY */}
      {activeTab === "history" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity size={16} className="text-primary" /> Query History
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="text-xs">
                  <TableHead>Time</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Query</TableHead>
                  <TableHead>Rows</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {QUERY_HISTORY.map((q, i) => (
                  <TableRow key={i} className="text-xs">
                    <TableCell className="font-mono text-muted-foreground">{q.time}</TableCell>
                    <TableCell>
                      <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-primary text-[11px]">{q.tenant}</span>
                    </TableCell>
                    <TableCell className="font-mono text-[11px] max-w-xs truncate">{q.query}</TableCell>
                    <TableCell>{q.rows}</TableCell>
                    <TableCell>
                      <Badge className={`text-[10px] ${q.status === "success" ? "bg-green-500/15 text-green-600 border-green-500/30" : "bg-red-500/15 text-red-600 border-red-500/30"}`}>
                        {q.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* DANGEROUS QUERY CONFIRM */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-500">
              <AlertTriangle size={18} /> Destructive Operation
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-muted-foreground">This query contains a destructive operation. Are you sure you want to execute?</p>
            <pre className="bg-muted p-3 rounded text-xs font-mono overflow-x-auto">{pendingQuery}</pre>
            <p className="text-xs text-red-500 flex items-center gap-1">
              <AlertTriangle size={11} /> This action cannot be undone.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={executeQuery}>Execute Anyway</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

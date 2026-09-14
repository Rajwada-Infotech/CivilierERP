import React, { useState, useEffect, useMemo } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { DbaShell } from "@/components/dba/DbaShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BellRing,
  Clock,
  AlertTriangle,
  Send,
  QrCode,
  Users,
  Wallet,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

export default function RemindersManager() {
  usePageRights("dba-reminders");
  const [reminders, setReminders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  const loadData = async () => {
    setLoading(true);
    try {
      const response = await fetchWithAuth("/api/tenant-reminders");
      if (response.ok) {
        const data = await response.json();
        setReminders(Array.isArray(data) ? data : data.data || []);
      }
    } catch {
      toast.error("Failed to sync billing data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const stats = useMemo(() => {
    const overdue = reminders.filter((r) => r.status === "overdue");
    return {
      overdueCount: overdue.length,
      totalCount: reminders.length,
      overdueSum: overdue.reduce((a, b) => a + (b.amountDue || 0), 0),
    };
  }, [reminders]);

  const handleSend = async (id: string) => {
    try {
      await fetchWithAuth(`/api/reminders/send/${id}`, { method: "POST" });
      toast.success("Notification dispatched to tenant");
      loadData();
    } catch {
      toast.error("Message delivery failed");
    }
  };

  const filtered = reminders.filter(
    (r) => filter === "all" || r.status === filter,
  );

  return (
    <div className="max-w-[1400px] mx-auto">
      {/* Header */}
      <Breadcrumbs items={[{ label: "DBA Console" }, { label: "Reminders" }]} />

      <DbaShell
        title="Reminders Manager"
        subtitle="Live tenant subscription and collection monitoring."
        icon={BellRing}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={loading}
            className="group gap-1.5 text-xs active:scale-90 transition-transform"
          >
            <RefreshCw
              size={12}
              className={`transition-transform duration-500 ${loading ? "animate-spin" : "group-hover:rotate-180"}`}
            />
            Sync Live
          </Button>
        }
      >
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-500/10">
              <AlertTriangle size={15} className="text-red-500" />
            </div>
            <div>
              <div className="text-lg font-bold leading-none">
                ₹{stats.overdueSum.toLocaleString()}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                Overdue Volume
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-yellow-500/10">
              <Clock size={15} className="text-yellow-500" />
            </div>
            <div>
              <div className="text-lg font-bold leading-none">
                {stats.overdueCount}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                Pending Alerts
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <Users size={15} className="text-emerald-500" />
            </div>
            <div>
              <div className="text-lg font-bold leading-none">
                {stats.totalCount}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                Tracked Tenants
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Wallet size={14} className="text-primary" /> Billing Queue
          </CardTitle>
          <div className="flex border rounded-lg p-0.5 gap-0.5 bg-muted/30">
            {["all", "overdue", "scheduled"].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-[10px] font-semibold uppercase rounded transition-all ${
                  filter === f
                    ? "bg-primary text-primary-foreground shadow"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="text-xs">
                  <TableHead>Tenant</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Sent</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-40 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Loader2
                          className="animate-spin text-muted-foreground"
                          size={20}
                        />
                        <span className="text-xs text-muted-foreground">
                          Fetching live data...
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="h-32 text-center text-xs text-muted-foreground"
                    >
                      No active reminders found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((r) => (
                    <TableRow key={r.id} className="text-xs">
                      <TableCell>
                        <div className="font-medium text-[11px]">
                          {r.tenantName}
                        </div>
                        <div className="text-muted-foreground text-[10px]">
                          Due: {r.dueDate}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono font-semibold text-emerald-500">
                          ₹{r.amountDue?.toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={`text-[10px] gap-1 ${
                            r.status === "overdue"
                              ? "bg-red-500/15 text-red-500 border-red-500/30"
                              : r.status === "scheduled"
                                ? "bg-blue-500/15 text-blue-500 border-blue-500/30"
                                : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-[10px] text-muted-foreground">
                        {r.lastSentOn || "Never"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 gap-1 text-[10px] px-2"
                          >
                            <QrCode size={10} /> QR
                          </Button>
                          <Button
                            size="sm"
                            className="h-6 gap-1 text-[10px] px-2 bg-amber-500 hover:bg-amber-600 text-white"
                            onClick={() => handleSend(r.id)}
                          >
                            <Send size={10} /> Send
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      </DbaShell>
    </div>
  );
}

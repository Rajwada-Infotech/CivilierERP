import React, { useState, useEffect, useMemo } from "react";
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
import { fetchWithAuth } from "@/lib/fetchWithAuth"; // Assuming your auth helper exists

export default function RemindersManager() {
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  // --- REAL-TIME FETCHING LOGIC ---
  const loadData = async () => {
    setLoading(true);
    try {
      const response = await fetchWithAuth("/api/tenant-reminders");
      if (response.ok) {
        const data = await response.json();
        setReminders(Array.isArray(data) ? data : data.data || []);
      }
    } catch (error) {
      toast.error("Failed to sync billing data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // --- COMPUTED STATS ---
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
      // Example API call to trigger the notification
      await fetchWithAuth(`/api/reminders/send/${id}`, { method: "POST" });
      toast.success("Notification dispatched to tenant");
      loadData(); // Refresh list to update 'lastSentOn'
    } catch {
      toast.error("Message delivery failed");
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* HEADER */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2 font-heading">
            <BellRing className="text-amber-500" size={24} />
            Reminders Manager
          </h1>
          <p className="text-sm text-muted-foreground">
            Live tenant subscription and collection monitoring.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={loadData}
          disabled={loading}
          className="gap-2 font-bold uppercase tracking-widest text-[10px]"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Sync Live
        </Button>
      </div>

      {/* STATS GRID */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-rose-50/50 border-rose-100 shadow-sm">
          <CardContent className="pt-6 flex items-center gap-4">
            <div className="p-3 bg-rose-500 rounded-xl text-white shadow-lg">
              <AlertTriangle size={24} />
            </div>
            <div>
              <div className="text-2xl font-black text-rose-700">
                ₹{stats.overdueSum.toLocaleString()}
              </div>
              <div className="text-[10px] text-rose-600 font-bold uppercase tracking-widest">
                Overdue Volume
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-amber-50/50 border-amber-100 shadow-sm">
          <CardContent className="pt-6 flex items-center gap-4">
            <div className="p-3 bg-amber-500 rounded-xl text-white shadow-lg">
              <Clock size={24} />
            </div>
            <div>
              <div className="text-2xl font-black text-amber-700">
                {stats.overdueCount}
              </div>
              <div className="text-[10px] text-amber-600 font-bold uppercase tracking-widest">
                Pending Alerts
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-emerald-50/50 border-emerald-100 shadow-sm">
          <CardContent className="pt-6 flex items-center gap-4">
            <div className="p-3 bg-emerald-500 rounded-xl text-white shadow-lg">
              <Users size={24} />
            </div>
            <div>
              <div className="text-2xl font-black text-emerald-700">
                {stats.totalCount}
              </div>
              <div className="text-[10px] text-emerald-600 font-bold uppercase tracking-widest">
                Tracked Tenants
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* DATA TABLE */}
      <Card className="overflow-hidden border-border/60 shadow-xl shadow-black/5">
        <CardHeader className="flex flex-row items-center justify-between border-b bg-muted/10 py-4">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Wallet size={16} className="text-primary" />
            Billing Queue
          </CardTitle>
          <div className="flex border rounded-lg p-1 gap-1 bg-background">
            {["all", "overdue", "scheduled"].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-[10px] font-black uppercase rounded transition-all ${
                  filter === f
                    ? "bg-primary shadow text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </CardHeader>

        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow>
              <TableHead className="text-[10px] uppercase font-bold tracking-wider">
                Tenant
              </TableHead>
              <TableHead className="text-[10px] uppercase font-bold tracking-wider">
                Amount
              </TableHead>
              <TableHead className="text-[10px] uppercase font-bold tracking-wider">
                Status
              </TableHead>
              <TableHead className="text-[10px] uppercase font-bold tracking-wider">
                Last Sent
              </TableHead>
              <TableHead className="text-right text-[10px] uppercase font-bold tracking-wider">
                Action
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-48 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="animate-spin text-primary" size={32} />
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                      Fetching Live Data...
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            ) : reminders.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-32 text-center text-muted-foreground font-medium"
                >
                  No active reminders found.
                </TableCell>
              </TableRow>
            ) : (
              reminders
                .filter((r) => filter === "all" || r.status === filter)
                .map((r) => (
                  <TableRow
                    key={r.id}
                    className="group hover:bg-muted/20 transition-colors"
                  >
                    <TableCell>
                      <div className="font-bold text-sm">{r.tenantName}</div>
                      <div className="text-[10px] text-muted-foreground">
                        Due: {r.dueDate}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-emerald-600 font-black">
                        ₹{r.amountDue?.toLocaleString()}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className="text-[9px] font-black uppercase px-2 py-0.5"
                        variant={
                          r.status === "overdue" ? "destructive" : "outline"
                        }
                      >
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground italic">
                      {r.lastSentOn || "Never"}
                    </TableCell>
                    <TableCell className="text-right flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-[10px] font-bold border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                      >
                        <QrCode size={12} /> QR
                      </Button>
                      <Button
                        size="sm"
                        className="h-8 gap-1.5 text-[10px] font-bold bg-amber-500 hover:bg-amber-600 text-white"
                        onClick={() => handleSend(r.id)}
                      >
                        <Send size={12} /> Send
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

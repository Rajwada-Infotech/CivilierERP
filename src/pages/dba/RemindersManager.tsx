import React, { useState, useMemo } from "react";
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
import { BellRing, Clock, AlertTriangle, Send, QrCode } from "lucide-react";
import { toast } from "sonner";

export default function RemindersManager() {
  const [reminders, setReminders] = useState(REMINDERS); // Uses the mock data from your original file
  const [filter, setFilter] = useState("all");

  const stats = useMemo(
    () => ({
      overdue: reminders.filter((r) => r.status === "overdue").length,
      total: reminders.length,
      sum: reminders
        .filter((r) => r.status === "overdue")
        .reduce((a, b) => a + b.amountDue, 0),
    }),
    [reminders],
  );

  const handleSend = (id: string) => {
    setReminders((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, status: "sent", lastSentOn: "Today" } : r,
      ),
    );
    toast.success("Reminder sent successfully");
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BellRing className="text-amber-500" /> Reminders Manager
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage tenant subscriptions and UPI collections.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-red-50 border-red-100">
          <CardContent className="pt-4 flex items-center gap-4">
            <AlertTriangle className="text-red-500" size={32} />
            <div>
              <div className="text-2xl font-bold text-red-700">
                ₹{stats.sum.toLocaleString()}
              </div>
              <div className="text-xs text-red-600 font-bold uppercase tracking-wider">
                Total Overdue
              </div>
            </div>
          </CardContent>
        </Card>
        {/* ... Other Stat Cards ... */}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between border-b py-3">
          <CardTitle className="text-sm font-bold">Billing Queue</CardTitle>
          <div className="flex border rounded-lg p-1 gap-1 bg-muted/20">
            {["all", "overdue", "scheduled"].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-[10px] font-bold uppercase rounded ${filter === f ? "bg-white shadow text-primary" : "text-muted-foreground"}`}
              >
                {f}
              </button>
            ))}
          </div>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tenant</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reminders
              .filter((r) => filter === "all" || r.status === filter)
              .map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-bold">{r.tenantName}</TableCell>
                  <TableCell className="font-mono text-emerald-600 font-bold">
                    ₹{r.amountDue.toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        r.status === "overdue" ? "destructive" : "secondary"
                      }
                    >
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right flex justify-end gap-2">
                    <Button size="sm" variant="outline" className="h-8 gap-1">
                      <QrCode size={12} /> QR
                    </Button>
                    <Button
                      size="sm"
                      className="h-8 gap-1 bg-amber-500 hover:bg-amber-600 text-white"
                      onClick={() => handleSend(r.id)}
                    >
                      <Send size={12} /> Send
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

import React, { useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Bell,
  BellRing,
  QrCode,
  Clock,
  Calendar,
  Building2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Send,
  Plus,
  Settings,
  Smartphone,
  Mail,
  MessageSquare,
  Timer,
  RefreshCw,
  Eye,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────────────────────

type ReminderStatus = "scheduled" | "sent" | "acknowledged" | "overdue";
type ReminderChannel = "email" | "whatsapp" | "sms" | "all";

interface Reminder {
  id: string;
  tenantId: string;
  tenantName: string;
  dbName: string;
  amountDue: number;
  plan: string;
  expiresOn: string;
  daysRemaining: number;
  reminderDaysBefore: number;
  status: ReminderStatus;
  lastSentOn: string | null;
  channel: ReminderChannel;
  upiId: string;
  contactEmail: string;
  contactPhone: string;
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const REMINDERS: Reminder[] = [
  {
    id: "REM-001",
    tenantId: "T-002",
    tenantName: "Buildtech Infrastructure Ltd",
    dbName: "buildtech_prod",
    amountDue: 18000,
    plan: "Growth",
    expiresOn: "2026-05-15",
    daysRemaining: 42,
    reminderDaysBefore: 30,
    status: "scheduled",
    lastSentOn: null,
    channel: "all",
    upiId: "buildtech@ybl",
    contactEmail: "admin@buildtech.in",
    contactPhone: "+91 98765 43210",
  },
  {
    id: "REM-002",
    tenantId: "T-004",
    tenantName: "Metro Projects Group",
    dbName: "metro_prod",
    amountDue: 18000,
    plan: "Growth",
    expiresOn: "2026-06-01",
    daysRemaining: 59,
    reminderDaysBefore: 30,
    status: "scheduled",
    lastSentOn: null,
    channel: "email",
    upiId: "metroprojects@paytm",
    contactEmail: "finance@metro.in",
    contactPhone: "+91 91234 56789",
  },
  {
    id: "REM-003",
    tenantId: "T-003",
    tenantName: "Apex Realty Developers",
    dbName: "apex_prod",
    amountDue: 9000,
    plan: "Starter",
    expiresOn: "2026-03-01",
    daysRemaining: -33,
    reminderDaysBefore: 30,
    status: "overdue",
    lastSentOn: "2026-03-01",
    channel: "all",
    upiId: "apexrealty@upi",
    contactEmail: "billing@apex.in",
    contactPhone: "+91 99887 76655",
  },
  {
    id: "REM-004",
    tenantId: "T-001",
    tenantName: "Civilier Constructions Pvt Ltd",
    dbName: "civilier_prod",
    amountDue: 84000,
    plan: "Enterprise",
    expiresOn: "2026-12-31",
    daysRemaining: 272,
    reminderDaysBefore: 30,
    status: "scheduled",
    lastSentOn: "2026-01-01",
    channel: "email",
    upiId: "civilier@hdfcbank",
    contactEmail: "accounts@civilier.in",
    contactPhone: "+91 99001 23456",
  },
];

const STATUS_CONFIG = {
  scheduled:    { color: "bg-blue-500/15 text-blue-600 border-blue-500/30",     icon: Clock,         label: "Scheduled" },
  sent:         { color: "bg-yellow-500/15 text-yellow-600 border-yellow-500/30", icon: Send,         label: "Sent" },
  acknowledged: { color: "bg-green-500/15 text-green-600 border-green-500/30",  icon: CheckCircle2,  label: "Acknowledged" },
  overdue:      { color: "bg-red-500/15 text-red-600 border-red-500/30",        icon: AlertTriangle, label: "Overdue" },
};

// ─── Fake QR Data URI ─────────────────────────────────────────────────────────
// Represents a UPI QR in SVG form (simplified pattern)
const QR_MODULES = (() => {
  const size = 21;
  const matrix: boolean[][] = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => {
      // Corner finders
      const inFinder = (rr: number, cc: number) =>
        (rr < 7 && cc < 7) || (rr < 7 && cc >= size - 7) || (rr >= size - 7 && cc < 7);
      if (inFinder(r, c)) {
        const dr = r < 7 ? r : r - (size - 7);
        const dc = c < 7 ? c : c - (size - 7);
        const borderR = r >= size - 7 ? r - (size - 7) : r;
        const borderC = c >= size - 7 ? c - (size - 7) : c;
        return (borderR === 0 || borderR === 6 || borderC === 0 || borderC === 6) ||
          (borderR >= 2 && borderR <= 4 && borderC >= 2 && borderC <= 4);
      }
      // Data pattern (pseudo-random based on position)
      return ((r * 7 + c * 3 + r + c) % 3 !== 0);
    })
  );
  return matrix;
})();

function QRCodeDisplay({ upiId, amount, name }: { upiId: string; amount: number; name: string }) {
  const cellSize = 8;
  const size = QR_MODULES.length;
  const svgSize = size * cellSize + 24;

  return (
    <div className="flex flex-col items-center gap-3">
      <svg width={svgSize} height={svgSize} viewBox={`0 0 ${svgSize} ${svgSize}`} className="rounded-lg border bg-white p-3">
        {QR_MODULES.map((row, r) =>
          row.map((on, c) =>
            on ? (
              <rect
                key={`${r}-${c}`}
                x={c * cellSize + 12}
                y={r * cellSize + 12}
                width={cellSize - 1}
                height={cellSize - 1}
                fill="#111827"
                rx={0.5}
              />
            ) : null
          )
        )}
      </svg>
      <div className="text-center space-y-1">
        <div className="flex items-center justify-center gap-1.5">
          <div className="w-5 h-5 rounded-full bg-orange-500 flex items-center justify-center">
            <span className="text-white text-[8px] font-bold">₹</span>
          </div>
          <span className="font-bold text-sm">UPI Payment</span>
        </div>
        <div className="font-mono text-[11px] bg-muted px-2 py-1 rounded">{upiId}</div>
        <div className="text-lg font-bold text-emerald-600">₹{amount.toLocaleString()}</div>
        <div className="text-[10px] text-muted-foreground">{name}</div>
        <div className="text-[9px] text-muted-foreground">Scan with any UPI app to pay</div>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RemindersManager() {
  const [reminders, setReminders] = useState<Reminder[]>(REMINDERS);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrTarget, setQrTarget] = useState<Reminder | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [defaultDays, setDefaultDays] = useState("30");
  const [defaultChannel, setDefaultChannel] = useState<ReminderChannel>("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const filtered = reminders.filter(r => filterStatus === "all" || r.status === filterStatus);

  const handleSendReminder = (rem: Reminder) => {
    setReminders(prev => prev.map(r => r.id === rem.id
      ? { ...r, status: "sent", lastSentOn: new Date().toISOString().split("T")[0] }
      : r
    ));
    toast.success(`Reminder sent to ${rem.tenantName} via ${rem.channel}`);
  };

  const handleShowQR = (rem: Reminder) => {
    setQrTarget(rem);
    setQrOpen(true);
  };

  const getDaysColor = (days: number) => {
    if (days < 0) return "text-red-500";
    if (days <= 30) return "text-orange-500";
    if (days <= 60) return "text-yellow-600";
    return "text-green-600";
  };

  const channelIcon = (ch: ReminderChannel) => {
    if (ch === "email") return <Mail size={10} />;
    if (ch === "whatsapp") return <MessageSquare size={10} />;
    if (ch === "sms") return <Smartphone size={10} />;
    return <Zap size={10} />;
  };

  const overdueCount = reminders.filter(r => r.status === "overdue").length;
  const expiringSoon = reminders.filter(r => r.daysRemaining > 0 && r.daysRemaining <= 30).length;
  const totalDue = reminders.filter(r => r.status === "overdue").reduce((s, r) => s + r.amountDue, 0);

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
      <Breadcrumbs items={[{ label: "DBA Console" }, { label: "Reminders" }]} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <BellRing size={20} className="text-amber-500" /> Payment Reminders
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Default: <strong>{defaultDays}-day</strong> advance reminder with UPI QR code for payment
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setSettingsOpen(true)}>
          <Settings size={12} /> Reminder Settings
        </Button>
      </div>

      {/* Alert banners */}
      {overdueCount > 0 && (
        <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
          <AlertTriangle size={16} className="text-red-500 shrink-0" />
          <div className="flex-1">
            <p className="text-xs font-semibold text-red-600">{overdueCount} tenant{overdueCount > 1 ? "s" : ""} with overdue payments — ₹{totalDue.toLocaleString()} outstanding</p>
            <p className="text-[10px] text-muted-foreground">Send reminder with QR code or follow up immediately</p>
          </div>
          <Button size="sm" variant="destructive" className="text-xs h-7 gap-1" onClick={() => {
            reminders.filter(r => r.status === "overdue").forEach(r => handleSendReminder(r));
          }}>
            <Send size={11} /> Send All
          </Button>
        </div>
      )}

      {expiringSoon > 0 && (
        <div className="flex items-center gap-3 bg-orange-500/10 border border-orange-500/20 rounded-lg p-3">
          <Clock size={16} className="text-orange-500 shrink-0" />
          <p className="text-xs text-orange-700 font-medium">{expiringSoon} tenant{expiringSoon > 1 ? "s" : ""} expiring within 30 days — reminders will auto-trigger</p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Reminders", value: reminders.length, icon: Bell, color: "text-blue-500" },
          { label: "Scheduled", value: reminders.filter(r => r.status === "scheduled").length, icon: Clock, color: "text-blue-500" },
          { label: "Overdue", value: overdueCount, icon: AlertTriangle, color: "text-red-500" },
          { label: "Expiring ≤30d", value: expiringSoon, icon: Timer, color: "text-orange-500" },
        ].map((s, i) => (
          <Card key={i}>
            <CardContent className="p-3 flex items-center gap-3">
              <s.icon size={18} className={s.color} />
              <div>
                <div className="text-lg font-bold leading-none">{s.value}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{s.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        {["all", "scheduled", "sent", "overdue", "acknowledged"].map(f => (
          <Button key={f} size="sm" variant={filterStatus === f ? "default" : "outline"} className="text-xs h-7 capitalize" onClick={() => setFilterStatus(f)}>
            {f}
          </Button>
        ))}
      </div>

      {/* Reminders Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Bell size={14} className="text-amber-500" /> Reminder Queue
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="text-xs">
                  <TableHead>Tenant</TableHead>
                  <TableHead>Plan & Amount</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Days Left</TableHead>
                  <TableHead>Remind Before</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Last Sent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((rem) => {
                  const SC = STATUS_CONFIG[rem.status];
                  return (
                    <TableRow key={rem.id} className={`text-xs ${rem.status === "overdue" ? "bg-red-500/5" : ""}`}>
                      <TableCell>
                        <div className="font-medium text-[11px]">{rem.tenantName}</div>
                        <div className="text-muted-foreground text-[10px] font-mono">{rem.tenantId}</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-bold text-emerald-600 text-[11px]">₹{rem.amountDue.toLocaleString()}</div>
                        <div className="text-muted-foreground text-[10px]">{rem.plan}</div>
                      </TableCell>
                      <TableCell className="font-mono text-[10px] text-muted-foreground">{rem.expiresOn}</TableCell>
                      <TableCell>
                        <span className={`font-bold text-[11px] ${getDaysColor(rem.daysRemaining)}`}>
                          {rem.daysRemaining < 0 ? `${Math.abs(rem.daysRemaining)}d overdue` : `${rem.daysRemaining}d`}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Bell size={10} className="text-amber-500" />
                          <span className="text-[11px]">{rem.reminderDaysBefore} days prior</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {channelIcon(rem.channel)}
                          <span className="text-[11px] capitalize">{rem.channel}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-[10px] text-muted-foreground">
                        {rem.lastSentOn ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] ${SC.color}`}>{SC.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center gap-1 justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[10px] gap-1"
                            onClick={() => handleShowQR(rem)}
                          >
                            <QrCode size={10} /> QR
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[10px] gap-1 text-amber-600"
                            onClick={() => handleSendReminder(rem)}
                          >
                            <Send size={10} /> Send
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* QR Payment Dialog */}
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <QrCode size={14} className="text-amber-500" /> UPI Payment QR
            </DialogTitle>
          </DialogHeader>
          {qrTarget && (
            <div className="py-2 space-y-4">
              <div className="flex flex-col items-center">
                <QRCodeDisplay upiId={qrTarget.upiId} amount={qrTarget.amountDue} name={qrTarget.tenantName} />
              </div>
              <div className="bg-muted/50 rounded-lg p-3 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tenant</span>
                  <span className="font-medium">{qrTarget.tenantName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Plan</span>
                  <span>{qrTarget.plan}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount Due</span>
                  <span className="font-bold text-emerald-600">₹{qrTarget.amountDue.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">UPI ID</span>
                  <span className="font-mono">{qrTarget.upiId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Access Expires</span>
                  <span className={getDaysColor(qrTarget.daysRemaining)}>{qrTarget.expiresOn}</span>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground text-center">
                Share this QR with the tenant's billing contact at <strong>{qrTarget.contactEmail}</strong>
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setQrOpen(false)}>Close</Button>
            <Button size="sm" className="text-xs gap-1 bg-amber-500 hover:bg-amber-600 text-white" onClick={() => {
              toast.success(`QR reminder sent to ${qrTarget?.contactEmail}`);
              setQrOpen(false);
            }}>
              <Send size={11} /> Send to Tenant
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settings Dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Settings size={13} className="text-muted-foreground" /> Reminder Settings
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label className="text-xs">Default Reminder Days Before Expiry</Label>
              <Select value={defaultDays} onValueChange={setDefaultDays}>
                <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7" className="text-xs">7 Days</SelectItem>
                  <SelectItem value="14" className="text-xs">14 Days</SelectItem>
                  <SelectItem value="30" className="text-xs">30 Days (Default)</SelectItem>
                  <SelectItem value="45" className="text-xs">45 Days</SelectItem>
                  <SelectItem value="60" className="text-xs">60 Days</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">Reminders auto-trigger {defaultDays} days before expiry</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Default Notification Channel</Label>
              <Select value={defaultChannel} onValueChange={v => setDefaultChannel(v as ReminderChannel)}>
                <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email" className="text-xs">Email Only</SelectItem>
                  <SelectItem value="whatsapp" className="text-xs">WhatsApp Only</SelectItem>
                  <SelectItem value="sms" className="text-xs">SMS Only</SelectItem>
                  <SelectItem value="all" className="text-xs">All Channels</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="bg-amber-500/10 border border-amber-500/20 rounded p-2.5 text-[10px] text-amber-700">
              All reminders include a UPI QR code for instant payment. Overdue reminders escalate daily automatically.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setSettingsOpen(false)}>Cancel</Button>
            <Button size="sm" className="text-xs bg-amber-500 hover:bg-amber-600 text-white" onClick={() => {
              setSettingsOpen(false);
              toast.success("Reminder settings saved");
            }}>Save Settings</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

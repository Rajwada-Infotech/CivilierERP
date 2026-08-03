import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getCommunicatorConfig,
  saveCommunicatorConfig,
} from "@/api/communicatorConfigApi";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Mail, Save, Loader2, CheckCircle2, AlertCircle, Info, Lock } from "lucide-react";
import { usePageRights } from "@/hooks/usePageRights";
import { AdminShell } from "@/components/admin/AdminShell";
import { cn } from "@/lib/utils";

interface EmailConfig {
  provider?: string;
  smtpHost?: string;
  smtpPort?: string;
  smtpUser?: string;
  smtpPassword?: string;
  fromEmail?: string;
  fromName?: string;
  encryption?: string;
  isActive?: boolean;
}

const CHANNEL = "email";
const EMPTY: EmailConfig = {
  provider: "", smtpHost: "", smtpPort: "", smtpUser: "",
  smtpPassword: "", fromEmail: "", fromName: "", encryption: "TLS", isActive: false,
};

export default function EmailSetup() {
  const qc = useQueryClient();
  const rights = usePageRights("email-setup");
  const [form, setForm] = useState<EmailConfig>(EMPTY);

  const { data, isLoading } = useQuery<EmailConfig>({
    queryKey: ["communicator-config", CHANNEL],
    queryFn: () => getCommunicatorConfig<EmailConfig>(CHANNEL),
  });

  useEffect(() => { if (data) setForm({ ...EMPTY, ...data }); }, [data]);

  const saveMutation = useMutation({
    mutationFn: () => saveCommunicatorConfig(CHANNEL, form as Record<string, unknown>),
    onSuccess: () => {
      toast.success("Email configuration saved");
      qc.invalidateQueries({ queryKey: ["communicator-config", CHANNEL] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function set(key: keyof EmailConfig, value: string | boolean) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const isConfigured = !!(form.smtpHost && form.smtpPort && form.smtpUser && form.smtpPassword && form.fromEmail);

  return (
    <AdminShell
      title="Email Configuration"
      subtitle="SMTP settings for system-wide email notifications"
      icon={Mail}
    >
      <div className="flex gap-6 items-start">

        {/* LEFT — form */}
        <div className="flex-1 min-w-0">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">SMTP &amp; Sender Details</CardTitle>
              <CardDescription>
                Connection details for your email server (AWS SES, SendGrid, Gmail SMTP, etc.)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="em-provider">Provider / Service</Label>
                      <Input id="em-provider" placeholder="e.g. AWS SES, SendGrid, Gmail" value={form.provider ?? ""} onChange={(e) => set("provider", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="em-encryption">Encryption</Label>
                      <Input id="em-encryption" placeholder="TLS / SSL / None" value={form.encryption ?? ""} onChange={(e) => set("encryption", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="em-host">SMTP Host</Label>
                      <Input id="em-host" placeholder="smtp.example.com" value={form.smtpHost ?? ""} onChange={(e) => set("smtpHost", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="em-port">SMTP Port</Label>
                      <Input id="em-port" placeholder="587 or 465" value={form.smtpPort ?? ""} onChange={(e) => set("smtpPort", e.target.value)} maxLength={5} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="em-user">SMTP Username</Label>
                      <Input id="em-user" placeholder="Username or access key" value={form.smtpUser ?? ""} onChange={(e) => set("smtpUser", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="em-pass">SMTP Password</Label>
                      <Input id="em-pass" type="password" placeholder="••••••••••••" value={form.smtpPassword ?? ""} onChange={(e) => set("smtpPassword", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="em-from">Sender Email (From)</Label>
                      <Input id="em-from" type="email" placeholder="noreply@yourdomain.com" value={form.fromEmail ?? ""} onChange={(e) => set("fromEmail", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="em-name">Sender Name (From)</Label>
                      <Input id="em-name" placeholder="e.g. Civilier ERP" value={form.fromName ?? ""} onChange={(e) => set("fromName", e.target.value)} />
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">Enable Email Delivery</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Activate this SMTP config to send live emails</p>
                    </div>
                    <Switch checked={!!form.isActive} onCheckedChange={(val) => set("isActive", val)} />
                  </div>

                  {rights.canEdit && (
                    <div className="flex justify-end">
                      <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm hover:opacity-90 gap-1.5 shrink-0 font-heading font-semibold text-white text-sm px-5 py-2 h-auto">
                        {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Save Configuration
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT — sidebar */}
        <div className="w-80 shrink-0 space-y-4">

          {/* Status */}
          <div className={cn("rounded-xl border p-4 space-y-2", form.isActive && isConfigured ? "border-emerald-400/30 bg-emerald-500/5" : "border-border bg-card")}>
            <div className="flex items-center gap-2">
              {form.isActive && isConfigured
                ? <CheckCircle2 size={14} className="text-emerald-600" />
                : <AlertCircle size={14} className="text-amber-500" />}
              <p className="text-xs font-semibold text-foreground">
                {form.isActive && isConfigured ? "Email Active" : form.isActive ? "Incomplete Config" : "Email Inactive"}
              </p>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {form.isActive && isConfigured
                ? `Sending via ${form.smtpHost || "SMTP"} · From: ${form.fromEmail || "—"}`
                : form.isActive
                ? "Toggle is ON but SMTP credentials are incomplete."
                : "Toggle is OFF. No emails will be sent until activated."}
            </p>
          </div>

          {/* Port reference */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Lock size={13} className="text-primary" />
              <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Common SMTP Ports</h3>
            </div>
            {[
              { port: "25",  label: "SMTP (unencrypted, often blocked)" },
              { port: "465", label: "SMTPS — SSL/TLS" },
              { port: "587", label: "SMTP + STARTTLS (recommended)" },
              { port: "2525", label: "Alternative if 587 is blocked" },
            ].map(({ port, label }) => (
              <div key={port} className="flex items-center gap-2.5">
                <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded font-mono shrink-0">{port}</code>
                <p className="text-[11px] text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>

          {/* Tips */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Info size={13} className="text-muted-foreground" />
              <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Quick Tips</h3>
            </div>
            <ul className="space-y-1.5">
              {[
                "Use an app-specific password for Gmail",
                "AWS SES requires domain verification",
                "SendGrid API key goes in the password field",
                "Ensure SPF / DKIM records are set to avoid spam",
                "Test with a non-production address first",
              ].map((tip) => (
                <li key={tip} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                  <span className="text-primary mt-0.5">·</span> {tip}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}

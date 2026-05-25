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
import { Mail, Save, Loader2 } from "lucide-react";

// ─── Config shape stored in dbo.CommunicatorConfig.ConfigJson ─────────────────
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
  provider: "",
  smtpHost: "",
  smtpPort: "",
  smtpUser: "",
  smtpPassword: "",
  fromEmail: "",
  fromName: "",
  encryption: "TLS",
  isActive: false,
};

export default function EmailSetup() {
  const qc = useQueryClient();
  const [form, setForm] = useState<EmailConfig>(EMPTY);

  const { data, isLoading } = useQuery<EmailConfig>({
    queryKey: ["communicator-config", CHANNEL],
    queryFn: () => getCommunicatorConfig<EmailConfig>(CHANNEL),
  });

  useEffect(() => {
    if (data) setForm({ ...EMPTY, ...data });
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      saveCommunicatorConfig(CHANNEL, form as Record<string, unknown>),
    onSuccess: () => {
      toast.success("Email configuration saved");
      qc.invalidateQueries({ queryKey: ["communicator-config", CHANNEL] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function set(key: keyof EmailConfig, value: string | boolean) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  return (
    <div className="p-6 space-y-5 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Mail className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Email Configuration
          </h1>
          <p className="text-sm text-muted-foreground">
            SMTP settings for system-wide email notifications
          </p>
        </div>
      </div>

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
                  <Input
                    id="em-provider"
                    placeholder="e.g. AWS SES, SendGrid, Gmail"
                    value={form.provider ?? ""}
                    onChange={(e) => set("provider", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="em-encryption">Encryption</Label>
                  <Input
                    id="em-encryption"
                    placeholder="TLS / SSL / None"
                    value={form.encryption ?? ""}
                    onChange={(e) => set("encryption", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="em-host">SMTP Host</Label>
                  <Input
                    id="em-host"
                    placeholder="smtp.example.com"
                    value={form.smtpHost ?? ""}
                    onChange={(e) => set("smtpHost", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="em-port">SMTP Port</Label>
                  <Input
                    id="em-port"
                    placeholder="587 or 465"
                    value={form.smtpPort ?? ""}
                    onChange={(e) => set("smtpPort", e.target.value)}
                    maxLength={5}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="em-user">SMTP Username</Label>
                  <Input
                    id="em-user"
                    placeholder="Username or access key"
                    value={form.smtpUser ?? ""}
                    onChange={(e) => set("smtpUser", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="em-pass">SMTP Password</Label>
                  <Input
                    id="em-pass"
                    type="password"
                    placeholder="••••••••••••"
                    value={form.smtpPassword ?? ""}
                    onChange={(e) => set("smtpPassword", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="em-from">Sender Email (From)</Label>
                  <Input
                    id="em-from"
                    type="email"
                    placeholder="noreply@yourdomain.com"
                    value={form.fromEmail ?? ""}
                    onChange={(e) => set("fromEmail", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="em-name">Sender Name (From)</Label>
                  <Input
                    id="em-name"
                    placeholder="e.g. Civilier ERP"
                    value={form.fromName ?? ""}
                    onChange={(e) => set("fromName", e.target.value)}
                  />
                </div>
              </div>

              {/* Enable toggle */}
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">Enable Email Delivery</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Activate this SMTP config to send live emails
                  </p>
                </div>
                <Switch
                  checked={!!form.isActive}
                  onCheckedChange={(val) => set("isActive", val)}
                />
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                  className="gap-2"
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Save Configuration
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
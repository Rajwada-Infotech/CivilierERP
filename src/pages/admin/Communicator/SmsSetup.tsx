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
import { MessageSquare, Save, Loader2 } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { usePageRights } from "@/hooks/usePageRights";

// ─── Config shape stored in dbo.CommunicatorConfig.ConfigJson ─────────────────
interface SmsConfig {
  provider?: string;
  apiUrl?: string;
  apiKey?: string;
  senderId?: string;
  isActive?: boolean;
}

const CHANNEL = "sms";
const EMPTY: SmsConfig = {
  provider: "",
  apiUrl: "",
  apiKey: "",
  senderId: "",
  isActive: false,
};

export default function SmsSetup() {
  const qc = useQueryClient();
  const rights = usePageRights("sms-setup");
  const [form, setForm] = useState<SmsConfig>(EMPTY);

  const { data, isLoading } = useQuery<SmsConfig>({
    queryKey: ["communicator-config", CHANNEL],
    queryFn: () => getCommunicatorConfig<SmsConfig>(CHANNEL),
  });

  // Populate form once data arrives
  useEffect(() => {
    if (data) setForm({ ...EMPTY, ...data });
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      saveCommunicatorConfig(CHANNEL, form as Record<string, unknown>),
    onSuccess: () => {
      toast.success("SMS configuration saved");
      qc.invalidateQueries({ queryKey: ["communicator-config", CHANNEL] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function set(key: keyof SmsConfig, value: string | boolean) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  return (
    <div className="max-w-3xl mx-auto">
      <AdminShell
        title="SMS Gateway"
        subtitle="Configure your SMS provider for transactional messages"
        icon={MessageSquare}
      >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">API Connection Details</CardTitle>
          <CardDescription>
            Credentials from your SMS vendor (MSG91, Twilio, etc.)
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
                  <Label htmlFor="sms-provider">Provider Name</Label>
                  <Input
                    id="sms-provider"
                    placeholder="e.g. MSG91, Twilio"
                    value={form.provider ?? ""}
                    onChange={(e) => set("provider", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sms-sender">Sender ID</Label>
                  <Input
                    id="sms-sender"
                    placeholder="e.g. CIVILR"
                    value={form.senderId ?? ""}
                    onChange={(e) => set("senderId", e.target.value)}
                    maxLength={11}
                    className="uppercase"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="sms-url">API URL</Label>
                  <Input
                    id="sms-url"
                    placeholder="https://api.provider.com/v1/send"
                    value={form.apiUrl ?? ""}
                    onChange={(e) => set("apiUrl", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="sms-key">API Key / Token</Label>
                  <Input
                    id="sms-key"
                    type="password"
                    placeholder="••••••••••••"
                    value={form.apiKey ?? ""}
                    onChange={(e) => set("apiKey", e.target.value)}
                  />
                </div>
              </div>

              {/* Enable toggle */}
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">Enable SMS Delivery</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Activate this gateway to send live messages
                  </p>
                </div>
                <Switch
                  checked={!!form.isActive}
                  onCheckedChange={(val) => set("isActive", val)}
                />
              </div>

              {rights.canEdit && (
                <div className="flex justify-end">
                  <Button
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending}
                    className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto"
                  >
                    {saveMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Save Configuration
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      </AdminShell>
    </div>
  );
}
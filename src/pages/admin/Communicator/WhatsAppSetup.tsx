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
import { MessageCircle, Save, Loader2 } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { usePageRights } from "@/hooks/usePageRights";

// ─── Config shape stored in dbo.CommunicatorConfig.ConfigJson ─────────────────
interface WhatsAppConfig {
  provider?: string;
  apiUrl?: string;
  accessToken?: string;
  phoneNumberId?: string;
  businessAccountId?: string;
  isActive?: boolean;
}

const CHANNEL = "whatsapp";
const EMPTY: WhatsAppConfig = {
  provider: "",
  apiUrl: "https://graph.facebook.com/v17.0/",
  accessToken: "",
  phoneNumberId: "",
  businessAccountId: "",
  isActive: false,
};

export default function WhatsAppSetup() {
  const qc = useQueryClient();
  const rights = usePageRights("whatsapp-setup");
  const [form, setForm] = useState<WhatsAppConfig>(EMPTY);

  const { data, isLoading } = useQuery<WhatsAppConfig>({
    queryKey: ["communicator-config", CHANNEL],
    queryFn: () => getCommunicatorConfig<WhatsAppConfig>(CHANNEL),
  });

  useEffect(() => {
    if (data) setForm({ ...EMPTY, ...data });
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      saveCommunicatorConfig(CHANNEL, form as Record<string, unknown>),
    onSuccess: () => {
      toast.success("WhatsApp configuration saved");
      qc.invalidateQueries({ queryKey: ["communicator-config", CHANNEL] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function set(key: keyof WhatsAppConfig, value: string | boolean) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  return (
    <div className="max-w-3xl mx-auto">
      <AdminShell
        title="WhatsApp Integration"
        subtitle="WhatsApp Cloud API or third-party provider settings"
        icon={MessageCircle}
      >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">API &amp; Account Details</CardTitle>
          <CardDescription>
            WhatsApp Business Platform credentials (Meta Cloud API, Wati, etc.)
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
                  <Label htmlFor="wa-provider">Provider Name</Label>
                  <Input
                    id="wa-provider"
                    placeholder="e.g. Meta Cloud API, Wati"
                    value={form.provider ?? ""}
                    onChange={(e) => set("provider", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wa-url">API URL</Label>
                  <Input
                    id="wa-url"
                    placeholder="https://graph.facebook.com/v17.0/"
                    value={form.apiUrl ?? ""}
                    onChange={(e) => set("apiUrl", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="wa-token">Access Token</Label>
                  <Input
                    id="wa-token"
                    type="password"
                    placeholder="EAAG… (long-lived token)"
                    value={form.accessToken ?? ""}
                    onChange={(e) => set("accessToken", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wa-phone">Phone Number ID</Label>
                  <Input
                    id="wa-phone"
                    placeholder="e.g. 101234567890"
                    value={form.phoneNumberId ?? ""}
                    onChange={(e) => set("phoneNumberId", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wa-biz">Business Account ID</Label>
                  <Input
                    id="wa-biz"
                    placeholder="e.g. 109876543210"
                    value={form.businessAccountId ?? ""}
                    onChange={(e) => set("businessAccountId", e.target.value)}
                  />
                </div>
              </div>

              {/* Enable toggle */}
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">Enable WhatsApp Delivery</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Activate to send live WhatsApp messages
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
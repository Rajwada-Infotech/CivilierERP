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
import { MessageCircle, Save, Loader2, CheckCircle2, AlertCircle, Info, ListChecks } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { usePageRights } from "@/hooks/usePageRights";
import { cn } from "@/lib/utils";

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
  provider: "", apiUrl: "https://graph.facebook.com/v17.0/",
  accessToken: "", phoneNumberId: "", businessAccountId: "", isActive: false,
};

export default function WhatsAppSetup() {
  const qc = useQueryClient();
  const rights = usePageRights("whatsapp-setup");
  const [form, setForm] = useState<WhatsAppConfig>(EMPTY);

  const { data, isLoading } = useQuery<WhatsAppConfig>({
    queryKey: ["communicator-config", CHANNEL],
    queryFn: () => getCommunicatorConfig<WhatsAppConfig>(CHANNEL),
  });

  useEffect(() => { if (data) setForm({ ...EMPTY, ...data }); }, [data]);

  const saveMutation = useMutation({
    mutationFn: () => saveCommunicatorConfig(CHANNEL, form as Record<string, unknown>),
    onSuccess: () => {
      toast.success("WhatsApp configuration saved");
      qc.invalidateQueries({ queryKey: ["communicator-config", CHANNEL] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function set(key: keyof WhatsAppConfig, value: string | boolean) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const isConfigured = !!(form.accessToken && form.phoneNumberId && form.businessAccountId);

  return (
    <AdminShell
      title="WhatsApp Integration"
      subtitle="WhatsApp Cloud API or third-party provider settings"
      icon={MessageCircle}
    >
      <div className="flex gap-6 items-start">

        {/* LEFT — form */}
        <div className="flex-1 min-w-0">
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
                      <Input id="wa-provider" placeholder="e.g. Meta Cloud API, Wati" value={form.provider ?? ""} onChange={(e) => set("provider", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="wa-url">API URL</Label>
                      <Input id="wa-url" placeholder="https://graph.facebook.com/v17.0/" value={form.apiUrl ?? ""} onChange={(e) => set("apiUrl", e.target.value)} />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="wa-token">Access Token</Label>
                      <Input id="wa-token" type="password" placeholder="EAAG… (long-lived token)" value={form.accessToken ?? ""} onChange={(e) => set("accessToken", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="wa-phone">Phone Number ID</Label>
                      <Input id="wa-phone" placeholder="e.g. 101234567890" value={form.phoneNumberId ?? ""} onChange={(e) => set("phoneNumberId", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="wa-biz">Business Account ID</Label>
                      <Input id="wa-biz" placeholder="e.g. 109876543210" value={form.businessAccountId ?? ""} onChange={(e) => set("businessAccountId", e.target.value)} />
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">Enable WhatsApp Delivery</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Activate to send live WhatsApp messages</p>
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
                {form.isActive && isConfigured ? "WhatsApp Active" : form.isActive ? "Incomplete Config" : "WhatsApp Inactive"}
              </p>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {form.isActive && isConfigured
                ? `Via ${form.provider || "configured provider"} · Phone ID: ${form.phoneNumberId || "—"}`
                : form.isActive
                ? "Toggle is ON but credentials are missing. Fill all fields and save."
                : "Toggle is OFF. No WhatsApp messages will be sent."}
            </p>
          </div>

          {/* Setup checklist */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ListChecks size={13} className="text-primary" />
              <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Meta Setup Checklist</h3>
            </div>
            {[
              { done: !!form.businessAccountId, label: "Create a Meta Business Account" },
              { done: !!form.phoneNumberId, label: "Add & verify a WhatsApp phone number" },
              { done: !!form.accessToken, label: "Generate a long-lived access token" },
              { done: !!form.apiUrl, label: "Set the Graph API URL" },
              { done: !!form.isActive, label: "Enable delivery toggle" },
            ].map(({ done, label }) => (
              <div key={label} className="flex items-center gap-2">
                <div className={cn("w-4 h-4 rounded-full border flex items-center justify-center shrink-0", done ? "border-emerald-500 bg-emerald-500/10" : "border-border bg-muted/30")}>
                  {done && <CheckCircle2 size={9} className="text-emerald-600" />}
                </div>
                <p className={cn("text-[11px]", done ? "text-foreground" : "text-muted-foreground")}>{label}</p>
              </div>
            ))}
          </div>

          {/* Tips */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Info size={13} className="text-muted-foreground" />
              <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Notes</h3>
            </div>
            <ul className="space-y-1.5">
              {[
                "Tokens expire every 60 days — rotate regularly",
                "Template messages must be pre-approved by Meta",
                "Test numbers are limited to 5 in sandbox mode",
                "Wati / 360dialog abstract the Meta API with simpler tokens",
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

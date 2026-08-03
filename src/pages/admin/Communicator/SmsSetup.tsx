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
import { MessageSquare, Save, Loader2, CheckCircle2, AlertCircle, Info, Zap } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { usePageRights } from "@/hooks/usePageRights";
import { cn } from "@/lib/utils";

interface SmsConfig {
  provider?: string;
  apiUrl?: string;
  apiKey?: string;
  senderId?: string;
  isActive?: boolean;
}

const CHANNEL = "sms";
const EMPTY: SmsConfig = { provider: "", apiUrl: "", apiKey: "", senderId: "", isActive: false };

export default function SmsSetup() {
  const qc = useQueryClient();
  const rights = usePageRights("sms-setup");
  const [form, setForm] = useState<SmsConfig>(EMPTY);

  const { data, isLoading } = useQuery<SmsConfig>({
    queryKey: ["communicator-config", CHANNEL],
    queryFn: () => getCommunicatorConfig<SmsConfig>(CHANNEL),
  });

  useEffect(() => { if (data) setForm({ ...EMPTY, ...data }); }, [data]);

  const saveMutation = useMutation({
    mutationFn: () => saveCommunicatorConfig(CHANNEL, form as Record<string, unknown>),
    onSuccess: () => {
      toast.success("SMS configuration saved");
      qc.invalidateQueries({ queryKey: ["communicator-config", CHANNEL] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function set(key: keyof SmsConfig, value: string | boolean) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const isConfigured = !!(form.apiKey && form.apiUrl && form.senderId && form.provider);

  return (
    <AdminShell
      title="SMS Gateway"
      subtitle="Configure your SMS provider for transactional messages"
      icon={MessageSquare}
    >
      <div className="flex gap-6 items-start">

        {/* LEFT — form */}
        <div className="flex-1 min-w-0">
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
                      <Input id="sms-provider" placeholder="e.g. MSG91, Twilio" value={form.provider ?? ""} onChange={(e) => set("provider", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="sms-sender">Sender ID</Label>
                      <Input id="sms-sender" placeholder="e.g. CIVILR" value={form.senderId ?? ""} onChange={(e) => set("senderId", e.target.value)} maxLength={11} className="uppercase" />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="sms-url">API URL</Label>
                      <Input id="sms-url" placeholder="https://api.provider.com/v1/send" value={form.apiUrl ?? ""} onChange={(e) => set("apiUrl", e.target.value)} />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="sms-key">API Key / Token</Label>
                      <Input id="sms-key" type="password" placeholder="••••••••••••" value={form.apiKey ?? ""} onChange={(e) => set("apiKey", e.target.value)} />
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">Enable SMS Delivery</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Activate this gateway to send live messages</p>
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

          {/* Status card */}
          <div className={cn("rounded-xl border p-4 space-y-2", form.isActive && isConfigured ? "border-emerald-400/30 bg-emerald-500/5" : "border-border bg-card")}>
            <div className="flex items-center gap-2">
              {form.isActive && isConfigured
                ? <CheckCircle2 size={14} className="text-emerald-600" />
                : <AlertCircle size={14} className="text-amber-500" />}
              <p className="text-xs font-semibold text-foreground">
                {form.isActive && isConfigured ? "Gateway Active" : form.isActive ? "Incomplete Config" : "Gateway Inactive"}
              </p>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {form.isActive && isConfigured
                ? `Using ${form.provider || "configured provider"} · Sender: ${form.senderId || "—"}`
                : form.isActive
                ? "Toggle is ON but credentials are missing. Fill all fields and save."
                : "Toggle is OFF. Messages won't be sent until activated."}
            </p>
          </div>

          {/* Provider tips */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Zap size={13} className="text-primary" />
              <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Popular Providers</h3>
            </div>
            {[
              { name: "MSG91", note: "India-focused, DLT registered" },
              { name: "Twilio", note: "Global coverage, REST API" },
              { name: "Fast2SMS", note: "India — low cost, quick setup" },
              { name: "TextLocal", note: "UK / India coverage" },
            ].map(({ name, note }) => (
              <div key={name} className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-primary/50 shrink-0 mt-1.5" />
                <div>
                  <p className="text-xs font-medium text-foreground">{name}</p>
                  <p className="text-[11px] text-muted-foreground">{note}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Sender ID rules */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Info size={13} className="text-muted-foreground" />
              <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Sender ID Rules</h3>
            </div>
            <ul className="space-y-1.5">
              {[
                "Max 11 characters (letters only in India)",
                "Must be DLT-registered for Indian routes",
                "No spaces or special characters",
                "Avoid generic words (PROMO, ALERT)",
              ].map((rule) => (
                <li key={rule} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                  <span className="text-primary mt-0.5">·</span> {rule}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}

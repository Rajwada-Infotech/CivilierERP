import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check } from "lucide-react";
import {
  getCommunicatorConfig,
  saveCommunicatorConfig,
} from "@/api/communicatorConfigApi";
import { SheetShell } from "@/components/sheet/Sheet";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { Box, Field, DeliverySwitch, SaveKey, StatusBox, NoteBox, Loading } from "./parts";

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

  // The settings the server needs before it will send (services/messageProviders.js).
  const missing = [
    !form.apiUrl?.trim() && "API URL",
    !form.accessToken?.trim() && "access token",
    !form.phoneNumberId?.trim() && "phone number ID",
  ].filter(Boolean) as string[];

  const checklist = [
    { done: !!form.businessAccountId, label: "Create a Meta Business Account" },
    { done: !!form.phoneNumberId, label: "Add and verify a WhatsApp phone number" },
    { done: !!form.accessToken, label: "Generate a long-lived access token" },
    { done: !!form.apiUrl, label: "Set the Graph API URL" },
    { done: !!form.isActive, label: "Switch delivery on" },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Admin", "Communicator", "WhatsApp"]} />
      <SheetShell
        eyebrow="CivilierERP · Admin · Communicator"
        title="WhatsApp"
        subtitle="WhatsApp Cloud API or third-party provider settings for messages to customers."
      >
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_20rem] gap-4 items-start">
          <Box title="API and account" note="Meta Cloud API, Wati, etc.">
            {isLoading ? <Loading /> : (
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field id="wa-provider" label="Provider name" placeholder="e.g. Meta Cloud API, Wati" value={form.provider ?? ""} onChange={(e) => set("provider", e.target.value)} />
                  <Field id="wa-url" label="API URL" placeholder="https://graph.facebook.com/v17.0/" value={form.apiUrl ?? ""} onChange={(e) => set("apiUrl", e.target.value)} />
                  <Field id="wa-token" label="Access token" wide type="password" placeholder="EAAG… (long-lived token)" value={form.accessToken ?? ""} onChange={(e) => set("accessToken", e.target.value)} />
                  <Field id="wa-phone" label="Phone number ID" placeholder="e.g. 101234567890" value={form.phoneNumberId ?? ""} onChange={(e) => set("phoneNumberId", e.target.value)} />
                  <Field id="wa-biz" label="Business account ID" placeholder="e.g. 109876543210" value={form.businessAccountId ?? ""} onChange={(e) => set("businessAccountId", e.target.value)} />
                </div>
                <DeliverySwitch label="WhatsApp delivery" sub="When on, booking messages go out on WhatsApp" on={!!form.isActive} onChange={(v) => set("isActive", v)} />
                {rights.canEdit && <SaveKey pending={saveMutation.isPending} onClick={() => saveMutation.mutate()} />}
              </div>
            )}
          </Box>

          <div className="space-y-4">
            <StatusBox
              on={!!form.isActive}
              missing={missing}
              sendingText={`Via ${form.provider || "the configured provider"} · Phone ID ${form.phoneNumberId || "—"}`}
              offText="Switched off. No WhatsApp message is sent until it is turned on and saved."
            />
            <NoteBox
              title="Meta setup checklist"
              items={checklist.map(({ done, label }) => (
                <span className="flex items-center gap-2">
                  <span className={`w-3.5 h-3.5 shrink-0 border flex items-center justify-center ${done ? "bg-foreground border-foreground" : "border-foreground/40"}`}>
                    {done && <Check size={10} className="text-card" strokeWidth={3} />}
                  </span>
                  <span className={done ? "text-foreground" : ""}>{label}</span>
                </span>
              ))}
            />
            <NoteBox
              title="Notes"
              items={[
                "Free-text messages only reach people who messaged you in the last 24 hours; anyone else needs a template approved by Meta",
                "Tokens expire every 60 days — rotate regularly",
                "Test numbers are limited to 5 in sandbox mode",
                "Wati / 360dialog abstract the Meta API with simpler tokens",
              ]}
            />
          </div>
        </div>
      </SheetShell>
    </>
  );
}

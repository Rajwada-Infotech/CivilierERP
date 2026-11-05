import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getCommunicatorConfig,
  saveCommunicatorConfig,
} from "@/api/communicatorConfigApi";
import { SheetShell } from "@/components/sheet/Sheet";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { Box, Field, DeliverySwitch, SaveKey, StatusBox, NoteBox, Loading } from "./parts";

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

  // The settings the server needs before it will send (services/messageProviders.js).
  const missing = [
    !form.apiUrl?.trim() && "API URL",
    !form.apiKey?.trim() && "API key",
    !form.senderId?.trim() && "sender ID",
  ].filter(Boolean) as string[];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Admin", "Communicator", "SMS"]} />
      <SheetShell
        eyebrow="CivilierERP · Admin · Communicator"
        title="SMS gateway"
        subtitle="The SMS provider that carries transactional messages to customers."
      >
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_20rem] gap-4 items-start">
          <Box title="API connection" note="From your SMS vendor (MSG91, Twilio, etc.)">
            {isLoading ? <Loading /> : (
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field id="sms-provider" label="Provider name" placeholder="e.g. MSG91, Twilio" value={form.provider ?? ""} onChange={(e) => set("provider", e.target.value)} />
                  <Field id="sms-sender" label="Sender ID" placeholder="e.g. CIVILR" value={form.senderId ?? ""} onChange={(e) => set("senderId", e.target.value)} maxLength={11} className="uppercase" />
                  <Field
                    id="sms-url"
                    label="API URL"
                    wide
                    placeholder="https://api.provider.com/v1/send"
                    value={form.apiUrl ?? ""}
                    onChange={(e) => set("apiUrl", e.target.value)}
                    hint={<>For a gateway called by link, put {"{to}"}, {"{message}"}, {"{sender}"} and {"{apiKey}"} where they go in the URL. Without them the URL gets a JSON POST of to, message and sender, with the key as a Bearer token.</>}
                  />
                  <Field id="sms-key" label="API key / token" wide type="password" placeholder="••••••••••••" value={form.apiKey ?? ""} onChange={(e) => set("apiKey", e.target.value)} />
                </div>
                <DeliverySwitch label="SMS delivery" sub="When on, booking messages go out as SMS" on={!!form.isActive} onChange={(v) => set("isActive", v)} />
                {rights.canEdit && <SaveKey pending={saveMutation.isPending} onClick={() => saveMutation.mutate()} />}
              </div>
            )}
          </Box>

          <div className="space-y-4">
            <StatusBox
              on={!!form.isActive}
              missing={missing}
              sendingText={`Using ${form.provider || "the configured provider"} · Sender ${form.senderId || "—"}`}
              offText="Switched off. No SMS is sent until it is turned on and saved."
            />
            <NoteBox
              title="Popular providers"
              items={[
                ["MSG91", "India-focused, DLT registered"],
                ["Twilio", "Global coverage, REST API"],
                ["Fast2SMS", "India — low cost, quick setup"],
                ["TextLocal", "UK / India coverage"],
              ].map(([name, note]) => <><span className="text-foreground font-medium">{name}</span> — {note}</>)}
            />
            <NoteBox
              title="Sender ID rules"
              items={[
                "Max 11 characters (letters only in India)",
                "Must be DLT-registered for Indian routes",
                "No spaces or special characters",
                "Avoid generic words (PROMO, ALERT)",
              ]}
            />
          </div>
        </div>
      </SheetShell>
    </>
  );
}

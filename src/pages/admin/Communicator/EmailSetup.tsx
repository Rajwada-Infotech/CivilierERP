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
import { Box, Field, DeliverySwitch, SaveKey, StatusBox, NoteBox, Loading, LBL, chip } from "./parts";

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
// The server reads SSL as implicit TLS (port 465) and TLS as STARTTLS.
const ENCRYPTION = ["TLS", "SSL", "None"];
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

  // The settings the server needs before it will send (services/messageProviders.js).
  const missing = [
    !form.smtpHost?.trim() && "SMTP host",
    !form.smtpPort?.trim() && "SMTP port",
    !form.fromEmail?.trim() && "sender email",
  ].filter(Boolean) as string[];
  const encryption = (form.encryption || "").toUpperCase();

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Admin", "Communicator", "Email"]} />
      <SheetShell
        eyebrow="CivilierERP · Admin · Communicator"
        title="Email"
        subtitle="The SMTP server that sends system email to customers and staff."
      >
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_20rem] gap-4 items-start">
          <Box title="SMTP and sender" note="AWS SES, SendGrid, Gmail SMTP, etc.">
            {isLoading ? <Loading /> : (
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field id="em-provider" label="Provider / service" placeholder="e.g. AWS SES, SendGrid, Gmail" value={form.provider ?? ""} onChange={(e) => set("provider", e.target.value)} />
                  <div className="space-y-1.5">
                    <span className={`${LBL} block`}>Encryption</span>
                    <div className="flex gap-1.5" role="group" aria-label="Encryption">
                      {ENCRYPTION.map((e) => (
                        <button key={e} type="button" aria-pressed={encryption === e.toUpperCase()} onClick={() => set("encryption", e)} className={chip(encryption === e.toUpperCase())}>
                          {e}
                        </button>
                      ))}
                    </div>
                  </div>
                  <Field id="em-host" label="SMTP host" placeholder="smtp.example.com" value={form.smtpHost ?? ""} onChange={(e) => set("smtpHost", e.target.value)} />
                  <Field id="em-port" label="SMTP port" placeholder="587 or 465" inputMode="numeric" value={form.smtpPort ?? ""} onChange={(e) => set("smtpPort", e.target.value)} maxLength={5} />
                  <Field id="em-user" label="SMTP username" placeholder="Username or access key" value={form.smtpUser ?? ""} onChange={(e) => set("smtpUser", e.target.value)} />
                  <Field id="em-pass" label="SMTP password" type="password" placeholder="••••••••••••" value={form.smtpPassword ?? ""} onChange={(e) => set("smtpPassword", e.target.value)} />
                  <Field id="em-from" label="Sender email (from)" type="email" placeholder="noreply@yourdomain.com" value={form.fromEmail ?? ""} onChange={(e) => set("fromEmail", e.target.value)} />
                  <Field id="em-name" label="Sender name (from)" placeholder="e.g. Civilier ERP" value={form.fromName ?? ""} onChange={(e) => set("fromName", e.target.value)} />
                </div>
                <DeliverySwitch label="Email delivery" sub="When on, booking messages go out by email" on={!!form.isActive} onChange={(v) => set("isActive", v)} />
                {rights.canEdit && <SaveKey pending={saveMutation.isPending} onClick={() => saveMutation.mutate()} />}
              </div>
            )}
          </Box>

          <div className="space-y-4">
            <StatusBox
              on={!!form.isActive}
              missing={missing}
              sendingText={`Sending via ${form.smtpHost || "SMTP"} · From ${form.fromEmail || "—"}`}
              offText="Switched off. No email is sent until it is turned on and saved."
            />
            <NoteBox
              title="Common SMTP ports"
              items={[
                ["25", "SMTP (unencrypted, often blocked)"],
                ["465", "SMTPS — SSL"],
                ["587", "SMTP + STARTTLS (recommended)"],
                ["2525", "Alternative if 587 is blocked"],
              ].map(([port, label]) => <><span className="font-heading tabular-nums text-foreground font-semibold inline-block w-10">{port}</span>{label}</>)}
            />
            <NoteBox
              title="Quick tips"
              items={[
                "Use an app-specific password for Gmail",
                "AWS SES requires domain verification",
                "SendGrid API key goes in the password field",
                "Ensure SPF / DKIM records are set to avoid spam",
                "Test with a non-production address first",
              ]}
            />
          </div>
        </div>
      </SheetShell>
    </>
  );
}

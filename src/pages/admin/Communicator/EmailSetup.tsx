import React, { useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Mail,
  Server,
  KeyRound,
  ShieldCheck,
  CheckCircle2,
  Loader2,
  Eye,
  EyeOff,
  Send,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function EmailSetup() {
  const [isTesting, setIsTesting] = useState(false);
  const [status, setStatus] = useState<"idle" | "success">("idle");
  const [showPass, setShowPass] = useState(false);
  const [encryption, setEncryption] = useState<"TLS" | "SSL" | "None">("TLS");

  const handleTest = () => {
    setIsTesting(true);
    setStatus("idle");
    setTimeout(() => {
      setIsTesting(false);
      setStatus("success");
    }, 2000);
  };

  return (
    <>
      <Breadcrumbs items={["Admin", "Communicator", "Email Setup"]} />

      <div className="space-y-6">
        {/* Page header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
              <Mail className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Email Setup</h1>
              <p className="text-muted-foreground mt-1">
                Configure outbound mail server for notifications and system communications.
              </p>
            </div>
          </div>
          <AnimatePresence>
            {status === "success" && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
              >
                <Badge className="gap-1.5 px-3 py-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary-foreground" />
                  Connection verified
                </Badge>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="grid xl:grid-cols-3 gap-6">
          {/* Left: main form */}
          <div className="xl:col-span-2 space-y-6">
            {/* SMTP Credentials */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <KeyRound className="h-4 w-4 text-muted-foreground" />
                  SMTP Credentials
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="sender-email">Sender Email Address</Label>
                  <Input
                    id="sender-email"
                    type="email"
                    placeholder="notifications@company.com"
                    className="mt-1.5"
                  />
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="smtp-user">SMTP Username</Label>
                    <Input
                      id="smtp-user"
                      placeholder="user@smtp.com"
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <Label htmlFor="smtp-pass">SMTP Password</Label>
                    <div className="relative mt-1.5">
                      <Input
                        id="smtp-pass"
                        type={showPass ? "text" : "password"}
                        placeholder="••••••••"
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass((p) => !p)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Server Settings */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Server className="h-4 w-4 text-muted-foreground" />
                  Server Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2">
                    <Label htmlFor="smtp-host">SMTP Host</Label>
                    <Input
                      id="smtp-host"
                      placeholder="smtp.provider.com"
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <Label htmlFor="smtp-port">Port</Label>
                    <Input id="smtp-port" placeholder="587" className="mt-1.5" />
                  </div>
                </div>
                <div>
                  <Label className="mb-2 block">Encryption Protocol</Label>
                  <div className="flex gap-2">
                    {(["TLS", "SSL", "None"] as const).map((opt) => (
                      <Button
                        key={opt}
                        type="button"
                        size="sm"
                        variant={encryption === opt ? "default" : "outline"}
                        onClick={() => setEncryption(opt)}
                      >
                        {opt}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right: sidebar */}
          <div className="space-y-6">
            {/* Connection checks */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  Connection Checks
                  <span
                    className={`w-2 h-2 rounded-full ${
                      status === "success" ? "bg-green-500 animate-pulse" : "bg-muted-foreground/30"
                    }`}
                  />
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {[
                  { label: "SMTP Auth", ok: status === "success" },
                  { label: "TLS Handshake", ok: status === "success" },
                  { label: "Relay OK", ok: status === "success" },
                ].map((item, i) => (
                  <div
                    key={item.label}
                    className={`flex items-center justify-between px-6 py-3 ${
                      i < 2 ? "border-b" : ""
                    }`}
                  >
                    <span className="text-sm text-muted-foreground">{item.label}</span>
                    <span
                      className={`text-xs font-semibold ${
                        item.ok ? "text-green-500" : "text-muted-foreground/40"
                      }`}
                    >
                      {item.ok ? "✓ OK" : "—"}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* App password tip */}
            <Card className="bg-muted/40">
              <CardContent className="pt-6">
                <ShieldCheck className="h-5 w-5 text-primary mb-3" />
                <p className="text-sm font-semibold mb-1.5">App Passwords</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  For Gmail or Outlook, generate an{" "}
                  <span className="text-primary font-medium">App Password</span>{" "}
                  instead of using your primary account credentials.
                </p>
              </CardContent>
            </Card>

            {/* Quick presets */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  Quick Presets
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                {[
                  { name: "Gmail", host: "smtp.gmail.com:587" },
                  { name: "Outlook", host: "smtp.office365.com:587" },
                  { name: "SendGrid", host: "smtp.sendgrid.net:465" },
                ].map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg border hover:bg-muted/50 transition-colors text-left"
                  >
                    <span className="text-sm font-medium">{p.name}</span>
                    <span className="text-xs text-muted-foreground">{p.host}</span>
                  </button>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t">
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={handleTest} disabled={isTesting}>
              {isTesting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              {isTesting ? "Sending test..." : "Send test email"}
            </Button>
            <AnimatePresence>
              {status === "success" && (
                <motion.span
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-1.5 text-sm text-green-500 font-medium"
                >
                  <CheckCircle2 className="h-4 w-4" /> Delivered
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <Button>Save configuration</Button>
        </div>
      </div>
    </>
  );
}

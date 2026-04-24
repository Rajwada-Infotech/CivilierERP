import React, { useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  MessageCircle,
  Link2,
  Key,
  ShieldCheck,
  CheckCircle2,
  Loader2,
  ExternalLink,
  Copy,
  Settings2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-2 h-10 rounded-md border bg-muted px-3">
      <code className="text-xs font-mono text-muted-foreground truncate flex-1">
        {value}
      </code>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
      >
        <AnimatePresence mode="wait">
          {copied ? (
            <motion.span
              key="ok"
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              className="flex text-green-500"
            >
              <CheckCircle2 className="h-4 w-4" />
            </motion.span>
          ) : (
            <motion.span
              key="copy"
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              className="flex"
            >
              <Copy className="h-4 w-4" />
            </motion.span>
          )}
        </AnimatePresence>
      </button>
    </div>
  );
}

export default function WhatsAppSetup() {
  const [isVerifying, setIsVerifying] = useState(false);
  const [status, setStatus] = useState<"idle" | "connected">("idle");

  const handleVerify = () => {
    setIsVerifying(true);
    setStatus("idle");
    setTimeout(() => {
      setIsVerifying(false);
      setStatus("connected");
    }, 2200);
  };

  return (
    <>
      <Breadcrumbs items={["Admin", "Communicator", "WhatsApp Setup"]} />

      <div className="space-y-6">
        {/* Page header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
              <MessageCircle className="h-5 w-5 text-primary-foreground" />
              {status === "connected" && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-60" />
                  <span className="relative rounded-full h-3 w-3 bg-green-500 border-2 border-background" />
                </span>
              )}
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">WhatsApp Setup</h1>
              <p className="text-muted-foreground mt-1">
                Connect your Meta Business account to send automated WhatsApp messages.
              </p>
            </div>
          </div>
          <AnimatePresence>
            {status === "connected" && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
              >
                <Badge className="gap-1.5 px-3 py-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary-foreground" />
                  API connected
                </Badge>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="grid xl:grid-cols-3 gap-6">
          {/* Left: main form */}
          <div className="xl:col-span-2 space-y-6">
            {/* API Credentials */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Settings2 className="h-4 w-4 text-muted-foreground" />
                  API Credentials
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="access-token">Access Token</Label>
                  <div className="relative mt-1.5">
                    <Input
                      id="access-token"
                      type="password"
                      placeholder="EAAG…"
                      className="pr-10"
                    />
                    <Key className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="phone-id">Phone Number ID</Label>
                    <Input
                      id="phone-id"
                      placeholder="1092837465…"
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <Label htmlFor="waba-id">WABA ID</Label>
                    <Input
                      id="waba-id"
                      placeholder="987654321…"
                      className="mt-1.5"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Webhook */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Link2 className="h-4 w-4 text-muted-foreground" />
                  Webhook Configuration
                  <Badge variant="outline" className="ml-1 text-xs">
                    Required
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="mb-1.5 block">Callback URL</Label>
                  <CopyField value="https://api.yourdomain.com/webhooks/whatsapp" />
                </div>
                <div>
                  <Label className="mb-1.5 block">Verify Token</Label>
                  <CopyField value="wh_verify_civilier_2024_secure" />
                </div>
                <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-muted/50 border">
                  <span className="text-muted-foreground mt-0.5 shrink-0">⚠</span>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Register this URL in your Meta App Dashboard under{" "}
                    <strong className="text-foreground">
                      WhatsApp → Configuration → Webhooks
                    </strong>
                    .
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Message templates */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                  Message Templates
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-3 gap-3">
                  {[
                    { name: "otp_verification", status: "APPROVED" },
                    { name: "payment_alert", status: "PENDING" },
                    { name: "task_update", status: "APPROVED" },
                  ].map((t) => (
                    <div
                      key={t.name}
                      className="rounded-lg p-3 border hover:bg-muted/50 transition-colors"
                    >
                      <p className="text-xs font-medium text-muted-foreground mb-2 truncate">
                        {t.name}
                      </p>
                      <Badge
                        variant={t.status === "APPROVED" ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {t.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right: sidebar */}
          <div className="space-y-6">
            {/* API status */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">API Status</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center gap-2.5 mb-4">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      status === "connected"
                        ? "bg-green-500 animate-pulse"
                        : "bg-muted-foreground/30"
                    }`}
                  />
                  <span
                    className={`text-sm font-medium ${
                      status === "connected" ? "text-green-500" : "text-muted-foreground"
                    }`}
                  >
                    {status === "connected" ? "Connected" : "Not verified"}
                  </span>
                </div>
                <div className="space-y-0">
                  {[
                    { label: "Token Valid", ok: status === "connected" },
                    { label: "Phone Number", ok: status === "connected" },
                    { label: "Webhook Active", ok: false },
                  ].map((item, i) => (
                    <div
                      key={item.label}
                      className={`flex items-center justify-between py-2.5 ${
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
                </div>
              </CardContent>
            </Card>

            {/* Meta portal */}
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm font-semibold mb-1.5">Meta Developer Portal</p>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                  Create an App in Meta's dashboard, add WhatsApp, and generate tokens
                  from{" "}
                  <span className="text-primary font-medium">
                    Business Settings → API Setup
                  </span>
                  .
                </p>
                <Button variant="outline" className="w-full" asChild>
                  <a
                    href="https://developers.facebook.com/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open Meta Dashboard
                    <ExternalLink className="h-3.5 w-3.5 ml-2" />
                  </a>
                </Button>
              </CardContent>
            </Card>

            {/* 24hr rule */}
            <Card className="bg-muted/40">
              <CardContent className="pt-6">
                <p className="text-sm font-semibold mb-1.5">24-Hour Rule</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Free-form messages are only allowed within{" "}
                  <span className="text-primary font-medium">24 hours</span> of a
                  user's last message. Outside this window, only approved templates
                  may be sent.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t">
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={handleVerify} disabled={isVerifying}>
              {isVerifying ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Link2 className="h-4 w-4 mr-2" />
              )}
              {isVerifying ? "Verifying..." : "Verify connection"}
            </Button>
            <AnimatePresence>
              {status === "connected" && (
                <motion.span
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-1.5 text-sm text-green-500 font-medium"
                >
                  <CheckCircle2 className="h-4 w-4" /> API connected
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <Button>Save changes</Button>
        </div>
      </div>
    </>
  );
}

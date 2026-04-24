import React, { useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  MessageSquare,
  Key,
  Smartphone,
  CheckCircle2,
  Loader2,
  Zap,
  Send,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const PROVIDERS = [
  "Twilio",
  "Vonage (Nexmo)",
  "MessageBird",
  "AWS SNS",
  "Custom HTTP API",
];

export default function SmsSetup() {
  const [isTesting, setIsTesting] = useState(false);
  const [status, setStatus] = useState<"idle" | "success">("idle");
  const [provider, setProvider] = useState("Twilio");
  const [msgType, setMsgType] = useState<"transactional" | "promotional">(
    "transactional"
  );

  const handleTest = () => {
    setIsTesting(true);
    setStatus("idle");
    setTimeout(() => {
      setIsTesting(false);
      setStatus("success");
    }, 1800);
  };

  return (
    <>
      <Breadcrumbs items={["Admin", "Communicator", "SMS Setup"]} />

      <div className="space-y-6">
        {/* Page header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
              <MessageSquare className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">SMS Gateway</h1>
              <p className="text-muted-foreground mt-1">
                Configure SMS for alerts, 2FA codes, and customer notifications.
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
                  Gateway reachable
                </Badge>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="grid xl:grid-cols-3 gap-6">
          {/* Left: main form */}
          <div className="xl:col-span-2 space-y-6">
            {/* Provider selection */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Zap className="h-4 w-4 text-muted-foreground" />
                  Gateway Provider
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-3 gap-2">
                  {PROVIDERS.map((p) => (
                    <Button
                      key={p}
                      type="button"
                      variant={provider === p ? "default" : "outline"}
                      size="sm"
                      className="justify-start"
                      onClick={() => setProvider(p)}
                    >
                      {p}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* API Credentials */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Key className="h-4 w-4 text-muted-foreground" />
                  API Credentials
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="account-sid">Account SID / API Key</Label>
                  <Input
                    id="account-sid"
                    placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label htmlFor="auth-token">Auth Token / Secret</Label>
                  <Input
                    id="auth-token"
                    type="password"
                    placeholder="••••••••••••••••••••"
                    className="mt-1.5"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Sender details */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Smartphone className="h-4 w-4 text-muted-foreground" />
                  Sender Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="from-number">From Number (E.164)</Label>
                    <Input
                      id="from-number"
                      placeholder="+12025551234"
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <Label htmlFor="sender-id">Sender ID / Name</Label>
                    <Input
                      id="sender-id"
                      placeholder="YOURAPP"
                      className="mt-1.5"
                    />
                  </div>
                </div>
                <div>
                  <Label className="mb-2 block">Message Type</Label>
                  <div className="flex gap-2">
                    {(["transactional", "promotional"] as const).map((t) => (
                      <Button
                        key={t}
                        type="button"
                        size="sm"
                        variant={msgType === t ? "default" : "outline"}
                        onClick={() => setMsgType(t)}
                        className="capitalize"
                      >
                        {t}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right: sidebar */}
          <div className="space-y-6">
            {/* Gateway status */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Gateway Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3 mb-1">
                  <div className="flex items-end gap-0.5 h-6">
                    {[0.4, 0.6, 0.8, 1].map((h, i) => (
                      <div
                        key={i}
                        className="w-2 rounded-sm transition-all duration-500"
                        style={{
                          height: `${h * 100}%`,
                          background:
                            status === "success"
                              ? `hsl(var(--primary) / ${h})`
                              : "hsl(var(--muted-foreground) / 0.2)",
                        }}
                      />
                    ))}
                  </div>
                  <span
                    className={`text-sm font-medium ${
                      status === "success" ? "text-green-500" : "text-muted-foreground"
                    }`}
                  >
                    {status === "success" ? "Reachable" : "Not tested"}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* A2P compliance */}
            <Card className="bg-muted/40">
              <CardContent className="pt-6">
                <Zap className="h-5 w-5 text-primary mb-3" />
                <p className="text-sm font-semibold mb-1.5">A2P Compliance</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Ensure proper{" "}
                  <span className="text-primary font-medium">opt-in consent</span>{" "}
                  is collected before messaging. Violations can result in carrier
                  blocks.
                </p>
              </CardContent>
            </Card>

            {/* Rate limits */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  Default Rate Limits
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {[
                  { label: "Per Second", val: "1 msg/s" },
                  { label: "Per Day", val: "1,000 msgs" },
                  { label: "Per Number", val: "200 msgs" },
                ].map((r, i) => (
                  <div
                    key={r.label}
                    className={`flex items-center justify-between px-6 py-3 ${
                      i < 2 ? "border-b" : ""
                    }`}
                  >
                    <span className="text-sm text-muted-foreground">{r.label}</span>
                    <span className="text-sm font-semibold">{r.val}</span>
                  </div>
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
              {isTesting ? "Sending test..." : "Send test SMS"}
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
          <Button>Save settings</Button>
        </div>
      </div>
    </>
  );
}

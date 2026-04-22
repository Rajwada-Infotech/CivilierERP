import React, { useState } from "react";
import {
  MessageCircle,
  Settings2,
  Link2,
  ShieldCheck,
  Key,
  CheckCircle2,
  Loader2,
  ExternalLink,
  Copy,
  Info,
} from "lucide-react";

const WhatsAppSetup: React.FC = () => {
  const [isVerifying, setIsVerifying] = useState(false);
  const [status, setStatus] = useState<"idle" | "connected" | "error">("idle");

  const handleVerify = () => {
    setIsVerifying(true);
    setTimeout(() => {
      setIsVerifying(false);
      setStatus("connected");
    }, 1800);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    // You could add a toast notification here
  };

  return (
    <div className="w-full max-w-6xl mx-auto p-6 space-y-8 text-slate-200">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="p-3 bg-emerald-500/10 rounded-xl mt-1">
          <MessageCircle size={32} className="text-emerald-500" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">
            WhatsApp Business API
          </h1>
          <p className="text-slate-400 mt-1">
            Connect your Meta Business account to send automated WhatsApp
            messages.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Configuration Left Side */}
        <div className="lg:col-span-2 space-y-6">
          {/* 1. API Credentials */}
          <section className="bg-[#1e2128] border border-slate-800 rounded-xl p-6 shadow-sm space-y-6">
            <div className="flex items-center gap-2 text-slate-400">
              <Settings2 size={18} />
              <h2 className="text-sm font-semibold uppercase tracking-wider">
                API Credentials
              </h2>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">
                  Temporary or Permanent Access Token
                </label>
                <div className="relative">
                  <input
                    type="password"
                    className="w-full flex h-11 rounded-md border border-slate-700 bg-[#0f1115] px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500/50 outline-none transition-all"
                    placeholder="EAAG..."
                  />
                  <Key
                    size={16}
                    className="absolute right-3 top-3.5 text-slate-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Phone Number ID
                  </label>
                  <input
                    type="text"
                    className="w-full flex h-11 rounded-md border border-slate-700 bg-[#0f1115] px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500/50 outline-none"
                    placeholder="1092837465..."
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    WhatsApp Business Account ID
                  </label>
                  <input
                    type="text"
                    className="w-full flex h-11 rounded-md border border-slate-700 bg-[#0f1115] px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500/50 outline-none"
                    placeholder="987654321..."
                  />
                </div>
              </div>
            </div>
          </section>

          {/* 2. Webhook Setup */}
          <section className="bg-[#1e2128] border border-slate-800 rounded-xl p-6 shadow-sm space-y-6">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2 text-slate-400">
                <Link2 size={18} />
                <h2 className="text-sm font-semibold uppercase tracking-wider">
                  Webhook Configuration
                </h2>
              </div>
              <span className="text-[10px] bg-amber-500/10 text-amber-500 px-2 py-1 rounded font-bold uppercase border border-amber-500/20">
                Required for Replies
              </span>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-500 uppercase">
                  Callback URL
                </p>
                <div className="flex items-center justify-between bg-[#0f1115] border border-slate-700 rounded-md px-3 py-2 group">
                  <code className="text-xs text-blue-400 truncate mr-2">
                    https://api.yourdomain.com/webhooks/whatsapp
                  </code>
                  <button
                    onClick={() =>
                      copyToClipboard(
                        "https://api.yourdomain.com/webhooks/whatsapp",
                      )
                    }
                    className="text-slate-500 hover:text-white transition-colors"
                  >
                    <Copy size={14} />
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-500 uppercase">
                  Verify Token
                </p>
                <div className="flex items-center justify-between bg-[#0f1115] border border-slate-700 rounded-md px-3 py-2 group">
                  <code className="text-xs text-blue-400">
                    wh_setup_2024_secure_node
                  </code>
                  <button
                    onClick={() => copyToClipboard("wh_setup_2024_secure_node")}
                    className="text-slate-500 hover:text-white transition-colors"
                  >
                    <Copy size={14} />
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Sidebar Info Panels */}
        <div className="space-y-6">
          <div className="p-6 rounded-xl bg-gradient-to-br from-emerald-600 to-emerald-800 text-white shadow-lg">
            <Info className="mb-4 text-emerald-200" size={28} />
            <h3 className="font-bold text-lg mb-2 text-white">
              Meta Developer Portal
            </h3>
            <p className="text-sm text-emerald-50/80 leading-relaxed mb-6">
              You must create an App in the Meta App Dashboard and add the
              "WhatsApp" product to generate tokens.
            </p>
            <a
              href="https://developers.facebook.com/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center w-full gap-2 text-sm font-bold bg-white/10 hover:bg-white/20 py-2.5 rounded-lg border border-white/20 transition-all"
            >
              Go to Meta Dashboard <ExternalLink size={14} />
            </a>
          </div>

          <div className="p-6 rounded-xl border border-slate-800 bg-[#1e2128]">
            <div className="flex items-center gap-2 mb-3">
              <ShieldCheck size={18} className="text-emerald-500" />
              <h4 className="text-sm font-semibold text-slate-200">
                Message Templates
              </h4>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              WhatsApp requires <strong>approved templates</strong> for
              business-initiated messages. Unsolicited free-form text is
              restricted outside the 24-hour service window.
            </p>
          </div>
        </div>
      </div>

      {/* Action Footer */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 border-t border-slate-800">
        <div className="flex items-center gap-4">
          <button
            onClick={handleVerify}
            disabled={isVerifying}
            className="h-10 px-6 text-sm font-medium border border-slate-700 rounded-md hover:bg-slate-800 transition-colors disabled:opacity-50 text-slate-300"
          >
            {isVerifying ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin inline" />
            ) : (
              "Verify Connection"
            )}
          </button>

          {status === "connected" && (
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-500">
              <CheckCircle2 size={18} /> API Connected
            </div>
          )}
        </div>

        <button className="w-full sm:w-auto h-10 px-10 text-sm font-bold bg-emerald-600 text-white rounded-md hover:bg-emerald-500 transition-all shadow-lg shadow-emerald-900/20">
          Save Changes
        </button>
      </div>
    </div>
  );
};

export default WhatsAppSetup;

import React, { useState } from "react";
import {
  MessageSquare,
  Key,
  Smartphone,
  CheckCircle2,
  Loader2,
  Zap,
  Info,
} from "lucide-react";

const SmsSetup: React.FC = () => {
  const [isTesting, setIsTesting] = useState(false);
  const [status, setStatus] = useState<"idle" | "success">("idle");

  const handleTest = () => {
    setIsTesting(true);
    setTimeout(() => {
      setIsTesting(false);
      setStatus("success");
    }, 1500);
  };

  return (
    <div className="w-full max-w-6xl mx-auto p-6 space-y-8 text-slate-200">
      <div className="flex items-start gap-4">
        <div className="p-3 bg-amber-500/10 rounded-xl mt-1">
          <MessageSquare size={32} className="text-amber-500" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">
            SMS Setup
          </h1>
          <p className="text-slate-400 mt-1">
            Configure your SMS gateway to send alerts and 2FA codes.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {/* Provider Selection */}
          <section className="bg-[#1e2128] border border-slate-800 rounded-xl p-6 space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              Gateway Provider
            </h2>
            <select className="w-full h-11 rounded-md border border-slate-700 bg-[#0f1115] px-3 text-sm outline-none focus:ring-2 focus:ring-amber-500/50 text-white">
              <option>Twilio</option>
              <option>Vonage (Nexmo)</option>
              <option>MessageBird</option>
              <option>Custom HTTP API</option>
            </select>
          </section>

          {/* API Keys */}
          <section className="bg-[#1e2128] border border-slate-800 rounded-xl p-6 space-y-6">
            <div className="flex items-center gap-2 text-slate-400">
              <Key size={18} />
              <h2 className="text-sm font-semibold uppercase tracking-wider">
                API Credentials
              </h2>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">
                  Account SID / API Key
                </label>
                <input
                  type="text"
                  className="w-full h-11 rounded-md border border-slate-700 bg-[#0f1115] px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500/50 outline-none"
                  placeholder="Enter SID"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">
                  Auth Token / Secret
                </label>
                <input
                  type="password"
                  className="w-full h-11 rounded-md border border-slate-700 bg-[#0f1115] px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500/50 outline-none"
                  placeholder="••••••••"
                />
              </div>
            </div>
          </section>

          {/* Sender Details */}
          <section className="bg-[#1e2128] border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-slate-400">
              <Smartphone size={18} />
              <h2 className="text-sm font-semibold uppercase tracking-wider">
                Sender Details
              </h2>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">
                From Number (E.164 format)
              </label>
              <input
                type="text"
                className="w-full h-11 rounded-md border border-slate-700 bg-[#0f1115] px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500/50 outline-none"
                placeholder="+1234567890"
              />
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <div className="p-6 rounded-xl bg-amber-500/10 border border-amber-500/20 shadow-lg">
            <Zap className="mb-4 text-amber-500" size={28} />
            <h3 className="font-bold text-lg mb-2 text-amber-100">
              Compliance Info
            </h3>
            <p className="text-sm text-amber-100/70 leading-relaxed">
              Ensure you have collected proper opt-ins before sending messages
              to comply with international A2P regulations.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 border-t border-slate-800">
        <div className="flex items-center gap-4">
          <button
            onClick={handleTest}
            disabled={isTesting}
            className="h-10 px-6 text-sm font-medium border border-slate-700 rounded-md hover:bg-slate-800 transition-colors text-slate-300"
          >
            {isTesting ? (
              <Loader2 className="w-4 h-4 animate-spin inline" />
            ) : (
              "Send Test SMS"
            )}
          </button>
          {status === "success" && (
            <div className="text-sm text-emerald-500 flex items-center gap-1">
              <CheckCircle2 size={16} /> Sent!
            </div>
          )}
        </div>
        <button className="w-full sm:w-auto h-10 px-10 text-sm font-bold bg-amber-600 text-white rounded-md hover:bg-amber-500">
          Save SMS Settings
        </button>
      </div>
    </div>
  );
};

export default SmsSetup;

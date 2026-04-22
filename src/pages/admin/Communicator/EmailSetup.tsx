import React, { useState } from "react";
import {
  Mail,
  Server,
  ShieldCheck,
  KeyRound,
  CheckCircle2,
  Loader2,
  Settings,
} from "lucide-react";

const EmailSetup: React.FC = () => {
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
        <div className="p-3 bg-blue-500/10 rounded-xl mt-1">
          <Mail size={32} className="text-blue-500" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">
            Email Configuration
          </h1>
          <p className="text-slate-400 mt-1">
            Setup SMTP settings for system notifications and user
            communications.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {/* SMTP Credentials */}
          <section className="bg-[#1e2128] border border-slate-800 rounded-xl p-6 space-y-6">
            <div className="flex items-center gap-2 text-slate-400">
              <KeyRound size={18} />
              <h2 className="text-sm font-semibold uppercase tracking-wider">
                SMTP Credentials
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium text-slate-300">
                  Sender Email Address
                </label>
                <input
                  type="email"
                  className="w-full h-11 rounded-md border border-slate-700 bg-[#0f1115] px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/50 outline-none"
                  placeholder="notifications@company.com"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">
                  SMTP Username
                </label>
                <input
                  type="text"
                  className="w-full h-11 rounded-md border border-slate-700 bg-[#0f1115] px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/50 outline-none"
                  placeholder="user@smtp.com"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">
                  SMTP Password
                </label>
                <input
                  type="password"
                  internal-password-toggle="true"
                  className="w-full h-11 rounded-md border border-slate-700 bg-[#0f1115] px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/50 outline-none"
                  placeholder="••••••••"
                />
              </div>
            </div>
          </section>

          {/* Server Settings */}
          <section className="bg-[#1e2128] border border-slate-800 rounded-xl p-6 space-y-6">
            <div className="flex items-center gap-2 text-slate-400">
              <Server size={18} />
              <h2 className="text-sm font-semibold uppercase tracking-wider">
                Server Settings
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2 space-y-2">
                <label className="text-sm font-medium text-slate-300">
                  SMTP Host
                </label>
                <input
                  type="text"
                  className="w-full h-11 rounded-md border border-slate-700 bg-[#0f1115] px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/50 outline-none"
                  placeholder="smtp.provider.com"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">
                  Port
                </label>
                <input
                  type="text"
                  className="w-full h-11 rounded-md border border-slate-700 bg-[#0f1115] px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/50 outline-none"
                  placeholder="587"
                />
              </div>
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <div className="p-6 rounded-xl bg-slate-800 border border-slate-700">
            <ShieldCheck className="mb-4 text-blue-400" size={28} />
            <h3 className="font-bold text-lg mb-2">Security Note</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              For Gmail or Outlook, use an <strong>App Password</strong> rather
              than your primary login password to ensure security.
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
              "Send Test Email"
            )}
          </button>
          {status === "success" && (
            <div className="text-sm text-emerald-500 flex items-center gap-1">
              <CheckCircle2 size={16} /> Sent!
            </div>
          )}
        </div>
        <button className="w-full sm:w-auto h-10 px-10 text-sm font-bold bg-blue-600 text-white rounded-md hover:bg-blue-500">
          Save Config
        </button>
      </div>
    </div>
  );
};

export default EmailSetup;

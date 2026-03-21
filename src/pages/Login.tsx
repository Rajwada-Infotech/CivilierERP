import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const ROLE_HINTS = [
  { role: "Super Admin", email: "superadmin@civilier.com", password: "super123", color: "#7c3aed" },
  { role: "Admin", email: "admin@civilier.com", password: "admin123", color: "#2563eb" },
  { role: "User (Active)", email: "rajesh@civilier.com", password: "user123", color: "#059669" },
  { role: "User (Limited)", email: "meena@civilier.com", password: "user123", color: "#d97706" },
  { role: "User (Inactive)", email: "dinesh@civilier.com", password: "user123", color: "#dc2626" },
];

export default function Login() {
  const [showPass, setShowPass] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showHints, setShowHints] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const result = login(email, password);
    if (result.success) {
      navigate("/");
    } else {
      setError(result.error || "Login failed.");
    }
  };

  const fillCredentials = (e: string, p: string) => {
    setEmail(e);
    setPassword(p);
    setShowHints(false);
    setError("");
  };

  return (
    <div
      className="relative h-screen w-full flex items-center justify-center overflow-hidden"
      style={{ background: "linear-gradient(135deg, #f3e8ff 0%, #e9d5ff 25%, #ffffff 60%, #f8f4ff 100%)" }}
    >
      {/* Background blobs */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full blur-[120px] animate-float" style={{ background: "rgba(168, 85, 247, 0.25)" }} />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full blur-[120px] animate-float-delayed" style={{ background: "rgba(139, 92, 246, 0.2)" }} />
        <div className="absolute top-[40%] left-[60%] w-[30%] h-[30%] rounded-full blur-[100px] animate-float" style={{ background: "rgba(196, 141, 255, 0.15)", animationDelay: "3s" }} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.2, 0, 0, 1] }}
        className="relative z-10 w-full max-w-md p-8 shadow-2xl rounded-2xl backdrop-blur-sm"
        style={{
          background: "linear-gradient(90deg, #d1d5db 0%, #e5e7eb 40%, #f9fafb 75%, #ffffff 100%)",
          border: "1px solid rgba(255,255,255,0.5)",
          boxShadow: "0 25px 60px rgba(139, 92, 246, 0.12), 0 8px 32px rgba(0,0,0,0.06)",
        }}
      >
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex flex-col items-center justify-center gap-3">
            <img
              src="/CivilierERP.png"
              alt="CivilierERP Logo"
              className="w-28 h-28 rounded-full object-contain drop-shadow-xl"
              style={{ filter: "drop-shadow(0 10px 24px rgba(124, 58, 237, 0.4))" }}
            />
            <h1
              className="text-3xl font-bold font-heading tracking-tight"
              style={{ background: "linear-gradient(135deg, #4c1d95, #7c3aed, #a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
            >
              CivilierERP
            </h1>
          </div>
          <p className="mt-2 text-sm text-slate-600">Enterprise Resource Planning — Built for Civil Contractors</p>
        </div>

        {/* Form */}
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide mb-1.5 ml-1 text-slate-700">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(""); }}
              className="w-full rounded-lg px-4 py-2.5 border border-purple-200 focus:border-purple-400 focus:ring-2 focus:ring-purple-300/50 transition-all bg-white/70 text-slate-800 placeholder:text-slate-400"
              placeholder="name@company.com"
              required
            />
          </div>

          <div className="relative">
            <label className="block text-xs font-medium uppercase tracking-wide mb-1.5 ml-1 text-slate-700">Password</label>
            <input
              type={showPass ? "text" : "password"}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              className="w-full rounded-lg px-4 py-2.5 border border-purple-200 focus:border-purple-400 focus:ring-2 focus:ring-purple-300/50 transition-all bg-white/70 text-slate-800 placeholder:text-slate-400 pr-11"
              placeholder="••••••••"
              required
            />
            <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-8 text-slate-500 hover:text-purple-700 transition-colors">
              {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="px-4 py-2.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600"
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          <button
            type="submit"
            className="w-full py-3 rounded-lg font-semibold text-white shadow-md hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-200"
            style={{ background: "linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)", boxShadow: "0 4px 16px rgba(124, 58, 237, 0.3)" }}
          >
            Sign In
          </button>
        </form>

        {/* Demo credentials hint */}
        <div className="mt-5">
          <button
            type="button"
            onClick={() => setShowHints(!showHints)}
            className="w-full flex items-center justify-center gap-2 text-xs text-slate-500 hover:text-purple-700 transition-colors"
          >
            <ShieldCheck size={14} />
            {showHints ? "Hide demo credentials" : "Show demo credentials"}
          </button>

          <AnimatePresence>
            {showHints && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-3 space-y-1.5 overflow-hidden"
              >
                {ROLE_HINTS.map((h) => (
                  <button
                    key={h.email}
                    type="button"
                    onClick={() => fillCredentials(h.email, h.password)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg border border-slate-200 bg-white/60 hover:bg-white/90 transition-all text-left"
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: h.color }} />
                    <span className="text-xs font-medium text-slate-700 w-28 shrink-0">{h.role}</span>
                    <span className="text-xs text-slate-500 truncate">{h.email}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}

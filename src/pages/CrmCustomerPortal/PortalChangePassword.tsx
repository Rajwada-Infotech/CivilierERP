import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";

const API = "/api/crm-portal";

const PortalChangePassword: React.FC = () => {
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirm) { toast.error("Passwords do not match"); return; }
    if (newPassword.length < 6) { toast.error("Password must be at least 6 characters"); return; }
    setLoading(true);
    try {
      const token = localStorage.getItem("crm_portal_token");
      const res = await fetch(`${API}/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ newPassword }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Password updated");
      navigate("/crm-client-portal/dashboard");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "linear-gradient(160deg, #faf5ff 0%, #f5f3ff 30%, #ffffff 65%, #fdf9ff 100%)" }}>
      <div className="w-full max-w-sm rounded-2xl p-7"
        style={{
          background: "rgba(255,255,255,0.95)",
          border: "1px solid rgba(124,58,237,0.12)",
          boxShadow: "0 20px 60px rgba(124,58,237,0.08), 0 4px 20px rgba(0,0,0,0.06)",
        }}>
        <div className="flex flex-col items-center gap-3 mb-6">
          <div className="w-14 h-14 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center">
            <KeyRound size={22} />
          </div>
          <div className="text-center">
            <h1 className="text-lg font-bold text-slate-800">Set Your Password</h1>
            <p className="text-xs text-slate-400 mt-1">For security, please set a new password for future logins</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs text-slate-500 block mb-1">New Password</label>
            <input type="password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400 transition-colors" />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Confirm Password</label>
            <input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400 transition-colors" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-2.5 text-white text-sm font-semibold rounded-xl disabled:opacity-40 transition-opacity"
            style={{ background: "linear-gradient(135deg, #7c3aed, #6d28d9)" }}>
            {loading ? "Saving..." : "Save & Continue"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default PortalChangePassword;

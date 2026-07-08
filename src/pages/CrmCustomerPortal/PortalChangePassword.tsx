import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

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
    <div className="min-h-screen flex items-center justify-center bg-muted/20 px-4">
      <div className="w-full max-w-sm bg-background rounded-2xl border border-border p-6 shadow-sm">
        <h1 className="text-xl font-bold text-center mb-1">Set Your Password</h1>
        <p className="text-xs text-muted-foreground text-center mb-6">For security, please set a new password</p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">New Password</label>
            <input type="password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Confirm Password</label>
            <input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)}
              className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-40">
            {loading ? "Saving..." : "Save & Continue"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default PortalChangePassword;

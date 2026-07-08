import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

const API = "/api/crm-portal";

const PortalLogin: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`${API}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      localStorage.setItem("crm_portal_token", data.token);
      if (data.mustChangePassword) {
        navigate("/crm-client-portal/change-password");
      } else {
        navigate("/crm-client-portal/dashboard");
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/20 px-4">
      <div className="w-full max-w-sm bg-background rounded-2xl border border-border p-6 shadow-sm">
        <h1 className="text-xl font-bold text-center mb-1">Customer Portal</h1>
        <p className="text-xs text-muted-foreground text-center mb-6">Track your application, agreement and payments</p>
        <form onSubmit={handleLogin} className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Email</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Password</label>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background" />
            <p className="text-[11px] text-muted-foreground mt-1">First time? Use your registered mobile number as the password.</p>
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-40">
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default PortalLogin;

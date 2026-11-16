// The Employee Portal sign-in: the same e-mail + password as the other portals, but only accounts HR has enabled for
// the Employee Portal can get through (the server refuses staff, supplier and customer accounts here).
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Eye, EyeOff, UserRound } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { LogoFull } from "@/components/Logo";

export default function EmployeeLogin() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (!email.trim() || !password) {
      setError("Enter your e-mail and password.");
      return;
    }
    setBusy(true);
    try {
      const result = await login(email.trim(), password, "employee");
      if (result.success) {
        navigate("/employee", { replace: true });
      } else {
        setError(result.error || "Sign-in failed. Check your e-mail and password.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sign-in failed. Please try again.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full h-11 px-3 bg-background border border-foreground/30 text-sm text-foreground outline-none focus:border-foreground";
  const label = "block text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1.5";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="flex items-center justify-between px-4 sm:px-8 h-14 border-b border-border">
        <LogoFull />
        <button type="button" onClick={() => navigate("/login")} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} /> Main login
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center p-4">
        <form onSubmit={submit} className="w-full max-w-sm border border-foreground/30 bg-card p-6 sm:p-8" noValidate>
          <div className="flex items-center gap-3 mb-6">
            <span className="w-10 h-10 flex items-center justify-center border border-foreground/30"><UserRound size={18} /></span>
            <div>
              <h1 className="font-heading text-xl font-bold leading-tight">Employee Portal</h1>
              <p className="text-xs text-muted-foreground">Salary, payslips, attendance and leave</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className={label} htmlFor="emp-email">E-mail</label>
              <input id="emp-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={field} placeholder="you@company.com" autoFocus />
            </div>
            <div>
              <label className={label} htmlFor="emp-password">Password</label>
              <div className="relative">
                <input id="emp-password" type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={`${field} pr-10`} />
                <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground" aria-label={show ? "Hide password" : "Show password"}>
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          </div>

          {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}

          <button type="submit" disabled={busy} className="mt-6 w-full h-11 bg-foreground text-background text-sm font-bold uppercase tracking-[0.12em] disabled:opacity-60">
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <p className="mt-4 text-xs text-muted-foreground">No access yet, or forgot your password? Ask HR to enable or reset your Employee Portal login.</p>
        </form>
      </main>
    </div>
  );
}

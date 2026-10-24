// Sign in. Parts under ./login: config (the look, public figures type) · LoginCard · LoginFigures · WelcomeBack
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useAppVersion } from "@/hooks/useAppVersion";
import { LOGIN_CSS, type PublicStats } from "./login/config";
import { LoginFigures } from "./login/LoginFigures";
import { LoginCard } from "./login/LoginCard";
import { WelcomeBack } from "./login/WelcomeBack";

export default function Login() {
  const { appVersion } = useAppVersion();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loginSuccess, setLoginSuccess] = useState(false);
  const [loginName, setLoginName] = useState("");
  const [stats, setStats] = useState<PublicStats | null>(null);

  useEffect(() => {
    fetch("/api/public-stats")
      .then((r) => {
        if (!r.ok) throw new Error("stats unavailable");
        return r.json();
      })
      .then((d) => setStats(d))
      .catch(() => {
        /* keep null: the figures show as placeholders */
      });
  }, []);

  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setError("");
    setIsLoading(true);
    try {
      const result = await login(email, password);
      if (result.success) {
        setLoginName(result.name || "");
        setLoginSuccess(true);
        setTimeout(() => {
          const role = result.role;
          const uid = result.userId ?? "";
          if (role === "customer") navigate(`/customer-portal/${uid}`, { replace: true });
          else if (role === "supplier") navigate("/supplier", { replace: true });
          else if (role === "dba") navigate(`/dba/${uid}`, { replace: true });
          else navigate(`/home/${uid}`, { replace: true });
        }, 1800);
      } else {
        setError(result.error || "Invalid email or password.");
        setIsLoading(false);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      setError("Unable to connect. Please check your connection and try again.");
      setIsLoading(false);
    }
  };

  return (
    <div
      className="login-page login-sheet min-h-screen w-full overflow-x-hidden overflow-y-auto relative"
      style={{ background: "var(--page)" }}
    >
      <style>{LOGIN_CSS}</style>

      <AnimatePresence>{loginSuccess && <WelcomeBack name={loginName} />}</AnimatePresence>

      {/* A soft light behind the card, nothing more */}
      <div
        className="absolute inset-0 z-0 pointer-events-none"
        style={{ background: "radial-gradient(48% 42% at 50% 38%, rgba(30,138,74,0.07), transparent 70%), radial-gradient(40% 40% at 50% 100%, rgba(17,18,20,0.04), transparent 70%)" }}
      />

      {/* One centred column; the figures in a line along the foot. The column stays the last child: the black-and-white
          theme keeps the logo in colour through it. */}
      <div className="bw-login-lift relative z-10 min-h-screen flex flex-col">
          <div className="flex-1 flex flex-col justify-center items-center px-4 py-10 gap-10">
            <LoginCard
              email={email}
              password={password}
              error={error}
              isLoading={isLoading}
              loginSuccess={loginSuccess}
              appVersion={appVersion}
              onEmail={(v) => {
                setEmail(v);
                setError("");
              }}
              onPassword={(v) => {
                setPassword(v);
                setError("");
              }}
              onSubmit={handleSubmit}
              onNavigate={(path) => navigate(path)}
            />
            <LoginFigures stats={stats} />
          </div>
      </div>
    </div>
  );
}

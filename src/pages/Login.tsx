// Sign in. Parts under ./login: config (the sheet look, public figures type) · LoginHero · LoginCard · WelcomeBack · CivilScene
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useAppVersion } from "@/hooks/useAppVersion";
import { LOGIN_CSS, type PublicStats } from "./login/config";
import { LoginHero } from "./login/LoginHero";
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
      style={{ background: "var(--ground)" }}
    >
      <style>{LOGIN_CSS}</style>

      {/* The drawing grid, and a still wash of violet in the top corner */}
      <div
        className="absolute inset-0 z-0 pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(60% 50% at 0% 0%, rgba(124,58,237,0.22), transparent 70%), linear-gradient(rgba(167,139,250,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(167,139,250,0.07) 1px, transparent 1px)",
          backgroundSize: "auto, 28px 28px, 28px 28px",
        }}
      />

      <AnimatePresence>{loginSuccess && <WelcomeBack name={loginName} />}</AnimatePresence>

      {/* The whole screen: headline and figures on the left, the sign-in panel on the right */}
      <div className="bw-login-lift relative z-10 grid grid-cols-1 lg:grid-cols-[1fr_minmax(420px,34%)] min-h-screen">
          <LoginHero stats={stats} />

          <div className="flex justify-center items-center px-5 py-10 sm:px-10 lg:border-l" style={{ borderColor: "var(--rule)", background: "rgba(20,16,42,0.78)" }}>
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
          </div>
      </div>
    </div>
  );
}

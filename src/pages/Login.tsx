// Sign in. Parts under ./login: config (the look, public figures type) · LoginHero (and the phone band) · LoginCard · WelcomeBack
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useAppVersion } from "@/hooks/useAppVersion";
import { LOGIN_CSS, type PublicStats } from "./login/config";
import { LoginBand, LoginHero } from "./login/LoginHero";
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
      style={{ background: "var(--concrete)" }}
    >
      <style>{LOGIN_CSS}</style>

      <AnimatePresence>{loginSuccess && <WelcomeBack name={loginName} />}</AnimatePresence>

      {/* The whole screen: the hoarding on the left (a band on a phone), the sign-in side on the right. The sign-in side
          stays the last child: the black-and-white theme keeps the logo in colour through it. */}
      <div className="bw-login-lift relative z-10 grid grid-cols-1 lg:grid-cols-[minmax(0,1.25fr)_minmax(440px,1fr)] min-h-screen">
          <LoginBand />
          <LoginHero stats={stats} />

          <div className="flex justify-center items-center px-5 sm:px-12 xl:px-20" style={{ background: "var(--paper)", paddingBlock: "min(2.5rem, 2vh)" }}>
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

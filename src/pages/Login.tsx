// Sign in. Parts under ./login: config (the look, public figures type) · LoginCard · LoginPhoto · WelcomeBack
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useAppVersion } from "@/hooks/useAppVersion";
import { LOGIN_CSS, type PublicStats } from "./login/config";
import { LoginPhoto } from "./login/LoginPhoto";
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

      {/* One white panel on the grey page: the form on the left, the photo on the right (hidden on a phone). The form
          stays the last child in the markup (the photo moves right with order): the black-and-white theme keeps the
          logo in colour through it. */}
      <div className="min-h-screen flex items-stretch sm:items-center justify-center sm:p-5 lg:p-[min(2rem,3vh)]">
        <div
          className="bw-login-lift relative z-10 w-full max-w-[1400px] grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-6 sm:rounded-[28px] p-3 sm:p-4"
          style={{ background: "var(--frame)", minHeight: "min(860px, calc(100vh - 6vh))", boxShadow: "0 1px 2px rgba(16,19,18,0.04), 0 24px 60px -24px rgba(16,19,18,0.18)" }}
        >
          <div className="hidden lg:block lg:order-2">
            <LoginPhoto stats={stats} />
          </div>
          <div className="flex justify-center items-center px-2 sm:px-8" style={{ paddingBlock: "min(2.5rem, 3vh)" }}>
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
    </div>
  );
}

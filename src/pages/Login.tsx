// Sign in. Parts under ./login: config (the look, public figures type) · LoginCard · LoginPhoto · WelcomeBack
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useAppVersion } from "@/hooks/useAppVersion";
import { LOGIN_CSS, type PublicStats } from "./login/config";
import { LoginBackdrop, LoginPhoto } from "./login/LoginPhoto";
import { LoginCard } from "./login/LoginCard";
import { WelcomeBack } from "./login/WelcomeBack";
import { FLOW } from "./login/motion";

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
    // reducedMotion="user": everything here holds still for anyone whose system asks for less motion.
    <MotionConfig reducedMotion="user">
    <div
      className="login-page login-sheet min-h-screen w-full overflow-x-hidden overflow-y-auto relative"
      style={{ background: "var(--page)" }}
    >
      <style>{LOGIN_CSS}</style>

      <AnimatePresence>{loginSuccess && <WelcomeBack name={loginName} />}</AnimatePresence>

      {/* Phone and tablet: the sky and the building fill the screen behind the form. */}
      <LoginBackdrop />

      {/* Wide screens: one white panel on the grey page, the form on the left and the photo on the right. Narrower,
          the panel goes clear and the form sits in a frosted card over the backdrop. The form stays the last child in
          the markup (the photo moves right with order): the black-and-white theme keeps the logo in colour through it. */}
      <div className="min-h-screen flex items-center justify-center p-4 sm:p-5 lg:p-[min(2rem,3vh)]">
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={FLOW}
          className="ls-panel bw-login-lift relative z-10 w-full max-w-[1400px] grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-6 lg:rounded-[28px] lg:p-4"
        >
          <div className="hidden lg:block lg:order-2">
            <LoginPhoto stats={stats} />
          </div>
          <div className="ls-form-side flex justify-center items-center">
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
        </motion.div>
      </div>
    </div>
    </MotionConfig>
  );
}

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import { useLocation } from "react-router-dom";

type Module = "finance" | "material" | "followup" | "admin" | null;

// Single source of truth for module dashboard routes
export const MODULE_DASHBOARD_ROUTES: Record<NonNullable<Module>, string> = {
  finance: "/finance",
  material: "/material",
  followup: "/followup",
  admin: "/admin/dashboard",
};

interface ModuleContextType {
  activeModule: Module;
  setActiveModule: (m: Module) => void;
  toggleModule: (m: Module) => void;
  moduleLabel: string;
  moduleSwitching: boolean;
  setModuleSwitching: (v: boolean) => void;
}

const ModuleContext = createContext<ModuleContextType | null>(null);

export const useModule = () => {
  const ctx = useContext(ModuleContext);
  if (!ctx) throw new Error("useModule must be inside ModuleProvider");
  return ctx;
};

export const ModuleProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const location = useLocation();
  const [activeModule, setActiveModuleState] = useState<Module>(null);
  const [moduleSwitching, setModuleSwitching] = useState(false);

  const moduleLabel =
    activeModule === "finance"
      ? "💰 Finance"
      : activeModule === "material"
        ? "📦 Material"
        : activeModule === "followup"
          ? "📅 Follow-Up"
          : activeModule === "admin"
            ? "🔧 Admin"
            : "No Module Selected";

  const setActiveModule = useCallback((m: Module) => {
    setActiveModuleState(m);
    if (m) {
      localStorage.setItem("activeModule", m);
    } else {
      localStorage.removeItem("activeModule");
    }
  }, []);

  // Toggle: if already active, deactivate; otherwise activate
  const toggleModule = useCallback((m: Module) => {
    setActiveModuleState((prev) => {
      const next = prev === m ? null : m;
      if (next) {
        localStorage.setItem("activeModule", next);
      } else {
        localStorage.removeItem("activeModule");
      }
      return next;
    });
  }, []);

  // Initialize activeModule ONCE on mount.
  //
  // Priority: URL first for known module paths, then localStorage for
  // ambiguous paths (/masters/*, /reports, etc.), then fallback to finance.
  useEffect(() => {
    const stored = localStorage.getItem("activeModule") as Module | null;
    const pathname = location.pathname;
    const valid: Module[] = ["finance", "material", "followup", "admin"];

    if (pathname.startsWith("/admin") || pathname.startsWith("/users")) {
      setActiveModuleState("admin");
      localStorage.setItem("activeModule", "admin");
    } else if (pathname.startsWith("/followup")) {
      setActiveModuleState("followup");
      localStorage.setItem("activeModule", "followup");
    } else if (pathname.startsWith("/material")) {
      setActiveModuleState("material");
      localStorage.setItem("activeModule", "material");
    } else if (pathname.startsWith("/finance") || pathname === "/finance") {
      setActiveModuleState("finance");
      localStorage.setItem("activeModule", "finance");
    } else if (pathname === "/home" || pathname === "/") {
      // Landing page after login — stay neutral, no module pre-selected
      setActiveModuleState(null);
      localStorage.removeItem("activeModule");
    } else {
      // Ambiguous path (e.g. /masters/*, /reports) — trust localStorage if valid,
      // but do NOT force finance when there's nothing stored
      if (stored && valid.includes(stored)) {
        setActiveModuleState(stored);
      } else {
        setActiveModuleState(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally run once on mount only

  return (
    <ModuleContext.Provider
      value={{
        activeModule,
        setActiveModule,
        toggleModule,
        moduleLabel,
        moduleSwitching,
        setModuleSwitching,
      }}
    >
      {children}
    </ModuleContext.Provider>
  );
};

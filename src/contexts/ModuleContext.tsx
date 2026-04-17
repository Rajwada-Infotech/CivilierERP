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
  finance: "/",
  material: "/material",
  followup: "/followup",
  admin: "/admin",
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

  // Initialize activeModule ONCE on mount — prefer localStorage, then infer from pathname.
  // We do NOT re-run this on pathname changes so that explicit module switches
  // are never clobbered by navigation within a module.
  useEffect(() => {
    const stored = localStorage.getItem("activeModule") as Module | null;

    if (
      stored &&
      (["finance", "material", "followup", "admin"] as Module[]).includes(stored)
    ) {
      setActiveModuleState(stored);
      return;
    }

    // First visit — no stored preference, infer from URL
    const pathname = location.pathname;
    if (pathname.startsWith("/admin")) {
      setActiveModuleState("admin");
      localStorage.setItem("activeModule", "admin");
    } else if (pathname.startsWith("/followup")) {
      setActiveModuleState("followup");
      localStorage.setItem("activeModule", "followup");
    } else if (pathname.startsWith("/material")) {
      setActiveModuleState("material");
      localStorage.setItem("activeModule", "material");
    } else {
      setActiveModuleState("finance");
      localStorage.setItem("activeModule", "finance");
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


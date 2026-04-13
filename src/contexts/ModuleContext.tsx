import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import { useLocation } from "react-router-dom";

type Module = "finance" | "material" | "followup" | null;

// Single source of truth for module dashboard routes
export const MODULE_DASHBOARD_ROUTES: Record<NonNullable<Module>, string> = {
  finance: "/",
  material: "/material",
  followup: "/followup",
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

  // Initialize activeModule from localStorage or infer from pathname
  useEffect(() => {
    const stored = localStorage.getItem("activeModule") as Module | null;
    let initialModule: Module = null;

    if (
      stored &&
      (["finance", "material", "followup"] as Module[]).includes(stored)
    ) {
      initialModule = stored;
    } else {
      // Infer from pathname
      const pathname = location.pathname;
      if (pathname.startsWith("/followup")) {
        initialModule = "followup";
      } else if (pathname.startsWith("/material")) {
        initialModule = "material";
      } else {
        initialModule = "finance";
      }
    }

    setActiveModuleState(initialModule);
  }, [location.pathname]);

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

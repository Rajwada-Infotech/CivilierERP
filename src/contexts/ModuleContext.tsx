import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import { useLocation } from "react-router-dom";
import type { Module } from "@/contexts/module.utils";
import { isModuleId, moduleFromPath } from "@/contexts/moduleFromPath";

// Module/MODULE_DASHBOARD_ROUTES now live in module.utils.ts and are NOT
// re-exported here — this file only exports components/hooks. Mixing
// component and non-component exports in one file breaks Vite Fast Refresh
// (forces a full reload on every edit instead of hot-patching). Import the
// type/constant directly from "@/contexts/module.utils" instead.

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
        : activeModule === "fixed-asset"
          ? "🏷️ Fixed Asset"
        : activeModule === "followup"
          ? "📅 Follow-Up"
          : activeModule === "engineering"
            ? "⚙️ Engineering"
            : activeModule === "ticket"
              ? "🎫 Ticket"
              : activeModule === "sales"
                ? "🛒 Sales"
                : activeModule === "records"
                  ? "🗄️ Records"
                  : activeModule === "civilworkdpr"
                    ? "⛏️ Civil Work DPR"
                    : activeModule === "sales-automation"
                      ? "📣 Sales Automation"
                      : activeModule === "crm"
                        ? "🏠 CRM"
                    : activeModule === "loan"
                      ? "🏦 Loan"
                    : activeModule === "maintenance"
                      ? "🔧 Maintenance"
                    : activeModule === "hr-payroll"
                      ? "🧑‍💼 HR and Payroll"
                    : activeModule === "admin"
                      ? "🔧 Admin"
                      : "No Module Selected";

  const setActiveModule = useCallback((m: Module) => {
    setActiveModuleState(m);
    if (m) {
      sessionStorage.setItem("activeModule", m);
    } else {
      sessionStorage.removeItem("activeModule");
    }
  }, []);

  // Toggle: if already active, deactivate; otherwise activate
  const toggleModule = useCallback((m: Module) => {
    setActiveModuleState((prev) => {
      const next = prev === m ? null : m;
      if (next) {
        sessionStorage.setItem("activeModule", next);
      } else {
        sessionStorage.removeItem("activeModule");
      }
      return next;
    });
  }, []);

  // Sync activeModule with the current URL.
  //
  // Runs on mount AND whenever the pathname changes so that navigating to
  // /home after login always clears the module, even though ModuleProvider
  // stays mounted across the whole session.
  //
  // Priority: URL first for known module paths, then localStorage for
  // ambiguous paths (/masters/*, /reports, etc.), then null.
  useEffect(() => {
    const resolved = moduleFromPath(location.pathname);

    if (resolved === "none") {
      // Landing page after login — always neutral, no module pre-selected
      setActiveModuleState(null);
      sessionStorage.removeItem("activeModule");
    } else if (resolved === "keep") {
      // Ambiguous path (e.g. /masters/*, /reports) — trust localStorage if valid,
      // but do NOT force a module when there's nothing stored
      const stored = sessionStorage.getItem("activeModule");
      setActiveModuleState(stored && isModuleId(stored) ? stored : null);
    } else {
      setActiveModuleState(resolved);
      sessionStorage.setItem("activeModule", resolved);
    }
  }, [location.pathname]); // re-run on every navigation

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

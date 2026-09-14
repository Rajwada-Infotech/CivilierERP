import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import { useLocation } from "react-router-dom";
import type { Module } from "@/contexts/module.utils";

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

  // Sync activeModule with the current URL.
  //
  // Runs on mount AND whenever the pathname changes so that navigating to
  // /home after login always clears the module, even though ModuleProvider
  // stays mounted across the whole session.
  //
  // Priority: URL first for known module paths, then localStorage for
  // ambiguous paths (/masters/*, /reports, etc.), then null.
  useEffect(() => {
    const stored = localStorage.getItem("activeModule") as Module | null;
    const pathname = location.pathname;
    const valid: Module[] = [
      "finance",
      "material",
      "fixed-asset",
      "followup",
      "engineering",
      "ticket",
      "sales",
      "records",
      "civilworkdpr",
      "sales-automation",
      "crm",
      "loan",
      "maintenance",
      "admin",
    ];

    if (pathname.startsWith("/admin") || pathname.startsWith("/users")) {
      setActiveModuleState("admin");
      localStorage.setItem("activeModule", "admin");
    } else if (pathname.startsWith("/followup")) {
      setActiveModuleState("followup");
      localStorage.setItem("activeModule", "followup");
    } else if (pathname.startsWith("/material")) {
      setActiveModuleState("material");
      localStorage.setItem("activeModule", "material");
    } else if (pathname.startsWith("/fixed-asset")) {
      setActiveModuleState("fixed-asset");
      localStorage.setItem("activeModule", "fixed-asset");
    } else if (pathname.startsWith("/engineering")) {
      setActiveModuleState("engineering");
      localStorage.setItem("activeModule", "engineering");
    } else if (pathname.startsWith("/ticket")) {
      setActiveModuleState("ticket");
      localStorage.setItem("activeModule", "ticket");
    } else if (pathname.startsWith("/sales-automation")) {
      setActiveModuleState("sales-automation");
      localStorage.setItem("activeModule", "sales-automation");
    } else if (pathname.startsWith("/crm")) {
      setActiveModuleState("crm");
      localStorage.setItem("activeModule", "crm");
    } else if (pathname.startsWith("/sales")) {
      setActiveModuleState("sales");
      localStorage.setItem("activeModule", "sales");
    } else if (pathname.startsWith("/records")) {
      setActiveModuleState("records");
      localStorage.setItem("activeModule", "records");
    } else if (pathname.startsWith("/civilworkdpr")) {
      setActiveModuleState("civilworkdpr");
      localStorage.setItem("activeModule", "civilworkdpr");
    } else if (pathname.startsWith("/loan")) {
      setActiveModuleState("loan");
      localStorage.setItem("activeModule", "loan");
    } else if (pathname.startsWith("/maintenance")) {
      setActiveModuleState("maintenance");
      localStorage.setItem("activeModule", "maintenance");
    } else if (
      pathname.startsWith("/finance") ||
      pathname === "/finance" ||
      pathname.startsWith("/brs") ||
      pathname.startsWith("/payments") ||
      pathname.startsWith("/received-payments") ||
      pathname.startsWith("/journal-voucher") ||
      pathname.startsWith("/trial-balance")
    ) {
      setActiveModuleState("finance");
      localStorage.setItem("activeModule", "finance");
    } else if (pathname === "/home" || pathname === "/") {
      // Landing page after login — always neutral, no module pre-selected
      setActiveModuleState(null);
      localStorage.removeItem("activeModule");
    } else {
      // Ambiguous path (e.g. /masters/*, /reports) — trust localStorage if valid,
      // but do NOT force a module when there's nothing stored
      if (stored && valid.includes(stored)) {
        setActiveModuleState(stored);
      } else {
        setActiveModuleState(null);
      }
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

import React, { createContext, useContext, useState, useCallback } from "react";

type Module = "finance" | null;

interface ModuleContextType {
  activeModule: Module;
  setActiveModule: (m: Module) => void;
  moduleLabel: string;
}

const ModuleContext = createContext<ModuleContextType | null>(null);

export const useModule = () => {
  const ctx = useContext(ModuleContext);
  if (!ctx) throw new Error("useModule must be inside ModuleProvider");
  return ctx;
};

export const ModuleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeModule, setActiveModuleState] = useState<Module>(null);
  const moduleLabel = activeModule === "finance" ? "💰 Finance" : "No Module Selected";

  const setActiveModule = useCallback((m: Module) => {
    setActiveModuleState(m);
  }, []);

  return (
    <ModuleContext.Provider value={{ activeModule, setActiveModule, moduleLabel }}>
      {children}
    </ModuleContext.Provider>
  );
};

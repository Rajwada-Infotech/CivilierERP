import React, { createContext, useContext, useState, ReactNode } from "react";

interface GlobalFilterState {
  selectedCompany: string | number | null;
  selectedProject: string | number | null;
  selectedFinancialYear: string | null;
}

interface GlobalFilterContextType extends GlobalFilterState {
  setCompany: (id: string | number | null) => void;
  setProject: (id: string | number | null) => void;
  setFinancialYear: (year: string | null) => void;
}

const GlobalFilterContext = createContext<GlobalFilterContextType | undefined>(undefined);

const LOCAL_STORAGE_KEY = "erp_filters";

const getInitialState = (urlKey: string, storageKey: string) => {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has(urlKey)) return params.get(urlKey);
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (stored) return JSON.parse(stored)[storageKey] || null;
  } catch { /* ignore */ }
  return null;
};

export const GlobalFilterProvider = ({ children }: { children: ReactNode }) => {
  const [selectedCompany, setSelectedCompany] = useState<string | number | null>(() => getInitialState('company', 'selectedCompany'));
  const [selectedProject, setSelectedProject] = useState<string | number | null>(() => getInitialState('project', 'selectedProject'));
  const [selectedFinancialYear, setSelectedFinancialYear] = useState<string | null>(() => getInitialState('fy', 'selectedFinancialYear'));

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ selectedCompany, selectedProject, selectedFinancialYear }));
    
    const url = new URL(window.location.href);
    if (selectedCompany) url.searchParams.set('company', String(selectedCompany));
    else url.searchParams.delete('company');
    
    if (selectedProject) url.searchParams.set('project', String(selectedProject));
    else url.searchParams.delete('project');
    
    if (selectedFinancialYear) url.searchParams.set('fy', String(selectedFinancialYear));
    else url.searchParams.delete('fy');
    
    window.history.replaceState({}, '', url.toString());
  }, [selectedCompany, selectedProject, selectedFinancialYear]);

  const setCompany = (id: string | number | null) => setSelectedCompany(id);
  const setProject = (id: string | number | null) => setSelectedProject(id);
  const setFinancialYear = (year: string | null) => setSelectedFinancialYear(year);

  return (
    <GlobalFilterContext.Provider
      value={{
        selectedCompany,
        selectedProject,
        selectedFinancialYear,
        setCompany,
        setProject,
        setFinancialYear,
      }}
    >
      {children}
    </GlobalFilterContext.Provider>
  );
};

export const useGlobalFilters = () => {
  const context = useContext(GlobalFilterContext);
  if (context === undefined) {
    throw new Error("useGlobalFilters must be used within a GlobalFilterProvider");
  }
  return context;
};
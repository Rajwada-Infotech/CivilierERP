import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from "react";

export interface FinYear {
  id: string;
  year: string;
  startDate: string;
  endDate: string;
  status: 'Active' | 'Closed';
  locked: boolean;
}

const DEMO_FINYEARS: FinYear[] = [
  { id: 'fy1', year: '2024-25', startDate: '01/04/2024', endDate: '31/03/2025', status: 'Active', locked: false },
  { id: 'fy2', year: '2023-24', startDate: '01/04/2023', endDate: '31/03/2024', status: 'Closed', locked: true },
  { id: 'fy3', year: '2022-23', startDate: '01/04/2022', endDate: '31/03/2023', status: 'Closed', locked: true },
];

interface FinYearContextType {
  finYears: FinYear[];
  addFinYear: (finYear: Omit<FinYear, 'id'>) => void;
  updateFinYear: (id: string, updates: Partial<FinYear>) => void;
  toggleLock: (id: string) => void;
  deleteFinYear: (id: string) => void;
}

const FinYearContext = createContext<FinYearContextType | null>(null);

export const useFinYear = () => {
  const ctx = useContext(FinYearContext);
  if (!ctx) throw new Error('useFinYear must be inside FinYearProvider');
  return ctx;
};

interface FinYearProviderProps {
  children: ReactNode;
}

export const FinYearProvider = ({ children }: FinYearProviderProps) => {
  const [finYears, setFinYears] = useState<FinYear[]>(DEMO_FINYEARS);

  const addFinYear = useCallback((finYear: Omit<FinYear, 'id'>) => {
    const newId = `fy-${Date.now()}`;
    setFinYears(prev => [{ ...finYear, id: newId }, ...prev]);
  }, []);

  const updateFinYear = useCallback((id: string, updates: Partial<FinYear>) => {
    setFinYears(prev => prev.map(fy => fy.id === id ? { ...fy, ...updates } : fy));
  }, []);

  const toggleLock = useCallback((id: string) => {
    setFinYears(prev => prev.map(fy => 
      // FIX: Was inverted — locking should set status Closed, unlocking should set Active
      fy.id === id ? { ...fy, locked: !fy.locked, status: fy.locked ? 'Active' : 'Closed' } : fy
    ));
  }, []);

  const deleteFinYear = useCallback((id: string) => {
    setFinYears(prev => prev.filter(fy => fy.id !== id));
  }, []);

  const value = useMemo(() => ({
    finYears,
    addFinYear,
    updateFinYear,
    toggleLock,
    deleteFinYear,
  }), [finYears, addFinYear, updateFinYear, toggleLock, deleteFinYear]);

  return <FinYearContext.Provider value={value}>{children}</FinYearContext.Provider>;
};


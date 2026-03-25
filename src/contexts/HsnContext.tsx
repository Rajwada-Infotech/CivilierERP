import React, { createContext, useContext, useState, useCallback } from "react";

export interface HsnRecord {
  code: string;
  shortDesc: string;
  description: string;
  igstRate: number;
  cgstRate: number;
  sgstRate: number;
  status: boolean;
}

// Seed data — mirrors HsnMaster initialData so both pages start in sync
const INITIAL_HSN: HsnRecord[] = [
  { code: "21069099", shortDesc: "Food Prep",       description: "Food preparations nes",                              igstRate: 0,  cgstRate: 4.5, sgstRate: 4.5, status: true },
  { code: "25232990", shortDesc: "Cement",           description: "Cement (Portland, aluminous, slag)",                igstRate: 18, cgstRate: 0,   sgstRate: 0,   status: true },
  { code: "72142090", shortDesc: "TMT Steel",        description: "Steel bars and rods - TMT bars",                   igstRate: 18, cgstRate: 0,   sgstRate: 0,   status: true },
  { code: "73089099", shortDesc: "Steel Structures", description: "Structures and parts of structures of iron/steel", igstRate: 18, cgstRate: 0,   sgstRate: 0,   status: true },
  { code: "84118100", shortDesc: "Gas Turbines",     description: "Gas turbines for construction equipment",          igstRate: 18, cgstRate: 0,   sgstRate: 0,   status: true },
  { code: "84272000", shortDesc: "JCB Parts",        description: "Other lifts and skip hoists (JCB parts)",          igstRate: 18, cgstRate: 0,   sgstRate: 0,   status: true },
  { code: "84314990", shortDesc: "Crane Parts",      description: "Parts of cranes, bulldozers, graders",             igstRate: 18, cgstRate: 0,   sgstRate: 0,   status: true },
  { code: "84791000", shortDesc: "Road Roller",      description: "Machinery for public works (road rollers)",        igstRate: 18, cgstRate: 0,   sgstRate: 0,   status: true },
  { code: "87089900", shortDesc: "Vehicle Parts",    description: "Parts for construction vehicles",                  igstRate: 18, cgstRate: 0,   sgstRate: 0,   status: true },
  { code: "90158090", shortDesc: "Survey Equip",     description: "Surveying instruments for site survey",            igstRate: 18, cgstRate: 0,   sgstRate: 0,   status: true },
];

interface HsnContextType {
  hsnRecords: HsnRecord[];
  setHsnRecords: (records: HsnRecord[]) => void;
  /** Only active (status=true) records, shaped for the ItemMaster dropdown */
  activeHsnCodes: { code: string; description: string }[];
}

const HsnContext = createContext<HsnContextType | null>(null);

export const useHsn = (): HsnContextType => {
  const ctx = useContext(HsnContext);
  if (!ctx) throw new Error("useHsn must be used inside HsnProvider");
  return ctx;
};

export const HsnProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [hsnRecords, setHsnRecordsState] = useState<HsnRecord[]>(INITIAL_HSN);

  const setHsnRecords = useCallback((records: HsnRecord[]) => {
    setHsnRecordsState(records);
  }, []);

  const activeHsnCodes = hsnRecords
    .filter((h) => h.status)
    .map((h) => ({ code: h.code, description: h.shortDesc }));

  return (
    <HsnContext.Provider value={{ hsnRecords, setHsnRecords, activeHsnCodes }}>
      {children}
    </HsnContext.Provider>
  );
};

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

export interface HsnRecord {
  code: string;
  shortDesc: string;
  description: string;
  igstRate: number;
  cgstRate: number;
  sgstRate: number;
  status: boolean;
}

interface HsnContextType {
  hsnRecords: HsnRecord[];
  setHsnRecords: (records: HsnRecord[]) => void;
  /** Only active (status=true) records, shaped for the ItemMaster dropdown */
  activeHsnCodes: { code: string; description: string }[];
  isLoading: boolean;
}

const HsnContext = createContext<HsnContextType | null>(null);

export const useHsn = (): HsnContextType => {
  const ctx = useContext(HsnContext);
  if (!ctx) throw new Error("useHsn must be used inside HsnProvider");
  return ctx;
};

export const HsnProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [hsnRecords, setHsnRecordsState] = useState<HsnRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchWithAuth("/api/hsn")
      .then((r) => r.json().catch(() => ({})))
      .then((data: any[]) => {
        if (!Array.isArray(data)) return;
        setHsnRecordsState(
          data.map((item) => ({
            code: item.HCode ?? "",
            shortDesc: item.HShortDescription ?? "",
            description: item.HDescription ?? "",
            igstRate: Number(item.HIGST ?? 0),
            cgstRate: Number(item.HCGST ?? 0),
            sgstRate: Number(item.HSGST ?? 0),
            status: item.HStatus !== false,
          })),
        );
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const setHsnRecords = useCallback((records: HsnRecord[]) => {
    setHsnRecordsState(records);
  }, []);

  const activeHsnCodes = hsnRecords
    .filter((h) => h.status)
    .map((h) => ({ code: h.code, description: h.shortDesc }));

  return (
    <HsnContext.Provider
      value={{ hsnRecords, setHsnRecords, activeHsnCodes, isLoading }}
    >
      {children}
    </HsnContext.Provider>
  );
};

import React, { createContext, useContext } from "react";
import { useNavigate } from "react-router-dom";

/**
 * A registered land is locked: its details, records, owners and documents change only through an approved amendment
 * (Land & Projects → Request amendment). The land profile provides the reason here; Legal tables and the ownership /
 * documents steps read it and hide their New / Edit / Delete buttons. The server refuses the same edits.
 */
export const LegalLockContext = createContext<string | null>(null);
export const useLegalLock = () => useContext(LegalLockContext);

export const REGISTERED_LOCK = "Registered land — locked. Change it through Request amendment (Land & Projects).";

/** Post-registration work stays open: tax, payments, survey, photos, mutation, sale, court cases, loans, expenses. */
export const OPEN_AFTER_REGISTRATION = new Set(["land-tax", "payment", "valuation", "land-photo", "mutation", "mutation-hearing", "mutation-record", "land-sale", "legal-case", "case-hearing", "mortgage", "expense", "settlement"]);

export function LockedBanner({ landCode, onRequest }: { landCode?: string; onRequest?: () => void }) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-2 border-indigo-500 bg-indigo-500/5 px-4 py-3">
      <p className="text-sm">
        <span className="mr-2 bg-indigo-600 px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-white">Registered · Locked</span>
        {landCode ? <b>{landCode} </b> : null}cannot be edited directly. Its details, RS / LR records, owners and documents change only through an
        approved <b>amendment</b>; it does not go through registration again. Post-registration work — mutation, tax, payments, survey, photos, sale, court cases, loans — stays open.
      </p>
      <button onClick={() => (onRequest ? onRequest() : navigate("/legal/land/projects"))}
        className="h-9 border border-foreground bg-foreground px-4 text-xs font-semibold uppercase tracking-[0.1em] text-background hover:opacity-90">
        Request amendment
      </button>
    </div>
  );
}

export const LockedNote: React.FC<{ text?: string }> = ({ text }) => (
  <p className="mb-2 border border-indigo-500/50 bg-indigo-500/5 px-3 py-2 text-xs">{text ?? REGISTERED_LOCK}</p>
);

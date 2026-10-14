import type React from "react";
import { Edit, X } from "lucide-react";
import { BodyPortal } from "@/components/ui/body-portal";
import { SheetMark } from "@/components/sheet/Sheet";
import { ACT, KEY_INK, LBL, RULE, TAG, effectivePrefix, recordTier } from "./config";
import type { TypeOfDocState } from "./useTypeOfDoc";

const Item: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="py-3 border-b border-foreground/10 last:border-b-0">
    <p className={`${LBL} mb-1`}>{label}</p>
    {children}
  </div>
);

const none = (text: string) => <span className="text-muted-foreground italic">{text}</span>;

export function DocTypeViewDrawer({ m }: { m: TypeOfDocState }) {
  const { viewRecord, setViewRecord, openEdit, rights } = m;
  if (!viewRecord) return null;
  const tier = recordTier(viewRecord);

  return (
    <BodyPortal><div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setViewRecord(null)} />
      <div className="relative w-full max-w-sm bg-card flex flex-col animate-in slide-in-from-right duration-200" style={{ borderLeft: RULE }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: RULE }}>
          <div className="min-w-0">
            <p className={LBL}>Document type</p>
            <h3 className="font-heading text-lg font-bold tracking-tight text-foreground mt-0.5 truncate">
              {viewRecord.EntryType ?? "—"}
            </h3>
          </div>
          <button onClick={() => setViewRecord(null)} className={`${ACT} hover:text-foreground hover:border-foreground`} aria-label="Close">
            <X size={15} />
          </button>
        </div>
        <div className="px-5 py-1 overflow-y-auto flex-1">
          <Item label="Description">
            <p className="text-sm text-foreground">{viewRecord.Description || none("No description")}</p>
          </Item>
          <Item label="Doc number prefix">
            <p className="font-heading text-sm font-semibold tracking-wider text-foreground">{effectivePrefix(viewRecord)}</p>
          </Item>
          <Item label="Format">
            <span className={`${TAG} ${tier.cls}`}>{tier.long}</span>
          </Item>
          {viewRecord.ProjectName && (
            <Item label="Project">
              <p className="text-sm text-foreground">
                {viewRecord.ProjectCode && <span className="font-heading font-semibold mr-1">{viewRecord.ProjectCode}</span>}
                {viewRecord.ProjectName}
              </p>
            </Item>
          )}
          <Item label="Module code">
            <p className="font-heading text-sm text-foreground">{viewRecord.ModuleCode || none("Not set")}</p>
          </Item>
          <Item label="Starting number">
            <p className="font-heading text-sm tabular-nums text-foreground">{viewRecord.StartingDocNo ?? 1}</p>
          </Item>
          <Item label="Counter">
            <p className="text-sm text-foreground">{viewRecord.FinYearReset ? "Resets each April" : "Never resets — one global counter"}</p>
          </Item>
          {viewRecord.links_to && (
            <Item label="Links to">
              <div className="flex flex-wrap gap-1.5 mt-1">
                {viewRecord.links_to.split(",").map((l) => (
                  <span key={l} className={`${TAG} text-foreground border-foreground/40`}>{l.trim()}</span>
                ))}
              </div>
            </Item>
          )}
          <Item label="Status">
            <SheetMark text={viewRecord.IsActive ? "Active" : "Inactive"} tone={viewRecord.IsActive ? "done" : "waiting"} />
          </Item>
        </div>
        {rights.canEdit && (
          <div className="px-5 py-3" style={{ borderTop: RULE }}>
            <button
              onClick={() => {
                openEdit(viewRecord);
                setViewRecord(null);
              }}
              className={`${KEY_INK} w-full h-9 px-4`}
            >
              <Edit size={12} /> Edit document type
            </button>
          </div>
        )}
      </div>
    </div></BodyPortal>
  );
}

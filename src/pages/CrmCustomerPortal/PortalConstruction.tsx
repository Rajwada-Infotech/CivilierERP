import React from "react";
import { useOutletContext } from "react-router-dom";
import { HardHat } from "lucide-react";
import { fmtDate } from "./portalApi";

type Ctx = { me: any; timeline: any };

const PortalConstruction: React.FC = () => {
  const { timeline } = useOutletContext<Ctx>();
  const updates = timeline.constructionUpdates || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-heading text-slate-800">Construction Progress</h1>
        <p className="text-sm text-slate-500 mt-0.5">Live updates from the site, shared as they happen.</p>
      </div>

      {updates.length === 0 ? (
        <div className="rounded-2xl border border-violet-100 bg-white p-8 text-center text-sm text-slate-500">
          No construction updates have been posted yet — check back soon.
        </div>
      ) : (
        <div className="relative pl-6">
          <div className="absolute left-[9px] top-2 bottom-2 w-0.5 bg-violet-100" />
          <div className="space-y-5">
            {updates.map((u: any, i: number) => (
              <div key={i} className="relative">
                <div className="absolute -left-6 top-1 w-4 h-4 rounded-full bg-violet-500 border-4 border-violet-100" />
                <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><HardHat size={14} className="text-violet-500" /> {u.Stage}</span>
                    <span className="text-[11px] text-slate-400">{fmtDate(u.UpdateDate)}</span>
                  </div>
                  {u.PercentComplete != null && (
                    <div className="mb-2">
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.min(100, u.PercentComplete)}%` }} />
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">{u.PercentComplete}% complete</p>
                    </div>
                  )}
                  {u.Summary && <p className="text-sm text-slate-600">{u.Summary}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default PortalConstruction;

// One activity line: rate, area, labour and material cost.
import React from "react";
import { X, Package, Hammer, Receipt } from "lucide-react";
import { WOGSTType, Activity, DropdownOption, ItemOption, ActivityOption, fmt, ensureArray, actLabour, matCost, withTotalRate, withArea, cellInput, cellSelect } from "./config";
import { MaterialBreakdownModal } from "./MaterialBreakdownModal";
import { HsnPopover } from "./HsnPopover";

// ─── Activity Row ─────────────────────────────────────────────────────────────────────────────

export const ActivityRow: React.FC<{
  activity: Activity;
  index: number;
  groupIndex: number;
  onUpdate: (patch: Partial<Activity>) => void;
  onDelete: () => void;
  canDelete: boolean;
  activityOptions: ActivityOption[];
  uomOptions: DropdownOption[];
  itemOptions: ItemOption[];
  suppliers: DropdownOption[];
  loadingActivities: boolean;
  loadingItems: boolean;
  hsnRecords: {
    code: string;
    shortDesc: string;
    igstRate: number;
    cgstRate: number;
    sgstRate: number;
  }[];
}> = ({
  activity,
  index,
  groupIndex,
  onUpdate,
  onDelete,
  canDelete,
  activityOptions,
  uomOptions,
  itemOptions,
  suppliers,
  loadingActivities,
  loadingItems,
  hsnRecords,
}) => {
  const safeOptions = ensureArray<ActivityOption>(activityOptions);
  const safeUomOptions = ensureArray<DropdownOption>(uomOptions);

  const labourTotal = actLabour(activity);
  const materialsTotal = activity.materials.reduce(
    (sum, m) => sum + matCost(m, activity),
    0,
  );
  const activitySubtotal = labourTotal + materialsTotal;
  const activityGstAmount =
    activity.hsnGstRate > 0
      ? (activitySubtotal * activity.hsnGstRate) / 100
      : 0;
  const activityTotal = activitySubtotal + activityGstAmount;
  const label = `${groupIndex + 1}.${index + 1}`;

  const handleActivityChange = (selectedId: string) => {
    const found = safeOptions.find((a) => String(a.id) === selectedId);
    // Auto-fill HSN from the linked activity if present; leave existing HSN if none linked
    const linkedHsn = found?.hsnCode ?? null;
    const hsnRecord = linkedHsn
      ? hsnRecords.find((h) => h.code === linkedHsn)
      : null;
    const linkedGstRate = hsnRecord
      ? hsnRecord.cgstRate + hsnRecord.sgstRate || hsnRecord.igstRate
      : 0;
    const linkedGstType: WOGSTType =
      hsnRecord && hsnRecord.cgstRate > 0 ? "cgst_sgst" : "igst";
    onUpdate({
      activityId: found ? found.id : null,
      name: found ? found.name : "",
      // Only overwrite HSN if the activity has one linked; otherwise keep current
      ...(linkedHsn
        ? {
            hsnCode: linkedHsn,
            hsnGstRate: linkedGstRate,
            hsnGstType: linkedGstType,
          }
        : {}),
    });
  };

  const handleUomChange = (selectedId: string) => {
    const found = safeUomOptions.find((u) => String(u.id) === selectedId);
    onUpdate({ uomId: found ? found.id : null, unit: found ? found.name : "" });
  };

  const activitySelectJSX = loadingActivities ? (
    <div className={`${cellSelect} bg-muted/30 animate-pulse h-[34px]`} />
  ) : (
    <select
      value={activity.activityId !== null ? String(activity.activityId) : ""}
      onChange={(e) => handleActivityChange(e.target.value)}
      className={cellSelect}
    >
      <option value="">
        {safeOptions.length === 0
          ? "No activities available"
          : "Select activity…"}
      </option>
      {safeOptions.map((a) => (
        <option key={a.id} value={String(a.id)}>
          {a.name}
        </option>
      ))}
    </select>
  );

  const uomSelectJSX = loadingActivities ? (
    <div className={`${cellSelect} bg-muted/30 animate-pulse h-[34px]`} />
  ) : (
    <select
      value={activity.uomId !== null ? String(activity.uomId) : ""}
      onChange={(e) => handleUomChange(e.target.value)}
      className="w-full text-sm rounded-md border border-border pl-2 pr-7 py-1.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition wo-select-arrow"
    >
      <option value="">
        {safeUomOptions.length === 0 ? "No UOMs" : "Select unit…"}
      </option>
      {safeUomOptions.map((u) => (
        <option key={u.id} value={String(u.id)}>
          {u.name}
        </option>
      ))}
    </select>
  );

  return (
    <>
      {/* Mobile */}
      <div className="sm:hidden rounded-lg border border-border/60 bg-muted/10 p-3 space-y-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-primary font-bold shrink-0 w-8">
            {label}
          </span>
          <div className="flex-1">{activitySelectJSX}</div>
          <button
            onClick={onDelete}
            disabled={!canDelete}
            className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-20"
          >
            <X size={13} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[0.625rem] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Unit
            </p>
            {uomSelectJSX}
          </div>
          <div>
            <p className="text-[0.625rem] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Area
            </p>
            <input
              type="number"
              min={0}
              value={activity.area || ""}
              onChange={(e) =>
                onUpdate(withArea(activity, parseFloat(e.target.value) || 0))
              }
              placeholder="0"
              className={cellInput}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[0.625rem] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Total Rate (Labour)
            </p>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                ₹
              </span>
              <input
                type="number"
                min={0}
                value={actLabour(activity) || ""}
                onChange={(e) =>
                  onUpdate(withTotalRate(activity, parseFloat(e.target.value) || 0))
                }
                placeholder="0"
                className={`${cellInput} pl-6`}
              />
            </div>
          </div>
          <div>
            <p className="text-[0.625rem] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Activity Total
            </p>
            <div className="flex items-center h-[34px]">
              <span
                className={`text-sm font-semibold ${activityTotal > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
              >
                {activityTotal > 0 ? fmt(activityTotal) : "—"}
              </span>
            </div>
          </div>
        </div>
        {(labourTotal > 0 || materialsTotal > 0 || activityGstAmount > 0) && (
          <div className="flex items-center gap-2 flex-wrap">
            {labourTotal > 0 && (
              <span className="flex items-center gap-1 text-[0.625rem] font-medium px-2 py-1 rounded-md bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                <Hammer size={9} />
                Labour: {fmt(labourTotal)}
              </span>
            )}
            {labourTotal > 0 && activity.area > 0 && (
              <span className="flex items-center gap-1 text-[0.625rem] font-medium px-2 py-1 rounded-md bg-sky-50 dark:bg-sky-950/30 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800">
                Per Activity Price: {fmt(labourTotal / activity.area)} / area
              </span>
            )}
            {materialsTotal > 0 && (
              <span className="flex items-center gap-1 text-[0.625rem] font-medium px-2 py-1 rounded-md bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                <Package size={9} />
                Materials: {fmt(materialsTotal)}
              </span>
            )}
            {activityGstAmount > 0 && (
              <span className="flex items-center gap-1 text-[0.625rem] font-medium px-2 py-1 rounded-md bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400 border border-violet-200 dark:border-violet-800">
                <Receipt size={9} />
                GST {activity.hsnCode} ({activity.hsnGstRate}%):{" "}
                {fmt(activityGstAmount)}
              </span>
            )}
          </div>
        )}
        {/* Mobile HSN button */}
        <HsnPopover
          activity={activity}
          hsnRecords={hsnRecords}
          onUpdate={onUpdate}
          variant="full"
        />
        <MaterialBreakdownModal
          activity={activity}
          uomOptions={uomOptions}
          itemOptions={itemOptions}
          loadingItems={loadingItems}
          suppliers={suppliers}
          onUpdateMaterials={(mats) => onUpdate({ materials: mats })}
        />
      </div>

      {/* Desktop */}
      <div className="hidden sm:block rounded-lg border border-border/50 sm:min-w-[960px]">
        <div className="grid grid-cols-[48px_1fr_120px_128px_112px_90px_100px_120px_32px] gap-2 items-center px-3 py-2.5 bg-muted/20">
          <div className="text-xs font-mono text-primary font-semibold">
            {label}
          </div>
          {activitySelectJSX}
          {uomSelectJSX}
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              ₹
            </span>
            <input
              type="number"
              min={0}
              value={actLabour(activity) || ""}
              onChange={(e) =>
                onUpdate(withTotalRate(activity, parseFloat(e.target.value) || 0))
              }
              placeholder="Total Rate"
              className={`${cellInput} pl-6`}
            />
          </div>
          <input
            type="number"
            min={0}
            value={activity.area || ""}
            onChange={(e) =>
              onUpdate(withArea(activity, parseFloat(e.target.value) || 0))
            }
            placeholder="Area"
            className={cellInput}
          />
          <MaterialBreakdownModal
            activity={activity}
            uomOptions={uomOptions}
            itemOptions={itemOptions}
            loadingItems={loadingItems}
            suppliers={suppliers}
            onUpdateMaterials={(mats) => onUpdate({ materials: mats })}
          />
          {/* Desktop HSN button */}
          <HsnPopover
            activity={activity}
            hsnRecords={hsnRecords}
            onUpdate={onUpdate}
            variant="compact"
          />
          <div className="text-right">
            <span
              className={`text-sm font-semibold ${activityTotal > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
            >
              {activityTotal > 0 ? fmt(activityTotal) : "—"}
            </span>
          </div>
          <button
            onClick={onDelete}
            disabled={!canDelete}
            className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
          >
            <X size={13} />
          </button>
        </div>
        {(labourTotal > 0 || materialsTotal > 0 || activityGstAmount > 0) && (
          <div className="flex items-center gap-3 px-3 py-1.5 bg-muted/10 border-t border-border/40 flex-wrap">
            <span className="text-[0.625rem] font-semibold text-muted-foreground uppercase tracking-wide mr-1">
              Breakdown:
            </span>
            {labourTotal > 0 && (
              <span className="flex items-center gap-1 text-[0.625rem] font-medium px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                <Hammer size={9} />
                Labour: {fmt(labourTotal)}
              </span>
            )}
            {labourTotal > 0 && activity.area > 0 && (
              <span className="flex items-center gap-1 text-[0.625rem] font-medium px-2 py-0.5 rounded bg-sky-50 dark:bg-sky-950/30 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800">
                Per Activity Price: {fmt(labourTotal / activity.area)} / area
              </span>
            )}
            {materialsTotal > 0 && (
              <span className="flex items-center gap-1 text-[0.625rem] font-medium px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                <Package size={9} />
                Materials: {fmt(materialsTotal)}
              </span>
            )}
            {activityGstAmount > 0 && (
              <span className="flex items-center gap-1 text-[0.625rem] font-medium px-2 py-0.5 rounded bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400 border border-violet-200 dark:border-violet-800">
                <Receipt size={9} />
                GST {activity.hsnCode} ({activity.hsnGstRate}%):{" "}
                {fmt(activityGstAmount)}
              </span>
            )}
          </div>
        )}
      </div>
    </>
  );
};

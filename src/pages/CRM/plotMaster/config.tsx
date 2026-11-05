// Plot Master and its parts: the APIs and loaders, a plot's state, and the sheet styles the dialogs share.
import React from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { MarkTone } from "@/components/sheet/Sheet";
import { RULE, LBL } from "../customers/config";

export { RULE, RULE_SOFT, LBL, KEY_INK, KEY_LINE, KEY_RED, INP } from "../customers/config";

export const PLOT_API = "/api/plot-master";
export const SETUP_API = "/api/crm/project-auto-setup";
export const FACING_API = "/api/plot-facing-master";
export const ALL = "__all__";

export type Plot = {
  Id: number; ProjectId: number; ProjectName: string; BlockId: number; BlockName: string;
  PlotNo: string; PlotName: string; SurveyNo?: string | null; AreaSqFt?: number | null;
  RatePerSqFt?: number | null; Facing?: string | null; IsCornerPlot?: boolean;
  RoadWidthFt?: number | null; PlotWidthFt?: number | null; PlotDepthFt?: number | null; GuidelineRatePerSqFt?: number | null;
  GridRow?: number | null; GridCol?: number | null;
  PlannedVillaTypeId?: number | null; PlannedVillaTypeCode?: string | null; PlannedVillaTypeName?: string | null;
  ConvertedUnitId?: number | null; ConvertedAt?: string | null; ConvertedUnitName?: string | null;
  ConvertedVillaTypeId?: number | null; ConvertedVillaTypeCode?: string | null; ConvertedVillaTypeName?: string | null;
  ConvertedBuiltUpAreaSqFt?: number | null; ConvertedRoomCount?: number | null; ConvertedFloorCount?: number | null;
  ConvertedMissingRooms?: number | null; ConvertedPlanRoomCount?: number | null;
  ConvertedRoomsWithoutSteps?: number | null; ConvertedTypesWithoutSteps?: string | null;
  LockBookingNo?: string | null; LockApplicationNo?: string | null; LockHoldId?: number | null; AdjacentPlotCount?: number;
};
export type PlotBlock = { BlockId: number; BlockName: string; ProjectId: number; ProjectName: string };
export type ConstructedAssetKind = { Id: number; Code: string; Name: string; SortOrder?: number; IsActive?: boolean; IsLand?: boolean; IsCommercial?: boolean };
// Plot facing is master data (dbo.PlotFacingMaster), not a typed string, so "North"/"north"/"N" cannot all coexist
// and a facing premium has somewhere to live.
export type PlotFacing = { Id: number; Code: string; Name: string; PremiumPercent: number; SortOrder?: number; IsActive?: boolean; PlotCount?: number };

export async function fetchFacings(all = false): Promise<PlotFacing[]> {
  const response = await fetchWithAuth(`${FACING_API}${all ? "?all=1" : ""}`);
  if (!response.ok) throw new Error("Could not load plot facings");
  return response.json();
}
export async function fetchPlots(): Promise<Plot[]> {
  const response = await fetchWithAuth(PLOT_API);
  if (!response.ok) throw new Error("Failed to load Plot Master");
  return response.json();
}
export async function fetchPlotBlocks(): Promise<PlotBlock[]> {
  const response = await fetchWithAuth(`${PLOT_API}/blocks`);
  if (!response.ok) throw new Error("Failed to load blocks");
  return response.json();
}
export async function fetchConstructedAssetKinds(projectId?: number | null): Promise<ConstructedAssetKind[]> {
  // With a project: only the kinds that project's type sells.
  const response = await fetchWithAuth(`${PLOT_API}/constructed-kinds${projectId ? `?projectId=${projectId}` : ""}`);
  if (!response.ok) throw new Error("Failed to load constructed asset kinds");
  return response.json();
}

export type StatusKind = "converted" | "booked" | "applied" | "held" | "available";
export function plotStatus(plot: Plot): { kind: StatusKind; label: string; tone: MarkTone } {
  if (plot.ConvertedUnitId) return { kind: "converted", label: "Converted", tone: "moving" };
  if (plot.LockBookingNo) return { kind: "booked", label: `Booked · ${plot.LockBookingNo}`, tone: "stopped" };
  if (plot.LockApplicationNo) return { kind: "applied", label: `Applied · ${plot.LockApplicationNo}`, tone: "waiting" };
  if (plot.LockHoldId) return { kind: "held", label: "On hold", tone: "waiting" };
  return { kind: "available", label: "Available", tone: "done" };
}

// A villa can be built on an unsold plot or on a SOLD one (plot first, villa after — the plot's owner then buys the
// villa as a separate booking). Plots whose ownership is still in flux (applied for, on hold) cannot.
export const canConvert = (plot: Plot) => ["available", "booked"].includes(plotStatus(plot).kind);

export const NUM = "font-heading tabular-nums";
export const DIALOG = "rounded-none p-5 gap-4";
export const DIALOG_STYLE: React.CSSProperties = { border: RULE };
export const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
export const TEXT_LINK = "text-xs underline underline-offset-2 decoration-foreground/40 hover:decoration-foreground disabled:opacity-40 disabled:no-underline";
export const sqft = (v: unknown) => (v ? `${Number(v).toLocaleString("en-IN")} sq ft` : "—");
export const rupees = (v: unknown) => (v ? `₹${Number(v).toLocaleString("en-IN")}` : "—");

/** A dialog's title block: what it belongs to, then what it is. */
export const DialogHead: React.FC<{ eyebrow: string; title: React.ReactNode; note?: React.ReactNode; Title: React.ElementType }> = ({ eyebrow, title, note, Title }) => (
  <div className="pb-3" style={{ borderBottom: RULE }}>
    <p className={LBL}>{eyebrow}</p>
    <Title className="mt-1 font-heading text-lg font-bold tracking-tight text-foreground">{title}</Title>
    {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
  </div>
);

/** A labelled value in a detail grid. */
export const Fact: React.FC<{ label: string; children: React.ReactNode; num?: boolean }> = ({ label, children, num }) => (
  <div className="min-w-0">
    <p className={LBL}>{label}</p>
    <p className={`mt-1 text-sm text-foreground ${num ? NUM : ""}`}>{children}</p>
  </div>
);

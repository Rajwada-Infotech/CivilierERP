import React from "react";
import type { ExportColumn } from "@/lib/export";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CompanyOption {
  id: number;
  name: string;
}
export interface FinYearOption {
  FId: number;
  FName: string;
  FStartDate: string;
  FEndDate: string;
}
export type DateMode = "single" | "range";

export interface FilterState {
  companyId: string;
  projectId: string;
  finYearId: string;
  dateMode: DateMode;
  singleDate: string;
  rangeFrom: string;
  rangeTo: string;
}

export interface ActiveFilter {
  label: string;
  clear: () => void;
}

/**
 * Per-report filter configuration.
 * Keys map standard FilterState fields → the actual query param the backend accepts.
 * Set a key to null to disable that filter for the report entirely.
 * Omit a key to use the default (companyId, dateFrom, dateTo; no finYear by default).
 */
export interface FilterConfig {
  /** Backend param name for company filter, or null to skip. Default: "companyId" */
  companyParam?: string | null;
  /** Backend param name for financial year ID, or null to skip. Default: null (most routes don't have it) */
  finYearParam?: string | null;
  /** Backend param name for project filter, or null to skip. Default: null —
   *  most report routes have no project scoping; only opt in reports that
   *  actually read this param server-side. */
  projectParam?: string | null;
  /** Whether `projectParam`'s value is the project's numeric id (most
   *  routes) or its plain name (routes doing a LIKE match on a stored name
   *  column, e.g. New Payment's `PProject`). Default: "id" */
  projectValueType?: "id" | "name";
  /** Backend param name for single-day date filter, or null to skip. Default: "dateFrom" */
  singleDateParam?: string | null;
  /** Backend param name for range-start date, or null to skip. Default: "dateFrom" */
  dateFromParam?: string | null;
  /** Backend param name for range-end date, or null to skip. Default: "dateTo" */
  dateToParam?: string | null;
  /** Key in the JSON response that holds the data array. Default: "data" */
  dataKey?: string;
}

export interface ReportDef {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
  apiPath: string;
  columns: ExportColumn[];
  defaultParams?: Record<string, string>;
  filterConfig?: FilterConfig;
  /** When set, the tile is a launcher: clicking it navigates to this route
   *  (a report that lives as its own page, e.g. the Follow-Up performance
   *  reports) instead of opening an inline table. `apiPath`/`columns` are
   *  then unused — pass "" / []. */
  route?: string;
  /** The API pages server-side ({ data, total, totalPages } per `page`/`limit`) and the result can be huge
   *  (lakhs of rows): the on-screen table then fetches only the page being viewed instead of every page
   *  up front. Export still fetches everything. */
  serverPaged?: boolean;
}

export interface ModuleSection {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  accent: string;
  reportIds: string[];
}

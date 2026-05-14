import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";

import {
  type ActivityActionType,
  type SessionEvent,
  getUserActivityLogs,
  logUserActivity,
  subscribeToActivityStream,
} from "@/api/userActivityApi";

import { getDeviceFingerprint, getDeviceInfo } from "@/utils/deviceFingerprint";

// ── TYPES ─────────────────────────────────────────────────────────────────────

export interface GroupedSession {
  sessionId: string;
  userId: string;
  userName: string;
  userEmail: string;
  userRole: string;
  deviceFingerprint: string;
  deviceInfo: string;
  ipAddress: string;
  loginTime: string;
  logoutTime?: string;
  durationMs?: number;
  actions: SessionEvent[];
  loginEvent: SessionEvent;
  logoutEvent?: SessionEvent;
}

export interface PaginatedActivity {
  data: SessionEvent[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

interface ActivityFilters {
  search?: string;
  role?: string;
}

interface DateFilters {
  dateFrom?: string;
  dateTo?: string;
  period?:
    | "today"
    | "yesterday"
    | "this-week"
    | "this-month"
    | "last-month"
    | "this-year";
}

export interface ActivityBrowserContextType {
  rawSessions: SessionEvent[];
  groupedSessions: GroupedSession[];
  isLoading: boolean;
  dateFilters: DateFilters;
  setDateFilters: React.Dispatch<React.SetStateAction<DateFilters>>;
  clearDateFilters: () => void;
  activity: PaginatedActivity;
  setPage: (page: number) => void;
  setFilters: (filters: ActivityFilters) => void;
  recordLogin: (user: {
    id: string;
    name: string;
    email: string;
    role: string;
  }) => Promise<void>;
  recordLogout: (user: {
    id: string;
    name: string;
    email: string;
    role: string;
  }) => Promise<void>;
  recordAction: (action: {
    method: string;
    url: string;
    actionType: ActivityActionType;
    resource: string;
    details?: string;
  }) => Promise<void>;
  clearAll: () => void;
  refresh: () => void;
}

// ── CONTEXT ───────────────────────────────────────────────────────────────────

export const ActivityBrowserContext =
  createContext<ActivityBrowserContextType | null>(null);

const NOOP_CONTEXT: ActivityBrowserContextType = {
  rawSessions: [],
  groupedSessions: [],
  isLoading: false,
  dateFilters: {},
  setDateFilters: () => {},
  clearDateFilters: () => {},
  activity: { data: [], total: 0, page: 1, limit: 50, pages: 0 },
  setPage: () => {},
  setFilters: () => {},
  recordLogin: async () => {},
  recordLogout: async () => {},
  recordAction: async () => {},
  clearAll: () => {},
  refresh: () => {},
};

// ── HOOK ──────────────────────────────────────────────────────────────────────
// Separated from ActivityBrowserProvider.tsx so each file only exports one
// kind of thing (hook vs component). Vite Fast Refresh requires this.

export const useActivityBrowser = (): ActivityBrowserContextType => {
  const ctx = useContext(ActivityBrowserContext);
  return ctx ?? NOOP_CONTEXT;
};

// ── HELPERS (module-private) ──────────────────────────────────────────────────

// IP resolution is intentionally omitted on the client side: the backend
// derives the real IP from X-Forwarded-For / socket.remoteAddress and ignores
// any client-supplied value. Fetching from ipify.org added ~100-300 ms of
// latency on every login/action for zero benefit.

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("user") || "{}");
  } catch {
    return {};
  }
}

export function normalizeEvent(
  event: SessionEvent,
  index: number,
): SessionEvent {
  return {
    ...event,
    id:
      event.id ||
      `${event.event}-${event.sessionId || "no-session"}-${event.timestamp}-${index}`,
    ipAddress: event.ipAddress || "Unavailable",
    deviceInfo: event.deviceInfo || "Unknown device",
    deviceFingerprint: event.deviceFingerprint || "Unknown",
    details: event.details || "",
    resource: event.resource || "",
    requestMethod: event.requestMethod || "",
    requestUrl: event.requestUrl || "",
  };
}

export const EMPTY_ACTIVITY: PaginatedActivity = {
  data: [],
  total: 0,
  page: 1,
  limit: 50,
  pages: 0,
};

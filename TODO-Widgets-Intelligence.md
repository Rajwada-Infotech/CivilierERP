# Widgets Command Center - Intelligence Upgrade TODO

Current Status: Plan approved. Implementing backend-driven alerts/insights first.

## Phase 1: Backend Intelligence Layer (Priority 1) ✅
- [x] 1.1 Update backend/routes/widgets.js: Add alerts array generation (critical/warning/info with score/action/count from summary).
- [x] 1.2 Add insights array (activity change % from trends.dailyFlow).
- [x] 1.3 Add meta.cacheTTL: 45 to response.
- [x] 1.4 Test: curl /api/widgets → verify alerts/insights populated/sorted.

## Phase 2: Frontend Integration (Priority 1) ✅
- [x] 2.1 Update src/api/widgetsApi.ts: Add WidgetAlert/WidgetInsight interfaces + to WidgetsDashboardData.
- [x] 2.2 src/pages/Widgets.tsx: Remove client alerts computation; render data.alerts (Badge type, clickable title to action).
- [x] 2.3 Add Insights panel Card below KPI grid (list data.insights with title/desc/change badge).
- [x] 2.4 Update useQuery refetchInterval: () => document.hidden ? false : 60_000.
- [x] 2.5 Hero sync: Add cache TTL display.
- [x] 2.6 Test: npm run dev → backend alerts, insights panel, smart refetch.

## Phase 3: Validation ✅
- [x] Backend restart/docker up; endpoint test all states.
- [x] Frontend checks passed.


## Later Phases (After Stable)
- Phase 4: Role-based modules/permissions.
- Phase 5: Modularize components.
- Phase 6: Multi-tenant/AI extensions.

*Completed steps will be marked here.*


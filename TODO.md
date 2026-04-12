# Restore Dashboard & Move Live Metrics

## Plan Progress Tracker

### 1. [x] Create src/pages/admin/MetricsDashboard.tsx
   - Move entire Live Metrics UI/logic from Dashboard.tsx
   - Admin-only via AdminRoute

### 2. [x] Restore src/pages/Dashboard.tsx  
   - Simple ERP overview: stats cards, recent activity table, quick links
   - Remove all metrics code

### 3. [x] Update src/App.tsx
   - Add lazy MetricsDashboard import
   - Add `/admin/metrics` AdminRoute

### 4. [x] Add sidebar navigation
   - Update AppSidebar.tsx or pageDefinitions.ts
   - "Live Metrics" under Admin section
   - Icon: TrendingUp

### 5. [ ] Test & Verify
   - `/` → Simple dashboard
   - `/admin/metrics` → Full metrics dashboard
   - Sidebar link works for admins
   - Demo/connect/live polling functional

**Current Step: 5/5**

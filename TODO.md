# TODO

- [x] Fix `src/pages/admin/AdminControlPanel.tsx`:
  - [x] Remove unused lucide import(s)
  - [x] Render system metrics DB table columns from `systemMetrics.tables` shape (`name`, `rows`, `totalKB`, `usedKB`)
  - [x] Ensure uptime card uses `systemMetrics.server.uptimeHours`
- [x] Add backend route `backend/routes/widgetCatalogAdmin.js` implementing CRUD for `dbo.WidgetCatalog`
  - [x] Support: GET list, POST create, PUT update, DELETE with safety (block if referenced by any user WidgetsJson; instruct admin to deactivate)
  - [x] Add endpoint to toggle active / set IsActive
- [x] Wire backend route into `backend/server.js` `ALL_ROUTES` as `/api/widget-catalog`
- [x] Create frontend admin page `src/pages/admin/WidgetCatalogAdmin.tsx`
  - [x] Searchable catalog list
  - [x] Toggle active
  - [x] Add / edit (Label, IconKey, Category, SortOrder, Description, IsActive)
  - [x] Delete with confirmation + uses API safety messages
  - [x] Invalidate `['widget-catalog']` after mutations
- [x] Wire frontend route into `src/App.tsx` under `/admin/widget-catalog` using `AdminRoute`
- [ ] Run: TypeScript check / build and smoke test endpoints

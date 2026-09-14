# CRM Audit Fixes

- [x] **Refactor `CrmDashboard.tsx`**: Replace basic textual cards with interactive charts using `recharts`. Add an Inventory Status pie chart and a Month-over-Month collection bar/line chart. (Backend `crmDashboard.js` updated for extra aggregated data).
- [/] **Upgrade `CrmCustomer360.tsx`**: Add an interactive timeline view that intertwines payments, demands, cancellations, and tickets chronologically.
- [ ] **Advanced Filtering & Reporting**: Add advanced filters (Project, Block, Salesperson, Dates) and an Aging Analysis view to the reporting component (`CrmReports.tsx`).

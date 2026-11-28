# CRM Work Report — 27 November 2026

Branch: `backend` (pushed to `origin/backend`, commit `69fdf9a62`, following commits `acd6ee278`, `7ef094976`, and merge `696f32ee8` from `main`).

## 1. Welcome Calls (`/crm/welcome-calls`)
- Rebuilt the Welcome Call workspace across dark, light, glass, BW, and sage themes: replaced the dark top band with a theme-adaptive workspace header, 5 clickable queue KPI cards, server-filtered tabs (`All`, `Overdue`, `Due Today`, `Pending Verification`, `Verified`), server sorting/pagination, and responsive mobile cards.
- Updated `backend/routes/crmWelcomeCalls.js` so `call-context` includes recent call logs (`recentCalls`, up to 20 entries) alongside server-side sorting and shared history filter logic (`buildHistoryFilters`, `HISTORY_SORT_MAP`).
- Split and upgraded the intake and review workflow across `IntakeDialog.tsx`, `Checklist.tsx`, `PreviewDialogs.tsx`, and `ContactActionBar.tsx` with clearer outcome pills, verification checklist controls, and contact action shortcuts.

## 2. Customer Directory (`/crm/customers`)
- Polished the CRM Customers workspace onto the 5-theme enterprise layout (`CrmCustomers.tsx`, `CustomerDialog.tsx`, `CustomerFields.tsx`, `NewCustomerDialog.tsx`, and `customers/config.tsx`).
- Updated `backend/routes/crmCustomers.js` with `buildCustomerWhere` and a `/counts` endpoint so customer view tabs (`All`, `With Applications`, `No Applications`, `Missing KYC`, `Invoice`, plus focus filters) match list totals cleanly across paginated data.

## 3. Unit Matrix & Parking Matrix (`/crm/unit-matrix`, `/crm/parking-matrix`)
- Rebuilt `CrmUnitMatrix.tsx` and `matrix/shared.tsx` onto the 5-theme rounded enterprise UI (`ModernPlaceHoldDialog`, clear status pills, theme-safe contrast tokens, and hold/booking modals).
- Customized `CrmParkingMatrix.tsx` specifically for parking inventory management: compact high-density numbered slot grid grouped by Block and Parking Type (`Open`, `Covered`, `Stack`, `Basement`) showing strictly slot number, status indicator, and holder/customer name on grid tiles (keeping pricing/GST out of matrix tiles), plus table view toggle, CSV export, and hold/allotment inspection.

## 4. Parking Allotments (`/crm/parking-booking`)
- Rebuilt `CrmParkingBooking.tsx` onto the 5-theme enterprise header card with 4 clickable financial/allocation KPI cards (`Standalone pending`, `Standalone collected`, `With unit booking`, `All allotments`), `<GridTabs>`, `<CrmGrid>` with Column Chooser, sorting, pagination, CSV export, and rounded detail / payment collection / release / standalone sale dialogs.

## 5. Legal Milestones (`/crm/legal-milestones`)
- Eliminated workflow lock contradictions across `backend/routes/crmLegalMilestones.js` and `src/pages/CRM/CrmLegalMilestones.tsx`:
  - Exposed full sub-states in `LM_SELECT` and aligned `AFS Registered` gates across Visit 2, OC/CC, and Mutation.
  - Surfaced explicit Home Loan sanction and under-construction Physical-Handover-before-Sale-Deed gates on `salesDeed`, plus `PrePossession Ready` gates on `handover`.
- Replaced the dark top banner with a 5-theme enterprise header card, accurate journey stage progress bars, and explicit unmet blocker pills with 1-click navigation links to the blocking module.

## 6. Agreements for Sale (`/crm/agreements`)
- Rebuilt `CrmAgreement.tsx` and the embedded Visit 1 components (`CrmAfsQueryPayment.tsx`, `CrmAfsRegistry.tsx`) for all 5 themes, removing dark `MoneyBand` banners, legacy sharp `RULE_SOFT` dividers, and broken `dark:` Tailwind classes, and adding `<GridColumnChooser>` and `mobileCardRenderer`.
- Corrected misleading creation prerequisite copy in the `New Agreement` dialog so it accurately reflects backend rules (`validateAgreementPreparationPrerequisites`: Approved & Active Booking + Welcomed Call + Milestone 1 covered; Bank, PAN, and Aadhaar optional at draft stage).
- Added 100% transparent gate visibility across the legal workspace:
  - Live 2-check Senior Approval readiness strip (`Legal Executive Assigned` + `Mandatory papers uploaded`).
  - Explicit Signing Date state distinguishing mutual match from pending Admin Date Approval in Approval Inbox.
  - 5-check Execution Readiness Grid and 3-step Sub-Registrar Visit 1 Readiness Strip (`Executed` → `AFS Registration Fees` → `AFS Registry`) with direct tab/inbox jump buttons.
- Fixed `[data-theme]` contrast tokens in shared `CrmDataTable.tsx` (`GridStatusPill`, `GridToneMark`, `GridGuidance`) and `payments/parts.tsx` (`Initials`, `StepBar`).
- Earlier backend commit (`7ef094976`): wired `maybeAutoCreateAgreement` after Finance milestone and on-account payment approvals (`crmPayments.js`) and added catch-up scheduling via `startReadyAgreements` (`crmDemandScheduler.js`, `crmWorkflowGuards.js`).

## 7. Auto Project Setup (`/crm/setup/auto-project-setup`)
- Replaced legacy `<SheetShell>`, `<SheetMark>`, `statrow four`, `--red`/`--graphite`, and square ledger tokens across `CrmProjectAutoSetup.tsx` and all 8 `src/pages/CRM/autoSetup/*.tsx` modules (`config.tsx`, `ProjectPicker.tsx`, `ProjectTypeBar.tsx`, `NamingPanel.tsx`, `BlockStackEditor.tsx`, `UnitTree.tsx`, `PlotParts.tsx`, `ParkingSetup.tsx`).
- Added an Enterprise Header Card with 5-theme segmented tab switcher (**Blocks, floors & units / Blocks & plots** vs **Parking**), live `<GridGuidance>` next-step strip with direct **Generate Units** action, pre-generation warning when a residential unit type lacks a layout in Unit Composition, and a 4-card KPI strip with rounded slot status tiles in Parking Setup.

## 8. Applications, Reminders & Mobile CRM Forms (Commit `acd6ee278`)
- Added backend focus-count endpoint (`/focus-counts`), `stageAndFocusWhere` filtering, and `BookingCleared` tracking in `crmApplications.js`, paired with `CrmApplication.tsx`, `applications/config.tsx`, and `CrmBooking.tsx` / `CrmBookingDetail.tsx` updates.
- Extended manual reminder composition and sending routes (`/compose`, `sendByHand`, `composeForBooking`) in `crmReminders.js` and `crmReminderEngine.js`, plus updates in `CrmReminderSetup.tsx` and mobile CRM screens (`BookingDetailScreen.tsx`, `CrmDemandDetailScreen.tsx`, `CrmForms.tsx`).

## 9. Verification & Deployment
- **Production Build**: `node ./node_modules/vite/bin/vite.js build` succeeded (`✓ built in 24.77s`).
- **ESLint & TypeScript**: `eslint --quiet` and scoped `tsc --noEmit` (`scratch/tsconfig.welcome.json`) passed with zero errors across the updated CRM pages (`CrmAgreement.tsx`, `CrmAfsQueryPayment.tsx`, `CrmAfsRegistry.tsx`, `payments/parts.tsx`, `CrmDataTable.tsx`, `CrmProjectAutoSetup.tsx`, and all 8 `autoSetup/*.tsx` files).
- **Vitest**: `node ./node_modules/vitest/vitest.mjs run src/components/crm src/pages/CRM` passed **6 test files (82 tests)** (`agreement/config.test.ts` 10/10, `CrmListToolbar.test.ts` 4/4, `payments/config.test.ts` 8/8, `invoices/config.test.ts` 6/6, `CrmDataTable.test.ts` 6/6, `CrmPossession.test.ts` 48/48); Vitest subsequently exited `1` in the terminal sandbox when probing optional `jsdom` outside the workspace (`EPERM`).
- **Backend Jest**:
  - `backend/test/crmLegalMilestonesMap.test.js`: **6/6 passed**.
  - `backend/test/crmAgreementDateCycle.test.js` & `backend/test/crmAgreementsList.test.js`: **2 suites, 5/5 passed**.
  - `backend/test/autoSetupParkingGenerate.test.js`: **1 suite, 4/4 passed**.
- **Git Push**: Committed and pushed all 33 CRM/backend files to `origin/backend` (`69fdf9a62`). (Note: this report file itself sits untracked locally unless committed separately.)

# Civilier Home (mobile) — Customer Portal + Maintenance

React Native (Expo, TypeScript) client for the **Maintenance** module — a
separate app from `mobile-admin/`, `mobile-finance-material/`,
`mobile-Fixed-Asset/` and `mobile-supplier/`, same backend, same
conventions. No backend changes — just another REST client against the
existing Maintenance routes (`backend/routes/maintenance.js`,
`maintenanceBill.js`, `securityAttendance.js`, `electricityMaintenance.js`),
same as the web app's `src/pages/maintenance/**`.

Scaffolded from `mobile-Fixed-Asset/`: auth, theme, navigation shell, and
shared components are ported as-is; FA-only screens/APIs were stripped.

## Two sign-ins: customers and staff

The sign-in screen has **Customer** and **Staff**:

- **Customer** — the Customer Portal (`backend/routes/crmPortal.js`, its own accounts and token, the same routes as
  the web portal `src/pages/CrmCustomerPortal/**`). Screens in `src/screens/customer/`, navigation in
  `src/navigation/CustomerStack.tsx`, data in `src/api/customerPortalApi.ts`, the chosen property in
  `src/customer/CustomerContext.tsx`. Everything the web portal does, by its own menu: Dashboard (journey, Needs
  Your Action — `src/customer/todo.ts`), My Booking, Construction (possession: letter, acknowledge / dispute),
  Agreement (documents to upload and on file, approve / recheck, agreement date, sale deed, government payment
  proof, registry, NOCs), Transfer Deed (papers, draft, signing date, stamp-duty challan), Payments (schedule,
  receipts, invoices, credit notes — as PDF), Support Tickets, Updates & Approvals and Customer 360 — plus their own
  Maintenance Bills (maintenance and electricity). Files open and upload through `src/utils/documents.ts`. A first
  sign-in with the mobile-number password must set a new password first. A customer's phone registers for
  notifications through the portal (`/api/crm-portal/push-devices`, migration 692); what they are told, and the
  screen a tap opens, is one list in `backend/services/pushNotifications.js` CUSTOMER_EVENTS.
- **Staff** — the Maintenance module below, unchanged.

## Stack

Expo SDK 57 · TypeScript · React Navigation · TanStack Query · NativeWind ·
expo-secure-store

## Getting started

```bash
cd mobile-maintenance
cp .env.example .env   # set EXPO_PUBLIC_API_URL to your backend
npm install
npm start
```

`EXPO_PUBLIC_API_URL` must be a full URL — there is no dev-server proxy like
the web app's `/api`. On a physical device use your machine's LAN IP; on
the Android emulator use `http://10.0.2.2:<port>` to reach the host.

Log in with any `dbo.users` account that has `view` rights on the relevant
`maintenance-*` pages (same accounts that work on the web Maintenance
module). RBAC is enforced by `middleware/requirePageRight` server-side.

Before the first EAS build, run `eas init` once inside this folder to mint
its own `projectId`.

## Structure

```
src/
  api/          maintenanceApi.ts (Customer Directory), maintenanceBillApi.ts
                (Bills, read-only), securityAttendanceApi.ts (Shifts/
                Personnel/Attendance read + the Check-In/Check-Out
                mutations), electricityMaintenanceApi.ts (Meters/readings
                read + the Add-Reading mutation) — all already written,
                mirroring the web app's own src/api/** shapes
  auth/         AuthContext (shared login/logout/RBAC contract with the
                other mobile apps) + permissions.ts
  hooks/        usePageRights, useAppVersion, useMaintenanceAlerts (derives
                "reading pending" / "not checked in yet" alerts client-side)
  navigation/   AuthStack / MainStack / RootNavigator + TopHeader + BottomPillNav
  screens/      auth/ (Login), dashboard/ (Dashboard placeholder, Profile),
                menu/ (Menu placeholder), notifications/
  services/     fetchWithAuth, authStorage (SecureStore), queryClient,
                sessionEvents
  theme/        colors (moduleAccents.maintenance = #65a30d, matches web's
                MAINTENANCE_ACCENT), fonts (Sora / DM Sans)
  types/        AppUser / PageKey / PagePermission — mirrors src/contexts/types.ts
```

## Current state — scaffold only

Login, a placeholder Dashboard, a placeholder Menu, and Profile/
Notifications/logout are wired up. **No Maintenance feature screens are
built yet** — Customer Directory, Bills, Security Attendance (Check-In/
Check-Out), and Electricity Maintenance (Add Meter Reading) all have their
API clients ready in `src/api/**` but no screens or navigation entries.

Scope note for whoever builds those next: this module doesn't need 1:1
parity with web. Full depth is worth building for **Security Attendance
Check-In/Check-Out** and **Electricity Add Meter Reading** — both are
genuinely on-site, phone-in-hand actions. Everything else (bill creation,
tariff/provider config, bill verification, reports) is back-office work —
keep those read-only (list/detail) here, or skip them and do them on web,
same as `mobile-Fixed-Asset` defers "creating a maintenance record" to web.

## Adding a Maintenance screen

1. Find the equivalent page under `src/pages/maintenance/**` on web.
2. The API call likely already exists in this app's `src/api/**` (see
   above) — if not, add it, mirroring the web `src/api/**` file's shapes.
3. Reuse the same `useQuery` / `useMutation` calls — TanStack Query code is
   framework-agnostic.
4. Rebuild the UI as RN components (reuse `src/components/list/DataList`,
   `StatusPill`, `form/{Form,DateField,PickerField}`, `Fab`, `ConfirmSheet`
   — the same generic toolkit `mobile-Fixed-Asset`'s screens use), register
   it in `MainStack.tsx` (`MainStackParamList` + `<Stack.Screen>`), and give
   it a way in from `DashboardScreen.tsx`, `MenuScreen.tsx`, or
   `BottomPillNav.tsx`.

# CivilierERP Supplier (mobile)

React Native (Expo, TypeScript) client for the external Supplier Portal — a
separate app from `mobile-admin/` and `mobile-finance-material/`, same
backend, same conventions. No backend changes — just another REST client
against `backend/routes/supplierPortal.js`, same as the web app's own
`src/pages/supplier/**`.

Scaffolded from `mobile-admin/`: auth, theme, navigation shell, and shared
components are ported as-is; Admin-only screens/APIs (Approval Inbox,
Rights, Masters, `NavSheet`'s admin nav tree) were stripped, and the login
screen's "other portals" switcher was removed since this app *is* one of
those portals now.

## Stack

Expo SDK 54 · TypeScript · React Navigation · TanStack Query · NativeWind ·
expo-secure-store

## Getting started

```bash
cd mobile-supplier
cp .env.example .env   # set EXPO_PUBLIC_API_URL to your backend
npm install
npm start
```

`EXPO_PUBLIC_API_URL` must be a full URL — there is no dev-server proxy like
the web app's `/api`. On a physical device, use your machine's LAN IP; on
the Android emulator, use `http://10.0.2.2:<port>` to reach the host
machine. See `.env.example` for details.

Log in with a `dbo.users` account whose `LinkedLHeadId` points at a
supplier's `AccountHeadMaster` row and whose `role` is `supplier` — the
same account that already works on the web Supplier Portal
(`/supplier/login`). `backend/routes/supplierPortal.js` re-resolves and
re-scopes every request to that link server-side; the client never sends
its own supplier id.

Before the first EAS build/submit, run `eas init` once inside this folder
to mint a real `projectId` (deliberately not copied from `mobile-admin/`'s
own project — each Expo app needs its own).

## Structure

```
src/
  api/          supplierPortalApi.ts — RN port of src/api/supplierPortalApi.ts
                (web), same shapes, same /api/supplier-portal endpoints
  auth/         AuthContext (shared login/logout/RBAC contract with the
                other mobile apps) + supplierAccess.ts (role==="supplier" gate)
  navigation/   AuthStack / MainStack / RootNavigator + TopHeader
  screens/      auth/ (Login) and dashboard/ (Dashboard, Profile)
  services/     fetchWithAuth, authStorage (SecureStore), queryClient,
                sessionEvents (401 -> logout pub/sub, no window global here)
  types/        AppUser / PageKey / PagePermission etc — mirrors
                src/contexts/types.ts
```

## Current state — shell only

Login, dashboard (live counts from `/api/supplier-portal/quotations` +
`/orders`: pending quotations, active orders, orders awaiting
acknowledgement), and profile/logout are wired up and working. Every other
supplier-facing page on web is not built here yet:

| Web page | Backend endpoint(s) | Status |
|---|---|---|
| `SupplierDashboard.tsx` | ported into `DashboardScreen.tsx` above | done |
| `SupplierQuotationDetail.tsx` (list + detail + price submission) | `GET /quotations`, `GET /quotations/:id`, `POST /quotations/:id/prices` | not built |
| Orders (list + detail + acknowledge + chat) | `GET /orders`, `GET /orders/:id`, `PUT /orders/:id/acknowledge`, `GET/POST /orders/:id/comment(s)` | not built |
| `SupplierCatalog.tsx` | `GET/PUT /catalog` | not built |
| GRN tracking (from `SupplierNotifications.tsx`) | `GET /grns` | not built |
| `SupplierCreditNotes.tsx` | `GET /credit-notes` | not built |
| `SupplierCompanyProfile.tsx` | `GET /me` | not built |

## Porting a supplier screen from web

1. Find the equivalent page under `src/pages/supplier/**` on web.
2. Its data layer is already ported — `src/api/supplierPortalApi.ts` here
   has every function/type `src/pages/supplier/**` calls, 1:1.
3. Reuse the same `useQuery`/`useMutation` calls — TanStack Query code is
   framework-agnostic.
4. Rebuild the UI as RN components (no DOM/Radix/CSS hover states — budget
   real time here), add the screen to `MainStack.tsx`'s
   `MainStackParamList` + `<Stack.Screen>`, and give it a way in from
   `DashboardScreen.tsx` (a stat card `onPress`, a menu, etc. — there's no
   `NavSheet` here since a handful of screens doesn't need a fan menu; add
   one back if the screen count grows past what fits on the dashboard).

## Known gaps (intentionally out of scope for this scaffold)

- No supplier feature screens yet beyond the dashboard (see table above).
- No file upload wiring yet (`expo-document-picker` / `expo-image-picker`
  are installed but unused) — useful once catalog images or delivery-
  challan photos are wired up; backend already supports multipart via Multer.
- No push notifications yet (`expo-notifications` installed, unused) — the
  web portal's own "notifications" are just derived client-side from
  quotations/GRNs, no dedicated backend endpoint exists to push from yet.
- No offline/persistence layer (TanStack Query persister + SQLite) — add
  once online-only usage is validated with real suppliers.

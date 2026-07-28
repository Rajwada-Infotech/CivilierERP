# CivilierERP Admin (mobile)

React Native (Expo, TypeScript) client for the Admin module — a separate app
from `mobile/` (Finance + Material), same backend, same conventions. No
backend changes — just another REST/Socket.IO client, same as `mobile/` and
the web app.

Scaffolded from `mobile/`: auth, theme, navigation shell, and shared
components are ported as-is; Finance/Material screens and APIs were
stripped, and the module switcher in `NavSheet.tsx` was replaced with a
single `ADMIN_NAV_TREE` (RN port of
`src/components/layout/sidebars/AdminSidebar.ts`) since this app only ever
shows one module.

## Stack

Expo SDK 57 · TypeScript · React Navigation · TanStack Query · NativeWind ·
React Hook Form + Zod · expo-secure-store · socket.io-client

## Getting started

```bash
cd mobile-admin
cp .env.example .env   # set EXPO_PUBLIC_API_URL to your backend
npm install
npm start
```

`EXPO_PUBLIC_API_URL` must be a full URL — there is no dev-server proxy like
the web app's `/api`. On a physical device, use your machine's LAN IP; on
the Android emulator, use `http://10.0.2.2:<port>` to reach the host
machine. See `.env.example` for details.

## Structure

```
src/
  api/          adminDashboardApi.ts — GET /api/admin-dashboard, and
                any future admin-*Api.ts files ported from src/api/**
  auth/         AuthContext (shared login/logout/RBAC contract with mobile/)
                + adminAccess.ts (single-role gate: super_admin/admin only)
  navigation/   AuthStack / MainStack / RootNavigator + NavSheet
                (adminNav.ts holds ADMIN_NAV_TREE, RN port of AdminSidebar.ts)
  screens/      auth/ (Login) and dashboard/ (Dashboard, Notifications, Profile)
  services/     fetchWithAuth, authStorage (SecureStore), queryClient,
                sessionEvents (401 -> logout pub/sub, no window global here)
  types/        AppUser / PageKey / PagePermission etc — mirrors
                src/contexts/types.ts
```

## Current state — shell only

Login, dashboard (stats from `/api/admin-dashboard`: total/active users,
role count, recently-added users), notifications, profile, and the nav
sheet are wired up and working. Every other admin section (Manage Users,
Approval Inbox, Masters, Rights, Communicator, etc.) is listed in
`adminNav.ts` but not built yet — tapping those alerts "not built yet, use
the web app for now", same convention `mobile/`'s NavSheet uses for its own
unbuilt leaves.

## Porting an admin screen from web

1. Find the equivalent page under `src/pages/admin/**` or
   `src/pages/masters/**` on web.
2. Copy/adapt its `src/api/*Api.ts` client into `mobile-admin/src/api/` —
   only the `fetchWithAuth` import path changes
   (`@/lib/fetchWithAuth` → `@/services/fetchWithAuth`).
3. Reuse the same `useQuery`/`useMutation` calls — TanStack Query code is
   framework-agnostic.
4. Rebuild the UI as RN components (no DOM/Radix/CSS hover states —
   budget real time here), add the screen to `MainStack.tsx`, and give its
   `adminNav.ts` entry a `nav` route so the sheet stops alerting for it.

## Known gaps (intentionally out of scope for this scaffold)

- No admin feature screens yet beyond the dashboard (see above).
- No file upload wiring yet (`expo-document-picker` / `expo-image-picker`
  are installed but unused) — backend already supports multipart via Multer.
- No socket.io connection yet — confirm the handshake auth path accepts a
  Bearer token via the `auth` option before wiring it up.
- No push notifications yet (`expo-notifications` installed, unused).
- No offline/persistence layer (TanStack Query persister + SQLite) — add
  once online-only usage is validated with real users.

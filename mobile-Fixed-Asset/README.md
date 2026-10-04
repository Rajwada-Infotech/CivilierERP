# CivilierERP Fixed Asset (mobile)

React Native (Expo, TypeScript) client for the **Fixed Asset** module — a
separate app from `mobile-admin/`, `mobile-finance-material/` and
`mobile-supplier/`, same backend, same conventions. No backend changes —
just another REST client against the existing Fixed Asset routes
(`backend/routes/fixedAssets.js`, `fixedAssetMaintenance.js`), same as the
web app's `src/pages/fixedAsset/**`.

Scaffolded from `mobile-supplier/`: auth, theme, navigation shell, and
shared components are ported as-is; supplier-only screens/APIs were
stripped and replaced with Fixed Asset ones.

## Stack

Expo SDK 54 · TypeScript · React Navigation · TanStack Query · NativeWind ·
expo-secure-store

## Getting started

```bash
cd mobile-Fixed-Asset
cp .env.example .env   # set EXPO_PUBLIC_API_URL to your backend
npm install
npm start
```

`EXPO_PUBLIC_API_URL` must be a full URL — there is no dev-server proxy like
the web app's `/api`. On a physical device use your machine's LAN IP; on
the Android emulator use `http://10.0.2.2:<port>` to reach the host.

Log in with any `dbo.users` account that has `view` rights on the
`fixed-asset-record` / `fixed-asset-maintenance` pages (same accounts that
work on the web Fixed Asset module). RBAC is enforced by
`middleware/requirePageRight` server-side.

Before the first EAS build, run `eas init` once inside this folder to mint
its own `projectId`.

## Structure

```
src/
  api/          fixedAssetApi.ts — RN client for the FA endpoints
                (/api/fixed-assets, /api/fixed-asset-maintenance,
                 /api/fixed-assets/:id/depreciation)
  auth/         AuthContext (shared login/logout/RBAC contract with the
                other mobile apps) + permissions.ts
  hooks/        usePageRights, useAppVersion, useFaAlerts (stub)
  navigation/   AuthStack / MainStack / RootNavigator + TopHeader + BottomPillNav
  screens/      auth/ (Login), dashboard/ (Dashboard, Profile),
                assets/ (Asset Register, Asset Detail + depreciation),
                maintenance/ (Maintenance list), notifications/
  services/     fetchWithAuth, authStorage (SecureStore), queryClient,
                sessionEvents
  theme/        colors, fonts (Sora / DM Sans)
  types/        AppUser / PageKey / PagePermission — mirrors src/contexts/types.ts
```

## Current state — shell

Login, dashboard (live counts + book value from `/api/fixed-assets` and
`/api/fixed-asset-maintenance`), Asset Register (searchable list), Asset
Detail with posted depreciation history, Maintenance list, and
profile/logout are wired up. Deeper flows (posting depreciation, creating a
maintenance record, printing a voucher) are not built here yet — do those
on web for now.

## Adding a Fixed Asset screen

1. Find the equivalent page under `src/pages/fixedAsset/**` on web.
2. Add the API call to `src/api/fixedAssetApi.ts` (mirror the web
   `src/api/fixedAssetApi.ts` / `fixedAssetMaintenanceApi.ts` shapes).
3. Reuse the same `useQuery` / `useMutation` calls — TanStack Query code is
   framework-agnostic.
4. Rebuild the UI as RN components, register it in `MainStack.tsx`
   (`MainStackParamList` + `<Stack.Screen>`), and give it a way in from
   `DashboardScreen.tsx` or `BottomPillNav.tsx`.

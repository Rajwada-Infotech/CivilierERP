# Civilier Work DPR (mobile)

React Native (Expo, TypeScript) client for the **Civil Work DPR** module — a separate app from
`mobile-admin/`, `mobile-finance-material/`, `mobile-Fixed-Asset/`, `mobile-follow-up/`,
`mobile-maintenance/` and `mobile-supplier/`, same backend, same conventions. No backend changes —
just another REST client against the existing Civil Work DPR routes (`backend/routes/civilworkdprDashboard.js`,
`dependencyActivityAssignment.js`), same as the web app's `src/pages/civilworkdpr/**`.

Scaffolded from `mobile-maintenance/`: auth, theme, navigation shell, update gate, push notifications
and shared components are ported as-is; Maintenance-only screens and APIs were stripped.

## What's in it today

| Screen | Source | Page right |
|---|---|---|
| Dashboard | `GET /api/civilworkdpr-dashboard` — work by status, 14-day completed trend | `civilworkdpr-dashboard` |
| Activities | `GET /api/dependency-activity-assignment` — every allocated activity, search + status filter, "Resumed" shown for activities put back after a hold | `civilworkdpr-activity-reporting` |
| Profile, Notifications | header — alerts for work sent back for rework or on hold | — |

Still to build (the web screens to port next): Work Allocation, Work Reporting detail (progress, remarks,
photos, checkpoints, daily log), Quality Check, Approvals.

## Stack

Expo SDK 57 · TypeScript · React Navigation · TanStack Query · NativeWind · expo-secure-store

## Getting started

```bash
cd mobile-cwd
cp .env.example .env   # set EXPO_PUBLIC_API_URL to your backend
npm install
npm start
```

`EXPO_PUBLIC_API_URL` must be a full URL — there is no dev-server proxy like the web app's `/api`. On a
physical device use your machine's LAN IP; on the Android emulator use `http://10.0.2.2:<port>`.

## Adding a screen

1. Create `src/screens/<area>/<Name>Screen.tsx`.
2. Register it in `src/navigation/MainStack.tsx` (add it to `MainStackParamList` too).
3. List it in `src/navigation/SidebarMenu.tsx`'s `NAV_ITEMS`.
4. Gate it with `usePageRights("<page-key>")` — the same page keys the web app uses.

## First-time setup for a build (one-off, per app)

- **EAS project:** `eas init` from this folder — it writes this app's own `extra.eas.projectId` into
  `app.json`. (The `owner` should be the same Expo account as the other apps.)
- **Push notifications:** register an Android app in the `civilier-erp` Firebase project with package
  `com.rajwadainfotech.civiliercwd`, download `google-services.json` into this folder, add
  `"googleServicesFile": "./google-services.json"` under `android` in `app.json`, then upload the FCM
  service-account key with `eas credentials`. Until then the app runs; it just can't receive pushes.
- **Update gate / APK downloads:** the app identifies itself as `cwd` (see `App.tsx`); that key is already in
  the backend's `APP_CATALOG` (`backend/routes/appReleases.js`) and `scripts/deploy-mobile-apks.sh`.

## Identity

| | |
|---|---|
| Name | Civilier Work DPR |
| Slug / scheme | `mobile-cwd` / `civiliercwd` |
| Android package / iOS bundle | `com.rajwadainfotech.civiliercwd` |
| Update / push key | `cwd` |
| Accent | `#0891b2` (the web app's Civil Work DPR cyan) |

# CivilierERP Follow-Up (Mobile)

React Native (Expo, TypeScript) client for the **Follow-Up** module of the
CivilierERP backend — task follow-ups, close/cancel, task transfer and the
performance report. No backend changes; this is another REST client, same
as the web app and the other `mobile-*` apps.

Scaffolded from `mobile-finance-material` — shared infra (auth, navigation,
theme, services, base components) is identical; the module screens are
Follow-Up-specific.

## Stack

Expo SDK 57 · TypeScript · React Navigation · TanStack Query · NativeWind ·
expo-secure-store · socket.io-client

## Getting started

```bash
cd mobile-follow-up
cp .env.example .env   # set EXPO_PUBLIC_API_URL to your backend
npm install
npm start
```

`EXPO_PUBLIC_API_URL` must be a full URL — there's no dev-server proxy like
the web app's `/api`. On a physical device use your machine's LAN IP; on
the Android emulator use `http://10.0.2.2:<port>`. See `.env.example`.

## Structure

```
src/
  api/followupApi.ts       fetch clients for /api/task-master, /api/task-transfer,
                           /api/task-performance-report
  auth/                    AuthContext + permission checkers (ported from web)
  components/              shared UI — TaskList, ComingSoon, logo/gradient bits
  hooks/                   usePageRights, useAppVersion
  navigation/              RootNavigator, MainStack, AuthStack, NavSheet (FAB menu),
                           TopHeader, moduleAccess (followup gate)
  screens/
    auth/LoginScreen
    dashboard/             DashboardScreen (task snapshot + shortcuts),
                           Notifications, Profile
    followup/              FollowUpDashboard, TaskList, CloseTask,
                           CancelledTasks, TaskTransfer*, TaskPerformance*
  services/                fetchWithAuth, secure-store, react-query client
  theme/                   colors, fonts
```

`*` = wired into navigation, screen body is a "build me out" placeholder
(`ComingSoon`). The read-only task lists (Tasks / Close Task / Cancelled)
are live against the backend.

## Building on this

New Follow-Up screens: add the component under `src/screens/followup/`,
register it in `src/navigation/MainStack.tsx` (route name + `<Stack.Screen>`),
and add a leaf to `FOLLOWUP_NAV` in `src/navigation/NavSheet.tsx`.

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
    dashboard/             DashboardScreen (task snapshot + grouped links),
                           Notifications, Profile
    followup/              FollowUpDashboard, TaskList, TaskMaster, CloseTask,
                           CancelledTasks, TaskTransfer*, TaskPerformance*,
                           TagPerformance*, EntryTypeDocReport*
    setup/                 DepartmentMaster, TagMaster, CancelTemplate
  services/                fetchWithAuth, secure-store, react-query client
  theme/                   colors, fonts
```

The FAB **Menu** (NavSheet) and the Dashboard both group every destination
into **Transactions / Reports / Setup**, mirroring the web app's Follow-Up
sidebar + Reports catalog + Setup fly-out.

`*` = wired into navigation, screen body is a "build me out" placeholder
(`ComingSoon`). Live against the backend: the task lists (Follow-Up Board /
Tasks / Task Master / Close Task / Cancelled Tasks) and the Setup masters
(read-only).

## Building on this

New screen: add the component under `src/screens/{followup,setup}/`, register
it in `src/navigation/MainStack.tsx` (route name + `<Stack.Screen>`), and add
a leaf to the right group in `GROUPS` in `src/navigation/NavSheet.tsx` (and,
optionally, `src/screens/dashboard/DashboardScreen.tsx`).

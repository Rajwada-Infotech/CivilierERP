# CivilierERP Mobile

React Native (Expo, TypeScript) client for the same backend the web app
(`/src`) talks to. No backend changes — this is just another REST/Socket.IO
client, same as the web app.

## Stack

Expo SDK 57 · TypeScript · React Navigation · TanStack Query · NativeWind ·
React Hook Form + Zod · expo-secure-store · socket.io-client

## Getting started

```bash
cd mobile-finance-material
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
  api/          fetch clients per backend module — ported 1:1 from src/api/**
  auth/         AuthContext + RBAC (ported from src/contexts/AuthContext.tsx,
                src/contexts/auth.utils.ts)
  hooks/        usePageRights and friends — same contract as the web app
  navigation/   AuthStack / MainTabs / RootNavigator (React Navigation)
  screens/      one folder per surface (auth, dashboard, ...)
  services/     fetchWithAuth, authStorage (SecureStore), queryClient,
                sessionEvents (401 -> logout pub/sub, no window global here)
  types/        AppUser / PageKey / PagePermission etc — mirrors
                src/contexts/types.ts
  utils/        apiBase (EXPO_PUBLIC_API_URL resolution)
```

## What's already proven working

`DashboardScreen` hits the real `/api/payment-reason-master` endpoint through
`fetchWithAuth` + TanStack Query, gated behind `AuthContext`'s login flow.
That loop — Bearer token attach, 401 handling, query caching, RBAC-ready
`currentUser` — is the thing to keep working as you add real modules. The
project has been verified with `tsc --noEmit`, `expo-doctor`, and a full
Metro bundle export (`npx expo export --platform android`), not just typed.

## Porting a new module from web

1. Copy the relevant `src/api/*Api.ts` file from the web app into
   `mobile-finance-material/src/api/` — only the `fetchWithAuth` import path changes
   (`@/lib/fetchWithAuth` → `@/services/fetchWithAuth`).
2. Reuse the same `useQuery`/`useMutation` calls from the web page —
   TanStack Query code is framework-agnostic.
3. Gate the screen with `usePageRights(pageKey)` exactly like the web page
   does — same `pageKey` string, same RBAC result.
4. Rebuild the UI as RN components — this is the part that does **not**
   port (no DOM, no Radix, no CSS hover states). Budget real time here.

## Known gaps (intentionally out of scope for this scaffold)

- No file upload wiring yet (`expo-document-picker` / `expo-image-picker`
  are installed but unused) — backend already supports multipart via Multer.
- No socket.io connection yet — confirm the handshake auth path accepts a
  Bearer token via the `auth` option before wiring it up.
- No push notifications yet (`expo-notifications` installed, unused).
- No offline/persistence layer (TanStack Query persister + SQLite) — add
  once online-only usage is validated with real users.

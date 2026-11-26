# Civilier Security Intercom

Expo (React Native, TypeScript) app for gate security, built on the mobile-finance-material template (drawing-sheet
UI, `fetchWithAuth`, SecureStore session, push, in-app APK updates). It uses the same backend as the web app.

## Who uses it

| Who | Signs in with | Menu |
| --- | --- | --- |
| Guard (role Guard / Security Guard) | CivilierERP email (Staff) | Dashboard · New visitor · Visitors today · Expected guests · My shift |
| Security Super Admin (and super admin / admin) | CivilierERP email (Staff) | Dashboard · Live map · Alerts · Visitor log · Guards on duty |
| Resident | Customer-portal mobile + password (Resident) | Dashboard · Visitors · Guest passes · Call the gate |

Roles are matched by name, never by id (`src/navigation/securityRole.ts`). The header has a bell with a count:
visitors waiting (residents and guards) or alerts not yet acknowledged (admins).

## What it does

- **Visitor approval.** The guard picks the flat, photographs the visitor and gives a reason. The flat's residents get
  a push and approve or deny; the first answer settles it. After 60 s the other residents are told, and the guard can
  call the flat. After 3 min the request ends as "no response", and the gate's rule says what to do next. Requests made
  offline are queued on the phone and sent once.
- **Guest passes.** A resident makes a pass with a 6-digit code. The guard enters the code, or picks the guest from
  the day's list, and the guest is let in without asking.
- **Tracking.** On shift only, after the guard agrees. Location is sent every ~5 s while moving and once a minute when
  still, queued offline and checked against the gate's hexagon or polygon zone. Alerts are raised for "left the zone"
  (3 readings in a row) and "device offline" (5 min of silence). Unacknowledged alerts are pushed again after 10 min,
  and after 30 min to the super admins too.
- **Calls.** In-app voice calls through LiveKit, resident to gate and guard to resident. The callee is rung by a
  high-priority push on the "calls" channel, or by the socket for staff. If LiveKit isn't set up, or inside Expo Go,
  the app falls back to the phone dialler.
- **Live map.** For admins: Leaflet / OpenStreetMap inside a WebView, with no Google Maps key.

## Server set-up

- Migrations `715-security-intercom.sql` and `716-security-intercom-additions.sql` (`npm run migrate` in /backend).
- Calls: put `LIVEKIT_URL` (wss://…), `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` from LiveKit Cloud in the backend's
  .env.
- Push: `EXPO_ACCESS_TOKEN` (optional), and the app's EAS project (`eas init`) plus Firebase for Android.
- Web admin (Maintenance): Setup menu → Security Gates, Security Guards, Residents, Geofences. Sidebar → Security
  Live. Grant the page rights `security-*` in Role Rights.

## Running it

```bash
cd mobile-security-intercom
npm install
npx expo start -c
```

Expo Go runs the screens, visitor approval and passes, but not background tracking or in-app calls: those need native
modules. Build a development client with `eas build --profile development` after `eas init`.

App key `security-intercom`; package / bundle id `com.rajwadainfotech.civiliersecurity`.

The privacy and consent draft for legal review is in `PRIVACY-DRAFT.md`.

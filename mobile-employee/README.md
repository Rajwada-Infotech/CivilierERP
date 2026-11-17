# Employee Portal App (`mobile-employee`)

The employee-only mobile app for CivilierERP (Android and iOS). It uses the existing backend (`/api/users/login` with
`portal: "employee"`, and `/api/employee-portal/*`) and the same SQL Server database. It has no separate backend.

Stack: Expo SDK 58 (development build, not Expo Go), React Native 0.88, React 19.3, TypeScript (strict),
React Navigation 7 (bottom tabs + native stack), TanStack React Query 5, Expo SecureStore. The UI follows
mobile-admin's sheet style (`src/components/sheet/Sheet.tsx`, themes in `src/theme`).

## What it does (step 1)
| Tab | Uses |
|---|---|
| Home | Today's punch card: Punch In / Out (live front-camera photo + GPS, required by the backend), Start / End break with a reason, live net working time, today's breaks |
| Attendance | Month summary, calendar coloured by status, day list (`GET /attendance?month=`) |
| Leave | Balances, apply, history with HR remarks, withdraw a Pending application |
| Payslips | CTC and latest pay, locked payslips, payslip detail, share as PDF |
| Profile | Own details, holiday calendar, login history, theme, sign out |

Not yet built (needs backend work): work locations / geofence, background GPS tracking, push notifications.

## Run on the Android emulator
```bash
cp .env.example .env        # set EXPO_PUBLIC_API_URL (https://civiliererp.in, or http://10.0.2.2:5001 for a local backend)
npm install
npx expo run:android        # builds and installs the development build, starts Metro
```
Needs Android Studio (its JDK: `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`) and a running emulator.

## Signing in
HR enables the login on the web: HR & Payroll → Employee Portal Access → Enable (sets the password). The user ID is the
e-mail on the employee's Employee Master record. Staff accounts are refused by the backend on this app.

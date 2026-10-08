# CivilierERP

> **Flagship ERP Solution for Civil Engineering & Construction**
> Developed by [Rajwada Infotech](https://rajwadainfotech.com) — Kolkata, India

[![Status](https://img.shields.io/badge/status-under%20active%20development-orange)](https://rajwadainfotech.com)
[![License](https://img.shields.io/badge/license-proprietary-red)](#license)
[![Stack](https://img.shields.io/badge/stack-React%20%2B%20Node.js%20%2B%20MSSQL-blue)](#tech-stack)
[![Docs](https://img.shields.io/badge/docs-PDF%20Reference-informational)](https://github.com/Rajwada-Infotech/CivilierERP/blob/main/CivilierERP%20Documentation.pdf)

---

## Table of Contents

- [Overview](#overview)
- [Documentation](#documentation)
- [About Rajwada Infotech](#about-rajwada-infotech)
- [Core Modules](#core-modules)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [Mobile Apps](#mobile-apps)
- [Themes & UI](#themes--ui)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Configuration](#environment-configuration)
  - [Running the App](#running-the-app)
- [Architecture](#architecture)
- [Approval Workflows](#approval-workflows)
- [Role-Based Access Control](#role-based-access-control)
- [Contributing](#contributing)
- [Code of Conduct](#code-of-conduct)
- [Security](#security)
- [Contact](#contact)
- [License](#license)

---

## Overview

**CivilierERP** is a comprehensive, purpose-built Enterprise Resource Planning system designed specifically for **construction companies**, **infrastructure developers**, and **civil engineering organizations**.

The platform integrates all critical business functions — project management, procurement, inventory, finance, HR, and reporting — into a single secure and scalable system. It provides real-time visibility across multiple sites and projects, streamlines multi-level approval workflows, reduces manual effort, and enables better decision-making at every level of the organization.

> **⚠️ Status: Under Active Development**
> This project is a work-in-progress. Production deployment preparation lives in [DEPLOYMENT.md](DEPLOYMENT.md).

---

## Documentation

The full developer documentation is available as a PDF reference covering all modules, APIs, database schema, infrastructure, and deployment procedures.

📄 **[CivilierERP Developer Documentation (PDF)](https://github.com/Rajwada-Infotech/CivilierERP/blob/main/CivilierERP%20Documentation.pdf)**

The documentation covers:

| Section | Topics |
|---|---|
| Finance Module | Payments, Receipts, BRS, Trial Balance, Setup masters |
| Material Module | Purchase Orders, GRN, Issues, Stock, Transfers |
| Follow-Up Module | Applications, Bookings, Agreements, Closure, Construction Updates |
| Engineering Module | BOQ, Work Orders, Work Done |
| Ticket Module | Support lifecycle, real-time chat, escalation, SLA |
| Admin Module | Authorization layers, RBAC, user management, rights |
| Authentication | JWT flow, Redis blacklist, brute-force protection |
| Redis Infrastructure | Caching, rate limiting, graceful degradation |
| Deployment & Infrastructure | AWS, Docker, CI/CD, health endpoints |
| Document Numbering | Three-tier format, atomic locking, lineage |
| Approval Workflow Engine | Multi-level approvals, audit trail, guardEdit |
| Reports & Widgets | Data export, dashboard widgets, access control |

---

## About Rajwada Infotech

**Rajwada Infotech** is a growing software company based in Kolkata, delivering powerful, user-friendly, and fully customizable ERP solutions across PAN India. We specialize in automation, accuracy, real-time data access, and complete business control to help organizations grow faster and smarter.

CivilierERP is our flagship product tailored for the construction and infrastructure sector.

| | |
|---|---|
| 🌐 **Website** | [https://rajwadainfotech.com](https://rajwadainfotech.com) |
| 📞 **Phone** | +91 9831406285 |
| 📧 **Email** | info@rajwadainfotech.com |
| 📍 **Address** | Windsor Greens Apartment, 26, Mahamaya Mandir Road, Mahamayatala, Kolkata – 700084, West Bengal, India |

---

## Core Modules

| Module | What it covers |
|---|---|
| 🏠 **Home & Command Center** | Project network across companies, live KPIs, widgets, notifications |
| 💰 **Finance** | Invoices, payments, received payments, on-account adjustments, fund transfer, BRS, cheque cancellation, journal vouchers, trial balance, balance sheet, P&L, balance enquiry, year-end close |
| 📦 **Material** | Material requests, quotations & L1 chart, purchase orders, GRN, issues & returns, stock, stock update, transfers, debit notes, short close, vehicle in/out, expense booking |
| 🏗️ **Engineering** | BOQ, work orders, work done, DPR |
| 🧱 **Civil Work DPR** | Work allocation & transfer, activity reporting with photos/checkpoints/daily log, quality check, dependencies, attendance |
| 🤝 **CRM** | Applications, bookings, agreements, legal milestones, project auto-setup, customer portal |
| 📣 **Sales Automation** | Campaigns, ads, leads, sales/marketing/team-lead dashboards |
| ✅ **Follow-Up** | Tasks, sub-tasks, follow-ups, chat & files, closed/cancelled tasks, task transfer, performance reports |
| 🧑‍💼 **HR & Payroll** | Employees, attendance, payroll |
| 🏦 **Loan** | Loan tracking and EMI schedules |
| 🪑 **Fixed Assets** | Asset register and lifecycle |
| 🔧 **Maintenance** | Maintenance requests and tracking |
| 🎫 **Tickets** | Support lifecycle, real-time chat, escalation, SLA |
| 🚚 **Supplier & Customer portals** | Separate logins for vendors (orders) and customers (bookings / owner portal) |
| 🛡️ **Admin / Super Admin / DBA** | Enterprise, companies, projects, masters, users & rights, approval setup & inbox, security, communicator, integrations |
| 📊 **Reports & Widgets** | Report builder, exports (PDF / Excel / CSV), dashboard widgets |

---

## Key Features

- **Single source of truth** for all operational and project data across sites
- **Strict Role-Based Access Control (RBAC)** with approval hierarchies
- **Multi-level approval workflows** — Draft → Pending → Approved/Rejected, managed exclusively through the Admin Approval Inbox
- **Workflow automation** reducing manual handoffs and paper trails
- **Secure data handling** with audit logging on all critical operations
- **Scalable architecture** suitable for growing construction businesses with multiple concurrent projects
- **Real-time insights and analytics** through live dashboards
- **Document number generation** per financial year across all document types (PO, WO, GRN, etc.)
- **Real-time updates** — chat, notifications and live status via Socket.IO
- **Letterhead print & PDF** for MR, PO, GRN, payments, invoices and more
- **Six UI themes** with module-coloured accents, fully responsive down to phone width
- **Field mobile apps** (Expo / React Native) for each department

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui (Radix), TanStack Table |
| **State / Data** | TanStack Query (React Query) |
| **Backend** | Node.js 22, Express 5, Socket.IO, background worker |
| **Database** | Microsoft SQL Server (`mssql`), numbered SQL migrations |
| **Caching / Rate limiting** | Redis (`ioredis`) |
| **Auth** | JWT with Redis token blacklist |
| **Mobile** | Expo SDK 57 / React Native (EAS builds) |
| **Testing** | Vitest (frontend), Jest (backend) |
| **Deployment** | Docker, Docker Compose, Nginx |

---

## Mobile Apps

Each department has its own Expo app in the repo root, sharing the same backend API:

| Folder | App |
|---|---|
| `mobile-admin/` | Admin & approvals |
| `mobile-finance-material/` | Finance & material (MR, PO, GRN, vehicle in/out) |
| `mobile-cwd/` | Civil Work DPR (allocation, transfer, reporting) |
| `mobile-follow-up/` | Follow-up tasks |
| `mobile-maintenance/` | Maintenance |
| `mobile-Fixed-Asset/` | Fixed assets |
| `mobile-supplier/` | Supplier portal |

```bash
cd mobile-admin        # or any mobile-* folder
npm install
npx expo start
```

Android builds are produced with EAS (`eas.json`); release APKs are kept in `apk-releases/` and offered on the in-app *Download Android App* page.

---

## Themes & UI

Users pick a theme from the top bar; it is stored per browser.

| Theme | Look |
|---|---|
| **Dark** (default) | Indigo on deep navy |
| **Light** | Soft violet on white |
| **Midnight** | Teal on near-black |
| **Root** | Amber accents |
| **Glass** | Frosted, tumbled-glass panels over a water tint that follows the active module's colour |
| **BW** | Black, white & grey; colour only in text and accent bars |

UI conventions applied app-wide (mostly via `src/index.css` and runtime helpers in `src/main.tsx`):

- Buttons follow the active **module colour** (Approve / Reject keep green / red).
- Tables: click a row to view, pinned **Status / Actions** columns, sideways scroll when wide, compact cards on phones.
- Dialogs: pinned header & footer, a single close button, frosted in Glass.
- Dates use the shadcn date / date-time / month pickers; dropdowns show a single arrow and themed lists.

---

## Project Structure

```
CivilierERP/
├── .env                        # Frontend env (VITE_ prefix only) — never commit
├── src/
│   ├── api/                    # Frontend API clients
│   ├── components/             # Shared UI (DataTable, MasterPage, ui/*, layout/*)
│   ├── contexts/               # Auth, Theme, …
│   ├── pages/                  # admin, finance, material, engineering, civilworkdpr,
│   │                           # CRM, SalesAutomation, followup, hrpayroll, loan,
│   │                           # fixedAsset, maintenance, ticket, supplier, customer, …
│   ├── utils/                  # Letterhead / document print & PDF builders
│   ├── index.css               # Themes and global UI rules
│   └── main.tsx                # App entry + runtime UI helpers
├── backend/
│   ├── .env                    # Backend secrets — NEVER commit
│   ├── server.js               # Express entry point
│   ├── worker.js               # Background jobs
│   ├── socket.js               # Socket.IO setup
│   ├── db.js · redis.js        # SQL Server / Redis connections
│   ├── config/ middleware/ routes/ services/ validation/ utils/
│   ├── migrations/             # Ordered SQL migrations (run by migrate.js)
│   ├── seeds/ scripts/         # Seed data & maintenance scripts
│   └── test/                   # Jest tests
├── mobile-*/                   # Expo apps per department
├── apk-releases/               # Android release builds
├── docker-compose.yml · Dockerfile · nginx.conf
└── DEPLOYMENT.md · SECURITY.md
```

---

## Getting Started

### Prerequisites

Ensure the following are installed on your system:

- **Node.js** v22 or later
- **Microsoft SQL Server** 2019 or later, or AWS RDS for SQL Server
- **Redis** v7 or later
- **Docker & Docker Compose** *(optional, for containerized setup)*

---

### Installation

**1. Clone the repository**

```bash
git clone https://github.com/Rajwada-Infotech/CivilierERP.git
cd CivilierERP
```

**2. Install frontend dependencies**

```bash
npm install
```

**3. Install backend dependencies**

```bash
cd backend
npm install
```

---

### Environment Configuration

This project uses **two separate `.env` files** — one for the frontend and one for the backend. **Never commit either file to version control.**

#### Frontend — `.env` (project root)

Copy the example and fill in your values:

```bash
cp .env.example .env
```

The root `.env` is for Vite (frontend) variables only. All keys **must** be prefixed with `VITE_`:

```env
# .env — Frontend only. Safe to reference in client-side code.
VITE_API_URL=/api
```

> ⚠️ Do not put secrets, database credentials, or JWT keys in this file. Vite embeds these values in the browser bundle.

---

#### Backend — `backend/.env`

```bash
cp backend/.env.example backend/.env
```

Fill in your values based on your local environment. Refer to `backend/.env.example` for the full list of required keys. The file contains configuration for:

- **Database** — SQL Server host, port, name, user, password, and TLS settings
- **Redis** — host and port for caching
- **JWT** — secret key and token expiry
- **App** — server port (default `5001`) and Node environment

> 🔒 **This file must never be committed.** It is already listed in `.gitignore`. Do not log, print, or expose these values anywhere in the codebase.

---

### Running the App

#### Option A — Docker Compose *(recommended for a clean setup)*

```bash
docker compose up --build
```

Runs the app stack with Redis from the project root. SQL Server is provided separately (local or RDS in production).

#### Option B — Manual

```bash
npm run dev:all        # frontend + backend together
```

or separately:

```bash
npm run dev            # frontend → http://localhost:8080
npm run dev:backend    # backend  → http://localhost:5001
```

The Vite dev server proxies `/api` calls to the backend.

#### Useful scripts

| Command | Purpose |
|---|---|
| `npm run build` | Production build of the frontend |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm test` | Frontend tests (Vitest) |
| `npm --prefix backend test` | Backend tests (Jest) |

#### Running Database Migrations

```bash
cd backend
npm run migrate          # apply pending migrations
npm run migrate:status   # list applied / pending
```

Migrations are numbered and run in order. Always run migrations after pulling new changes that include files in `backend/migrations/`.

---

## Architecture

```
Browser (React + Vite)  ·  Mobile apps (Expo)
        │
        │  HTTP / REST  +  WebSocket (Socket.IO)
        ▼
Express API Server (Node.js)
        │
   ┌────┴────┐
   │         │
SQL Server  Redis
(primary   (caching &
 data)      sessions)
```

**Request lifecycle:**

1. Frontend makes authenticated requests with a JWT Bearer token in the `Authorization` header.
2. `auth.js` middleware verifies the token on every protected route.
3. `role.js` and `permissions.js` enforce role and page-level access before the route handler runs.
4. Route handlers interact with SQL Server via parameterized queries.
5. Redis is used for caching frequently accessed data and for token blacklisting on logout.

---

## Approval Workflows

CivilierERP uses a strict multi-level approval system. The workflow for documents (Purchase Orders, Work Orders, Expenses, etc.) is:

```
Draft  ──► Pending  ──► Approved
                    └──► Rejected
```

**Rules:**

- **Draft → Pending:** Any authorized user can submit a document for approval using the Submit button on the document.
- **Pending → Approved / Rejected:** This action is **exclusively available in the Admin module's Approval Inbox**. Approve and Reject buttons do not appear anywhere else in the application.
- Documents in **Approved** or **Fully Received** status are considered terminal and cannot be actioned further through this workflow.

This separation ensures that approval authority is centralized and auditable.

> For full details on the approval engine, workflow configuration, and the `guardEdit()` guard, see the [Developer Documentation](https://github.com/Rajwada-Infotech/CivilierERP/blob/main/CivilierERP%20Documentation.pdf).

---

## Role-Based Access Control

Access in CivilierERP is governed by roles assigned to each user. Each role has a defined set of page-level and action-level permissions stored in the database.

| Role | Description |
|---|---|
| `super_admin` | Full system access, all modules and approvals |
| `admin` | Approval Inbox access, user management, master data |
| `dba` | Database-level administrative access |
| `material` | Procurement module access (MR, PO, GRN) |
| `finance` | Finance module access |
| `engineering` | Project and engineering module access |

Permissions are checked server-side on every request via middleware. Frontend sidebar navigation and UI elements are also conditionally rendered based on the authenticated user's role.

> For the full authorization architecture — including the two-layer permission model (`allowRoles()` + `checkPermission()`), role aliases, and the `UserPageRightsJson` override system — see the [Developer Documentation](https://github.com/Rajwada-Infotech/CivilierERP/blob/main/CivilierERP%20Documentation.pdf).

---

## Contributing

We welcome contributions from internal team members. Please follow these steps:

1. **Branch naming:** Use descriptive branch names — `feature/po-approval-inbox`, `fix/grn-status-refresh`, `chore/migrate-redis-config`.
2. **One concern per PR:** Keep pull requests focused on a single feature or fix.
3. **No secrets in commits:** Run a quick check before committing. Use `.env.example` files to document required variables.
4. **Test before pushing:** Verify that migrations run cleanly and the app starts without errors.
5. **Write meaningful commit messages:** Use the imperative mood — "Add optimistic status update to PO list" not "fixed stuff".

---

## Code of Conduct

All contributors and team members are expected to uphold the following standards:

### Our Pledge

We are committed to making participation in this project a respectful and productive experience for everyone, regardless of background, experience level, or role within the organization.

### Expected Behavior

- Communicate professionally and constructively in code reviews, issue discussions, and team channels.
- Provide and accept feedback on code — not on the person who wrote it.
- Ask questions openly; there are no stupid questions in a complex system.
- Acknowledge mistakes and learn from them without blame.
- Respect confidentiality — client data, internal architecture, and credentials are never shared outside the team.

### Unacceptable Behavior

- Sharing, committing, or logging credentials, secrets, or personally identifiable information.
- Dismissive, condescending, or hostile communication toward team members.
- Deliberately introducing breaking changes without discussion or documentation.
- Bypassing the review process by pushing directly to `main` or `production` branches.
- Copying proprietary code, designs, or business logic outside of authorized use.

### Reporting

If you observe behavior that violates this code of conduct, report it privately to the project lead at **info@rajwadainfotech.com**. All reports will be handled with discretion.

---

## Security

### Protecting Secrets

- **Never commit** `backend/.env` or any file containing real credentials, API keys, JWT secrets, or database passwords.
- Both `.env` files are in `.gitignore`. Verify this before every initial commit on a new machine.
- Use `.env.example` files to document what variables are required — with placeholder values only (e.g., `JWT_SECRET=your-secret-here`).
- Do not print or log sensitive environment variables anywhere in the codebase, even in development mode.

### Reporting a Vulnerability

If you discover a security vulnerability in CivilierERP, please **do not open a public issue**. Report it privately to:

📧 **info@rajwadainfotech.com**

Include a clear description of the vulnerability, steps to reproduce it, and the potential impact. We will respond promptly and coordinate a fix before any public disclosure.

---

## Contact

**Rajwada Infotech**

- 🌐 [https://rajwadainfotech.com](https://rajwadainfotech.com)
- 📧 info@rajwadainfotech.com
- 📞 +91 9831406285
- 📍 Windsor Greens Apartment, 26, Mahamaya Mandir Road, Mahamayatala, Kolkata – 700084, West Bengal, India

---

## License

CivilierERP is **proprietary software** owned by Rajwada Infotech. All rights reserved.

Unauthorized copying, distribution, modification, or use of this software — in whole or in part — without explicit written permission from Rajwada Infotech is strictly prohibited.

For licensing inquiries, contact **info@rajwadainfotech.com**.

---

*Built with ❤️ by Rajwada Infotech, Kolkata*

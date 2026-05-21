# CivilierERP

> **Flagship ERP Solution for Civil Engineering & Construction**
> Developed by [Rajwada Infotech](https://rajwadainfotech.com) — Kolkata, India

[![Status](https://img.shields.io/badge/status-under%20active%20development-orange)](https://rajwadainfotech.com)
[![License](https://img.shields.io/badge/license-proprietary-red)](#license)
[![Stack](https://img.shields.io/badge/stack-React%20%2B%20Node.js%20%2B%20PostgreSQL-blue)](#tech-stack)

---

## Table of Contents

- [Overview](#overview)
- [About Rajwada Infotech](#about-rajwada-infotech)
- [Core Modules](#core-modules)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
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
> This project is a work-in-progress. Features and modules are being built iteratively. It is **not yet ready for production deployment**.

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

### 🏗️ Project Management
End-to-end project lifecycle tracking — tasks, milestones, progress monitoring, and delay alerts across all active sites.

### 👷 Resource Management
Manpower allocation, attendance tracking, equipment scheduling, and resource utilization reporting across multiple sites and projects.

### 💰 Financial Management
Budget planning and control, expense tracking, RA billing, invoice generation, cost variance monitoring, and detailed financial reporting.

### 📦 Procurement & Inventory
Material requisitions with multi-level approvals, vendor management, purchase orders, Goods Receipt Notes (GRN), and site-wise real-time stock tracking.

### 🛡️ HR & Admin
User and role management with granular permissions, master data control (companies, suppliers, items, UOM), and full system configuration.

### 📊 Reporting & Dashboards
Real-time operational dashboards, KPI tracking, custom report generation, and export to PDF and Excel.

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

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| **Backend** | Node.js, Express |
| **Database** | PostgreSQL |
| **Caching** | Redis |
| **Auth** | JWT (JSON Web Tokens) |
| **State Management** | TanStack Query (React Query) |
| **Containerization** | Docker, Docker Compose |

---

## Project Structure

```
CivilierERP/
├── .env                        # Frontend environment variables (VITE_ prefix only)
├── public/
│   └── CivilierERP.jpeg
├── src/
│   ├── api/                    # Frontend API client functions
│   ├── components/             # Reusable UI components
│   │   ├── ApprovalActions.tsx # Submit/Approve/Reject action component
│   │   ├── StatusBadge.tsx
│   │   └── layout/
│   │       ├── AppLayout.tsx
│   │       ├── AppSidebar.tsx
│   │       └── sidebars/       # Role-specific sidebar configs
│   ├── pages/                  # Application views and routes
│   │   ├── admin/              # Admin module (Approval Inbox, User Management)
│   │   ├── material/           # Procurement (Purchase Orders, GRN, MR)
│   │   ├── finance/            # Finance module
│   │   ├── project/            # Project management views
│   │   └── ...
│   └── assets/                 # Styles, icons, images
│
└── backend/
    ├── .env                    # Backend secrets — NEVER commit this file
    ├── index.js                # Express app entry point
    ├── db.js                   # Database connection
    ├── logger.js               # Logging setup
    ├── config/
    │   └── env.js              # Environment variable loader
    ├── middleware/
    │   ├── auth.js             # JWT authentication
    │   ├── role.js             # Role enforcement
    │   ├── permissions.js      # Granular permission checks
    │   └── ...
    ├── routes/
    │   ├── purchaseOrders.js
    │   └── ...
    ├── migrations/             # Ordered SQL migration files
    └── migrate.js              # Migration runner
```

---

## Getting Started

### Prerequisites

Ensure the following are installed on your system:

- **Node.js** v18 or later
- **Bun** (used for the backend) — [install here](https://bun.sh)
- **PostgreSQL** v14 or later
- **Redis** v7 or later
- **Docker & Docker Compose** *(optional, for containerized setup)*

---

### Installation

**1. Clone the repository**

```bash
git clone https://github.com/rajwadainfotech/civilier-erp.git
cd civilier-erp
```

**2. Install frontend dependencies**

```bash
npm install
```

**3. Install backend dependencies**

```bash
cd backend
bun install
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

- **Database** — PostgreSQL host, port, name, user, and password
- **Redis** — host and port for caching
- **JWT** — secret key and token expiry
- **App** — server port and Node environment

> 🔒 **This file must never be committed.** It is already listed in `.gitignore`. Do not log, print, or expose these values anywhere in the codebase.

---

### Running the App

#### Option A — Docker Compose *(recommended for a clean setup)*

```bash
cd backend
docker compose up --build
```

This spins up the app, PostgreSQL, and Redis together.

#### Option B — Manual

**Run the backend:**

```bash
cd backend
bun run index.js
```

**Run the frontend** (in a separate terminal from the project root):

```bash
npm run dev
```

The frontend will be available at `http://localhost:5173` and will proxy API calls to the backend.

#### Running Database Migrations

```bash
cd backend
node migrate.js
```

Migrations are numbered and run in order. Always run migrations after pulling new changes that include files in `backend/migrations/`.

---

## Architecture

```
Browser (React + Vite)
        │
        │  HTTP / REST
        ▼
Express API Server (Node.js / Bun)
        │
   ┌────┴────┐
   │         │
PostgreSQL  Redis
(primary   (caching &
 data)      sessions)
```

**Request lifecycle:**

1. Frontend makes authenticated requests with a JWT Bearer token in the `Authorization` header.
2. `auth.js` middleware verifies the token on every protected route.
3. `role.js` and `permissions.js` enforce role and page-level access before the route handler runs.
4. Route handlers interact with PostgreSQL via parameterized queries.
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

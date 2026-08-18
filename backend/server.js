require("./config/env").loadEnv();

const isDev = process.env.NODE_ENV === "development";
const isTest = process.env.NODE_ENV === "test";

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");

const { connectDB, closeDB } = require("./db");
const { startCrmSlaEngine } = require("./services/crmSlaEngine");
const authMiddleware = require("./middleware/auth");
const rateLimit = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");

const logger = require("./logger");
const requestLogger = require("./requestLogger");
const {
  addRequestTiming,
  requestTimeout,
} = require("./middleware/requestObservability");

const { safeLoadRoutes, printRoutesSummary } = require("./utils/loadRoutes");
const http = require("http");
const { initSocket } = require("./socket");
const { isOriginAllowed } = require("./config/origins");
const { validateApprovalModuleMap } = require("./services/approvalService");

// ─── Crash visibility ───────────────────────────────────────────────────────
// Node has no default handler for these, so without one an uncaught error in
// a fire-and-forget async call (a socket handler, a cron job, a .catch()-less
// promise anywhere in the app) kills the entire process with only whatever
// happened to be on stdout at that moment — often nothing, if stdout isn't
// being captured by whatever runs `node server.js` on the live server. Log
// first so the failure is diagnosable, then let Node exit as it already
// would (this does not change crash-vs-continue behavior, only visibility).
if (!isTest) {
  process.on("unhandledRejection", (reason) => {
    logger.error(
      { event: "UNHANDLED_REJECTION", err: reason instanceof Error ? reason.stack : reason },
      "Unhandled promise rejection — process will exit",
    );
  });
  process.on("uncaughtException", (err) => {
    logger.error(
      { event: "UNCAUGHT_EXCEPTION", err: err?.stack || err },
      "Uncaught exception — process will exit",
    );
    process.exit(1);
  });
}

const {
  getRedis,
  closeRedis,
  redisZScore,
  incrGlobalRequests,
  pfaddActiveUser,
  getSystemMetrics,
  trackHourLoad,
  getPredictedRPM,
  getDynamicLimit,
} = require("./redis");

// ─── Banner ──────────────────────────────────────────────────────────────────
function printBanner(port) {
  if (!isDev) return;

  // ANSI helpers — raw codes work even when chalk/picocolors suppress colour
  const R  = "\x1b[0m";
  const b  = (s) => `\x1b[1m${s}${R}`;
  const dim = (s) => `\x1b[2m${s}${R}`;
  const violet = (s) => `\x1b[38;5;135m${s}${R}`;
  const indigo = (s) => `\x1b[38;5;105m${s}${R}`;
  const cyan   = (s) => `\x1b[38;5;87m${s}${R}`;
  const green  = (s) => `\x1b[38;5;120m${s}${R}`;
  const amber  = (s) => `\x1b[38;5;221m${s}${R}`;
  const slate  = (s) => `\x1b[38;5;246m${s}${R}`;

  const env     = process.env.NODE_ENV || "development";
  const node    = process.version;
  const time    = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
  const memMB   = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);
  const pid     = process.pid;
  const routes  = ALL_ROUTES.length;
  const envColor = env === "production" ? amber : green;

  // Visual width (printable chars only, not ANSI escapes)
  const W = 52;
  const pad = (s, len) => {
    // strip ANSI for length calc
    const plain = s.replace(/\x1b\[[0-9;]*m/g, "");
    return s + " ".repeat(Math.max(0, len - plain.length));
  };

  const border = indigo("╭" + "─".repeat(W) + "╮");
  const sep    = indigo("├" + "─".repeat(W) + "┤");
  const foot   = indigo("╰" + "─".repeat(W) + "╯");
  const bar    = (content) => `${indigo("│")} ${pad(content, W - 2)} ${indigo("│")}`;
  const kv     = (icon, label, val) =>
    bar(`${slate(icon)}  ${dim(label.padEnd(6))}  ${val}`);

  const lines = [
    "",
    border,
    bar(""),
    bar(`  ${b(violet("◆  CivilierERP"))}  ${slate("API Server")}`),
    bar(`     ${dim("Rajwada Infotech  ·  v1.0.0")}`),
    bar(""),
    sep,
    bar(""),
    kv("→", "URL",  cyan(`http://localhost:${port}`)),
    kv("⬡", "ENV",  envColor(env)),
    kv("◎", "NODE", slate(node)),
    kv("⊙", "PID",  slate(String(pid))),
    kv("◈", "MEM",  slate(`${memMB} MB`)),
    kv("⏱", "TIME", slate(time)),
    kv("⊞", "ROUTES", slate(`${routes} registered`)),
    bar(""),
    foot,
    "",
  ];

  process.stdout.write(lines.join("\n") + "\n");
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeStore(prefix) {
  return new RedisStore({
    prefix,
    sendCommand: (...args) => getRedis().then((client) => client.call(...args)),
  });
}

function isLocalRequest(req) {
  const ip = req.ip || req.socket?.remoteAddress || "";
  return (
    ip === "::1" ||
    ip === "127.0.0.1" ||
    ip === "::ffff:127.0.0.1" ||
    ip.includes("127.0.0.1")
  );
}

// ─── Routes ──────────────────────────────────────────────────────────────────
const ALL_ROUTES = [
  { path: "/api/roles", file: "./routes/roles" },
  { path: "/api/user-rights", file: "./routes/userRights" },
  { path: "/api/user-widget-rights", file: "./routes/userWidgetRights" },
  { path: "/api/account-group", file: "./routes/accountGroup" },
  { path: "/api/account-head", file: "./routes/accountHeadMaster" },
  { path: "/api/activity-master", file: "./routes/activityMaster" },
  { path: "/api/bank-master", file: "./routes/bankMaster" },
  { path: "/api/billing-terms", file: "./routes/billingTerms" },
  { path: "/api/card-master", file: "./routes/cardMaster" },
  { path: "/api/cheque-master", file: "./routes/chequeMaster" },
  { path: "/api/return-reason-master", file: "./routes/returnReasonMaster" },
  { path: "/api/payment-reason-master", file: "./routes/paymentReasonMaster" },
  { path: "/api/loan-sanction", file: "./routes/loanSanction" },
  { path: "/api/cost-center", file: "./routes/costCenter" },
  { path: "/api/payment-terms", file: "./routes/vendorPaymentTerm" },
  { path: "/api/profit-center", file: "./routes/profitCenter" },
  { path: "/api/document-type", file: "./routes/document-type" },
  { path: "/api/doc-selector", file: "./routes/docSelector" },
  { path: "/api/fin-year", file: "./routes/finYear" },
  { path: "/api/general-ledger", file: "./routes/generalLedger" },
  { path: "/api/hsn", file: "./routes/hsn" },
  { path: "/api/item-groups", file: "./routes/itemGroup" },
  { path: "/api/item-master", file: "./routes/itemMaster" },
  { path: "/api/tds-master", file: "./routes/tdsMaster" },
  { path: "/api/enterprises", file: "./routes/enterprise" },
  { path: "/api/entry-type", file: "./routes/entryType" },
  { path: "/api/expense-booking", file: "./routes/expenseBooking" },
  { path: "/api/material-chain", file: "./routes/materialChain" },
  { path: "/api/amendments", file: "./routes/amendments" },
  { path: "/api/new-payment", file: "./routes/newPayment" },
  { path: "/api/on-account", file: "./routes/onAccount" },
  { path: "/api/received-payment", file: "./routes/receivedPayment" },
  { path: "/api/journal-voucher", file: "./routes/journalVoucher" },
  { path: "/api/fund-transfer", file: "./routes/fundTransfer" },
  { path: "/api/contract", file: "./routes/contract" },
  { path: "/api/reports/journal-voucher", file: "./routes/journalVoucherReports" },
  { path: "/api/purchase-orders", file: "./routes/purchaseOrders" },
  { path: "/api/customer-sale-orders", file: "./routes/customerSaleOrders" },
  { path: "/api/sale-invoices", file: "./routes/saleInvoices" },
  { path: "/api/sales-dashboard", file: "./routes/salesDashboard" },
  { path: "/api/tenants", file: "./routes/tenants" },
  { path: "/api/work-orders", file: "./routes/workOrder" },
  { path: "/api/user-profile", file: "./routes/userProfile" },
  { path: "/api/uom-master", file: "./routes/uomMaster" },
  { path: "/api/item-uom-alternates", file: "./routes/itemUomAlternates" },
  { path: "/api/debit-note", file: "./routes/debitNote" },
  { path: "/api/tc-master", file: "./routes/tcMaster" },
  { path: "/api/transactions", file: "./routes/transactions" },
  { path: "/api/trial-balance", file: "./routes/trialBalance" },
  { path: "/api/financial-statements", file: "./routes/financialStatements" },
  { path: "/api/year-end-close", file: "./routes/yearEndClose" },
  { path: "/api/balance-enquiry", file: "./routes/balanceEnquiry" },
  { path: "/api/grns", file: "./routes/grns" },
  { path: "/api/vehicle-in-out", file: "./routes/vehicleInOut" },
  { path: "/api/quality-debit-note", file: "./routes/qualityRejectionDebitNote" },
  { path: "/api/stock-ledger", file: "./routes/stockLedger" },
  { path: "/api/inventory-master", file: "./routes/inventoryMaster" },
  { path: "/api/brs", file: "./routes/brs" },
  { path: "/api/cheque-cancellation", file: "./routes/chequeCancellation" },
  { path: "/api/reports", file: "./routes/reports" },
  { path: "/api/reports/pdc", file: "./routes/pdcReport" },
  { path: "/api/finance-dashboard", file: "./routes/financeDashboard" },
  { path: "/api/material-dashboard", file: "./routes/materialDashboard" },
  { path: "/api/civilworkdpr-dashboard", file: "./routes/civilworkdprDashboard" },
  { path: "/api/engineering", file: "./routes/engineering" },
  { path: "/api/material-issues", file: "./routes/materialIssues" },
  { path: "/api/material-issue-returns", file: "./routes/issueReturn" },
  { path: "/api/material-requests", file: "./routes/materialRequests" },
  { path: "/api/short-close", file: "./routes/shortClose" },
  { path: "/api/quotations", file: "./routes/quotations" },
  { path: "/api/admin-dashboard", file: "./routes/adminDashboard" },
  { path: "/api/user-activity", file: "./routes/userActivity" },
  { path: "/api/cheque-leaf", file: "./routes/chequeLeaf" },
  { path: "/api/contractor-category", file: "./routes/contractorCategory" },
  { path: "/api/dependency", file: "./routes/dependency" },
  { path: "/api/dependency-master", file: "./routes/dependencyMaster" },
  { path: "/api/dependency-activity-assignment", file: "./routes/dependencyActivityAssignment" },
  { path: "/api/depreciation-setup", file: "./routes/depreciationSetup" },
  { path: "/api/fixed-assets",       file: "./routes/fixedAssets" },
  { path: "/api/work-progress", file: "./routes/workProgress" },
  { path: "/api/contractor-allocation", file: "./routes/contractorAllocation" },
  { path: "/api/daily-labour", file: "./routes/dailyLabour" },
  { path: "/api/worker-attendance", file: "./routes/workerAttendance" },
  { path: "/api/activity-items", file: "./routes/activityItems" },
  { path: "/api/approval-workflows", file: "./routes/approvalWorkflows" },
  { path: "/api/approval-inbox", file: "./routes/approvalInbox" },
  { path: "/api/tasks", file: "./routes/tasks" },
  { path: "/api/widgets", file: "./routes/widgets" },
  { path: "/api/widgets/metrics", file: "./routes/widgetMetrics" },
  { path: "/api/tenant-reminders", file: "./routes/tenantReminders" },
  { path: "/api/reminders", file: "./routes/tenantReminders" },
  { path: "/api/applicants", file: "./routes/applicants" },
  { path: "/api/company-master", file: "./routes/companyMaster" },
  { path: "/api/project-master", file: "./routes/projectMaster" },
  { path: "/api/block-master", file: "./routes/blockMaster" },
  { path: "/api/unit-master", file: "./routes/unitMaster" },
  { path: "/api/room-master", file: "./routes/roomMaster" },
  { path: "/api/room-category-master", file: "./routes/roomCategoryMaster" },
  { path: "/api/activity-checkpoint", file: "./routes/activityCheckpoint" },
  { path: "/api/unit-bhk-config", file: "./routes/unitBhkConfig" },
  { path: "/api/payment-plan-master", file: "./routes/paymentPlanMaster" },
  { path: "/api/parking-master", file: "./routes/parkingMaster" },
  { path: "/api/parking-slot-master", file: "./routes/parkingSlotMaster" },
  { path: "/api/extra-charge-master", file: "./routes/extraChargeMaster" },
  { path: "/api/department-master", file: "./routes/departmentMaster" },
  { path: "/api/tag-master", file: "./routes/tagMaster" },
  { path: "/api/task-master", file: "./routes/taskMaster" },
  { path: "/api/task-transfer", file: "./routes/taskTransfer" },
  { path: "/api/task-performance-report", file: "./routes/taskPerformanceReport" },
  { path: "/api/unit-matrix", file: "./routes/unitMatrix" },
  { path: "/api/parking-matrix", file: "./routes/parkingMatrix" },
  { path: "/api/business", file: "./routes/businessRoutes" },
  { path: "/api/tickets", file: "./routes/ticketRoutes" },
  { path: "/api/records", file: "./routes/recordsRoutes" },
  { path: "/api/personal-vault", file: "./routes/personalVault" },
  { path: "/api/signatures", file: "./routes/signatures" },
  { path: "/api/communicator", file: "./routes/communicator" },
  { path: "/api/system/metrics", file: "./routes/systemMetrics" },
  { path: "/api/menu-master", file: "./routes/menuMaster" },
  { path: "/api/menu-type", file: "./routes/menuType" },
  // Backward-compatible plural alias; frontend uses /api/menu-type.
  { path: "/api/menu-types", file: "./routes/menuType" },
  { path: "/api/typeofdoc", file: "./routes/typeofdoc" },
  { path: "/api/boq", file: "./routes/boq" },
  { path: "/api/engineering/dpr", file: "./routes/dpr" },
  { path: "/api/godowns", file: "./routes/godowns" },
  { path: "/api/stock-transfers", file: "./routes/stockTransfers" },
  { path: "/api/inter-company-transfer", file: "./routes/interCompanyTransfer" },
  { path: "/api/sale-orders", file: "./routes/saleOrders" },
  { path: "/api/widget-catalog", file: "./routes/widgetCatalogAdmin" },
  { path: "/api/page-definitions", file: "./routes/pageDefinitions" },
  { path: "/api/lookups", file: "./routes/lookups" },
  { path: "/api/sa/social-media", file: "./routes/saSocialMedia" },
  { path: "/api/sa/campaigns", file: "./routes/saCampaigns" },
  { path: "/api/sa/ads", file: "./routes/saAds" },
  { path: "/api/sa/leads", file: "./routes/saLeads" },
  { path: "/api/sa/channel-partners", file: "./routes/saChannelPartners" },
  { path: "/api/sa/lead-activities", file: "./routes/saLeadActivities" },
  { path: "/api/sa/lead-tasks", file: "./routes/saLeadTasks" },
  { path: "/api/sa/lead-distribution", file: "./routes/saLeadDistribution" },
  { path: "/api/sa/inquiry", file: "./routes/saInquiry" },
  { path: "/api/sa/site-visits", file: "./routes/saSiteVisits" },
  { path: "/api/sa/marketing-invoices", file: "./routes/saMarketingInvoices" },
  { path: "/api/sa/commissions", file: "./routes/saCommissions" },
  { path: "/api/sa/dashboard", file: "./routes/saDashboard" },
  { path: "/api/sa/reports", file: "./routes/saReports" },
  { path: "/api/sa/distribution-rules", file: "./routes/saDistributionRules" },
  { path: "/api/sa/teams", file: "./routes/saTeams" },
  { path: "/api/sa/lead-transfers", file: "./routes/saLeadTransfers" },
  { path: "/api/sa/role-master", file: "./routes/saRoleMaster" },
  { path: "/api/sa/notifications", file: "./routes/saNotifications" },
  // ── CRM Module ──────────────────────────────────────────────────────────────
  { path: "/api/crm/customers",      file: "./routes/crmCustomers"      },
  { path: "/api/crm/applications",   file: "./routes/crmApplications"   },
  { path: "/api/crm/bookings",       file: "./routes/crmBookings"       },
  { path: "/api/crm/welcome-calls",     file: "./routes/crmWelcomeCalls"     },
  { path: "/api/crm/welcome-checklist", file: "./routes/crmWelcomeChecklist" },
  { path: "/api/crm/co-applicants",  file: "./routes/crmCoApplicant"    },
  { path: "/api/crm/booking-documents", file: "./routes/crmBookingDocuments" },
  { path: "/api/crm/agreements",     file: "./routes/crmAgreements"     },
  { path: "/api/crm/payments",       file: "./routes/crmPayments"       },
  { path: "/api/crm/money-receipts", file: "./routes/crmMoneyReceipts"  },
  { path: "/api/crm/invoices",       file: "./routes/crmInvoices"       },
  { path: "/api/crm/handover",       file: "./routes/crmHandover"       },
  { path: "/api/crm/service-tickets",file: "./routes/crmServiceTickets" },
  { path: "/api/crm/cancellations",  file: "./routes/crmCancellations"  },
  { path: "/api/crm/customer-360",   file: "./routes/crmCustomer360"    },
  { path: "/api/crm/legal-milestones",     file: "./routes/crmLegalMilestones"     },
  { path: "/api/crm/noc",                  file: "./routes/crmNoc"                 },
  { path: "/api/crm/sales-deed",           file: "./routes/crmSalesDeed"           },
  { path: "/api/crm/query-payment",        file: "./routes/crmQueryPayment"        },
  { path: "/api/crm/registry",             file: "./routes/crmRegistry"            },
  { path: "/api/crm/pre-possession",       file: "./routes/crmPrePossession"       },
  { path: "/api/crm/possession-notice",    file: "./routes/crmPossessionNotice"    },
  { path: "/api/crm/construction-updates", file: "./routes/crmConstructionUpdates" },
  { path: "/api/crm/communication",        file: "./routes/crmCommunication"       },
  { path: "/api/crm/dashboard",            file: "./routes/crmDashboard"           },
  { path: "/api/crm/reports",              file: "./routes/crmReports"             },
  { path: "/api/crm/customer-bank-details",file: "./routes/crmCustomerBankDetails" },
  { path: "/api/crm/brokerage",            file: "./routes/crmBrokerage"           },
  { path: "/api/crm/brokerage-rate-tiers", file: "./routes/crmBrokerageRateTiers"  },
  { path: "/api/crm/payment-plans",        file: "./routes/crmPaymentPlans"        },
  { path: "/api/crm/project-banks",        file: "./routes/crmProjectBanks"        },
  { path: "/api/crm/milestone-master",     file: "./routes/crmMilestoneMaster"     },
  { path: "/api/crm/parking",              file: "./routes/crmParking"             },
  { path: "/api/crm/project-auto-setup",   file: "./routes/crmProjectAutoSetup"    },
  { path: "/api/crm/holds",                file: "./routes/crmHolds"               },
  { path: "/api/crm/extra-charges",        file: "./routes/crmExtraCharges"        },
  { path: "/api/crm/booking-amendments",   file: "./routes/crmBookingAmendments"   },
  { path: "/api/crm/sla-engine",           file: "./routes/crmSlaEngine"           },
  // /api/crm-portal is registered earlier, before the blanket authMiddleware
  // wall (see above) — it must NOT also be registered here.
];

// ─── createApp ───────────────────────────────────────────────────────────────
async function createApp() {
  const app = express();
  app.locals.startupTime = new Date().toISOString();

  // Exactly one reverse proxy hop sits in front of this process: the nginx
  // container. nginx forwards the real client/ALB IP via X-Forwarded-For,
  // so trust 1 hop — not `true`, which would trust any spoofed header from
  // anywhere and defeat rate limiting and IP-based checks below.
  app.set("trust proxy", 1);

  app.disable("x-powered-by");
  app.use(requestLogger);
  app.use(addRequestTiming);
  app.use(requestTimeout());

  app.use((req, res, next) => {
    res.setHeader("X-Request-Id", req.id || "test");
    next();
  });

  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
          callback(null, true);
        } else {
          logger.warn(`[BLOCK] CORS rejected: ${origin}`);
          callback(new Error("Not allowed by CORS"));
        }
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "X-Request-Id",
      ],
      optionsSuccessStatus: 204,
    }),
  );

  app.use(compression());

  // Ticket attachments are served through /api/tickets/file/:filename after auth.
  // Do not expose backend/uploads/tickets statically.

  // Global request tracking
  if (!isTest) {
    app.use((req, res, next) => {
      incrGlobalRequests().catch(() => {});
      trackHourLoad().catch(() => {});
      next();
    });
  }

  // ── Rate limiters ─────────────────────────────────────────────────────────
  // Registered inside createApp() so they apply in ALL environments,
  // including the Vercel serverless entry point (api/index.js) which calls
  // createApp() directly and never goes through startServer().
  if (!isTest) {
    const loginLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10,
      message: { error: "Too many login attempts. Try again later." },
      store: makeStore("rl:login:"),
      skip: (req) => isDev && isLocalRequest(req),
      standardHeaders: true,
      legacyHeaders: false,
    });

    // Cache the dynamic limit for 10 s to avoid 3 Redis round-trips on every
    // request. Without this, page load fires ~15 concurrent requests and each
    // one awaits redisZScore + getSystemMetrics + getPredictedRPM, causing
    // 2-3 s queuing before the route handler even starts.
    let _cachedLimit = 500;
    let _limitCachedAt = 0;
    async function getDynamicLimitCached(userId) {
      const now = Date.now();
      if (now - _limitCachedAt < 10_000) return _cachedLimit;
      try {
        const score = Number(
          (await redisZScore("engagement:score", userId)) || 0,
        );
        const metrics = await getSystemMetrics();
        const predictedRPM = await getPredictedRPM();
        _cachedLimit = getDynamicLimit(
          score,
          predictedRPM || metrics.rpm,
          metrics.memoryUsage,
        );
        _limitCachedAt = now;
      } catch {
        // keep last cached value
      }
      return _cachedLimit;
    }

    const apiLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: async (req) => {
        if (!req.user?.userId) return 1000;
        try {
          return await getDynamicLimitCached(req.user.userId);
        } catch (err) {
          logger.warn(
            { event: "RATE_LIMIT_FALLBACK", err },
            "Using default limit due to Redis issue",
          );
          return 500;
        }
      },
      store: makeStore("rl:api:"),
      skip: (req) => req.path.startsWith("/api/user-activity"),
      keyGenerator: (req) =>
        req.user?.userId ? `user:${req.user.userId}` : req.ip,
      validate: false,
      standardHeaders: true,
      legacyHeaders: false,
    });

    app.use("/api/users/login", loginLimiter);
    app.use("/api", apiLimiter);
  }

  app.get("/", (req, res) => res.send("CivilierERP API running"));
  app.use("/health", require("./routes/health"));
  app.use("/api/users", require("./routes/users"));
  app.use("/api/public-stats", require("./routes/publicStats"));
  // Version number is not sensitive — served publicly so the Login/Landing
  // footers (pre-auth) can show the real DB-driven version, not "…".
  app.use("/api/app-version", require("./routes/appVersion"));
  // Customer portal manages its own auth entirely (public /login using the
  // separate CrmCustomerPortalUser table + JWT, then portalAuth for
  // everything past that) — same reason /api/users is registered here
  // rather than below. Registered before the blanket staff authMiddleware
  // so a customer who has never held a staff session can actually reach
  // /login; it used to sit in ALL_ROUTES below the wall, so every request —
  // including login itself — was rejected with "No token provided" before
  // crmPortal.js's own router ever ran.
  app.use("/api/crm-portal", require("./routes/crmPortal"));

  // Active user tracking — runs after auth on all /api routes
  app.use("/api", authMiddleware, (req, res, next) => {
    if (req.user?.userId) {
      pfaddActiveUser(req.user.userId).catch(() => {});
    }
    next();
  });

  if (!isTest) logger.info("[ROUTES] Loading routes...");

  const routeResults = await safeLoadRoutes(app, ALL_ROUTES, {
    baseDir: __dirname,
    logger,
    failFast: false,
    verbose: isDev,
  });

  // DBA route — role-gated, loaded separately
  try {
    app.use(
      "/api/dba",
      authMiddleware,
      require("./middleware/role")("dba", "admin", "director", "super_admin"),
      require("./routes/dba"),
    );
    routeResults.loaded.push("dba");
  } catch (err) {
    logger.error(`[ERR] Route failed [dba]: ${err.message}`);
    routeResults.failed.push({ label: "dba", error: err.message });
  }

  // Supplier Portal route — role-gated to the external "supplier" role only
  try {
    app.use(
      "/api/supplier-portal",
      authMiddleware,
      require("./middleware/role")("supplier"),
      require("./routes/supplierPortal"),
    );
    routeResults.loaded.push("supplier-portal");
  } catch (err) {
    logger.error(`[ERR] Route failed [supplier-portal]: ${err.message}`);
    routeResults.failed.push({ label: "supplier-portal", error: err.message });
  }

  if (!isTest) {
    printRoutesSummary(routeResults, logger);
    logger.info(`[OK] Routes loaded: ${routeResults.loaded.length}`);
  }

  // ── Global error handler ──────────────────────────────────────────────────
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const statusCode = err.status || err.statusCode || 500;

    req.log?.error(
      {
        err,
        requestId: req.id,
        method: req.method,
        url: req.originalUrl || req.url,
        userId: req.user?.userId,
      },
      `Unhandled error ${statusCode} on ${req.method} ${req.url}`,
    );

    if (isDev) {
      process.stderr.write(
        `\n[ERROR] ${req.method} ${req.originalUrl} => ${statusCode}: ${err.message}\n`,
      );
    }

    res.err = err; // Let pino-http surface the real error

    res.status(statusCode).json({
      success: false,
      error: "Internal Server Error",
      message: isDev ? err.message : "Something went wrong",
      requestId: req.id,
    });
  });

  return app;
}

// ─── startServer ─────────────────────────────────────────────────────────────
async function startServer() {
  try {
    logger.info("[DB] Connecting to database...");
    await connectDB();

    validateApprovalModuleMap(logger).catch((err) => {
      logger.warn(
        { event: "APPROVAL_MODULE_VALIDATION_FAILED", err },
        "Approval module startup validation failed",
      );
    });

    const worker = require("./worker");
    await worker.startWorker();

    logger.info("[OK] Database connected");

    const app = await createApp();
    const PORT = process.env.PORT || 5000;
    const httpServer = http.createServer(app);

    initSocket(httpServer);

    const server = httpServer.listen(PORT, () => {
      printBanner(PORT);
      logger.info(`[START] Server ready on port ${PORT}`);
      startCrmSlaEngine();
    });

    setupGracefulShutdown(server, worker);

    return app;
  } catch (err) {
    logger.error(`[FATAL] Server failed to start: ${err.message}`);
    process.exit(1);
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
function setupGracefulShutdown(server, worker) {
  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.warn(
      { event: "SHUTDOWN_START", signal },
      "Graceful shutdown started",
    );

    const forceExitTimer = setTimeout(
      () => {
        logger.fatal(
          { event: "SHUTDOWN_FORCE_EXIT", signal },
          "Graceful shutdown timed out",
        );
        process.exit(1);
      },
      Number(process.env.SHUTDOWN_TIMEOUT_MS || 10000),
    );
    forceExitTimer.unref();

    server.close(async (err) => {
      if (err) {
        logger.error(
          { event: "HTTP_SERVER_CLOSE_ERROR", err },
          "HTTP close failed",
        );
      }

      try {
        worker?.stopWorker?.();
        await closeRedis();
        await closeDB();
        logger.info(
          { event: "SHUTDOWN_DONE", signal },
          "Graceful shutdown complete",
        );
        process.exit(err ? 1 : 0);
      } catch (closeErr) {
        logger.error(
          { event: "SHUTDOWN_CLOSE_ERROR", err: closeErr },
          "Graceful shutdown failed",
        );
        process.exit(1);
      }
    });
  }

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = { startServer, createApp };

if (!isTest) {
  startServer();
}

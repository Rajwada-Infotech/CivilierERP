const express = require("express");

const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

const { getPool, sql } = require("../db");
const { redisGet, redisSet } = require("../redis");

const CACHE_TTL_SECONDS = 15;
const PRIVILEGED_ROLES = new Set(["admin", "super_admin", "dba"]);

const toNumber = (value) => Number(value || 0);
const emptyResult = (row = {}) => Promise.resolve({ recordset: [row] });
const emptyListResult = () => Promise.resolve({ recordset: [] });

function formatCurrency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

function buildLastSevenDays(activityRows, taskRows) {
  const activityMap = new Map(
    activityRows.map((row) => [
      new Date(row.BucketDate).toISOString().slice(0, 10),
      toNumber(row.ActivityCount),
    ]),
  );
  const taskMap = new Map(
    taskRows.map((row) => [
      new Date(row.BucketDate).toISOString().slice(0, 10),
      toNumber(row.TaskCount),
    ]),
  );

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));

    const isoDate = date.toISOString().slice(0, 10);

    return {
      date: isoDate,
      label: date.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      }),
      activityCount: activityMap.get(isoDate) || 0,
      tasksCreated: taskMap.get(isoDate) || 0,
    };
  });
}

function getRolePresentation(role) {
  switch (role) {
    case "super_admin":
      return {
        badge: "Executive control tower",
        title: "Super admin intelligence center",
        description:
          "Cross-functional visibility across users, activity, finance, procurement, and task execution with live database-backed metrics.",
        audienceLabel: "Super Admin",
      };
    case "admin":
      return {
        badge: "Operations command center",
        title: "Admin operations dashboard",
        description:
          "Live operational oversight for teams, finance movement, procurement load, and work execution, refreshed from the application database.",
        audienceLabel: "Admin",
      };
    case "dba":
      return {
        badge: "System oversight cockpit",
        title: "DBA reliability and operations view",
        description:
          "Monitor platform activity, operator coverage, work queues, and critical operational signals from one centralized workspace.",
        audienceLabel: "DBA",
      };
    default:
      return {
        badge: "Personal workspace",
        title: "My live work dashboard",
        description:
          "A focused workspace for your tasks, recent activity, due items, and the actions that need your attention today.",
        audienceLabel: "User",
      };
  }
}

function getPermissions(role) {
  const isPrivileged = PRIVILEGED_ROLES.has(role);

  return {
    canViewUsers: isPrivileged,
    canViewActivity: true,
    canViewFinance: isPrivileged,
    canViewProcurement: isPrivileged,
    canViewTasks: true,
    canViewAdminTools: isPrivileged,
    canViewCrm: isPrivileged || role === "marketing_head",
  };
}

function buildQuickActions(role) {
  switch (role) {
    case "super_admin":
      return [
        {
          label: "Admin dashboard",
          detail: "Govern users, rights, and policies",
          path: "/admin/dashboard",
          icon: "shield-check",
        },
        {
          label: "Users",
          detail: "Create and manage accounts",
          path: "/users",
          icon: "users",
        },
        {
          label: "Metrics",
          detail: "Review management analytics",
          path: "/admin/metrics",
          icon: "bar-chart-3",
        },
        {
          label: "Reports",
          detail: "Open standard reporting",
          path: "/reports",
          icon: "file-text",
        },
      ];
    case "admin":
      return [
        {
          label: "Users",
          detail: "Create or update accounts",
          path: "/users",
          icon: "users",
        },
        {
          label: "Payments",
          detail: "Review finance entries",
          path: "/payments",
          icon: "wallet",
        },
        {
          label: "Purchase orders",
          detail: "Check open procurement",
          path: "/material/purchase-order",
          icon: "shopping-cart",
        },
        {
          label: "Tasks",
          detail: "Follow up on pending work",
          path: "/tasks",
          icon: "clipboard-list",
        },
      ];
    case "dba":
      return [
        {
          label: "DBA console",
          detail: "Open database operations tools",
          path: "/dba",
          icon: "database",
        },
        {
          label: "Control panel",
          detail: "Review platform controls",
          path: "/dba/control-panel",
          icon: "settings-2",
        },
        {
          label: "Activity browser",
          detail: "Inspect live user events",
          path: "/admin/activity-browser",
          icon: "activity",
        },
        {
          label: "Tasks",
          detail: "Track operational blockers",
          path: "/tasks",
          icon: "clipboard-list",
        },
      ];
    default:
      return [
        {
          label: "My tasks",
          detail: "See assigned and created tasks",
          path: "/tasks",
          icon: "clipboard-list",
        },
        {
          label: "Reports",
          detail: "Open standard reports",
          path: "/reports",
          icon: "file-text",
        },
        {
          label: "Transactions",
          detail: "Continue day-to-day entries",
          path: "/transactions",
          icon: "layout-dashboard",
        },
        {
          label: "Profile",
          detail: "Review your account details",
          path: "/user/profile",
          icon: "user-circle-2",
        },
      ];
  }
}

function buildModules({ role, summary }) {
  switch (role) {
    case "super_admin":
      return [
        {
          key: "users-ready",
          title: "Users ready",
          value: `${summary.activeUsers}/${summary.totalUsers}`,
          description: `${summary.inactiveUsers} inactive accounts parked`,
          tone: summary.inactiveUsers > 0 ? "amber" : "emerald",
          action: "/users",
        },
        {
          key: "activity-24h",
          title: "Activity in 24h",
          value: String(summary.activity24h),
          description: `${summary.activeOperators24h} active operators in last 24h`,
          tone: summary.activity24h === 0 ? "amber" : "sky",
          action: "/admin/activity-browser",
        },
        {
          key: "cash-today",
          title: "Cash posted today",
          value: formatCurrency(summary.paymentAmountToday),
          description: `${summary.paymentsToday} finance entries posted today`,
          tone: "emerald",
          action: "/payments",
        },
        {
          key: "open-pos",
          title: "Open PO exposure",
          value: formatCurrency(summary.openPOValue),
          description: `${summary.openPOs} purchase orders still open`,
          tone: summary.openPOs > 0 ? "amber" : "emerald",
          action: "/material/purchase-order",
        },
      ];
    case "admin":
      return [
        {
          key: "task-attention",
          title: "Tasks requiring attention",
          value: String(summary.overdueTasks + summary.dueSoonTasks),
          description: `${summary.overdueTasks} overdue and ${summary.dueSoonTasks} due soon`,
          tone: summary.overdueTasks > 0 ? "rose" : "amber",
          action: "/tasks",
        },
        {
          key: "payments-today",
          title: "Cash posted today",
          value: formatCurrency(summary.paymentAmountToday),
          description: `${summary.paymentsToday} payment entries added`,
          tone: "emerald",
          action: "/payments",
        },
        {
          key: "procurement",
          title: "Procurement load",
          value: String(summary.openPOs),
          description: `${formatCurrency(summary.openPOValue)} still open`,
          tone: summary.openPOs > 0 ? "amber" : "emerald",
          action: "/material/purchase-order",
        },
        {
          key: "users",
          title: "Active users",
          value: String(summary.activeUsers),
          description: `${summary.totalUsers} total users on roster`,
          tone: "sky",
          action: "/users",
        },
      ];
    case "dba":
      return [
        {
          key: "operator-coverage",
          title: "Operator coverage",
          value: String(summary.activeOperators24h),
          description: `${summary.activity24h} actions logged in 24h`,
          tone: summary.activity24h === 0 ? "amber" : "sky",
          action: "/admin/activity-browser",
        },
        {
          key: "work-risk",
          title: "Work risk",
          value: String(summary.overdueTasks),
          description: `${summary.inProgressTasks} tasks still in progress`,
          tone: summary.overdueTasks > 0 ? "rose" : "emerald",
          action: "/tasks",
        },
        {
          key: "finance-watch",
          title: "Pending cheques",
          value: String(summary.pendingCheques),
          description: `${summary.totalPayments} payment rows in register`,
          tone: summary.pendingCheques > 5 ? "amber" : "emerald",
          action: "/payments",
        },
        {
          key: "materials-watch",
          title: "Open PO count",
          value: String(summary.openPOs),
          description: `${summary.grnsToday} GRNs posted today`,
          tone: summary.openPOs > 0 ? "amber" : "emerald",
          action: "/material/purchase-order",
        },
      ];
    default:
      return [
        {
          key: "my-active-tasks",
          title: "My active tasks",
          value: String(summary.openTasks + summary.inProgressTasks),
          description: `${summary.inProgressTasks} in progress right now`,
          tone: summary.openTasks + summary.inProgressTasks > 0 ? "sky" : "emerald",
          action: "/tasks",
        },
        {
          key: "my-overdue",
          title: "My overdue items",
          value: String(summary.overdueTasks),
          description: `${summary.dueSoonTasks} due in the next 3 days`,
          tone: summary.overdueTasks > 0 ? "rose" : "emerald",
          action: "/tasks",
        },
        {
          key: "my-completed",
          title: "Completed by me",
          value: String(summary.closedTasks + summary.reviewedTasks),
          description: `${summary.totalTasks} total tasks in your workspace`,
          tone: "emerald",
          action: "/tasks",
        },
        {
          key: "my-activity",
          title: "My activity in 24h",
          value: String(summary.activity24h),
          description: `${summary.totalActivity} events logged overall`,
          tone: summary.activity24h === 0 ? "amber" : "sky",
          action: "/widgets",
        },
      ];
  }
}

function buildAlerts({ role, isPrivileged, summary }) {
  const alerts = [];

  if (isPrivileged) {
    if (summary.overdueTasks > 0) {
      alerts.push({
        type: "critical",
        score: 95,
        title: "Overdue Tasks",
        description: `${summary.overdueTasks} tasks are overdue across the system`,
        action: "/tasks",
        count: summary.overdueTasks,
      });
    }

    if (summary.pendingCheques > 5) {
      alerts.push({
        type: "warning",
        score: 78,
        title: "Pending Cheques",
        description: `${summary.pendingCheques} cheques are waiting for clearance`,
        action: "/payments",
        count: summary.pendingCheques,
      });
    }

    if (summary.inactiveUsers > 0) {
      alerts.push({
        type: "warning",
        score: 62,
        title: "Inactive Users",
        description: `${summary.inactiveUsers} user accounts are currently inactive`,
        action: "/users",
        count: summary.inactiveUsers,
      });
    }

    if (summary.openPOs > 0) {
      alerts.push({
        type: "info",
        score: 48,
        title: "Open Purchase Orders",
        description: `${summary.openPOs} purchase orders remain open for processing`,
        action: "/material/purchase-order",
        count: summary.openPOs,
      });
    }

    if (summary.crmSlaBreachedTickets > 0) {
      alerts.push({
        type: "critical",
        score: 90,
        title: "CRM SLA Breached",
        description: `${summary.crmSlaBreachedTickets} service tickets are past their SLA due date`,
        action: "/reports",
        count: summary.crmSlaBreachedTickets,
      });
    }

    if (summary.crmOverduePayments > 0) {
      alerts.push({
        type: "warning",
        score: 70,
        title: "CRM Overdue Payments",
        description: `${summary.crmOverduePayments} payment milestones are overdue`,
        action: "/reports",
        count: summary.crmOverduePayments,
      });
    }
  } else {
    if (summary.overdueTasks > 0) {
      alerts.push({
        type: "critical",
        score: 94,
        title: "Your overdue tasks",
        description: `${summary.overdueTasks} assigned items are past due`,
        action: "/tasks",
        count: summary.overdueTasks,
      });
    }

    if (summary.dueSoonTasks > 0) {
      alerts.push({
        type: "warning",
        score: 75,
        title: "Due soon",
        description: `${summary.dueSoonTasks} tasks need attention in the next 3 days`,
        action: "/tasks",
        count: summary.dueSoonTasks,
      });
    }

    if (summary.activity24h === 0) {
      alerts.push({
        type: "info",
        score: 42,
        title: "No activity logged today",
        description: "No personal activity was recorded in the last 24 hours",
        action: "/tasks",
      });
    }

    if (summary.totalTasks === 0) {
      alerts.push({
        type: "info",
        score: 30,
        title: "No task workload yet",
        description: "You currently have no tasks in your workspace",
        action: "/tasks",
      });
    }
  }

  if (alerts.length === 0) {
    alerts.push({
      type: "info",
      score: 10,
      title: isPrivileged ? "System stable" : "Workspace stable",
      description: isPrivileged
        ? "No urgent operational exceptions detected right now"
        : "No urgent personal action items detected right now",
    });
  }

  return alerts.sort((a, b) => b.score - a.score);
}

function buildInsights({ role, isPrivileged, summary, trends }) {
  const insights = [];
  const today = trends.dailyFlow.at(-1);
  const yesterday = trends.dailyFlow.at(-2);

  if (today && yesterday && yesterday.activityCount > 0) {
    const activityChange =
      ((today.activityCount - yesterday.activityCount) / yesterday.activityCount) *
      100;

    insights.push({
      title: isPrivileged ? "System activity trend" : "Your activity trend",
      description: `Activity ${
        activityChange >= 0 ? "increased" : "decreased"
      } by ${Math.abs(activityChange).toFixed(1)}% versus yesterday`,
      change: Number(activityChange.toFixed(1)),
    });
  }

  if (today && yesterday && yesterday.tasksCreated > 0) {
    const taskChange =
      ((today.tasksCreated - yesterday.tasksCreated) / yesterday.tasksCreated) *
      100;

    insights.push({
      title: isPrivileged ? "Task intake trend" : "Task creation trend",
      description: `Task volume ${
        taskChange >= 0 ? "moved up" : "moved down"
      } by ${Math.abs(taskChange).toFixed(1)}% compared with yesterday`,
      change: Number(taskChange.toFixed(1)),
    });
  }

  const completionRate = summary.totalTasks
    ? Math.round(
        ((summary.closedTasks + summary.reviewedTasks) / summary.totalTasks) * 100,
      )
    : 0;

  insights.push({
    title: isPrivileged ? "Task completion health" : "My task completion health",
    description: `${completionRate}% of ${
      isPrivileged ? "tracked tasks are resolved" : "your tracked tasks are resolved"
    }`,
    change: completionRate,
  });

  if (isPrivileged) {
    const readiness = summary.totalUsers
      ? Math.round((summary.activeUsers / summary.totalUsers) * 100)
      : 0;

    insights.push({
      title: role === "dba" ? "Operator availability" : "User readiness",
      description:
        role === "dba"
          ? `${summary.activeOperators24h} operators were active in the last 24 hours`
          : `${readiness}% of registered users are currently active`,
      change: readiness,
    });

    if (summary.openPOs > 0) {
      insights.push({
        title: "Procurement backlog",
        description: `${summary.openPOs} purchase orders remain open with exposure of ${formatCurrency(summary.openPOValue)}`,
      });
    }
  } else {
    const activeTaskLoad = summary.openTasks + summary.inProgressTasks;

    insights.push({
      title: "Current focus",
      description:
        activeTaskLoad > 0
          ? `You have ${activeTaskLoad} active tasks in your queue right now`
          : "Your queue is clear right now with no active tasks pending",
    });
  }

  return insights.slice(0, 4);
}

router.get("/catalog", async (_req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        WidgetKey AS [key],
        Label AS label,
        IconKey AS iconKey,
        Category AS category,
        ISNULL(Description, '') AS description,
        SortOrder AS sortOrder,
        CAST(IsActive AS bit) AS isActive
      FROM dbo.WidgetCatalog
      WHERE IsActive = 1
      ORDER BY SortOrder ASC, Label ASC
    `);

    return res.json(result.recordset);
  } catch (error) {
    console.error("Widget catalog error:", error.message);
    return res.status(500).json({ error: "Failed to load widget catalog" });
  }
});

router.get("/", async (req, res) => {
  const role = req.user?.role || "user";
  const userId = Number(req.user?.userId || 0);
  const isPrivileged = PRIVILEGED_ROLES.has(role);
  const isCrmVisible = isPrivileged || role === "marketing_head";
  const cacheKey = `widgets:${role}:${userId || "session"}`;

  try {
    try {
      const cached = await redisGet(cacheKey);
      if (cached) {
        return res.json(JSON.parse(cached));
      }
    } catch (cacheReadError) {
      console.warn("Widgets cache read failed:", cacheReadError.message);
    }

    const pool = getPool();
    const scopedRequest = () => pool.request().input("UserId", sql.Int, userId);

    const [
      userStatsResult,
      activityStatsResult,
      financeStatsResult,
      procurementStatsResult,
      taskStatsResult,
      recentUsersResult,
      recentActivityResult,
      recentTasksResult,
      recentPaymentsResult,
      recentPurchaseOrdersResult,
      recentGrnsResult,
      activityTrendResult,
      taskTrendResult,
      crmStatsResult,
    ] = await Promise.all([
      isPrivileged
        ? pool.request().query(`
            SELECT
              COUNT(*) AS TotalUsers,
              SUM(CASE WHEN ISNULL(discontinue, 0) = 0 THEN 1 ELSE 0 END) AS ActiveUsers,
              SUM(CASE WHEN ISNULL(discontinue, 0) = 1 THEN 1 ELSE 0 END) AS InactiveUsers
            FROM dbo.users
          `)
        : emptyResult({
            TotalUsers: 0,
            ActiveUsers: 0,
            InactiveUsers: 0,
          }),

      isPrivileged
        ? pool.request().query(`
            SELECT
              COUNT(*) AS TotalActivity,
              SUM(CASE WHEN CreatedAt >= DATEADD(HOUR, -24, GETDATE()) THEN 1 ELSE 0 END) AS Activity24h,
              COUNT(DISTINCT CASE WHEN CreatedAt >= DATEADD(HOUR, -24, GETDATE()) THEN UserId END) AS ActiveOperators24h
            FROM dbo.UserActivityLog
          `)
        : scopedRequest().query(`
            SELECT
              COUNT(*) AS TotalActivity,
              SUM(CASE WHEN CreatedAt >= DATEADD(HOUR, -24, GETDATE()) THEN 1 ELSE 0 END) AS Activity24h,
              CASE
                WHEN SUM(CASE WHEN CreatedAt >= DATEADD(HOUR, -24, GETDATE()) THEN 1 ELSE 0 END) > 0
                THEN 1
                ELSE 0
              END AS ActiveOperators24h
            FROM dbo.UserActivityLog
            WHERE UserId = @UserId
          `),

      isPrivileged
        ? pool.request().query(`
            SELECT
              (SELECT COUNT(*) FROM dbo.NewPayment) AS TotalPayments,
              (SELECT COUNT(*) FROM dbo.NewPayment WHERE CAST(PDate AS DATE) = CAST(GETDATE() AS DATE)) AS PaymentsToday,
              (SELECT ISNULL(SUM(PAmount), 0) FROM dbo.NewPayment) AS PaymentAmountTotal,
              (
                SELECT ISNULL(SUM(CASE WHEN CAST(PDate AS DATE) = CAST(GETDATE() AS DATE) THEN PAmount ELSE 0 END), 0)
                FROM dbo.NewPayment
              ) AS PaymentAmountToday,
              (
                SELECT COUNT(*)
                FROM dbo.ChequeMaster
                WHERE Status IN ('Draft','Pending') OR Status IS NULL
              ) AS PendingCheques,
              (SELECT COUNT(*) FROM dbo.AccountHeadMaster WHERE LHeadType = 'S') AS SupplierCount,
              (SELECT COUNT(*) FROM dbo.AccountHeadMaster WHERE LHeadType = 'C') AS CustomerCount,
              (
                SELECT COUNT(*)
                FROM dbo.AccountHeadMaster
                WHERE LHeadType = 'GL' AND ISNULL(LHeadStatus, '') != ''
              ) AS LedgerCount
          `)
        : emptyResult({
            TotalPayments: 0,
            PaymentsToday: 0,
            PaymentAmountTotal: 0,
            PaymentAmountToday: 0,
            PendingCheques: 0,
            SupplierCount: 0,
            CustomerCount: 0,
            LedgerCount: 0,
          }),

      isPrivileged
        ? pool.request().query(`
            SELECT
              (SELECT COUNT(*) FROM dbo.PurchaseOrders) AS TotalPOs,
              (
                SELECT COUNT(*)
                FROM dbo.PurchaseOrders
                WHERE ISNULL(Status, '') != 'Closed'
              ) AS OpenPOs,
              (
                SELECT ISNULL(SUM(CASE WHEN ISNULL(Status, '') != 'Closed' THEN TotalAmount ELSE 0 END), 0)
                FROM dbo.PurchaseOrders
              ) AS OpenPOValue,
              (
                SELECT COUNT(*)
                FROM dbo.GoodsReceiptNotes
                WHERE YEAR(GRNDate) = YEAR(GETDATE())
                  AND MONTH(GRNDate) = MONTH(GETDATE())
              ) AS GrnsThisMonth,
              (
                SELECT COUNT(*)
                FROM dbo.GoodsReceiptNotes
                WHERE CAST(GRNDate AS DATE) = CAST(GETDATE() AS DATE)
              ) AS GrnsToday,
              (SELECT COUNT(*) FROM dbo.WorkOrderHeader) AS TotalWorkOrders
          `)
        : emptyResult({
            TotalPOs: 0,
            OpenPOs: 0,
            OpenPOValue: 0,
            GrnsThisMonth: 0,
            GrnsToday: 0,
            TotalWorkOrders: 0,
          }),

      isPrivileged
        ? pool.request().query(`
            SELECT
              COUNT(*) AS TotalTasks,
              SUM(CASE WHEN Status = 'open' THEN 1 ELSE 0 END) AS OpenTasks,
              SUM(CASE WHEN Status = 'in_progress' THEN 1 ELSE 0 END) AS InProgressTasks,
              SUM(CASE WHEN Status = 'closed' THEN 1 ELSE 0 END) AS ClosedTasks,
              SUM(CASE WHEN Status = 'reviewed' THEN 1 ELSE 0 END) AS ReviewedTasks,
              SUM(
                CASE
                  WHEN Status IN ('open', 'in_progress')
                    AND DueDate IS NOT NULL
                    AND CAST(DueDate AS DATE) < CAST(GETDATE() AS DATE)
                  THEN 1
                  ELSE 0
                END
              ) AS OverdueTasks,
              SUM(
                CASE
                  WHEN Status IN ('open', 'in_progress')
                    AND DueDate IS NOT NULL
                    AND CAST(DueDate AS DATE) BETWEEN CAST(GETDATE() AS DATE) AND DATEADD(DAY, 3, CAST(GETDATE() AS DATE))
                  THEN 1
                  ELSE 0
                END
              ) AS DueSoonTasks
            FROM dbo.Tasks
          `)
        : scopedRequest().query(`
            SELECT
              COUNT(*) AS TotalTasks,
              SUM(CASE WHEN Status = 'open' THEN 1 ELSE 0 END) AS OpenTasks,
              SUM(CASE WHEN Status = 'in_progress' THEN 1 ELSE 0 END) AS InProgressTasks,
              SUM(CASE WHEN Status = 'closed' THEN 1 ELSE 0 END) AS ClosedTasks,
              SUM(CASE WHEN Status = 'reviewed' THEN 1 ELSE 0 END) AS ReviewedTasks,
              SUM(
                CASE
                  WHEN Status IN ('open', 'in_progress')
                    AND DueDate IS NOT NULL
                    AND CAST(DueDate AS DATE) < CAST(GETDATE() AS DATE)
                  THEN 1
                  ELSE 0
                END
              ) AS OverdueTasks,
              SUM(
                CASE
                  WHEN Status IN ('open', 'in_progress')
                    AND DueDate IS NOT NULL
                    AND CAST(DueDate AS DATE) BETWEEN CAST(GETDATE() AS DATE) AND DATEADD(DAY, 3, CAST(GETDATE() AS DATE))
                  THEN 1
                  ELSE 0
                END
              ) AS DueSoonTasks
            FROM dbo.Tasks
            WHERE AssignedTo = @UserId OR CreatedBy = @UserId
          `),

      isPrivileged
        ? pool.request().query(`
            SELECT TOP 5
              u.id,
              u.name,
              u.email,
              u.created_datetime,
              u.discontinue,
              r.RName AS roleName
            FROM dbo.users u
            LEFT JOIN dbo.Role r ON r.RId = u.RoleId
            ORDER BY u.created_datetime DESC, u.id DESC
          `)
        : emptyListResult(),

      isPrivileged
        ? pool.request().query(`
            SELECT TOP 8
              Id,
              UserName,
              UserRole,
              EventType,
              ActionType,
              Resource,
              Details,
              CreatedAt
            FROM dbo.UserActivityLog
            ORDER BY CreatedAt DESC
          `)
        : scopedRequest().query(`
            SELECT TOP 8
              Id,
              UserName,
              UserRole,
              EventType,
              ActionType,
              Resource,
              Details,
              CreatedAt
            FROM dbo.UserActivityLog
            WHERE UserId = @UserId
            ORDER BY CreatedAt DESC
          `),

      isPrivileged
        ? pool.request().query(`
            SELECT TOP 6
              t.Id,
              t.Title,
              t.Priority,
              t.Status,
              t.DueDate,
              t.CreatedAt,
              au.name AS AssignedToName,
              cu.name AS CreatedByName
            FROM dbo.Tasks t
            LEFT JOIN dbo.users au ON au.id = t.AssignedTo
            LEFT JOIN dbo.users cu ON cu.id = t.CreatedBy
            ORDER BY t.CreatedAt DESC
          `)
        : scopedRequest().query(`
            SELECT TOP 6
              t.Id,
              t.Title,
              t.Priority,
              t.Status,
              t.DueDate,
              t.CreatedAt,
              au.name AS AssignedToName,
              cu.name AS CreatedByName
            FROM dbo.Tasks t
            LEFT JOIN dbo.users au ON au.id = t.AssignedTo
            LEFT JOIN dbo.users cu ON cu.id = t.CreatedBy
            WHERE t.AssignedTo = @UserId OR t.CreatedBy = @UserId
            ORDER BY t.CreatedAt DESC
          `),

      isPrivileged
        ? pool.request().query(`
            SELECT TOP 5
              PPaymentID,
              PPaymentName,
              PMode,
              PAmount,
              PDate,
              PCreatedAt
            FROM dbo.NewPayment
            ORDER BY PCreatedAt DESC
          `)
        : emptyListResult(),

      isPrivileged
        ? pool.request().query(`
            SELECT TOP 5
              po.PurchaseOrderID,
              po.PurchaseOrderNo,
              po.PODate,
              po.TotalAmount,
              po.Status,
              ah.LHeadName AS SupplierName
            FROM dbo.PurchaseOrders po
            LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = po.SupplierID
            ORDER BY po.PurchaseOrderID DESC
          `)
        : emptyListResult(),

      isPrivileged
        ? pool.request().query(`
            SELECT TOP 5
              grn.GRNID,
              grn.GRNNo,
              grn.GRNDate,
              grn.Status,
              supplier.LHeadName AS SupplierName
            FROM dbo.GoodsReceiptNotes grn
            LEFT JOIN dbo.AccountHeadMaster supplier ON supplier.LHeadId = grn.SupplierID
            ORDER BY grn.GRNID DESC
          `)
        : emptyListResult(),

      isPrivileged
        ? pool.request().query(`
            SELECT
              CAST(CreatedAt AS DATE) AS BucketDate,
              COUNT(*) AS ActivityCount
            FROM dbo.UserActivityLog
            WHERE CreatedAt >= DATEADD(DAY, -6, CAST(GETDATE() AS DATE))
            GROUP BY CAST(CreatedAt AS DATE)
            ORDER BY BucketDate ASC
          `)
        : scopedRequest().query(`
            SELECT
              CAST(CreatedAt AS DATE) AS BucketDate,
              COUNT(*) AS ActivityCount
            FROM dbo.UserActivityLog
            WHERE CreatedAt >= DATEADD(DAY, -6, CAST(GETDATE() AS DATE))
              AND UserId = @UserId
            GROUP BY CAST(CreatedAt AS DATE)
            ORDER BY BucketDate ASC
          `),

      isPrivileged
        ? pool.request().query(`
            SELECT
              CAST(CreatedAt AS DATE) AS BucketDate,
              COUNT(*) AS TaskCount
            FROM dbo.Tasks
            WHERE CreatedAt >= DATEADD(DAY, -6, CAST(GETDATE() AS DATE))
            GROUP BY CAST(CreatedAt AS DATE)
            ORDER BY BucketDate ASC
          `)
        : scopedRequest().query(`
            SELECT
              CAST(CreatedAt AS DATE) AS BucketDate,
              COUNT(*) AS TaskCount
            FROM dbo.Tasks
            WHERE CreatedAt >= DATEADD(DAY, -6, CAST(GETDATE() AS DATE))
              AND (AssignedTo = @UserId OR CreatedBy = @UserId)
            GROUP BY CAST(CreatedAt AS DATE)
            ORDER BY BucketDate ASC
          `),

      isCrmVisible
        ? pool.request().query(`
            SELECT
              (SELECT COUNT(*) FROM dbo.SaLead WHERE IsActive = 1) AS TotalLeads,
              (SELECT COUNT(*) FROM dbo.SaLead WHERE IsActive = 1 AND CAST(DateGenerated AS DATE) = CAST(GETDATE() AS DATE)) AS LeadsToday,
              (SELECT COUNT(*) FROM dbo.SaLead WHERE IsActive = 1 AND Status = 'Hot') AS HotLeads,
              (SELECT COUNT(*) FROM dbo.SaCampaign WHERE IsActive = 1 AND Status = 'Active') AS ActiveCampaigns,
              (SELECT COUNT(*) FROM dbo.CrmBooking WHERE IsActive = 1 AND Status NOT IN ('Cancelled', 'Rejected')) AS ActiveCrmBookings,
              (SELECT COUNT(*) FROM dbo.SaLead l WHERE l.IsActive = 1 AND EXISTS (
                SELECT 1 FROM dbo.SaLeadActivity a WHERE a.LeadId = l.Id AND a.NextFollowupDate IS NOT NULL AND a.NextFollowupDate <= CAST(GETDATE() AS DATE)
              )) AS PendingFollowups,
              (SELECT ISNULL(SUM(r.Amount), 0) FROM dbo.CrmPaymentReceipt r WHERE CAST(r.ReceivedDate AS DATE) = CAST(GETDATE() AS DATE)) AS CrmCollectionsToday,
              (SELECT COUNT(*) FROM dbo.CrmPaymentMilestone m WHERE m.Status = 'Pending' AND m.DueDate < CAST(GETDATE() AS DATE)) AS CrmOverduePayments,
              (SELECT COUNT(*) FROM dbo.CrmCancellation WHERE Status = 'Pending') AS CrmPendingCancellations,
              (SELECT COUNT(*) FROM dbo.CrmServiceTicket WHERE Status NOT IN ('Resolved', 'Closed')) AS CrmOpenServiceTickets,
              (SELECT COUNT(*) FROM dbo.CrmServiceTicket WHERE Status NOT IN ('Resolved', 'Closed') AND SlaDueDate IS NOT NULL AND SlaDueDate < GETDATE()) AS CrmSlaBreachedTickets,
              (SELECT COUNT(*) FROM dbo.CrmHandover WHERE Status NOT IN ('Completed')) AS CrmPendingHandovers
          `)
        : pool.request().input("UserId", sql.Int, userId).query(`
            SELECT
              (SELECT COUNT(*) FROM dbo.SaLead WHERE IsActive = 1 AND AssignedSalespersonId = @UserId) AS TotalLeads,
              (SELECT COUNT(*) FROM dbo.SaLead WHERE IsActive = 1 AND AssignedSalespersonId = @UserId AND CAST(DateGenerated AS DATE) = CAST(GETDATE() AS DATE)) AS LeadsToday,
              (SELECT COUNT(*) FROM dbo.SaLead WHERE IsActive = 1 AND AssignedSalespersonId = @UserId AND Status = 'Hot') AS HotLeads,
              0 AS ActiveCampaigns,
              0 AS ActiveCrmBookings,
              (SELECT COUNT(*) FROM dbo.SaLead l WHERE l.IsActive = 1 AND l.AssignedSalespersonId = @UserId AND EXISTS (
                SELECT 1 FROM dbo.SaLeadActivity a WHERE a.LeadId = l.Id AND a.NextFollowupDate IS NOT NULL AND a.NextFollowupDate <= CAST(GETDATE() AS DATE)
              )) AS PendingFollowups,
              0 AS CrmCollectionsToday,
              0 AS CrmOverduePayments,
              0 AS CrmPendingCancellations,
              0 AS CrmOpenServiceTickets,
              0 AS CrmSlaBreachedTickets,
              0 AS CrmPendingHandovers
          `),
    ]);

    const users = userStatsResult.recordset[0] || {};
    const activity = activityStatsResult.recordset[0] || {};
    const finance = financeStatsResult.recordset[0] || {};
    const procurement = procurementStatsResult.recordset[0] || {};
    const tasks = taskStatsResult.recordset[0] || {};
    const crm = crmStatsResult.recordset[0] || {};

    const summary = {
      totalUsers: toNumber(users.TotalUsers),
      activeUsers: toNumber(users.ActiveUsers),
      inactiveUsers: toNumber(users.InactiveUsers),
      totalActivity: toNumber(activity.TotalActivity),
      activity24h: toNumber(activity.Activity24h),
      activeOperators24h: toNumber(activity.ActiveOperators24h),
      totalPayments: toNumber(finance.TotalPayments),
      paymentsToday: toNumber(finance.PaymentsToday),
      paymentAmountTotal: toNumber(finance.PaymentAmountTotal),
      paymentAmountToday: toNumber(finance.PaymentAmountToday),
      pendingCheques: toNumber(finance.PendingCheques),
      supplierCount: toNumber(finance.SupplierCount),
      customerCount: toNumber(finance.CustomerCount),
      ledgerCount: toNumber(finance.LedgerCount),
      totalPOs: toNumber(procurement.TotalPOs),
      openPOs: toNumber(procurement.OpenPOs),
      openPOValue: toNumber(procurement.OpenPOValue),
      grnsThisMonth: toNumber(procurement.GrnsThisMonth),
      grnsToday: toNumber(procurement.GrnsToday),
      totalWorkOrders: toNumber(procurement.TotalWorkOrders),
      totalTasks: toNumber(tasks.TotalTasks),
      openTasks: toNumber(tasks.OpenTasks),
      inProgressTasks: toNumber(tasks.InProgressTasks),
      closedTasks: toNumber(tasks.ClosedTasks),
      reviewedTasks: toNumber(tasks.ReviewedTasks),
      overdueTasks: toNumber(tasks.OverdueTasks),
      dueSoonTasks: toNumber(tasks.DueSoonTasks),
      totalLeads: toNumber(crm.TotalLeads),
      leadsToday: toNumber(crm.LeadsToday),
      hotLeads: toNumber(crm.HotLeads),
      activeCampaigns: toNumber(crm.ActiveCampaigns),
      activeCrmBookings: toNumber(crm.ActiveCrmBookings),
      pendingFollowups: toNumber(crm.PendingFollowups),
      crmCollectionsToday: toNumber(crm.CrmCollectionsToday),
      crmOverduePayments: toNumber(crm.CrmOverduePayments),
      crmPendingCancellations: toNumber(crm.CrmPendingCancellations),
      crmOpenServiceTickets: toNumber(crm.CrmOpenServiceTickets),
      crmSlaBreachedTickets: toNumber(crm.CrmSlaBreachedTickets),
      crmPendingHandovers: toNumber(crm.CrmPendingHandovers),
    };

    const trends = {
      dailyFlow: buildLastSevenDays(
        activityTrendResult.recordset,
        taskTrendResult.recordset,
      ),
    };

    const permissions = getPermissions(role);
    const alerts = buildAlerts({ role, isPrivileged, summary });
    const insights = buildInsights({ role, isPrivileged, summary, trends });
    const experience = getRolePresentation(role);

    const response = {
      generatedAt: new Date().toISOString(),
      experience: {
        badge: experience.badge,
        title: experience.title,
        description: experience.description,
      },
      summary,
      trends,
      recent: {
        users: recentUsersResult.recordset.map((row) => ({
          id: row.id,
          name: row.name,
          email: row.email,
          role: row.roleName || "User",
          createdAt: row.created_datetime,
          discontinue: !!row.discontinue,
        })),
        activity: recentActivityResult.recordset.map((row) => ({
          id: row.Id,
          userName: row.UserName,
          userRole: row.UserRole,
          event: row.EventType,
          actionType: row.ActionType,
          resource: row.Resource,
          details: row.Details,
          createdAt: row.CreatedAt,
        })),
        tasks: recentTasksResult.recordset.map((row) => ({
          id: row.Id,
          title: row.Title,
          priority: row.Priority,
          status: row.Status,
          dueDate: row.DueDate,
          createdAt: row.CreatedAt,
          assignedToName: row.AssignedToName,
          createdByName: row.CreatedByName,
        })),
        payments: recentPaymentsResult.recordset.map((row) => ({
          id: row.PPaymentID,
          name: row.PPaymentName,
          mode: row.PMode,
          amount: toNumber(row.PAmount),
          date: row.PDate,
          createdAt: row.PCreatedAt,
        })),
        purchaseOrders: recentPurchaseOrdersResult.recordset.map((row) => ({
          id: row.PurchaseOrderID,
          number: row.PurchaseOrderNo,
          supplierName: row.SupplierName,
          totalAmount: toNumber(row.TotalAmount),
          status: row.Status,
          date: row.PODate,
        })),
        grns: recentGrnsResult.recordset.map((row) => ({
          id: row.GRNID,
          number: row.GRNNo,
          supplierName: row.SupplierName,
          status: row.Status,
          date: row.GRNDate,
        })),
      },
      alerts,
      insights,
      permissions,
      quickActions: buildQuickActions(role),
      modules: buildModules({ role, summary }),
      meta: {
        cacheTTL: CACHE_TTL_SECONDS,
        role,
        scope: isPrivileged ? "command_center" : "personal_workspace",
        audienceLabel: experience.audienceLabel,
      },
    };

    try {
      await redisSet(cacheKey, JSON.stringify(response), CACHE_TTL_SECONDS);
    } catch (cacheWriteError) {
      console.warn("Widgets cache write failed:", cacheWriteError.message);
    }

    return res.json(response);
  } catch (error) {
    console.error("Widgets command center error:", error.message);
    return res.status(500).json({
      error: "Failed to load widgets dashboard",
    });
  }
});

module.exports = router;





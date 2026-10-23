// Every successful write (POST / PUT / PATCH / DELETE answered 2xx) by a signed-in user goes into
// dbo.UserActivityLog from here, with what was actually done: the record it touched (id and document
// number), the values that were submitted, the page it was done from and the result. The browser used
// to log only "POST /api/expense-booking/3270/post-to-gl", after the fact and only for writes made
// through fetchWithAuth, so what someone had changed could only be worked out by digging through tables.
const crypto = require("crypto");
const { getPool, sql } = require("../db");
const { bumpCacheVersion, redisZIncrBy } = require("../redis");

// Housekeeping writes that are not anyone's work, and POSTs that only look things up (previews, checks, sums).
const SKIP = [
  /^\/api\/user-activity/,
  /^\/api\/home\/usage/,
  /^\/api\/users\/(login|logout|refresh)/,
  /^\/api\/doc-search/,
  /\/(preview|naming-preview|validate|calculate|bulk-search)(\?|$)/,
];

const ACTION = { POST: "create", PUT: "update", PATCH: "update", DELETE: "delete" };
const WEIGHT = { create: 10, update: 8, delete: 15 };

const SECRET = /pass(word)?|token|secret|otp|cvv|pin$|api.?key/i;
const DOC_NO = /(doc(ument)?_?no|docnumber|voucher_?no|bill_?no|invoice_?no|order_?no|po_?no|wo_?no|grn_?no|ref_?no|code)$/i;
const NAME = /^(name|title|.*name)$/i;
const MAX_FIELDS = 40;
const MAX_LINES = 20;
const MAX_VALUE = 120;
const MAX_DETAILS = 12000;

const short = (v) => {
  if (v instanceof Date) return v.toISOString();
  const s = String(v);
  return s.length > MAX_VALUE ? s.slice(0, MAX_VALUE - 1) + "…" : s;
};
const scalar = (v) => v === null || ["string", "number", "boolean"].includes(typeof v) || v instanceof Date;

// The submitted values: plain fields as they are, lists as their lines (each line's plain fields), nested
// objects one level deep. Secrets are masked and empty values left out.
function summarise(body) {
  if (!body || typeof body !== "object") return undefined;
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(body)) {
    if (n >= MAX_FIELDS) {
      out["…"] = `${Object.keys(body).length - n} more fields`;
      break;
    }
    if (v === undefined || v === "" || v === null) continue;
    if (SECRET.test(k)) {
      out[k] = "••••";
    } else if (scalar(v)) {
      out[k] = short(v);
    } else if (Array.isArray(v)) {
      const lines = v.slice(0, MAX_LINES).map((line) =>
        scalar(line)
          ? short(line)
          : Object.fromEntries(Object.entries(line || {}).filter(([lk, lv]) => scalar(lv) && lv !== "" && lv !== null && !SECRET.test(lk)).slice(0, 12).map(([lk, lv]) => [lk, short(lv)])),
      );
      out[k] = v.length > MAX_LINES ? [...lines, `… ${v.length - MAX_LINES} more`] : lines;
    } else if (typeof v === "object") {
      out[k] = Object.fromEntries(Object.entries(v).filter(([lk, lv]) => scalar(lv) && lv !== "" && lv !== null && !SECRET.test(lk)).slice(0, 12).map(([lk, lv]) => [lk, short(lv)]));
    }
    n++;
  }
  return Object.keys(out).length ? out : undefined;
}

// Which record: the id in the URL, else the id the response handed back, plus a document number or name
// from the response or the submitted body.
function identify(path, body, payload) {
  const ids = path.split("/").filter((s) => /^\d+$/.test(s));
  const sources = [payload, payload?.data, payload?.record, payload?.result, body].filter((o) => o && typeof o === "object" && !Array.isArray(o));
  let id = ids.length ? ids[ids.length - 1] : undefined;
  let no;
  let name;
  for (const o of sources) {
    for (const [k, v] of Object.entries(o)) {
      if (!scalar(v) || v === "" || v === null) continue;
      if (id === undefined && /^(id|.*Id|.*_id)$/.test(k) && /^\d+$/.test(String(v))) id = String(v);
      if (no === undefined && DOC_NO.test(k) && typeof v === "string") no = v;
      if (name === undefined && NAME.test(k) && typeof v === "string" && !/user|created|updated|approv/i.test(k)) name = short(v);
    }
  }
  const rec = {};
  if (id !== undefined) rec.id = id;
  if (no) rec.no = no;
  if (name) rec.name = name;
  return Object.keys(rec).length ? rec : undefined;
}

const files = (req) => {
  const list = [...(req.file ? [req.file] : []), ...(Array.isArray(req.files) ? req.files : Object.values(req.files || {}).flat())];
  return list.length ? list.map((f) => f.originalname || f.filename).filter(Boolean) : undefined;
};

async function write(req, res, payload) {
  const u = req.user;
  const actionType = ACTION[req.method];
  const path = (req.originalUrl || req.url).split("?")[0];
  const header = (h) => {
    const v = req.headers[h];
    return typeof v === "string" && v ? v.slice(0, 200) : undefined;
  };
  const details = {
    v: 2,
    from: header("x-page"),
    record: identify(path, req.body, payload),
    fields: summarise(req.body),
    files: files(req),
    message: typeof payload?.message === "string" ? short(payload.message) : undefined,
  };
  let text = JSON.stringify(details);
  if (text.length > MAX_DETAILS) text = JSON.stringify({ ...details, fields: { "…": "too large to record in full" } });

  const ip = (req.ip || req.socket?.remoteAddress || "").replace(/^::ffff:/, "") || "unknown";
  const ua = (req.headers["user-agent"] || "unknown").slice(0, 255);
  const id = crypto.randomUUID();
  const row = {
    id,
    userId: String(u.userId),
    userName: String(u.name || u.email || "Unknown User").slice(0, 100),
    userEmail: u.email ? String(u.email).slice(0, 100) : null,
    userRole: u.role ? String(u.role).slice(0, 50) : null,
    event: "action",
    timestamp: new Date().toISOString(),
    ipAddress: ip,
    deviceInfo: ua,
    actionType,
    resource: path.slice(0, 200),
    details: text,
    sessionId: header("x-session-id")?.slice(0, 50) || null,
    requestMethod: req.method,
    requestUrl: (req.originalUrl || req.url).slice(0, 500),
  };

  await getPool()
    .request()
    .input("id", sql.NVarChar(50), row.id)
    .input("userId", sql.NVarChar(50), row.userId)
    .input("userName", sql.NVarChar(100), row.userName)
    .input("userEmail", sql.NVarChar(100), row.userEmail)
    .input("userRole", sql.NVarChar(50), row.userRole)
    .input("ipAddress", sql.NVarChar(50), row.ipAddress)
    .input("deviceInfo", sql.NVarChar(255), row.deviceInfo)
    .input("actionType", sql.NVarChar(50), row.actionType)
    .input("resource", sql.NVarChar(200), row.resource)
    .input("details", sql.NVarChar(sql.MAX), row.details)
    .input("sessionId", sql.NVarChar(50), row.sessionId)
    .input("requestMethod", sql.NVarChar(10), row.requestMethod)
    .input("requestUrl", sql.NVarChar(500), row.requestUrl)
    .input("createdAt", sql.DateTime2, new Date()).query(`
      INSERT INTO dbo.UserActivityLog (Id, UserId, UserName, UserEmail, UserRole, EventType, IpAddress, DeviceInfo,
        ActionType, Resource, Details, SessionId, RequestMethod, RequestUrl, CreatedAt)
      VALUES (@id, @userId, @userName, @userEmail, @userRole, 'action', @ipAddress, @deviceInfo,
        @actionType, @resource, @details, @sessionId, @requestMethod, @requestUrl, @createdAt)`);

  Promise.resolve(bumpCacheVersion("user-activity")).catch(() => {});
  Promise.resolve(redisZIncrBy("engagement:score", WEIGHT[actionType] || 2, row.userId, 2592000)).catch(() => {});
  try {
    require("../socket").getIo().to("activity-watchers").emit("activity:new", row);
  } catch {
    // Socket not started (scripts, tests) — the row is written all the same.
  }
}

function activityAudit(req, res, next) {
  if (!ACTION[req.method] || req.headers["x-skip-activity-log"] || SKIP.some((rx) => rx.test(req.originalUrl || req.url))) return next();
  let payload;
  const json = res.json.bind(res);
  res.json = (body) => {
    payload = body;
    return json(body);
  };
  res.on("finish", () => {
    // A route sets res.locals.noChange when the request turned out to change nothing (e.g. opening an activity's
    // photos asks the server to carry yesterday's After photos forward, and usually there is nothing to carry).
    if (res.statusCode < 200 || res.statusCode >= 300 || !req.user?.userId || res.locals?.noChange) return;
    write(req, res, payload).catch((err) => console.warn("activityAudit:", err.message));
  });
  next();
}

module.exports = { activityAudit, summarise, identify };

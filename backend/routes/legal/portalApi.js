"use strict";

// API connections for Government Site Links (Setup → Government Site Links), set up in Admin → API Integration.
//   GET  /                admin: every site link with its API settings (the secret only as "saved")
//   PUT  /:linkId          admin: save the settings (a blank secret keeps the saved one)
//   POST /:linkId/test     admin: call it once with sample values
//   GET  /enabled          Legal users: the links whose API is switched on
//   POST /:linkId/fetch    Legal users: call it with a land's details and return what the site answers
// The call is made by the server (the key never reaches the browser), https only, 15 s timeout, answer capped at 200 KB.
// {placeholders} in the URL / body are filled from the land: district, mouza, jlNo, location, lat, lng, rsDag, lrDag,
// rsKhatian, lrKhatian, landCode, enquiryNo.
const express = require("express");
const dns = require("dns").promises;
const https = require("https");
const net = require("net");
const { getPool, sql } = require("../../db");
const { requirePageRight, requireAnyPageRight } = require("../../middleware/requirePageRight");
const apiRateLimit = require("../../middleware/apiRateLimit");

const router = express.Router();
router.use(apiRateLimit);

const ADMIN_PAGE = "api-integration";
const LEGAL_PAGES = ["legal-land-enquiry", "legal-land-master"];
const AUTH_TYPES = ["None", "Header", "Bearer", "Basic"];
const MAX_BYTES = 200 * 1024;
const PLACEHOLDERS = ["district", "mouza", "jlNo", "location", "lat", "lng", "rsDag", "lrDag", "rsKhatian", "lrKhatian", "landCode", "enquiryNo"];

const str = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const tableReady = async (pool) => (await pool.request().query("SELECT OBJECT_ID(N'dbo.LegalPortalApi', N'U') AS id")).recordset[0].id != null;
const notReady = (res) => res.status(503).json({ error: "Portal API is not set up on this server yet (migration 628)" });

const fill = (tpl, vals, encode) => String(tpl || "").replace(/\{(\w+)\}/g, (_, k) => {
  const v = vals[k] == null ? "" : String(vals[k]);
  return encode ? encodeURIComponent(v) : JSON.stringify(v).slice(1, -1);
});

// Server-side request forgery guard. The call goes only to the site the admin saved — placeholders can fill the path and
// query, never change the host — and never to an address inside our own network (loopback, private ranges, link-local
// incl. the cloud metadata address 169.254.169.254, carrier-grade NAT, unique-local / link-local IPv6).
function isInternalIp(ip) {
  const v4 = net.isIPv4(ip) ? ip : (/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip) || [])[1];
  if (v4) {
    const [a, b] = v4.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || a >= 224;
  }
  const x = ip.toLowerCase();
  return x === "::" || x === "::1" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe80");
}
// Looks the name up once and returns the address to connect to — only if every address it resolves to is public.
async function resolvePublic(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "");
  const inside = { error: "That address is inside the network and can't be called" };
  if (/^localhost$/i.test(host) || /\.(local|internal|localhost)$/i.test(host)) return inside;
  let addrs;
  try { addrs = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await dns.lookup(host, { all: true }); } catch { return { error: "The site's address could not be found" }; }
  if (!addrs.length || addrs.some((a) => isInternalIp(a.address))) return inside;
  return { address: addrs[0].address, family: addrs[0].family };
}
const publicHostError = async (hostname) => (await resolvePublic(hostname)).error || null;

// The HTTPS call made to the address resolvePublic checked — not a fresh lookup — so a name that changes to an
// internal address between the check and the call (DNS rebinding) can't redirect it. The certificate is still
// verified against the site's own name. No redirects are followed; the answer is capped at MAX_BYTES.
function pinnedRequest(u, { method, headers, body }, addr) {
  return new Promise((resolve) => {
    const host = u.hostname.replace(/^\[|\]$/g, "");
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
    const req = https.request({
      protocol: "https:",
      hostname: host,
      port: u.port || 443,
      path: `${u.pathname}${u.search}`,
      method,
      headers: body ? { ...headers, "Content-Length": Buffer.byteLength(body) } : headers,
      servername: net.isIP(host) ? undefined : host,
      lookup: (_name, opts, cb) => (opts && opts.all ? cb(null, [{ address: addr.address, family: addr.family }]) : cb(null, addr.address, addr.family)),
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) {
        res.destroy();
        return done({ error: "The site tried to send the call to another address — redirects aren't followed" });
      }
      const chunks = [];
      let size = 0;
      let truncated = false;
      res.on("data", (c) => {
        if (truncated) return;
        size += c.length;
        chunks.push(c);
        if (size > MAX_BYTES) { truncated = true; res.destroy(); done({ status: res.statusCode, buf: Buffer.concat(chunks), truncated }); }
      });
      res.on("end", () => done({ status: res.statusCode, buf: Buffer.concat(chunks), truncated }));
      res.on("error", (e) => done({ error: `Could not read the site's answer (${e.message})` }));
    });
    const timer = setTimeout(() => { req.destroy(); done({ error: "The site did not answer within 15 seconds" }); }, 15000);
    req.on("error", (e) => done({ error: `Could not reach the site (${e.message})` }));
    if (body) req.write(body);
    req.end();
  });
}

// The saved template's own site address (scheme to the first / ? #); null when a placeholder sits in it.
const templateHost = (tpl) => {
  const raw = (/^https:\/\/([^/?#]*)/i.exec(String(tpl || "")) || [])[1];
  if (!raw || raw.includes("{")) return null;
  try { return new URL(`https://${raw}`).host.toLowerCase(); } catch { return null; }
};

async function callPortal(cfg, vals) {
  const url = fill(cfg.UrlTemplate, vals, true);
  let u;
  try { u = new URL(url); } catch { return { error: "The API URL is not valid" }; }
  if (u.protocol !== "https:") return { error: "Only https API addresses are allowed" };
  // Placeholders may not change which site is called.
  const pinned = templateHost(cfg.UrlTemplate);
  if (!pinned || u.host.toLowerCase() !== pinned) return { error: "Placeholders can only be used in the path or query of the API URL, not in the site address" };
  const addr = await resolvePublic(u.hostname);
  if (addr.error) return { error: addr.error };
  const headers = { Accept: "application/json, text/plain, */*" };
  if (cfg.AuthType === "Header" && cfg.AuthHeader && cfg.Secret) headers[cfg.AuthHeader] = cfg.Secret;
  if (cfg.AuthType === "Bearer" && cfg.Secret) headers.Authorization = `Bearer ${cfg.Secret}`;
  if (cfg.AuthType === "Basic") headers.Authorization = `Basic ${Buffer.from(`${cfg.Username || ""}:${cfg.Secret || ""}`).toString("base64")}`;
  const method = cfg.Method === "POST" ? "POST" : "GET";
  let body;
  if (method === "POST") { headers["Content-Type"] = "application/json"; body = fill(cfg.BodyTemplate || "{}", vals, false); }
  const started = Date.now();
  const r = await pinnedRequest(u, { method, headers, body }, addr);
  if (r.error) return { error: r.error };
  const textBody = r.buf.subarray(0, MAX_BYTES).toString("utf8");
  let data = null;
  try { data = JSON.parse(textBody); } catch { /* not JSON */ }
  const ok = r.status >= 200 && r.status < 300;
  return { sourceUrl: `${u.origin}${u.pathname}`, status: r.status, ok, ms: Date.now() - started, truncated: r.truncated, data, text: data == null ? textBody : null };
}

router.get("/", requirePageRight(ADMIN_PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    const ready = await tableReady(pool);
    const r = await pool.request().query(`
      SELECT l.LinkId, l.LinkLabel, l.ServiceType, l.Url, l.IsActive${ready ? `,
             a.IsEnabled, a.Method, a.UrlTemplate, a.AuthType, a.AuthHeader, a.Username, a.BodyTemplate, a.UpdatedAt,
             CAST(CASE WHEN a.Secret IS NULL OR a.Secret = N'' THEN 0 ELSE 1 END AS BIT) AS HasSecret,
             (SELECT name FROM dbo.users WHERE id = a.UpdatedBy) AS UpdatedByName` : ""}
      FROM dbo.LegalPortalLink l${ready ? " LEFT JOIN dbo.LegalPortalApi a ON a.LinkId = l.LinkId" : ""}
      ORDER BY l.LinkLabel`);
    res.json({ ready, placeholders: PLACEHOLDERS, links: r.recordset });
  } catch (err) {
    console.error("[portal-api] list:", err.message);
    res.status(500).json({ error: "Could not load the site links" });
  }
});

router.put("/:linkId", requirePageRight(ADMIN_PAGE, "edit"), async (req, res) => {
  const linkId = Number(req.params.linkId);
  if (!Number.isInteger(linkId) || linkId <= 0) return res.status(400).json({ error: "Invalid link" });
  const b = req.body || {};
  const urlTemplate = str(b.UrlTemplate, 1000);
  const authType = AUTH_TYPES.includes(b.AuthType) ? b.AuthType : "None";
  const method = b.Method === "POST" ? "POST" : "GET";
  if (!urlTemplate || !/^https:\/\//i.test(urlTemplate)) return res.status(400).json({ error: "API URL must start with https://" });
  {
    // The site address itself is fixed: no {placeholders} in it, and not an address inside the network.
    const host = templateHost(urlTemplate);
    if (!host) return res.status(400).json({ error: "Placeholders can only be used in the path or query of the API URL, not in the site address" });
    const hostErr = await publicHostError(new URL(`https://${host}`).hostname);
    if (hostErr) return res.status(400).json({ error: hostErr });
  }
  if (authType === "Header" && !str(b.AuthHeader, 100)) return res.status(400).json({ error: "Enter the header name for the key (e.g. x-api-key)" });
  if (b.BodyTemplate && method === "POST") {
    try { JSON.parse(fill(b.BodyTemplate, {}, false)); } catch { return res.status(400).json({ error: "The request body must be valid JSON" }); }
  }
  try {
    const pool = getPool();
    if (!(await tableReady(pool))) return notReady(res);
    const exists = (await pool.request().input("L", sql.Int, linkId).query("SELECT 1 AS x FROM dbo.LegalPortalLink WHERE LinkId = @L")).recordset.length;
    if (!exists) return res.status(404).json({ error: "Site link not found" });
    const secret = str(b.Secret, 1000);
    await pool.request()
      .input("L", sql.Int, linkId).input("En", sql.Bit, b.IsEnabled ? 1 : 0).input("M", sql.NVarChar(10), method)
      .input("U", sql.NVarChar(1000), urlTemplate).input("A", sql.NVarChar(20), authType)
      .input("H", sql.NVarChar(100), str(b.AuthHeader, 100)).input("Un", sql.NVarChar(200), str(b.Username, 200))
      .input("S", sql.NVarChar(1000), secret).input("ClearS", sql.Bit, authType === "None" ? 1 : 0)
      .input("B", sql.NVarChar(4000), str(b.BodyTemplate, 4000)).input("By", sql.Int, req.user?.userId || null)
      .query(`
        MERGE dbo.LegalPortalApi AS t USING (SELECT @L AS LinkId) AS s ON t.LinkId = s.LinkId
        WHEN MATCHED THEN UPDATE SET IsEnabled = @En, Method = @M, UrlTemplate = @U, AuthType = @A, AuthHeader = @H, Username = @Un,
          Secret = CASE WHEN @ClearS = 1 THEN NULL ELSE COALESCE(@S, t.Secret) END, BodyTemplate = @B, UpdatedBy = @By, UpdatedAt = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT (LinkId, IsEnabled, Method, UrlTemplate, AuthType, AuthHeader, Username, Secret, BodyTemplate, UpdatedBy)
          VALUES (@L, @En, @M, @U, @A, @H, @Un, CASE WHEN @ClearS = 1 THEN NULL ELSE @S END, @B, @By);`);
    res.json({ message: "API settings saved" });
  } catch (err) {
    console.error("[portal-api] save:", err.message);
    res.status(500).json({ error: "Could not save the API settings" });
  }
});

const loadCfg = async (pool, linkId, enabledOnly) => (await pool.request().input("L", sql.Int, linkId).query(`
  SELECT a.*, l.LinkLabel FROM dbo.LegalPortalApi a JOIN dbo.LegalPortalLink l ON l.LinkId = a.LinkId
  WHERE a.LinkId = @L${enabledOnly ? " AND a.IsEnabled = 1 AND l.IsActive = 1" : ""}`)).recordset[0];

router.post("/:linkId/test", requirePageRight(ADMIN_PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await tableReady(pool))) return notReady(res);
    const cfg = await loadCfg(pool, Number(req.params.linkId), false);
    if (!cfg) return res.status(404).json({ error: "Save the API settings first" });
    const out = await callPortal(cfg, req.body?.values || {});
    if (out.error) return res.status(502).json(out);
    res.json(out);
  } catch (err) {
    console.error("[portal-api] test:", err.message);
    res.status(500).json({ error: "Test failed" });
  }
});

router.get("/enabled", requireAnyPageRight(LEGAL_PAGES, "view"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await tableReady(pool))) return res.json([]);
    const r = await pool.request().query(`
      SELECT a.LinkId, l.LinkLabel, l.ServiceType FROM dbo.LegalPortalApi a JOIN dbo.LegalPortalLink l ON l.LinkId = a.LinkId
      WHERE a.IsEnabled = 1 AND l.IsActive = 1 ORDER BY l.LinkLabel`);
    res.json(r.recordset);
  } catch (err) {
    console.error("[portal-api] enabled:", err.message);
    res.status(500).json({ error: "Could not load the connected sites" });
  }
});

router.post("/:linkId/fetch", requireAnyPageRight(LEGAL_PAGES, "view"), async (req, res) => {
  const v = req.body?.values || {};
  const values = Object.fromEntries(PLACEHOLDERS.map((k) => [k, v[k] == null ? "" : String(v[k]).slice(0, 200)]));
  try {
    const pool = getPool();
    if (!(await tableReady(pool))) return notReady(res);
    const cfg = await loadCfg(pool, Number(req.params.linkId), true);
    if (!cfg) return res.status(404).json({ error: "This site's API is not switched on (Admin → API Integration)" });
    const out = await callPortal(cfg, values);
    if (out.error) return res.status(502).json(out);
    res.json({ site: cfg.LinkLabel, ...out });
  } catch (err) {
    console.error("[portal-api] fetch:", err.message);
    res.status(500).json({ error: "Could not fetch from the site" });
  }
});

module.exports = router;

/**
 * Sends Email / SMS / WhatsApp through the provider settings saved on the
 * Communicator setup pages (dbo.CommunicatorConfig, channels "email", "sms",
 * "whatsapp"). A channel only sends when its settings are complete and its
 * "active" switch is on; otherwise send() resolves { ok: false, skipped: true }.
 */
const axios = require("axios");
const nodemailer = require("nodemailer");
const { getPool, sql } = require("../db");

const TIMEOUT_MS = 15_000;

const REQUIRED = {
  email: ["smtpHost", "smtpPort", "fromEmail"],
  sms: ["apiUrl", "apiKey", "senderId"],
  whatsapp: ["apiUrl", "accessToken", "phoneNumberId"],
};

async function loadConfig(channel) {
  const result = await getPool()
    .request()
    .input("Channel", sql.NVarChar(50), channel)
    .query("SELECT ConfigJson, IsActive FROM dbo.CommunicatorConfig WHERE Channel = @Channel");
  const row = result.recordset[0];
  if (!row || !row.IsActive) return null;
  try {
    return JSON.parse(row.ConfigJson || "{}");
  } catch {
    return null;
  }
}

/** Which settings a channel is missing, or [] when it can send. */
const missingFields = (channel, config) => (REQUIRED[channel] || []).filter((k) => !String(config?.[k] ?? "").trim());

// Indian numbers stored as 10 digits get the 91 country code most gateways expect.
const toIntlNumber = (mobile) => {
  const digits = String(mobile || "").replace(/\D/g, "");
  return digits.length === 10 ? `91${digits}` : digits;
};

async function sendEmail(config, { to, subject, text }) {
  const port = Number(config.smtpPort);
  const transport = nodemailer.createTransport({
    host: config.smtpHost,
    port,
    secure: String(config.encryption).toLowerCase() === "ssl" || port === 465,
    requireTLS: String(config.encryption).toLowerCase() === "tls",
    auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPassword || "" } : undefined,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
  });
  const from = config.fromName ? `"${String(config.fromName).replace(/"/g, "")}" <${config.fromEmail}>` : config.fromEmail;
  const info = await transport.sendMail({ from, to, subject, text });
  return { id: info.messageId };
}

/**
 * SMS gateways differ, so the saved API URL decides the shape:
 * - with {to} / {message} placeholders (also {sender}, {apiKey}) it is called as a GET with them filled in;
 * - otherwise it gets a JSON POST of { to, message, sender }, with the key as a Bearer token and an authkey header.
 */
async function sendSms(config, { to, text }) {
  const number = toIntlNumber(to);
  if (/\{(to|message)\}/.test(config.apiUrl)) {
    const url = config.apiUrl
      .replace(/\{to\}/g, encodeURIComponent(number))
      .replace(/\{message\}/g, encodeURIComponent(text))
      .replace(/\{sender\}/g, encodeURIComponent(config.senderId))
      .replace(/\{apiKey\}/g, encodeURIComponent(config.apiKey));
    const res = await axios.get(url, { timeout: TIMEOUT_MS });
    return { id: null, response: res.data };
  }
  const res = await axios.post(
    config.apiUrl,
    { to: number, message: text, sender: config.senderId },
    { timeout: TIMEOUT_MS, headers: { Authorization: `Bearer ${config.apiKey}`, authkey: config.apiKey } },
  );
  return { id: null, response: res.data };
}

/** WhatsApp Cloud API text message. Meta only delivers free-form text inside a 24-hour customer-service window. */
async function sendWhatsApp(config, { to, text }) {
  const base = config.apiUrl.endsWith("/") ? config.apiUrl : `${config.apiUrl}/`;
  const res = await axios.post(
    `${base}${config.phoneNumberId}/messages`,
    { messaging_product: "whatsapp", to: toIntlNumber(to), type: "text", text: { body: text } },
    { timeout: TIMEOUT_MS, headers: { Authorization: `Bearer ${config.accessToken}` } },
  );
  return { id: res.data?.messages?.[0]?.id || null };
}

const SENDERS = { email: sendEmail, sms: sendSms, whatsapp: sendWhatsApp };

const errorText = (err) => {
  const data = err?.response?.data;
  const detail = data?.error?.message || data?.message || (typeof data === "string" ? data : null);
  return String(detail || err?.message || "Send failed").slice(0, 300);
};

/**
 * send("email" | "sms" | "whatsapp", { to, subject?, text }, { force })
 * force sends even when the channel's active switch is off (used by "Send test").
 */
async function send(channel, message, { force = false } = {}) {
  const sender = SENDERS[channel];
  if (!sender) return { ok: false, error: `Unknown channel ${channel}` };
  const config = await loadConfig(channel);
  if (!config) return { ok: false, skipped: true, error: "Not set up" };
  const missing = missingFields(channel, config);
  if (missing.length) return { ok: false, skipped: true, error: `Missing ${missing.join(", ")}` };
  if (!config.isActive && !force) return { ok: false, skipped: true, error: "Switched off" };
  try {
    const result = await sender(config, message);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
}

module.exports = { send, loadConfig, missingFields, REQUIRED };

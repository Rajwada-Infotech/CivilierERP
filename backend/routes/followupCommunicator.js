// backend/routes/followupCommunicator.js
// Followup Communicator — Email / SMS / WhatsApp
// Reads channel config from dbo.CommunicatorConfig (same table as main communicator)
// Exposes:
//   POST /api/followup-communicator/send        — ad-hoc send from UI
//   POST /api/followup-communicator/trigger      — internal trigger (booking / welcome call)
//   GET  /api/followup-communicator/logs         — sent log per applicant
//   GET  /api/followup-communicator/logs/:id     — single log entry

const express = require("express");
const router = express.Router();
const nodemailer = require("nodemailer");
const axios = require("axios");
const authMiddleware = require("../middleware/auth");
const { checkPermissionForMethod } = require("../middleware/routePermission");

const PERMISSION_MODULE = "Followup";
const PERMISSION_SUBMODULE = "Communicator";

const rateLimit=require('express-rate-limit');router.use(rateLimit({windowMs:15*60*1000,max:50,validate:false}));router.use(authMiddleware);
router.use(checkPermissionForMethod(PERMISSION_MODULE, PERMISSION_SUBMODULE));

// ─── helpers ──────────────────────────────────────────────────────────────────

async function getConfig(pool, channel) {
  const result = await pool
    .request()
    .input("Channel", channel)
    .query(
      `SELECT TOP 1 ConfigJson, IsActive
       FROM dbo.CommunicatorConfig
       WHERE Channel = @Channel`,
    );
  if (!result.recordset.length) return null;
  const row = result.recordset[0];
  if (!row.IsActive) return null;
  try {
    return JSON.parse(row.ConfigJson);
  } catch {
    return null;
  }
}

async function logMessage(
  pool,
  {
    applicantId,
    bookingId,
    channel,
    recipient,
    subject,
    body,
    status,
    errorMessage,
    sentBy,
  },
) {
  await pool
    .request()
    .input("ApplicantId", applicantId ?? null)
    .input("BookingId", bookingId ?? null)
    .input("Channel", channel)
    .input("Recipient", recipient)
    .input("Subject", subject ?? null)
    .input("Body", body)
    .input("Status", status)
    .input("ErrorMessage", errorMessage ?? null)
    .input("SentBy", sentBy ?? "System")
    .query(
      `INSERT INTO dbo.FollowupCommunicatorLog
         (ApplicantId, BookingId, Channel, Recipient, Subject, Body,
          Status, ErrorMessage, SentBy, SentAt)
       VALUES
         (@ApplicantId, @BookingId, @Channel, @Recipient, @Subject, @Body,
          @Status, @ErrorMessage, @SentBy, GETDATE())`,
    );
}

// ─── channel senders ──────────────────────────────────────────────────────────

async function sendEmail(config, { to, subject, body }) {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port ?? 587,
    secure: config.secure ?? false,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });
  await transporter.sendMail({
    from: config.from ?? config.user,
    to,
    subject,
    html: body.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/on\w+\s*=/gi,''),
  });
}

async function sendSms(config, { to, body }) {
  // Supports generic REST SMS gateway (Fast2SMS, Msg91, Twilio-compatible)
  // Config keys: apiUrl, apiKey, senderId, method ("GET"|"POST")
  const method = (config.method ?? "POST").toUpperCase();

  if (method === "GET") {
    await axios.get(config.apiUrl, {
      params: {
        authorization: config.apiKey,
        sender_id: config.senderId,
        message: body,
        numbers: to,
        route: config.route ?? "v3",
      },
    });
  } else {
    await axios.post(
      config.apiUrl,
      {
        sender_id: config.senderId,
        message: body,
        numbers: to,
        route: config.route ?? "v3",
      },
      {
        headers: {
          authorization: config.apiKey,
          "Content-Type": "application/json",
        },
      },
    );
  }
}

async function sendWhatsApp(config, { to, body }) {
  // Supports generic WhatsApp Business API (WATI, AiSensy, etc.)
  // Config keys: apiUrl, apiKey, senderNumber
  // Normalise number — strip spaces, ensure +91 prefix for Indian numbers
  const normalised = to
    .replace(/\s+/g, "")
    .replace(/^0/, "+91")
    .replace(/^91/, "+91");

  await axios.post(
    config.apiUrl,
    {
      phone: normalised,
      message: body,
    },
    {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
    },
  );
}

// ─── core dispatch ────────────────────────────────────────────────────────────

async function dispatch(
  pool,
  { channel, recipient, subject, body, applicantId, bookingId, sentBy },
) {
  const cfg = await getConfig(pool, `${channel}-api`);
  if (!cfg) {
    throw new Error(`Channel '${channel}' is not configured or inactive`);
  }

  if (channel === "email") {
    await sendEmail(cfg, { to: recipient, subject, body });
  } else if (channel === "sms") {
    await sendSms(cfg, { to: recipient, body });
  } else if (channel === "whatsapp") {
    await sendWhatsApp(cfg, { to: recipient, body });
  } else {
    throw new Error(`Unknown channel: ${channel}`);
  }

  await logMessage(pool, {
    applicantId,
    bookingId,
    channel,
    recipient,
    subject,
    body,
    status: "Sent",
    sentBy,
  });
}

// ─── welcome message templates ────────────────────────────────────────────────

function buildWelcomeTemplates({
  applicantName,
  projectName,
  unitNo,
  bookingDate,
  contactName,
  contactPhone,
}) {
  const date = bookingDate
    ? new Date(bookingDate).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

  const emailBody = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
      <h2 style="color:#1a5276">Welcome to ${projectName ?? "our project"}!</h2>
      <p>Dear <strong>${applicantName}</strong>,</p>
      <p>We are delighted to confirm your booking for <strong>Unit ${unitNo ?? "—"}</strong>
         on <strong>${date}</strong>.</p>
      <p>Your dedicated relationship manager <strong>${contactName ?? "our team"}</strong>
         ${contactPhone ? `(${contactPhone})` : ""} will reach out to you shortly to guide
         you through the next steps.</p>
      <p>If you have any questions, please feel free to contact us at any time.</p>
      <br/>
      <p>Warm regards,<br/><strong>${projectName ?? "The Team"}</strong></p>
    </div>`;

  const smsBody = `Dear ${applicantName}, your booking for Unit ${unitNo ?? "—"} in ${projectName ?? "our project"} is confirmed on ${date}. Our team will contact you shortly. Welcome aboard!`;

  const waBody = `Hello *${applicantName}* 👋\n\nYour booking for *Unit ${unitNo ?? "—"}* in *${projectName ?? "our project"}* has been confirmed on *${date}*.\n\nYour relationship manager *${contactName ?? "our team"}* ${contactPhone ? `(${contactPhone})` : ""} will get in touch with you soon.\n\nWelcome aboard! 🏠`;

  return { emailBody, smsBody, waBody };
}

// ─── routes ───────────────────────────────────────────────────────────────────

// POST /api/followup-communicator/send
// Body: { channel, recipient, subject?, body, applicantId?, bookingId? }
router.post("/send", async (req, res) => {
  const pool = req.app.locals.db;
  const { channel, recipient, subject, body, applicantId, bookingId } =
    req.body;

  if (!channel || !recipient || !body) {
    return res
      .status(400)
      .json({ error: "channel, recipient, and body are required" });
  }

  try {
    await dispatch(pool, {
      channel,
      recipient,
      subject,
      body,
      applicantId,
      bookingId,
      sentBy: req.body.sentBy ?? "User",
    });
    res.json({ success: true, message: `${channel} sent successfully` });
  } catch (err) {
    // Log failure
    try {
      await logMessage(pool, {
        applicantId,
        bookingId,
        channel,
        recipient,
        subject,
        body,
        status: "Failed",
        errorMessage: err.message,
        sentBy: req.body.sentBy ?? "User",
      });
    } catch (_) {}
    console.error("[followupCommunicator] send error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/followup-communicator/trigger
// Called internally from Bookings / WelcomeCalls after save
// Body: { triggerType: "booking"|"welcomecall", applicantId, bookingId,
//         applicantName, email?, phone?, projectName?, unitNo?, bookingDate?,
//         contactName?, contactPhone? }
router.post("/trigger", async (req, res) => {
  const pool = req.app.locals.db;
  const {
    triggerType,
    applicantId,
    bookingId,
    applicantName,
    email,
    phone,
    projectName,
    unitNo,
    bookingDate,
    contactName,
    contactPhone,
  } = req.body;

  if (!triggerType || !applicantId) {
    return res
      .status(400)
      .json({ error: "triggerType and applicantId are required" });
  }

  const { emailBody, smsBody, waBody } = buildWelcomeTemplates({
    applicantName: applicantName ?? "Customer",
    projectName,
    unitNo,
    bookingDate,
    contactName,
    contactPhone,
  });

  const results = [];

  // Email
  if (email) {
    try {
      await dispatch(pool, {
        channel: "email",
        recipient: email,
        subject: `Welcome to ${projectName ?? "our project"} — Booking Confirmed`,
        body: emailBody,
        applicantId,
        bookingId,
        sentBy: "System",
      });
      results.push({ channel: "email", status: "sent" });
    } catch (err) {
      try {
        await logMessage(pool, {
          applicantId,
          bookingId,
          channel: "email",
          recipient: email,
          subject: `Welcome — Booking Confirmed`,
          body: emailBody,
          status: "Failed",
          errorMessage: err.message,
          sentBy: "System",
        });
      } catch (_) {}
      results.push({ channel: "email", status: "failed", error: err.message });
    }
  }

  // SMS
  if (phone) {
    try {
      await dispatch(pool, {
        channel: "sms",
        recipient: phone,
        body: smsBody,
        applicantId,
        bookingId,
        sentBy: "System",
      });
      results.push({ channel: "sms", status: "sent" });
    } catch (err) {
      try {
        await logMessage(pool, {
          applicantId,
          bookingId,
          channel: "sms",
          recipient: phone,
          body: smsBody,
          status: "Failed",
          errorMessage: err.message,
          sentBy: "System",
        });
      } catch (_) {}
      results.push({ channel: "sms", status: "failed", error: err.message });
    }
  }

  // WhatsApp
  if (phone) {
    try {
      await dispatch(pool, {
        channel: "whatsapp",
        recipient: phone,
        body: waBody,
        applicantId,
        bookingId,
        sentBy: "System",
      });
      results.push({ channel: "whatsapp", status: "sent" });
    } catch (err) {
      try {
        await logMessage(pool, {
          applicantId,
          bookingId,
          channel: "whatsapp",
          recipient: phone,
          body: waBody,
          status: "Failed",
          errorMessage: err.message,
          sentBy: "System",
        });
      } catch (_) {}
      results.push({
        channel: "whatsapp",
        status: "failed",
        error: err.message,
      });
    }
  }

  res.json({ success: true, results });
});

// GET /api/followup-communicator/logs?applicantId=&bookingId=&channel=&status=&page=&limit=
router.get("/logs", async (req, res) => {
  const pool = req.app.locals.db;
  const {
    applicantId,
    bookingId,
    channel,
    status,
    page = 1,
    limit = 50,
  } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let where = "WHERE 1=1";
  const req2 = pool.request();

  if (applicantId) {
    where += " AND ApplicantId = @ApplicantId";
    req2.input("ApplicantId", applicantId);
  }
  if (bookingId) {
    where += " AND BookingId = @BookingId";
    req2.input("BookingId", bookingId);
  }
  if (channel) {
    where += " AND Channel = @Channel";
    req2.input("Channel", channel);
  }
  if (status) {
    where += " AND Status = @Status";
    req2.input("Status", status);
  }

  req2.input("Limit", parseInt(limit));
  req2.input("Offset", offset);

  try {
    const result = await req2.query(
      `SELECT Id, ApplicantId, BookingId, Channel, Recipient, Subject,
              Body, Status, ErrorMessage, SentBy, SentAt
       FROM dbo.FollowupCommunicatorLog
       ${where}
       ORDER BY SentAt DESC
       OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY`,
    );

    const countResult = await pool.request().query(
      `SELECT COUNT(*) AS Total FROM dbo.FollowupCommunicatorLog ${where.replace(
        /@\w+/g,
        (m) => {
          // re-bind not needed for count — just run separate simple count
          return m;
        },
      )}`,
    );
    // Simple approach: just return the rows and let the frontend paginate
    res.json({
      data: result.recordset,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    console.error("[followupCommunicator] logs error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/followup-communicator/logs/:id
router.get("/logs/:id", async (req, res) => {
  const pool = req.app.locals.db;
  try {
    const result = await pool
      .request()
      .input("Id", req.params.id)
      .query(`SELECT * FROM dbo.FollowupCommunicatorLog WHERE Id = @Id`);
    if (!result.recordset.length)
      return res.status(404).json({ error: "Not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

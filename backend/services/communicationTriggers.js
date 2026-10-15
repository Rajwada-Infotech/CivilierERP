const { sql } = require("../db");
const { send } = require("./messageProviders");

// Timeline channel name -> Communicator channel whose saved provider settings send it.
const PROVIDER_CHANNEL = { SMS: "sms", Email: "email", WhatsApp: "whatsapp" };

/**
 * Core engine for triggering automated communications and logging them.
 */
async function sendAutoCommunication(pool, { bookingId, channel, subject, summary, content, toMobile, toEmail, systemUserId = 1 }) {
  try {
    // 1. Send through the provider saved on the Communicator setup page; a channel
    //    that isn't set up or is switched off sends nothing and logs nothing.
    const to = channel === "Email" ? toEmail : toMobile;
    if (!PROVIDER_CHANNEL[channel] || !to) return false;
    const sent = await send(PROVIDER_CHANNEL[channel], { to, subject, text: content });
    if (!sent.ok) {
      if (!sent.skipped) console.error(`[communicationTriggers] ${channel} for booking ${bookingId} failed: ${sent.error}`);
      return false;
    }

    // 2. Log it into the Customer 360 timeline (dbo.CrmCommunicationLog)
    await pool.request()
      .input("bid", sql.Int, bookingId)
      .input("ch", sql.NVarChar(30), channel)
      .input("dir", sql.NVarChar(20), "Outbound")
      .input("subj", sql.NVarChar(300), subject)
      .input("sum", sql.NVarChar(sql.MAX), summary)
      .input("cb", sql.Int, systemUserId) // Usually 1 for "System"
      .query(`
        INSERT INTO dbo.CrmCommunicationLog
          (BookingId, Channel, Direction, Subject, Summary, ContactedAt, CreatedBy, CreatedAt)
        VALUES (@bid, @ch, @dir, @subj, @sum, SYSDATETIME(), @cb, SYSDATETIME())
      `);

    return true;
  } catch (error) {
    console.error(`[communicationTriggers] Failed to send ${channel} for booking ${bookingId}:`, error.message);
    return false;
  }
}

/**
 * Triggered when a booking is Confirmed
 */
async function triggerBookingConfirmed(pool, bookingId, systemUserId = 1) {
  try {
    // Fetch customer details
    const result = await pool.request().input("bid", sql.Int, bookingId).query(`
      SELECT b.BookingNo, a.ApplicantName, a.Mobile, a.Email, u.UnitName, p.name AS ProjectName
      FROM dbo.CrmBooking b
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      JOIN dbo.UnitMaster u ON u.Id = b.UnitId
      JOIN dbo.enterprise p ON p.id = a.ProjectId
      WHERE b.Id = @bid
    `);
    
    if (!result.recordset.length) return;
    const { BookingNo, ApplicantName, Mobile, Email, UnitName, ProjectName } = result.recordset[0];

    const subject = `Booking Confirmed - ${ProjectName} - Unit ${UnitName}`;
    const message = `Dear ${ApplicantName}, your booking ${BookingNo} for unit ${UnitName} in ${ProjectName} has been confirmed. Welcome to the family!`;

    // Send SMS
    if (Mobile) {
      await sendAutoCommunication(pool, {
        bookingId, channel: "SMS", subject,
        summary: "Automated Booking Confirmation SMS sent.",
        content: message, toMobile: Mobile, systemUserId
      });
      // Send WhatsApp
      await sendAutoCommunication(pool, {
        bookingId, channel: "WhatsApp", subject,
        summary: "Automated Booking Confirmation WhatsApp sent.",
        content: message, toMobile: Mobile, systemUserId
      });
    }

    // Send Email
    if (Email) {
      await sendAutoCommunication(pool, {
        bookingId, channel: "Email", subject,
        summary: "Automated Booking Confirmation Email sent.",
        content: message, toEmail: Email, systemUserId
      });
    }
  } catch (error) {
    console.error("[communicationTriggers] triggerBookingConfirmed error:", error.message);
  }
}

/**
 * Triggered when a payment receipt is generated (Payment Received)
 */
async function triggerPaymentReceived(pool, receiptId, systemUserId = 1) {
  try {
    const result = await pool.request().input("rid", sql.Int, receiptId).query(`
      SELECT r.ReceiptNo, r.Amount, r.PaymentMode,
             b.Id AS BookingId, b.BookingNo, 
             a.ApplicantName, a.Mobile, a.Email, u.UnitName
      FROM dbo.CrmPaymentReceipt r
      JOIN dbo.CrmBooking b ON b.Id = r.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      JOIN dbo.UnitMaster u ON u.Id = b.UnitId
      WHERE r.Id = @rid
    `);
    
    if (!result.recordset.length) return;
    const { ReceiptNo, Amount, PaymentMode, BookingId, BookingNo, ApplicantName, Mobile, Email, UnitName } = result.recordset[0];

    const formattedAmount = Number(Amount).toLocaleString("en-IN", { style: "currency", currency: "INR" });
    const subject = `Payment Received - Receipt ${ReceiptNo}`;
    const message = `Dear ${ApplicantName}, we have received your payment of ${formattedAmount} via ${PaymentMode} for booking ${BookingNo} (Unit ${UnitName}). Receipt No: ${ReceiptNo}. Thank you!`;

    if (Mobile) {
      await sendAutoCommunication(pool, {
        bookingId: BookingId, channel: "SMS", subject,
        summary: `Automated Payment Receipt SMS sent for ${formattedAmount}.`,
        content: message, toMobile: Mobile, systemUserId
      });
    }

    if (Email) {
      await sendAutoCommunication(pool, {
        bookingId: BookingId, channel: "Email", subject,
        summary: `Automated Payment Receipt Email sent for ${formattedAmount}.`,
        content: message, toEmail: Email, systemUserId
      });
    }
  } catch (error) {
    console.error("[communicationTriggers] triggerPaymentReceived error:", error.message);
  }
}

/**
 * Triggered when a payment demand is raised
 */
async function triggerPaymentDemand(pool, demandId, systemUserId = 1) {
  try {
    const result = await pool.request().input("did", sql.Int, demandId).query(`
      SELECT d.DemandNo, d.TotalAmountDue, d.DueDate,
             b.Id AS BookingId, b.BookingNo, 
             a.ApplicantName, a.Mobile, a.Email, u.UnitName
      FROM dbo.CrmDemand d
      JOIN dbo.CrmBooking b ON b.Id = d.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      JOIN dbo.UnitMaster u ON u.Id = b.UnitId
      WHERE d.Id = @did
    `);
    
    if (!result.recordset.length) return;
    const { DemandNo, TotalAmountDue, DueDate, BookingId, BookingNo, ApplicantName, Mobile, Email, UnitName } = result.recordset[0];

    const formattedAmount = Number(TotalAmountDue).toLocaleString("en-IN", { style: "currency", currency: "INR" });
    const formattedDate = DueDate ? new Date(DueDate).toLocaleDateString("en-IN") : "immediately";
    const subject = `Payment Demand - ${DemandNo}`;
    const message = `Dear ${ApplicantName}, a payment demand of ${formattedAmount} has been raised for booking ${BookingNo} (Unit ${UnitName}). Please pay by ${formattedDate}. Demand No: ${DemandNo}.`;

    if (Mobile) {
      await sendAutoCommunication(pool, {
        bookingId: BookingId, channel: "SMS", subject,
        summary: `Automated Demand Letter SMS sent for ${formattedAmount}.`,
        content: message, toMobile: Mobile, systemUserId
      });
      await sendAutoCommunication(pool, {
        bookingId: BookingId, channel: "WhatsApp", subject,
        summary: `Automated Demand Letter WhatsApp sent for ${formattedAmount}.`,
        content: message, toMobile: Mobile, systemUserId
      });
    }

    if (Email) {
      await sendAutoCommunication(pool, {
        bookingId: BookingId, channel: "Email", subject,
        summary: `Automated Demand Letter Email sent for ${formattedAmount}.`,
        content: message, toEmail: Email, systemUserId
      });
    }
  } catch (error) {
    console.error("[communicationTriggers] triggerPaymentDemand error:", error.message);
  }
}

module.exports = {
  triggerBookingConfirmed,
  triggerPaymentReceived,
  triggerPaymentDemand
};

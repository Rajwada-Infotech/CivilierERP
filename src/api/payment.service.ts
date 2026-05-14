import { db } from "../config/database";
import { domainEvents, EVENTS } from "../events/domainEvents";
import { generateDocumentNumber } from "./documentRegistry.service";
import { logAudit } from "./audit.service";

export class PaymentService {
  /**
   * Creates a payment inside a strict transactional boundary.
   * If any step fails (e.g., doc generation or audit log), the entire operation rolls back.
   */
  static async createPayment(payload: any, userId: number) {
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // 1. Generate standard document number
      const docInfo = await generateDocumentNumber(connection, {
        companyId: payload.companyId,
        projectId: payload.projectId,
        docTypeId: payload.docTypeId,
        financialYear: payload.tenure,
        transactionTable: 'payments'
      });

      // 2. Insert the actual payment record
      const [result] = await connection.query(
        `INSERT INTO payments (doc_number, amount, supplier_id, status, created_by) VALUES (?, ?, ?, ?, ?)`,
        [docInfo.full_doc_number, payload.amount, payload.supplierId, 'PENDING', userId]
      );

      const paymentId = result.insertId;

      // 3. Write to universal audit log
      await logAudit(connection, {
        tableName: 'payments',
        recordId: paymentId,
        action: 'CREATE',
        performedBy: userId,
      });

      await connection.commit();

      // 4. Emit domain event (Post-Commit) for side effects (Notifications, Webhooks)
      domainEvents.emit(EVENTS.PAYMENT_CREATED, { paymentId, amount: payload.amount });

      return { success: true, paymentId, docNumber: docInfo.full_doc_number };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}
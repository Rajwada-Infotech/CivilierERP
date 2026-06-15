// backend/validation/followupSchemas.js
// Zod schemas for all 10 Followup module write endpoints.
// Usage: validateBody(schemas.bookingCreate) as route middleware.

const { z } = require("zod");

// ── shared primitives ─────────────────────────────────────────────────────────

const positiveInt = z.coerce.number().int().positive();
const optPositiveInt = positiveInt.nullable().optional();
const optDecimal = z.coerce.number().nonnegative().nullable().optional();
const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
  .nullable()
  .optional();
const optStr = z.string().max(500).nullable().optional();

// ── followupApplications ──────────────────────────────────────────────────────

const APPLICATION_STATUS = ["New", "Qualified", "Shortlisted", "Document Pending", "Rejected"];

const applicationBase = z.object({
  ApplicantName:         z.string().min(1, "Applicant name is required").max(200),
  ProjectId:             optPositiveInt,
  CompanyId:             optPositiveInt,
  CustomerId:            optPositiveInt,
  UnitId:                optPositiveInt,
  AssignedTo:            optPositiveInt,
  BudgetAmount:          optDecimal,
  Status:                z.enum(APPLICATION_STATUS).optional().default("New"),
  PrimaryMobile:         z.string().max(20).nullable().optional(),
  Email:                 z.string().email("Invalid email").nullable().optional(),
  PanNumber:             z.string().max(20).nullable().optional(),
  ApplicantAddress:      optStr,
  CoApplicantName:       z.string().max(200).nullable().optional(),
  CoApplicantPhone:      z.string().max(20).nullable().optional(),
  CorrespondenceAddress: optStr,
  ApplicationDate:       dateStr,
  City:                  z.string().max(100).nullable().optional(),
  Source:                z.string().max(100).nullable().optional(),
  PreferredUnitType:     z.string().max(100).nullable().optional(),
  Notes:                 z.string().max(2000).nullable().optional(),
});

exports.applicationCreate = applicationBase;
exports.applicationUpdate = applicationBase.partial().refine(
  (b) => Object.keys(b).length > 0,
  { message: "At least one field required" }
);

// ── followupUnitSelections ────────────────────────────────────────────────────

const UNIT_SELECTION_STATUS = ["Reserved", "Negotiation", "Confirmed", "Released"];

const unitSelectionBase = z.object({
  ApplicantId:    positiveInt,
  ProjectId:      optPositiveInt,
  CompanyId:      optPositiveInt,
  UnitNo:         z.string().min(1, "Unit number is required").max(50),
  AreaSqFt:       optDecimal,
  RatePerSqFt:    optDecimal,
  TotalValue:     optDecimal,
  BookingAmount:  optDecimal,
  Status:         z.enum(UNIT_SELECTION_STATUS).optional().default("Reserved"),
  BlockName:      z.string().max(100).nullable().optional(),
  FloorName:      z.string().max(100).nullable().optional(),
  UnitType:       z.string().max(100).nullable().optional(),
  SelectionDate:  dateStr,
  Notes:          z.string().max(2000).nullable().optional(),
});

exports.unitSelectionCreate = unitSelectionBase;
exports.unitSelectionUpdate = unitSelectionBase.partial().refine(
  (b) => Object.keys(b).length > 0,
  { message: "At least one field required" }
);

// ── followupBookings ──────────────────────────────────────────────────────────

const BOOKING_STATUS = ["Confirmed", "Pending", "Cancelled"];

const bookingBase = z.object({
  ApplicantId:      positiveInt,
  UnitSelectionId:  optPositiveInt,
  ProjectId:        optPositiveInt,
  CompanyId:        optPositiveInt,
  AssignedTo:       optPositiveInt,
  TotalValue:       optDecimal,
  BookingAmount:    z.coerce.number().nonnegative().optional().default(0),
  RatePerSqFt:      optDecimal,
  AreaSqFt:         optDecimal,
  LoanAmount:       optDecimal,
  UnitNo:           z.string().min(1, "UnitNo is required").max(50),
  BookingDate:      z.string().min(1, "BookingDate is required").regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  Status:           z.enum(BOOKING_STATUS).optional().default("Confirmed"),
  BlockName:        z.string().max(100).nullable().optional(),
  FloorName:        z.string().max(100).nullable().optional(),
  UnitType:         z.string().max(100).nullable().optional(),
  PaymentMode:      z.string().max(50).nullable().optional(),
  ChequeNo:         z.string().max(50).nullable().optional(),
  BankName:         z.string().max(200).nullable().optional(),
  LoanBank:         z.string().max(200).nullable().optional(),
  Notes:            z.string().max(2000).nullable().optional(),
});

exports.bookingCreate = bookingBase;
exports.bookingUpdate = bookingBase.partial().refine(
  (b) => Object.keys(b).length > 0,
  { message: "At least one field required" }
);

// ── followupAgreements ────────────────────────────────────────────────────────

const AGREEMENT_STATUS = ["Draft", "Issued", "Signed", "Cancelled"];

const agreementBase = z.object({
  ApplicantId:      positiveInt,
  UnitSelectionId:  optPositiveInt,
  BookingId:        optPositiveInt,
  ProjectId:        optPositiveInt,
  CompanyId:        optPositiveInt,
  AgreementValue:   optDecimal,
  AdvanceAmount:    optDecimal,
  Status:           z.enum(AGREEMENT_STATUS).optional().default("Draft"),
  AgreementDate:    dateStr,
  RegistrationDate: dateStr,
  Notes:            z.string().max(2000).nullable().optional(),
});

exports.agreementCreate = agreementBase;
exports.agreementUpdate = agreementBase.partial().refine(
  (b) => Object.keys(b).length > 0,
  { message: "At least one field required" }
);

// ── followupNoc ───────────────────────────────────────────────────────────────

const NOC_STATUS = ["Pending", "Approved", "Issued", "Rejected"];
const LOAN_SANCTION_STATUS = ["Pending", "Approved", "Rejected", "NA"];
const LOAN_DISBURSEMENT_STATUS = ["Pending", "Partial", "Full", "NA"];
const BANK_NOC_STATUS = ["Pending", "Received", "NA"];

const nocBase = z.object({
  ApplicantId:            positiveInt,
  UnitSelectionId:        optPositiveInt,
  AgreementId:            optPositiveInt,
  ProjectId:              optPositiveInt,
  CompanyId:              optPositiveInt,
  Status:                 z.enum(NOC_STATUS).optional().default("Pending"),
  NOCDate:                dateStr,
  ApprovalDate:           dateStr,
  IssuedDate:             dateStr,
  ApprovedBy:             z.string().max(200).nullable().optional(),
  Reason:                 z.string().max(500).nullable().optional(),
  Notes:                  z.string().max(2000).nullable().optional(),
  BankName:               z.string().max(200).nullable().optional(),
  LoanAccountNo:          z.string().max(100).nullable().optional(),
  LoanAmount:             optDecimal,
  LoanSanctionStatus:     z.enum(LOAN_SANCTION_STATUS).nullable().optional(),
  LoanSanctionDate:       dateStr,
  LoanDisbursementStatus: z.enum(LOAN_DISBURSEMENT_STATUS).nullable().optional(),
  LoanDisbursementDate:   dateStr,
  BankNOCStatus:          z.enum(BANK_NOC_STATUS).nullable().optional(),
  BankNOCDate:            dateStr,
  BankNOCNotes:           z.string().max(500).nullable().optional(),
});

exports.nocCreate = nocBase;
exports.nocUpdate = nocBase.partial().refine(
  (b) => Object.keys(b).length > 0,
  { message: "At least one field required" }
);

// ── followupLegalMilestones ───────────────────────────────────────────────────

const STEP_FIELDS = [
  "DocCollection", "LegalReview", "Drafting",
  "InternalApproval", "DocShared", "MutualAgreement",
  "DirectorMeeting", "FinalExecution",
];
const STEP_STATUS_OPTIONS  = ["Pending", "In Progress", "Completed", "Blocked", "Waived"];
const OVERALL_STATUS_OPTIONS = ["In Progress", "Completed", "On Hold", "Cancelled"];

exports.legalMilestoneCreate = z.object({
  ApplicantId:          positiveInt,
  UnitSelectionId:      optPositiveInt,
  BookingId:            optPositiveInt,
  AgreementId:          optPositiveInt,
  ProjectId:            optPositiveInt,
  CompanyId:            optPositiveInt,
  DocCollectionDue:     dateStr,
  LegalReviewDue:       dateStr,
  DraftingDue:          dateStr,
  InternalApprovalDue:  dateStr,
  DocSharedDue:         dateStr,
  MutualAgreementDue:   dateStr,
  DirectorMeetingDue:   dateStr,
  FinalExecutionDue:    dateStr,
  Notes:                z.string().max(2000).nullable().optional(),
});

exports.legalMilestoneStepUpdate = z.object({
  stepField: z.enum(STEP_FIELDS),
  status:    z.enum(STEP_STATUS_OPTIONS),
  doneDate:  dateStr,
  notes:     z.string().max(2000).nullable().optional(),
});

exports.legalMilestoneUpdate = z.object({
  OverallStatus: z.enum(OVERALL_STATUS_OPTIONS).optional().default("In Progress"),
  CurrentStep:   z.coerce.number().int().min(1).optional(),
  Notes:         z.string().max(2000).nullable().optional(),
});

// ── followupSalesDeed ─────────────────────────────────────────────────────────

const SALES_DEED_STATUS = ["Draft", "Executed", "Registered", "Overdue", "Cancelled"];

const salesDeedBase = z.object({
  ApplicantId:       positiveInt,
  UnitSelectionId:   optPositiveInt,
  AgreementId:       optPositiveInt,
  ProjectId:         optPositiveInt,
  CompanyId:         optPositiveInt,
  DeedValue:         optDecimal,
  StampDuty:         optDecimal,
  RegistrationFee:   optDecimal,
  Status:            z.enum(SALES_DEED_STATUS).optional().default("Draft"),
  SubRegistrarOffice: z.string().max(200).nullable().optional(),
  RegistrationNo:    z.string().max(100).nullable().optional(),
  BookNo:            z.string().max(50).nullable().optional(),
  PartNo:            z.string().max(50).nullable().optional(),
  DeedDate:          dateStr,
  RegistrationDate:  dateStr,
  PossessionDate:    dateStr,
  ExecutedBy:        z.string().max(200).nullable().optional(),
  WitnessNames:      z.string().max(500).nullable().optional(),
  Notes:             z.string().max(2000).nullable().optional(),
});

exports.salesDeedCreate = salesDeedBase;
exports.salesDeedUpdate = salesDeedBase.partial().refine(
  (b) => Object.keys(b).length > 0,
  { message: "At least one field required" }
);

// ── followupHandover ──────────────────────────────────────────────────────────

const HANDOVER_STATUS    = ["Scheduled", "Completed", "Delayed", "Cancelled"];
const CONDITION_OPTIONS  = ["Ready", "Punch-list Pending", "Snagging", "Minor Works"];

const handoverBase = z.object({
  ApplicantId:        positiveInt,
  UnitSelectionId:    optPositiveInt,
  AgreementId:        optPositiveInt,
  SalesDeedId:        optPositiveInt,
  ProjectId:          optPositiveInt,
  CompanyId:          optPositiveInt,
  Status:             z.enum(HANDOVER_STATUS).optional().default("Scheduled"),
  UnitCondition:      z.enum(CONDITION_OPTIONS).nullable().optional(),
  HandoverDate:       dateStr,
  ActualHandoverDate: dateStr,
  KeyHandoverDate:    dateStr,
  SnagListItems:      z.string().max(2000).nullable().optional(),
  SnagsClearedDate:   dateStr,
  HandedOverBy:       z.string().max(200).nullable().optional(),
  ReceivedBy:         z.string().max(200).nullable().optional(),
  WitnessNames:       z.string().max(500).nullable().optional(),
  Notes:              z.string().max(2000).nullable().optional(),
});

exports.handoverCreate = handoverBase;
exports.handoverUpdate = handoverBase.partial().refine(
  (b) => Object.keys(b).length > 0,
  { message: "At least one field required" }
);

// ── followupPayments ──────────────────────────────────────────────────────────

const PAYMENT_MODES = ["Cash", "Cheque", "NEFT", "RTGS", "UPI", "DD"];

exports.paymentRecord = z.object({
  amount:      z.coerce.number().positive("Valid amount is required"),
  paymentMode: z.enum(PAYMENT_MODES, {
    errorMap: () => ({ message: `Payment mode must be one of: ${PAYMENT_MODES.join(", ")}` }),
  }),
  paymentDate: z.string().min(1, "Payment date is required").regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  referenceNo: z.string().max(100).nullable().optional(),
  bankName:    z.string().max(100).nullable().optional(),
  notes:       z.string().max(500).nullable().optional(),
});

// ── followupDemands ───────────────────────────────────────────────────────────

exports.demandRaise = z.object({
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD").nullable().optional(),
  notes:   z.string().max(500).nullable().optional(),
});
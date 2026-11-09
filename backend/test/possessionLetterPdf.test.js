jest.mock("../db", () => ({ sql: {}, getPool: jest.fn() }));
const { renderPossessionLetterBuffer } = require("../services/possessionLetterPdf");

const base = {
  NoticeNo: "PN-2026-00001", Status: "Sent", OfferedDate: "2026-11-09", ResponseDeadline: "2026-11-24", BookingNo: "BKG-1", UnitNo: "A-101", BlockName: "A",
  ProjectFullName: "Test Project", ProjectRera: "RERA-1", ApplicantName: "Test Buyer", CompanyName: "Test Co", RequiredAmount: 100, Collected: 100, CertType: "OC", CertificateNo: "1", CertDate: "2026-10-01", CertAuthority: "Municipal Corporation",
};
const pages = (buf) => (buf.toString("latin1").match(/\/Type \/Page\b/g) || []).length;

describe("possession letter", () => {
  it("is a single-page PDF", async () => {
    const buf = await renderPossessionLetterBuffer(base);
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pages(buf)).toBe(1);
  });
  it("still fits one page with a long address, a balance and no certificate details", async () => {
    const buf = await renderPossessionLetterBuffer({ ...base, Status: "Draft", Collected: 40, CertificateNo: null, CertDate: null, CertAuthority: null, CustomerAddress: "Very long address line ".repeat(8), Mobile: "9000000000", Email: "a@b.test" });
    expect(pages(buf)).toBe(1);
  });
});

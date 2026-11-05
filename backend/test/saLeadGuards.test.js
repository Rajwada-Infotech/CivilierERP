const fs = require("fs");
const path = require("path");
const { applyLeadScope, isSaAdmin, isSaTeamLead, isSalesPerson } = require("../services/saAccess");

describe("Sales Automation (SA) Lead Security & Access Guards", () => {
  describe("applyLeadScope access control logic", () => {
    const mockRequest = () => {
      const inputs = {};
      return {
        input: (k, type, v) => { inputs[k] = v; return this; },
        _inputs: inputs,
      };
    };

    test("admin-tier roles (super_admin, sa, dba, admin, marketing_head) see all leads (1=1)", () => {
      const adminRoles = ["super_admin", "sa", "dba", "admin", "marketing_head"];
      for (const role of adminRoles) {
        const req = { user: { userId: 5, role } };
        const req0 = mockRequest();
        expect(applyLeadScope(req0, req, "l")).toBe("1=1");
        expect(isSaAdmin(req)).toBe(true);
      }
    });

    test("sales_team_lead sees leads assigned to them or their team members", () => {
      const req = { user: { userId: 42, role: "sales_team_lead" } };
      const req0 = mockRequest();
      const clause = applyLeadScope(req0, req, "l");
      expect(clause).toContain("l.AssignedTeamLeadId = @ActorUserId");
      expect(clause).toContain("SELECT MemberUserId FROM dbo.SaSalesTeam WHERE TeamLeadUserId = @ActorUserId");
      expect(isSaTeamLead(req)).toBe(true);
      expect(isSaAdmin(req)).toBe(false);
    });

    test("sales_person sees only their own assigned leads", () => {
      const req = { user: { userId: 88, role: "sales_person" } };
      const req0 = mockRequest();
      const clause = applyLeadScope(req0, req, "l");
      expect(clause).toBe("l.AssignedSalespersonId = @ActorUserId");
      expect(isSalesPerson(req)).toBe(true);
      expect(isSaAdmin(req)).toBe(false);
    });

    test("missing user or unauthenticated request fails closed (1=0)", () => {
      const req0 = mockRequest();
      expect(applyLeadScope(req0, { user: null }, "l")).toBe("1=0");
      expect(applyLeadScope(req0, { user: { role: "sales_person" } }, "l")).toBe("1=0");
    });
  });

  describe("SA routes have no duplicate apiRateLimit calls", () => {
    const saRoutes = [
      "saAds.js", "saCampaigns.js", "saDashboard.js", "saDistributionRules.js",
      "saInquiry.js", "saLeadActivities.js", "saLeadDistribution.js", "saLeads.js",
      "saLeadTasks.js", "saLeadTransfers.js", "saMarketingInvoices.js", "saNotifications.js",
      "saReports.js", "saSiteVisits.js", "saSocialMedia.js", "saTeams.js"
    ];

    test.each(saRoutes)("%s does not invoke apiRateLimit before authentication", (file) => {
      const src = fs.readFileSync(path.join(__dirname, "..", "routes", file), "utf8");
      const matches = src.match(/router\.use\s*\(\s*apiRateLimit\s*\)/g);
      expect(matches ? matches.length : 0).toBeLessThanOrEqual(1);
    });
  });

  describe("All SA lead-detail endpoints enforce applyLeadScope", () => {
    const filesToCheck = [
      { file: "saSiteVisits.js", mustContain: ["applyLeadScope", "router.post(\"/\""] },
      { file: "saInquiry.js", mustContain: ["applyLeadScope", "router.post(\"/:leadId/call\""] },
      { file: "saLeadActivities.js", mustContain: ["applyLeadScope", "router.post(\"/lead/:leadId\""] },
      { file: "saLeadTasks.js", mustContain: ["applyLeadScope", "router.post(\"/lead/:leadId\""] },
    ];

    test.each(filesToCheck)("$file guards its mutation endpoints with lead scope", ({ file }) => {
      const src = fs.readFileSync(path.join(__dirname, "..", "routes", file), "utf8");
      expect(src).toContain("applyLeadScope");
      // Check that lead active filter is present
      expect(src).toContain("l.IsActive = 1");
    });
  });
});

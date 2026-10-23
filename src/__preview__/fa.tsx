// Temporary preview harness (mock data, no server writes). Delete after checking.
if (location.hostname !== "127.0.0.1") throw new Error("preview harness runs on 127.0.0.1 only");
sessionStorage.setItem("user", JSON.stringify({ id: 1, name: "Preview", email: "preview@example.test", role: "super_admin" }));
import "@/index.css";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/contexts/AuthContext";
import { ModuleProvider } from "@/contexts/ModuleContext";
import { FinYearProvider } from "@/contexts/FinYearContext";
import Page from "@/pages/fixedAsset/FixedAssetQualityCheck";

const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const Q = ["Good", "Average", "Defective", "Repairing"];
const list = Array.from({ length: 8 }, (_, i) => ({
  QualityCheckId: i + 1, DocNo: `FAQ-2026-${String(8 - i).padStart(5, "0")}`, DocDate: day(-10 - i), CompanyId: 1, CompanyName: "Rajwada Infotech", ProjectId: 10 + (i % 2), ProjectName: i % 2 ? "Metro Depot" : "Riverside Towers",
  AssetId: 100 + i, AssetCode: "AST-1", FAItemCode: `TR/LAP/000${i}/FY2026-27`, ItemName: "Dell Latitude 5520", ItemPicture: null, CurrentUserId: 1, CurrentUserName: "Asha Sen", CurrentUserAvatar: null, UserPhoto: null,
  QualityStatus: Q[i % 4], Remarks: null, NextFollowUpDate: day(i < 2 ? -3 : i < 4 ? 3 : 20), FollowUpType: "Inspection", FollowUpRemarks: null, ResponsibleUserId: 2, ResponsibleUserName: "Rahul Das", ResponsibleUserAvatar: null,
  FollowUpStatus: i === 6 ? "Completed" : i === 7 ? "Cancelled" : "Pending", LastFollowUpDate: null, NextActionNotes: null, CompletedBy: null, CompletedAt: null, Status: "Active", CreatedBy: "admin", CreatedAt: "",
  IsOverdue: i < 2 ? 1 : 0,
}));
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
const real = window.fetch;
window.fetch = async (input: any, init?: any) => {
  const url = String(input?.url ?? input);
  if (!url.includes("/api/")) return real(input, init);
  if (init?.method && init.method !== "GET") return json({ error: "preview: no writes" });
  if (url.includes("/asset-context/")) return json({ assetId: 100, faItemCode: "TR/LAP/0000/FY2026-27", itemName: "Dell Latitude 5520", companyId: 1, projectId: 10, finYear: "", itemPicture: null, itemPictureFromDocNo: null, itemPictureFromDate: null, currentUserId: 1, currentUserName: "Asha Sen", currentUserAvatar: null, userPhoto: null, hasAssignment: true, assignmentId: 1, responsibleUserId: 2, responsibleUserName: "Rahul Das", responsibleUserAvatar: null });
  if (url.includes("/fixed-asset-quality-check/assets")) return json([{ AssetId: 100, FAItemCode: "TR/LAP/0000/FY2026-27", AssetName: "Dell Latitude 5520", AssetCategory: "Computers", CompanyId: 1, ProjectId: 10, FinYear: "" }]);
  let m;
  if ((m = url.match(/\/fixed-asset-quality-check\/(\d+)/))) return json(list[Number(m[1]) - 1]);
  if (url.includes("/fixed-asset-quality-check")) return json(list);
  if (url.includes("business_type=C")) return json([{ id: 1, label: "Rajwada Infotech" }]);
  if (url.includes("business_type=P")) return json([{ id: 10, label: "Riverside Towers", company_id: 1, CompanyId: 1 }]);
  return json([]);
};
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <BrowserRouter><AuthProvider><ModuleProvider><FinYearProvider><div style={{ padding: 16 }}><Page /></div></FinYearProvider></ModuleProvider></AuthProvider></BrowserRouter>
  </QueryClientProvider>,
);

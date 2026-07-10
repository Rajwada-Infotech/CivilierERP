import React from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { User, Phone, Mail, Building2, KeyRound, LogOut } from "lucide-react";

type Ctx = { me: any; timeline: any };

function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function Row({ icon: Icon, label, value }: { icon: any; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-violet-50 last:border-0">
      <div className="w-9 h-9 rounded-xl bg-violet-100 text-violet-600 flex items-center justify-center shrink-0"><Icon size={15} /></div>
      <div className="min-w-0">
        <p className="text-[11px] text-slate-400">{label}</p>
        <p className="text-sm font-medium text-slate-800 mt-0.5">{value ?? "—"}</p>
      </div>
    </div>
  );
}

const PortalProfile: React.FC = () => {
  const { me } = useOutletContext<Ctx>();
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem("crm_portal_token");
    navigate("/crm-client-portal/login");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-heading text-slate-800">Profile</h1>
        <p className="text-sm text-slate-500 mt-0.5">Your account details on file with us.</p>
      </div>

      <div className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-4 mb-4 pb-4 border-b border-violet-50">
          <div className="w-14 h-14 rounded-full bg-violet-100 text-violet-600 font-bold text-lg flex items-center justify-center">{initials(me.ApplicantName)}</div>
          <div>
            <p className="text-base font-bold text-slate-800">{me.ApplicantName}</p>
            <p className="text-xs text-slate-400">{me.ApplicationNo}</p>
          </div>
        </div>
        <Row icon={Phone} label="Mobile" value={me.Mobile} />
        <Row icon={Mail} label="Email" value={me.Email} />
        <Row icon={Building2} label="Interested Project" value={me.InterestedProject} />
        <Row icon={User} label="Application Status" value={me.Status} />
      </div>

      <div className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm space-y-3">
        <button onClick={() => navigate("/crm-client-portal/change-password")}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors">
          <span className="flex items-center gap-2.5 text-sm font-medium text-slate-700"><KeyRound size={15} className="text-violet-500" /> Change Password</span>
        </button>
        <button onClick={handleLogout}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-rose-100 hover:bg-rose-50 transition-colors">
          <span className="flex items-center gap-2.5 text-sm font-medium text-rose-600"><LogOut size={15} /> Logout</span>
        </button>
      </div>
    </div>
  );
};

export default PortalProfile;

// Who is signed in to Civilier Home: a customer (backend/routes/crmPortal.js — their own login and token). Staff use
// the Civilier CRM app, so a stored session of any other kind is cleared on start (AuthContext.tsx).
export interface AppUser {
  kind: "customer";
  id: string;
  name: string;
  email: string;
  initials: string;
}

import React from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { updateUserPreferences } from "@/api/userProfileApi";
import { Switch } from "@/components/ui/switch";
import { ProfileSection } from "@/components/layout/ProfileShell";
import { setUiPrefs, useUiPrefs, type UiPrefs } from "@/lib/uiPrefs";

// The Settings tab of every profile page (User, Admin, Super Admin, DBA): one component, so a setting added here is on all of them.
// Sign-in: the reminders popup after login (kept on the account). Animations: what moves, switched on or off for this device.

function Row({ title, hint, checked, disabled, onChange }: { title: string; hint: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-border/60 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={title} />
    </div>
  );
}

const ANIMATIONS: { key: keyof UiPrefs; title: string; hint: string }[] = [
  { key: "menus", title: "Menus and panels", hint: "The bubble the top-bar panels (notifications, reminders, theme, your menu) and the phone's bottom menus open and close with." },
  { key: "pages", title: "Pages and dialogs", hint: "The rise and fade pages, cards, charts and dialogs appear with." },
  { key: "counts", title: "Numbers counting up", hint: "Figures on dashboards counting up to their value." },
];

export function ProfileSettings() {
  const { currentUser, updateCurrentUserShowLoginReminders } = useAuth();
  const userId = currentUser?.id ? parseInt(currentUser.id) : 0;
  const prefs = useUiPrefs();
  const allOn = prefs.menus && prefs.pages && prefs.counts;
  const anyOn = prefs.menus || prefs.pages || prefs.counts;

  const remindersMutation = useMutation({
    mutationFn: (showLoginReminders: boolean) => updateUserPreferences(userId, { showLoginReminders }),
    onSuccess: (_data, showLoginReminders) => {
      updateCurrentUserShowLoginReminders(showLoginReminders);
      toast.success(showLoginReminders ? "Login reminders popup enabled" : "Login reminders popup disabled");
    },
    onError: () => toast.error("Failed to update preference"),
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      <ProfileSection title="Sign-in" icon={Bell}>
        <Row
          title="Show reminders popup on login"
          hint="Pop up pending alerts (from the bell icon) right after you sign in."
          checked={currentUser?.showLoginReminders !== false}
          disabled={remindersMutation.isPending}
          onChange={(v) => remindersMutation.mutate(v)}
        />
      </ProfileSection>

      <ProfileSection title="Animations" icon={Sparkles}>
        <Row
          title="All animations"
          hint={allOn ? "Everything below is on." : anyOn ? "Some of the animations below are off." : "Everything below is off."}
          checked={anyOn}
          onChange={(v) => setUiPrefs({ menus: v, pages: v, counts: v })}
        />
        {ANIMATIONS.map((a) => (
          <Row key={a.key} title={a.title} hint={a.hint} checked={prefs[a.key]} onChange={(v) => setUiPrefs({ [a.key]: v })} />
        ))}
        <p className="text-xs text-muted-foreground mt-3">
          Saved on this device only. If your device is set to reduce motion, these stay off whatever is chosen here.
        </p>
      </ProfileSection>
    </div>
  );
}

export default ProfileSettings;

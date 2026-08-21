import React, { useEffect, useMemo, useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { RecordsShell } from "@/components/records/RecordsShell";
import {
  FinanceGlassCard,
  GlassSection,
} from "@/components/finance/FinanceShell";
import { useRecords, type UnifiedRecord } from "@/hooks/useRecords";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useTheme } from "@/contexts/ThemeContext";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Download,
  Eye,
  RefreshCw,
  FileText,
  FileImage,
  FileSpreadsheet,
  File,
  Search,
  X,
  Loader2,
  ChevronRight,
  ArrowLeft,
  Folder,
  FolderPlus,
  Upload,
  Trash2,
  Lock,
  KeyRound,
  MoreVertical,
  CheckSquare,
  Square,
  EyeOff,
} from "lucide-react";
// Module-strip icons use Ionicons (via react-icons/io5) instead of
// lucide-react, per request — everything else on this page stays lucide.
import {
  IoArchiveOutline,
  IoTicketOutline,
  IoCarOutline,
  IoLockClosedOutline,
  IoFolderOpenOutline,
} from "react-icons/io5";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getPersonalVaultFolders,
  uploadToPersonalVault,
  uploadMoreToPersonalVault,
  unlockPersonalVaultFolder,
  setPersonalVaultFolderPassword,
  resetPersonalVaultFolderPassword,
  deletePersonalVaultFile,
  deletePersonalVaultFilesBulk,
  deletePersonalVaultFolder,
  fetchPersonalVaultFile,
  type PersonalVaultFolder,
} from "@/api/personalVaultApi";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fileIcon(type?: string) {
  if (!type) return <File size={14} className="text-muted-foreground" />;
  if (type.startsWith("image/"))
    return <FileImage size={14} className="text-blue-400" />;
  if (type.includes("pdf"))
    return <FileText size={14} className="text-red-400" />;
  if (type.includes("sheet") || type.includes("excel") || type.includes("csv"))
    return <FileSpreadsheet size={14} className="text-green-500" />;
  return <FileText size={14} className="text-muted-foreground" />;
}

function formatFileSize(bytes?: number) {
  if (!bytes || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const MODULE_META: Record<
  string,
  { label: string; icon: React.ElementType; color: string }
> = {
  ticket: { label: "Ticket", icon: IoTicketOutline, color: "#ec4899" },
  vehicle: { label: "Vehicle In/Out", icon: IoCarOutline, color: "#10b981" },
  // "vault" (Follow-Up Document Vault) deliberately omitted — disconnected
  // on the backend too (recordsRoutes.js), Follow-Up is stray/unused for now.
  personal: { label: "Personal Vault", icon: IoFolderOpenOutline, color: "#f97316" },
};

function PasswordInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  onKeyDown,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative w-full">
      <input
        type={visible ? "text" : "password"}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={
          className ??
          "w-full pl-3 pr-9 py-2 rounded-lg text-sm bg-muted border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
        }
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        tabIndex={-1}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        title={visible ? "Hide password" : "Show password"}
      >
        {visible ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

function ActionButtons({
  record,
  onDelete,
  vaultToken,
  selectMode,
  selected,
  onToggleSelect,
}: {
  record: UnifiedRecord;
  onDelete?: () => void;
  vaultToken?: string | null;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const [loading, setLoading] = useState<"preview" | "download" | "delete" | null>(null);

  const handleAction = async (action: "preview" | "download") => {
    setLoading(action);
    try {
      const res =
        record.source === "personal"
          ? await fetchPersonalVaultFile(record.url, vaultToken)
          : await fetchWithAuth(record.url);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);

      if (action === "preview") {
        window.open(objUrl, "_blank");
        setTimeout(() => URL.revokeObjectURL(objUrl), 60000); // cleanup after a minute
      } else {
        const a = document.createElement("a");
        a.href = objUrl;
        a.download = record.filename;
        a.click();
        URL.revokeObjectURL(objUrl);
      }
    } catch (e: any) {
      toast.error(`Failed to ${action} file: ${e.message}`);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="flex items-center gap-1">
      {selectMode && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect?.();
          }}
          className="p-1.5 rounded-md text-muted-foreground hover:text-primary transition-colors"
          title={selected ? "Deselect" : "Select"}
        >
          {selected ? <CheckSquare size={15} className="text-primary" /> : <Square size={15} />}
        </button>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleAction("preview");
        }}
        disabled={loading !== null}
        className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
        title={`Preview ${record.filename}`}
      >
        {loading === "preview" ? <Loader2 size={15} className="animate-spin" /> : <Eye size={15} />}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleAction("download");
        }}
        disabled={loading !== null}
        className="p-1.5 rounded-md hover:bg-amber-500/10 transition-colors disabled:opacity-50"
        style={{ color: "#f59e0b" }}
        title={`Download ${record.filename}`}
      >
        {loading === "download" ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
      </button>
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (!window.confirm(`Delete "${record.filename}"? This can't be undone.`)) return;
            setLoading("delete");
            Promise.resolve(onDelete()).finally(() => setLoading(null));
          }}
          disabled={loading !== null}
          className="p-1.5 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-50"
          title={`Delete ${record.filename}`}
        >
          {loading === "delete" ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
        </button>
      )}
    </div>
  );
}

// ─── Folder tree types ────────────────────────────────────────────────────────

type DocRefGroup = {
  key: string;
  docRef: string;
  docLabel: string;
  files: UnifiedRecord[];
  totalSize: number;
  latestUploadedAt: string;
};

type ModuleGroup = {
  key: string;
  source: string;
  module: string;
  docRefGroups: DocRefGroup[];
  fileCount: number;
  totalSize: number;
  latestUploadedAt: string;
};

function buildFolderTree(records: UnifiedRecord[]): ModuleGroup[] {
  const moduleMap = new Map<string, Map<string, DocRefGroup>>();

  for (const r of records) {
    if (!moduleMap.has(r.source)) moduleMap.set(r.source, new Map());
    const docMap = moduleMap.get(r.source)!;
    const key = `${r.source}::${r.docRef}`;
    if (!docMap.has(key)) {
      docMap.set(key, {
        key,
        docRef: r.docRef,
        docLabel: r.docLabel,
        files: [],
        totalSize: 0,
        latestUploadedAt: r.uploadedAt,
      });
    }
    const group = docMap.get(key)!;
    group.files.push(r);
    group.totalSize += r.size || 0;
    if (new Date(r.uploadedAt).getTime() > new Date(group.latestUploadedAt).getTime()) {
      group.latestUploadedAt = r.uploadedAt;
    }
  }

  const moduleGroups: ModuleGroup[] = [];
  for (const [source, docMap] of moduleMap.entries()) {
    const docRefGroups = Array.from(docMap.values())
      .map((g) => ({
        ...g,
        files: [...g.files].sort(
          (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
        ),
      }))
      .sort(
        (a, b) => new Date(b.latestUploadedAt).getTime() - new Date(a.latestUploadedAt).getTime(),
      );

    const fileCount = docRefGroups.reduce((s, g) => s + g.files.length, 0);
    const totalSize = docRefGroups.reduce((s, g) => s + g.totalSize, 0);
    const latestUploadedAt = docRefGroups[0]?.latestUploadedAt ?? "";
    const moduleLabel = MODULE_META[source]?.label ?? docRefGroups[0]?.files[0]?.module ?? source;

    moduleGroups.push({ key: source, source, module: moduleLabel, docRefGroups, fileCount, totalSize, latestUploadedAt });
  }

  return moduleGroups.sort(
    (a, b) => new Date(b.latestUploadedAt).getTime() - new Date(a.latestUploadedAt).getTime(),
  );
}

// ─── Folder grid view — drill-down like a real file browser instead of an
// inline-expanding accordion: root shows one folder card per module,
// clicking one navigates into a grid of doc-reference folders, clicking
// one of those navigates into the actual file list. ─────────────────────

function FolderCard({
  icon: Icon,
  label,
  sublabel,
  color,
  count,
  size,
  onClick,
  locked,
  menuItems,
}: {
  icon: React.ElementType;
  label: string;
  sublabel?: string;
  color: string;
  count: number;
  size: number;
  onClick: () => void;
  locked?: boolean;
  menuItems?: { label: string; danger?: boolean; onClick: () => void }[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") onClick();
      }}
      className="group relative flex flex-col items-start gap-2.5 p-4 rounded-xl border border-border/60 bg-card/40 hover:bg-card/80 hover:border-border transition-all text-left cursor-pointer"
    >
      {menuItems && menuItems.length > 0 && (
        <div className="absolute top-2 right-2 z-10">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="More options"
          >
            <MoreVertical size={15} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); }} />
              <div className="absolute right-0 top-full mt-1 w-44 rounded-lg border border-border bg-popover shadow-lg z-20 overflow-hidden py-1">
                {menuItems.map((mi) => (
                  <button
                    key={mi.label}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      mi.onClick();
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs font-heading transition-colors ${
                      mi.danger
                        ? "text-destructive hover:bg-destructive/10"
                        : "text-foreground hover:bg-muted"
                    }`}
                  >
                    {mi.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      <div
        className="flex items-center justify-center w-11 h-11 rounded-xl transition-transform group-hover:scale-105"
        style={{ background: `${color}1f` }}
      >
        <Icon size={22} style={{ color }} />
      </div>
      <div className="min-w-0 w-full">
        <p className="text-sm font-heading font-semibold text-foreground truncate flex items-center gap-1.5" title={label}>
          {label}
          {locked && <Lock size={11} className="text-muted-foreground shrink-0" />}
        </p>
        {sublabel && (
          <p className="text-xs text-muted-foreground truncate" title={sublabel}>
            {sublabel}
          </p>
        )}
      </div>
      <div className="flex items-center justify-between w-full text-[11px] text-muted-foreground">
        <span>
          {count} file{count !== 1 ? "s" : ""}
        </span>
        <span>{formatFileSize(size)}</span>
      </div>
    </div>
  );
}

function daysUntil(iso: string) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

function FileRow({
  record,
  onChanged,
  vaultToken,
  selectMode,
  selected,
  onToggleSelect,
}: {
  record: UnifiedRecord;
  onChanged?: () => void;
  vaultToken?: string | null;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2.5 hover:bg-muted/30 transition-colors">
      {fileIcon(record.mimeType)}
      <span className="text-xs text-foreground truncate max-w-[220px]" title={record.filename}>
        {record.filename}
      </span>
      {record.pendingDeletion && (
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-heading font-semibold bg-destructive/10 text-destructive border border-destructive/20 whitespace-nowrap"
          title="The source document was deleted — this file is auto-purged after a 7-day grace period"
        >
          Deleted · purges in {record.purgeAt ? daysUntil(record.purgeAt) : "?"}d
        </span>
      )}
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {formatFileSize(record.size)}
      </span>
      <span className="hidden sm:inline text-xs text-muted-foreground whitespace-nowrap">
        {record.uploadedBy || "—"}
      </span>
      <span className="hidden md:inline text-xs text-muted-foreground whitespace-nowrap">
        {record.uploadedAt ? format(new Date(record.uploadedAt), "dd/MM/yyyy HH:mm") : "—"}
      </span>
      <div className="ml-auto shrink-0">
        <ActionButtons
          record={record}
          vaultToken={vaultToken}
          selectMode={selectMode && record.source === "personal"}
          selected={selected}
          onToggleSelect={onToggleSelect}
          onDelete={
            record.source === "personal"
              ? async () => {
                  try {
                    await deletePersonalVaultFile(record.sourceId, vaultToken);
                    toast.success("File deleted");
                    onChanged?.();
                  } catch (e: any) {
                    toast.error(e.message || "Failed to delete file");
                  }
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}

function AddFilesButton({
  folderName,
  onUploaded,
  vaultToken,
}: {
  folderName: string;
  onUploaded?: () => void;
  vaultToken?: string | null;
}) {
  const [uploading, setUploading] = useState(false);

  const handleFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setUploading(true);
    try {
      await uploadMoreToPersonalVault(folderName, files, vaultToken);
      toast.success(`${files.length} file${files.length !== 1 ? "s" : ""} added`);
      onUploaded?.();
    } catch (e: any) {
      toast.error(e.message || "Failed to upload files");
    } finally {
      setUploading(false);
    }
  };

  return (
    <label className="flex items-center gap-1.5 mx-3 mt-3 mb-1 w-fit px-3 py-1.5 rounded-lg text-xs font-heading font-semibold bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/25 hover:bg-orange-500/15 transition-colors cursor-pointer">
      {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
      {uploading ? "Uploading…" : "Add Files"}
      <input
        type="file"
        multiple
        className="hidden"
        disabled={uploading}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </label>
  );
}

// ─── Personal Vault — folder unlock screen ─────────────────────────────────

function VaultUnlockPanel({
  folderName,
  onUnlocked,
}: {
  folderName: string;
  onUnlocked: (token: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [accountPassword, setAccountPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const handleUnlock = async () => {
    if (!password) return;
    setBusy(true);
    try {
      const { token } = await unlockPersonalVaultFolder(folderName, password);
      toast.success("Folder unlocked");
      onUnlocked(token);
    } catch (e: any) {
      toast.error(e.message || "Wrong password");
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    if (!accountPassword || !newPassword) {
      toast.error("Fill in both fields");
      return;
    }
    setBusy(true);
    try {
      const { token } = await resetPersonalVaultFolderPassword(folderName, accountPassword, newPassword);
      toast.success("Password reset");
      if (token) onUnlocked(token);
      setForgotOpen(false);
    } catch (e: any) {
      toast.error(e.message || "Failed to reset password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3 py-12 px-4">
      <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-orange-500/10">
        <Lock size={22} className="text-orange-500" />
      </div>
      <p className="text-sm font-heading font-semibold text-foreground">"{folderName}" is password-protected</p>
      {!forgotOpen ? (
        <>
          <div className="flex items-center gap-3 mt-1 w-80">
            <PasswordInput
              autoFocus
              value={password}
              onChange={setPassword}
              onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
              placeholder="Folder password"
            />
            <button
              onClick={handleUnlock}
              disabled={busy || !password}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-heading font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-60"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
              Unlock
            </button>
          </div>
          <button
            onClick={() => setForgotOpen(true)}
            className="text-[11px] text-muted-foreground hover:text-primary underline underline-offset-2 mt-1"
          >
            Forgot password?
          </button>
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 mt-1 w-64">
          <p className="text-[11px] text-muted-foreground text-center">
            Verify your account password to reset this folder's password.
          </p>
          <PasswordInput
            value={accountPassword}
            onChange={setAccountPassword}
            placeholder="Your account password"
          />
          <PasswordInput
            value={newPassword}
            onChange={setNewPassword}
            placeholder="New folder password"
          />
          <div className="flex items-center gap-2 w-full mt-1">
            <button
              onClick={() => setForgotOpen(false)}
              className="flex-1 px-3 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              Back
            </button>
            <button
              onClick={handleReset}
              disabled={busy}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-60"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : "Reset"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Personal Vault — set/change password dialog ───────────────────────────

function VaultSetPasswordDialog({
  open,
  folderName,
  hasPassword,
  vaultToken,
  onClose,
  onSaved,
}: {
  open: boolean;
  folderName: string;
  hasPassword: boolean;
  vaultToken?: string | null;
  onClose: () => void;
  onSaved: (token: string | null) => void;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setNewPassword("");
  }, [open]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { token } = await setPersonalVaultFolderPassword(folderName, newPassword || null, vaultToken);
      toast.success(newPassword ? "Password set" : "Password removed");
      onSaved(token ?? null);
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Failed to update password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading text-base flex items-center gap-2">
            <KeyRound size={16} className="text-orange-500" />
            {hasPassword ? "Change Password" : "Set Password"} — {folderName}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          <PasswordInput
            autoFocus
            value={newPassword}
            onChange={setNewPassword}
            placeholder={hasPassword ? "New password (blank to remove)" : "New password"}
          />
          {hasPassword && (
            <p className="text-[11px] text-muted-foreground">Leave blank and save to remove password protection.</p>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-4 border-t border-border mt-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-60"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : "Save"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RecordsFolderBrowser({
  records,
  searchActive,
  onChanged,
}: {
  records: UnifiedRecord[];
  searchActive: boolean;
  onChanged?: () => void;
}) {
  const [moduleKey, setModuleKey] = useState<string | null>(null);
  const [docRefKey, setDocRefKey] = useState<string | null>(null);

  // Personal Vault folder metadata (HasPassword) + session-only unlock
  // tokens, keyed by folder name. Tokens are never persisted — a reload
  // re-locks any protected folder, which is the point of a lock.
  const [vaultFolders, setVaultFolders] = useState<PersonalVaultFolder[]>([]);
  const [vaultTokens, setVaultTokens] = useState<Record<string, string>>({});
  const [passwordDialogFolder, setPasswordDialogFolder] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const refreshVaultFolders = () => {
    getPersonalVaultFolders().then(setVaultFolders).catch(() => {});
  };

  useEffect(() => {
    refreshVaultFolders();
  }, []);

  const tree = useMemo(() => buildFolderTree(records), [records]);

  const currentModule = moduleKey ? tree.find((m) => m.key === moduleKey) : null;
  const currentDocRef =
    currentModule && docRefKey
      ? currentModule.docRefGroups.find((d) => d.key === docRefKey)
      : null;

  const vaultMeta = currentDocRef
    ? vaultFolders.find((f) => f.FolderName === currentDocRef.docRef)
    : null;
  const currentToken = currentDocRef ? vaultTokens[currentDocRef.docRef] : undefined;
  const isLocked = !!(currentModule?.source === "personal" && vaultMeta?.HasPassword && !currentToken);

  // Reset dangling selections if the underlying data changed underneath
  // (e.g. a refresh removed the module/doc-ref currently drilled into).
  useEffect(() => {
    if (moduleKey && !currentModule) {
      setModuleKey(null);
      setDocRefKey(null);
    } else if (docRefKey && currentModule && !currentDocRef) {
      setDocRefKey(null);
    }
  }, [moduleKey, docRefKey, currentModule, currentDocRef]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [docRefKey]);

  const handleChanged = () => {
    onChanged?.();
    refreshVaultFolders();
  };

  // Mid-search, folder navigation doesn't make sense (matches can span
  // every module/doc) — drop straight to a flat list of matching files.
  if (searchActive) {
    const flat = [...records].sort(
      (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
    );
    return (
      <div className="divide-y divide-border/50">
        {flat.map((r) => (
          <FileRow
            key={r.id}
            record={r}
            onChanged={handleChanged}
            vaultToken={r.source === "personal" ? vaultTokens[r.docRef] : undefined}
          />
        ))}
      </div>
    );
  }

  const crumbs: { label: string; onClick: () => void }[] = [
    { label: "All Attachments", onClick: () => { setModuleKey(null); setDocRefKey(null); } },
  ];
  if (currentModule) {
    crumbs.push({ label: currentModule.module, onClick: () => setDocRefKey(null) });
  }
  if (currentDocRef) {
    crumbs.push({ label: currentDocRef.docRef, onClick: () => {} });
  }

  const goBack = () => {
    if (currentDocRef) setDocRefKey(null);
    else if (currentModule) setModuleKey(null);
  };

  const handleDeleteFolder = async (folderName: string, token?: string | null) => {
    if (!window.confirm(`Delete the entire "${folderName}" folder and all its files? This can't be undone.`)) return;
    try {
      await deletePersonalVaultFolder(folderName, token);
      toast.success(`"${folderName}" deleted`);
      setDocRefKey(null);
      handleChanged();
    } catch (e: any) {
      toast.error(e.message || "Failed to delete folder — unlock it first if it's protected");
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedIds.size} selected file${selectedIds.size !== 1 ? "s" : ""}? This can't be undone.`)) return;
    setBulkDeleting(true);
    try {
      await deletePersonalVaultFilesBulk(Array.from(selectedIds), currentToken);
      toast.success(`${selectedIds.size} file${selectedIds.size !== 1 ? "s" : ""} deleted`);
      setSelectedIds(new Set());
      handleChanged();
    } catch (e: any) {
      toast.error(e.message || "Failed to delete files");
    } finally {
      setBulkDeleting(false);
    }
  };

  return (
    <div>
      {/* Breadcrumb trail */}
      <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-border/50 text-xs overflow-x-auto">
        {currentModule && (
          <button
            onClick={goBack}
            title="Back"
            className="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:text-primary hover:bg-muted shrink-0 mr-0.5 transition-colors"
          >
            <ArrowLeft size={14} />
          </button>
        )}
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <ChevronRight size={12} className="text-muted-foreground/50 shrink-0" />}
            <button
              onClick={c.onClick}
              disabled={i === crumbs.length - 1}
              className={`whitespace-nowrap font-heading transition-colors ${
                i === crumbs.length - 1
                  ? "text-foreground cursor-default"
                  : "text-muted-foreground hover:text-primary"
              }`}
            >
              {c.label}
            </button>
          </React.Fragment>
        ))}
      </div>

      <div className="p-3">
        {!currentModule ? (
          tree.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No attachments yet.</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {tree.map((mg) => {
                const meta = MODULE_META[mg.source] ?? { label: mg.module, icon: File, color: "#94a3b8" };
                return (
                  <FolderCard
                    key={mg.key}
                    icon={meta.icon}
                    label={mg.module}
                    color={meta.color}
                    count={mg.fileCount}
                    size={mg.totalSize}
                    onClick={() => setModuleKey(mg.key)}
                  />
                );
              })}
            </div>
          )
        ) : !currentDocRef ? (
          currentModule.docRefGroups.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">This folder is empty.</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {currentModule.docRefGroups.map((dg) => {
                const isPersonal = currentModule.source === "personal";
                const meta = isPersonal ? vaultFolders.find((f) => f.FolderName === dg.docRef) : null;
                const token = vaultTokens[dg.docRef];
                return (
                  <FolderCard
                    key={dg.key}
                    icon={Folder}
                    label={dg.docRef}
                    sublabel={dg.docLabel !== dg.docRef ? dg.docLabel : undefined}
                    color="#f59e0b"
                    count={dg.files.length}
                    size={dg.totalSize}
                    locked={isPersonal && !!meta?.HasPassword && !token}
                    onClick={() => setDocRefKey(dg.key)}
                    menuItems={
                      isPersonal
                        ? [
                            {
                              label: meta?.HasPassword ? "Change Password" : "Set Password",
                              onClick: () => setPasswordDialogFolder(dg.docRef),
                            },
                            {
                              label: "Delete Folder",
                              danger: true,
                              onClick: () => handleDeleteFolder(dg.docRef, token),
                            },
                          ]
                        : undefined
                    }
                  />
                );
              })}
            </div>
          )
        ) : isLocked ? (
          <VaultUnlockPanel
            folderName={currentDocRef.docRef}
            onUnlocked={(token) => setVaultTokens((prev) => ({ ...prev, [currentDocRef.docRef]: token }))}
          />
        ) : (
          <div>
            {currentModule.source === "personal" && (
              <div className="flex items-center gap-3 mx-3 mt-3 mb-1 flex-wrap">
                <AddFilesButton folderName={currentDocRef.docRef} onUploaded={handleChanged} vaultToken={currentToken} />
                <button
                  onClick={() => setPasswordDialogFolder(currentDocRef.docRef)}
                  className="flex items-center gap-1.5 w-fit px-3 py-1.5 rounded-lg text-xs font-heading font-semibold bg-muted text-muted-foreground border border-border hover:bg-muted/70 transition-colors"
                >
                  <KeyRound size={13} />
                  {vaultMeta?.HasPassword ? "Change Password" : "Set Password"}
                </button>
                {selectedIds.size > 0 && (
                  <button
                    onClick={handleBulkDelete}
                    disabled={bulkDeleting}
                    className="flex items-center gap-1.5 w-fit px-3 py-1.5 rounded-lg text-xs font-heading font-semibold bg-destructive/10 text-destructive border border-destructive/25 hover:bg-destructive/15 transition-colors disabled:opacity-60"
                  >
                    {bulkDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    Delete {selectedIds.size} Selected
                  </button>
                )}
              </div>
            )}
            <div className="rounded-lg border border-border/50 divide-y divide-border/50 overflow-hidden">
              {currentDocRef.files.map((r) => (
                <FileRow
                  key={r.id}
                  record={r}
                  onChanged={handleChanged}
                  vaultToken={currentToken}
                  selectMode={currentModule.source === "personal"}
                  selected={selectedIds.has(r.sourceId)}
                  onToggleSelect={() => toggleSelect(r.sourceId)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <VaultSetPasswordDialog
        open={!!passwordDialogFolder}
        folderName={passwordDialogFolder || ""}
        hasPassword={!!vaultFolders.find((f) => f.FolderName === passwordDialogFolder)?.HasPassword}
        vaultToken={passwordDialogFolder ? vaultTokens[passwordDialogFolder] : undefined}
        onClose={() => setPasswordDialogFolder(null)}
        onSaved={(token) => {
          if (!passwordDialogFolder) return;
          setVaultTokens((prev) => {
            const next = { ...prev };
            if (token) next[passwordDialogFolder] = token;
            else delete next[passwordDialogFolder];
            return next;
          });
          refreshVaultFolders();
        }}
      />
    </div>
  );
}

// ─── New Folder dialog — Personal Vault ────────────────────────────────────────
// Private, per-user storage for files unrelated to any project record —
// any format (images, PDFs, Office docs, CSV, etc). A "folder" is created
// implicitly the first time a file is uploaded under that name.

function NewFolderDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [folderName, setFolderName] = useState("");
  const [password, setPassword] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  // Deliberately NOT reset via a useEffect keyed on `open` — that pattern
  // clears the form on every re-render where the dialog happens to still be
  // open (e.g. a records refresh firing mid-fill), wiping what the user just
  // typed before they'd even clicked Create. Reset only on the two actions
  // that actually end the "filling in a folder" session: a successful create,
  // or an explicit cancel.
  const resetForm = () => {
    setFolderName("");
    setPassword("");
    setFiles([]);
  };

  const handleCreate = async () => {
    const name = folderName.trim();
    if (!name) {
      toast.error("Give the folder a name — e.g. \"XYZ Vault\"");
      return;
    }
    if (files.length === 0) {
      toast.error("Pick at least one file to create the folder with");
      return;
    }
    setSaving(true);
    try {
      await uploadToPersonalVault(name, files, password.trim() || undefined);
      toast.success(`"${name}" created`);
      onCreated();
      resetForm();
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Failed to create folder");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    resetForm();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-base flex items-center gap-2">
            <FolderPlus size={16} className="text-orange-500" /> New Folder
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
              Folder Name
            </label>
            <input
              autoFocus
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="e.g. XYZ Vault"
              className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Private to you — unrelated to any project record. Any file type is accepted.
            </p>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
              Password <span className="normal-case text-muted-foreground/60">(optional)</span>
            </label>
            <PasswordInput
              value={password}
              onChange={setPassword}
              placeholder="Leave blank for no password"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Protect this folder — you'll need it (or your account password to reset) to open it later.
            </p>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
              Files
            </label>
            <input
              type="file"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
              className="w-full text-xs text-muted-foreground file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-primary file:text-primary-foreground file:text-xs file:font-heading file:font-semibold file:cursor-pointer"
            />
            {files.length > 0 && (
              <p className="text-[11px] text-muted-foreground mt-1.5">
                {files.length} file{files.length !== 1 ? "s" : ""} selected ·{" "}
                {formatFileSize(files.reduce((s, f) => s + f.size, 0))}
              </p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-4 border-t border-border mt-2">
          <button
            onClick={handleCancel}
            className="px-3 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-60"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            {saving ? "Uploading…" : "Create Folder"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Records() {
  usePageRights("records");
  const { records, loading, error, refreshRecords } = useRecords();
  const [moduleFilter, setModuleFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const { theme } = useTheme();
  const isDark = theme !== "light";

  const counts = useMemo(() => {
    const byModule: Record<string, number> = {};
    for (const r of records) byModule[r.source] = (byModule[r.source] ?? 0) + 1;
    return byModule;
  }, [records]);

  const filteredByModule = useMemo(
    () =>
      moduleFilter ? records.filter((r) => r.source === moduleFilter) : records,
    [records, moduleFilter],
  );

  // Search across doc ref, reference label, filename, module, and uploader —
  // layered on top of the module filter.
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return filteredByModule;
    return filteredByModule.filter((r) =>
      [r.docRef, r.docLabel, r.filename, r.module, r.uploadedBy ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [filteredByModule, search]);

  const totalSize = records.reduce((s, r) => s + (r.size || 0), 0);

  const summaryStats = [
    {
      label: "Total Files",
      value: String(records.length),
      icon: IoArchiveOutline,
      color: "#f59e0b",
    },
    {
      label: "Tickets",
      value: String(counts.ticket ?? 0),
      icon: IoTicketOutline,
      color: "#ec4899",
    },
    {
      label: "Vehicle In/Out",
      value: String(counts.vehicle ?? 0),
      icon: IoCarOutline,
      color: "#10b981",
    },
    {
      label: "Storage Used",
      value: formatFileSize(totalSize),
      icon: IoLockClosedOutline,
      color: "#818cf8",
    },
  ];

  return (
    <>
      <Breadcrumbs items={["Records"]} />
      <RecordsShell
        title="Records"
        subtitle="Every attachment across the ERP — Tickets, Vehicle In/Out, Contract, and your own Personal Vault — in one searchable place"
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setNewFolderOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-orange-500/30 hover:bg-orange-500/10 transition-colors"
              style={{ color: "#f97316" }}
            >
              <FolderPlus size={13} />
              New Folder
            </button>
            <button
              onClick={refreshRecords}
              className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-amber-500/30 hover:bg-amber-500/10 transition-colors"
              style={{ color: "#fbbf24" }}
            >
              <RefreshCw size={13} />
              Refresh
            </button>
          </div>
        }
      >
        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {summaryStats.map((s) => (
            <FinanceGlassCard
              key={s.label}
              label={s.label}
              value={s.value}
              icon={s.icon}
              accentColor={s.color}
            />
          ))}
        </div>

        {error && (
          <div className="p-4 text-center text-destructive text-sm bg-destructive/5 border border-destructive/20 rounded-xl">
            Failed to load records: {error}
          </div>
        )}

        <GlassSection
          title="All Attachments"
          icon={IoArchiveOutline}
          accentColor="#f59e0b"
          action={
            <div className="flex items-center gap-2">
              {/* Module quick-filter chips */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setModuleFilter(null)}
                  className={`px-2.5 py-1 rounded-full text-xs font-heading transition-colors ${
                    moduleFilter === null
                      ? "bg-amber-500/20 text-amber-500"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  All
                </button>
                {Object.entries(MODULE_META).map(([key, meta]) => (
                  <button
                    key={key}
                    onClick={() =>
                      setModuleFilter(moduleFilter === key ? null : key)
                    }
                    className="px-2.5 py-1 rounded-full text-xs font-heading transition-colors"
                    style={
                      moduleFilter === key
                        ? { background: `${meta.color}28`, color: meta.color }
                        : { color: "var(--muted-foreground)" }
                    }
                  >
                    {meta.label} ({counts[key] ?? 0})
                  </button>
                ))}
              </div>
            </div>
          }
        >
          {/* Doc-reference search bar — searches doc ref, filename, module, uploader */}
          <div className="relative mb-3">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by document number, filename, module, or uploader…"
              className="w-full pl-9 pr-9 py-2.5 rounded-xl text-sm bg-muted/60 border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-amber-500/30 placeholder:text-muted-foreground/70"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                title="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div
            className="rounded-xl overflow-hidden"
            style={{
              background: isDark ? "rgba(15,17,26,0.45)" : "rgba(255,255,255,0.72)",
              border: isDark
                ? "1px solid rgba(245,158,11,0.18)"
                : "1px solid rgba(245,158,11,0.22)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              boxShadow: isDark
                ? "0 4px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)"
                : "0 4px 24px rgba(245,158,11,0.08), inset 0 1px 0 rgba(255,255,255,0.9)",
            }}
          >
            {loading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Loading records…
              </div>
            ) : searched.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {records.length === 0
                  ? "No attachments yet. Files uploaded in Tickets, Vehicle In/Out, Contract, or your Personal Vault will appear here automatically."
                  : "No attachments match your search."}
              </div>
            ) : (
              <RecordsFolderBrowser records={searched} searchActive={search.trim().length > 0} onChanged={refreshRecords} />
            )}
          </div>
        </GlassSection>
      </RecordsShell>
      <NewFolderDialog
        open={newFolderOpen}
        onClose={() => setNewFolderOpen(false)}
        onCreated={refreshRecords}
      />
    </>
  );
}

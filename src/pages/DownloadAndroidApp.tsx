import { QRCodeSVG } from "qrcode.react";
import { Download } from "lucide-react";
import { motion } from "framer-motion";

// Same-origin static files — the APKs are dropped into public/downloads/ by
// the release process (see mobile/eas.json's and mobile-admin/eas.json's
// "production" profiles) so these links never depend on an Expo/EAS URL
// that can expire.
const APPS = [
  {
    key: "main",
    title: "CivilierERP",
    description:
      "Scan the QR code with your phone's camera, or use the download link below to install the APK directly.",
    apkPath: "/downloads/CivilierERP.apk",
    version: "1.0.0",
  },
  {
    key: "admin",
    title: "CivilierERP Admin",
    description:
      "For admins — scan or download to install the admin console app on your device.",
    apkPath: "/downloads/CivilierERPAdmin.apk",
    version: "1.0.0",
  },
] as const;

function AppCard({ title, description, apkPath, version }: (typeof APPS)[number]) {
  const downloadUrl =
    typeof window !== "undefined" ? `${window.location.origin}${apkPath}` : apkPath;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="relative z-10 w-full max-w-md rounded-3xl overflow-hidden flex flex-col items-center gap-6 text-center"
      style={{
        border: "1px solid rgba(167,139,250,0.18)",
        backdropFilter: "blur(16px)",
      }}
    >
      {/* Card backdrop — the illustration, dimmed underneath so the card's
          own text stays readable without a separate icon block */}
      <div
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: "url(/MobileApkDesign.jpg)",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      <div
        className="absolute inset-0 z-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(180deg, rgba(13,10,26,0.55) 0%, rgba(13,10,26,0.90) 45%, rgba(13,10,26,0.97) 75%)",
        }}
      />

      <div className="relative z-10 flex flex-col items-center gap-6 p-8 w-full">
        <div className="pt-2">
          <h1 className="text-2xl font-bold text-white tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-white/50 leading-relaxed">{description}</p>
        </div>

        <div className="p-4 rounded-2xl bg-white">
          <QRCodeSVG value={downloadUrl} size={180} level="M" />
        </div>

        <a
          href={apkPath}
          download
          className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-white transition-transform active:scale-95"
          style={{ background: "linear-gradient(135deg, #7c3aed, #4f46e5)" }}
        >
          <Download size={16} />
          Download APK ({version})
        </a>

        <p className="text-xs text-white/30 leading-relaxed">
          Android will warn about installing from an unknown source — that's expected for an app
          outside the Play Store. Allow the install to continue in your device settings.
        </p>
      </div>
    </motion.div>
  );
}

export default function DownloadAndroidApp() {
  return (
    <div
      className="min-h-screen w-full flex items-center justify-center px-4 py-10 relative overflow-hidden"
      style={{ background: "#0d0a1a" }}
    >
      {/* Page-level backdrop — same illustration, heavily blurred/dimmed so it
          reads as ambient texture, not a competing focal point next to the cards */}
      <div
        className="absolute inset-0 z-0 pointer-events-none"
        style={{
          backgroundImage: "url(/MobileApkDesign.jpg)",
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "blur(60px) saturate(120%)",
          transform: "scale(1.1)",
          opacity: 0.35,
        }}
      />
      <div
        className="absolute inset-0 z-0 pointer-events-none"
        style={{ background: "rgba(13,10,26,0.55)" }}
      />
      <div
        className="absolute inset-0 z-0 pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(167,139,250,0.07) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <motion.div
          className="absolute top-[-15%] left-[-10%] w-[50%] h-[50%] rounded-full blur-[110px]"
          style={{ background: "rgba(124,58,237,0.28)" }}
          animate={{ scale: [1, 1.12, 1], opacity: [0.28, 0.42, 0.28] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute bottom-[-15%] right-[-10%] w-[50%] h-[50%] rounded-full blur-[110px]"
          style={{ background: "rgba(79,70,229,0.22)" }}
          animate={{ scale: [1, 1.15, 1], opacity: [0.22, 0.34, 0.22] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 2 }}
        />
      </div>

      <div className="relative z-10 w-full flex flex-wrap items-start justify-center gap-8">
        {APPS.map((app) => (
          <AppCard key={app.key} {...app} />
        ))}
      </div>
    </div>
  );
}

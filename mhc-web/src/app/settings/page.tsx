import { Suspense } from "react";
import WatermarkBanner from "@/components/WatermarkBanner";
import SettingsClient from "./SettingsClient";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <WatermarkBanner title="设置" />
      <Suspense fallback={<p className="text-sm" style={{ color: "var(--text-tertiary)" }}>加载中...</p>}>
        <SettingsClient />
      </Suspense>
    </div>
  );
}

import { Suspense } from "react";
import WatermarkBanner from "@/components/WatermarkBanner";
import PushClient from "./PushClient";

export default function PushesPage() {
  return (
    <div className="space-y-6">
      <WatermarkBanner title="推送记录" />
      <Suspense fallback={<p className="text-sm" style={{ color: "var(--text-tertiary)" }}>加载中...</p>}>
        <PushClient />
      </Suspense>
    </div>
  );
}

import { Suspense } from "react";
import WatermarkBanner from "@/components/WatermarkBanner";
import AbnormalClient from "./AbnormalClient";

export default function AbnormalPage() {
  return (
    <div className="space-y-6">
      <WatermarkBanner title="异常机器" />
      <Suspense fallback={<p className="text-sm" style={{ color: "var(--text-tertiary)" }}>加载中...</p>}>
        <AbnormalClient />
      </Suspense>
    </div>
  );
}

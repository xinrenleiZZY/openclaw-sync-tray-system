import { Suspense } from "react";
import WatermarkBanner from "@/components/WatermarkBanner";
import KeyOwnersClient from "./KeyOwnersClient";

export default function KeyOwnersPage() {
  return (
    <div className="space-y-6">
      <WatermarkBanner title="Key 归属人员" />
      <Suspense fallback={<p className="text-sm" style={{ color: "var(--text-tertiary)" }}>加载中...</p>}>
        <KeyOwnersClient />
      </Suspense>
    </div>
  );
}

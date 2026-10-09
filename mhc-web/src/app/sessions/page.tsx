import { Suspense } from "react";
import WatermarkBanner from "@/components/WatermarkBanner";
import SessionsClient from "./SessionsClient";

export default function SessionsPage() {
  return (
    <div className="space-y-6">
      <WatermarkBanner title="会话明细" />
      <Suspense fallback={<p className="text-sm" style={{ color: "var(--text-tertiary)" }}>加载中...</p>}>
        <SessionsClient />
      </Suspense>
    </div>
  );
}

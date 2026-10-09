import { Suspense } from "react";
import WatermarkBanner from "@/components/WatermarkBanner";
import PricesClient from "./PricesClient";

export default function PricesPage() {
  return (
    <div className="space-y-6">
      <WatermarkBanner title="模型实时价格" />
      <Suspense fallback={<p className="text-sm" style={{ color: "var(--text-tertiary)" }}>加载中...</p>}>
        <PricesClient />
      </Suspense>
    </div>
  );
}

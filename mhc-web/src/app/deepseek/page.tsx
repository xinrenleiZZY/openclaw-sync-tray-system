import WatermarkBanner from "@/components/WatermarkBanner";
import DeepseekClient from "./DeepseekClient";

export default function DeepseekPage() {
  return (
    <div className="space-y-6">
      <WatermarkBanner title="Deepseek 用量统计中心" />
      <DeepseekClient />
    </div>
  );
}

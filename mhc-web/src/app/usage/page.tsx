import WatermarkBanner from "@/components/WatermarkBanner";
import UsageClient from "./UsageClient";

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ machine?: string; days?: string }>;
}) {
  const sp = await searchParams;
  const machine = sp.machine || "";
  const days = sp.days ? Number(sp.days) : undefined;

  return (
    <div className="space-y-6">
      <WatermarkBanner title="用量总览" />
      <UsageClient initialMachine={machine} initialDays={days} />
    </div>
  );
}

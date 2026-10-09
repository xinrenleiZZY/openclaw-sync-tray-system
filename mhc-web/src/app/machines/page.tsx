import { Suspense } from "react";
import WatermarkBanner from "@/components/WatermarkBanner";
import MachinesClient from "./MachinesClient";
import MachineRanking from "./MachineRanking";

export default async function MachinesPage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string }>;
}) {
  const sp = await searchParams;
  return (
    <div className="space-y-6">
      <WatermarkBanner title="机器列表" />
      <MachineRanking />
      <MachinesClient initialName={sp.name || ""} />
    </div>
  );
}

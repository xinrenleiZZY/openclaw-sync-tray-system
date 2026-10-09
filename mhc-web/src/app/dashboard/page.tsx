import { Suspense } from "react";
import DashboardLife from "@/components/DashboardLife";
import SyncAllButton from "@/components/SyncAllButton";
import UsageStatCards from "@/components/UsageStatCards";
import DailyTrendBars from "@/components/DailyTrendBars";
import MachineSummaryList from "@/components/MachineSummaryList";
import RecentPushFeed from "@/components/RecentPushFeed";
import AutoRefresh from "@/components/AutoRefresh";
import TrayVersionPanel from "@/components/TrayVersionPanel";

function CardFallback() {
  return (
    <div className="hzx-card animate-pulse">
      <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-2/3 mb-4" />
      <div className="h-8 bg-gray-300 dark:bg-gray-700 rounded w-1/2" />
    </div>
  );
}

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div className="relative">
        <DashboardLife />
        <div className="absolute right-5 top-1/2 -translate-y-1/2 z-20 hidden sm:flex items-center gap-4">
          <SyncAllButton />
          <AutoRefresh seconds={30} />
        </div>
      </div>

      <Suspense fallback={<CardFallback />}>
        <UsageStatCards />
      </Suspense>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        <div className="h-full">
          <Suspense fallback={<CardFallback />}>
            <DailyTrendBars />
          </Suspense>
        </div>
        <div className="h-full">
          <Suspense fallback={<CardFallback />}>
            <MachineSummaryList />
          </Suspense>
        </div>
      </div>

      <Suspense fallback={<CardFallback />}>
        <TrayVersionPanel />
      </Suspense>

      <Suspense fallback={<CardFallback />}>
        <RecentPushFeed />
      </Suspense>
    </div>
  );
}

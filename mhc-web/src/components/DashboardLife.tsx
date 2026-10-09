"use client";

import { useState } from "react";
import WatermarkBanner from "./WatermarkBanner";
import LifeFormView from "./LifeFormView";

/**
 * 仪表盘入口：艺术彩字标题 + 点击进入全屏"生命形态"实时解析
 */
export default function DashboardLife({ title = "仪表盘" }: { title?: string }) {
  const [life, setLife] = useState(false);

  return (
    <>
      <WatermarkBanner title={title} artistic onClick={() => setLife(true)} />
      {life && <LifeFormView onClose={() => setLife(false)} />}
    </>
  );
}

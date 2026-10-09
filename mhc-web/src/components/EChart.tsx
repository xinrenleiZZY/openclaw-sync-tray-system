"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";

/**
 * 通用 ECharts 封装：自动初始化、随容器 resize、option 变化时更新
 */
export default function EChart({
  option,
  height = "100%",
  className,
}: {
  option: echarts.EChartsOption;
  height?: string | number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chartRef.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.setOption(option, true);
    }
  }, [option]);

  return <div ref={ref} className={className} style={{ width: "100%", height }} />;
}

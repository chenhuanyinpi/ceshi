import { useEffect, useState } from "react";
import { searchTasks } from "./api";
import type { Task, StatusFilter } from "./types";
/** 已成功返回结果的那一次查询条件；用于按真实结果钳制越界页码。 */
export interface SettledQuery {
  q: string;
  status: StatusFilter;
}
export function useTaskSearch(q: string, status: StatusFilter) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [settled, setSettled] = useState<SettledQuery | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError("");
    // T1：快速改变查询条件时，旧请求会被取消；即便已来不及取消，
    // active 标志也会丢弃其迟到结果，避免覆盖新请求的数据。
    searchTasks(q, status, controller.signal)
      .then((result) => {
        if (!active) return;
        setTasks(result);
        // 只有“当前条件”查询成功后，才标记该条件已结算，
        // 供页面据此按真实结果修正越界页码。
        setSettled({ q, status });
      })
      .catch((e) => {
        if (!active || e.name === "AbortError") return;
        setError(e.message);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
      
    return () => {
      active = false;
      controller.abort();
    };
  }, [q, status]);
  return { tasks, loading, error, settled };
}

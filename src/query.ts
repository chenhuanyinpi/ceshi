import type { Filters, StatusFilter } from "./types";
// T2：URL 状态同步。参数为 q / status / page，默认值 q 为空、status 为 ALL、page 为 1。

/** 状态筛选仅允许这四个值；缺省或非法一律回落到 ALL。 */
const STATUS_FILTERS: readonly StatusFilter[] = ["ALL", "TODO", "DOING", "DONE"];

function normalizeStatus(raw: string | null | undefined): StatusFilter {
  return STATUS_FILTERS.includes(raw as StatusFilter)
    ? (raw as StatusFilter)
    : "ALL";
}

/** 页码缺省、非正安全整数、非整数或非数值时一律回落到 1。 */
function normalizePage(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || !/^\d+$/.test(raw)) return 1;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1 ? value : 1;
}

/** 值为空串代表“默认值”，应从地址栏移除该参数。 */
function setParam(params: URLSearchParams, key: string, value: string): void {
  if (value === "") params.delete(key);
  else params.set(key, value);
}

/** 从 location.search 解析已提交的查询状态；缺省与非法值回落到默认值。 */
export function readQuery(search: string): Filters {
  const params = new URLSearchParams(search);
  return {
    q: params.get("q") ?? "",
    status: normalizeStatus(params.get("status")),
    page: normalizePage(params.get("page")),
  };
}

/**
 * 把查询状态写回地址栏。
 * 默认值（q 为空、status 为 ALL、page 为 1）省略不写，
 * 无关参数与 hash 原样保留；编码由 URLSearchParams 处理。
 */
export function writeQuery(filters: Filters, mode: "push" | "replace"): void {
  const params = new URLSearchParams(window.location.search);
  const status = normalizeStatus(filters.status);
  const page = normalizePage(String(filters.page));

  setParam(params, "q", filters.q);
  setParam(params, "status", status === "ALL" ? "" : status);
  setParam(params, "page", page === 1 ? "" : String(page));

  const query = params.toString();
  const url =
    window.location.pathname + (query ? `?${query}` : "") + window.location.hash;
  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

/** 监听浏览器前进/后退，并把解析后的查询状态回传给调用方。 */
export function subscribeToQuery(
  listener: (filters: Filters) => void,
): () => void {
  const handler = () => listener(readQuery(window.location.search));
  window.addEventListener("popstate", handler);
  return () => window.removeEventListener("popstate", handler);
}

export function pageOf<T>(items: T[], page: number, size = 6) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(pages, Math.max(1, page));
  return {
    items: items.slice((current - 1) * size, current * size),
    current,
    pages,
  };
}

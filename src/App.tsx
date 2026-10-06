import { useEffect, useState } from "react";
import type { Filters, StatusFilter } from "./types";
import { useTaskSearch } from "./useTaskSearch";
import { pageOf, readQuery, subscribeToQuery, writeQuery } from "./query";
export default function App() {
  // 已提交并同步到地址栏的查询状态；输入框草稿单独保存，未提交不写 URL。
  const [filters, setFilters] = useState<Filters>(() =>
    readQuery(window.location.search),
  );
  const [draft, setDraft] = useState(filters.q);
  const { tasks, loading, error, settled } = useTaskSearch(
    filters.q,
    filters.status,
  );
  const view = pageOf(tasks, filters.page);
  function commit(next: Filters, mode: "push" | "replace") {
    writeQuery(next, mode);
    setFilters(next);
  }
  // 浏览器前进/后退：从地址栏恢复输入、筛选与页码，并触发对应查询。
  useEffect(
    () =>
      subscribeToQuery((next) => {
        setDraft(next.q);
        setFilters(next);
      }),
    [],
  );
  // 越界页码只在“当前条件”的查询成功返回后，按真实结果页数用 replace 修正；
  // 加载前的空列表或上一次查询结果都不会提前把页码改回 1。
  useEffect(() => {
    if (loading || error || !settled) return;
    if (settled.q !== filters.q || settled.status !== filters.status) return;
    if (view.current === filters.page) return;
    const next = { ...filters, page: view.current };
    writeQuery(next, "replace");
    setFilters(next);
  }, [loading, error, settled, filters, view.current]);
  function search(e: React.FormEvent) {
    e.preventDefault();
    const value = draft.trim();
    setDraft(value);
    // 查询：trim 搜索词、页码回 1、replace 当前历史项。
    commit({ ...filters, q: value, page: 1 }, "replace");
  }
  function changeStatus(status: StatusFilter) {
    // 筛选变化：push 新历史项，页码回 1。
    commit({ ...filters, status, page: 1 }, "push");
  }
  function goPage(page: number) {
    // 翻页：push 新历史项。
    commit({ ...filters, page }, "push");
  }
  return (
    <>
      <header>
        <div className="brand">
          TaskBoard<span>任务看板</span>
        </div>
      </header>
      <main>
        <h1>项目任务</h1>
        <p className="subtitle">搜索、筛选和查看团队任务。</p>
        <form className="toolbar" onSubmit={search}>
          <label className="search">
            搜索任务
            <input
              placeholder="搜索任务标题"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
          <label>
            状态
            <select
              value={filters.status}
              onChange={(e) => changeStatus(e.target.value as StatusFilter)}
            >
              <option value="ALL">全部状态</option>
              <option value="TODO">待办</option>
              <option value="DOING">进行中</option>
              <option value="DONE">已完成</option>
            </select>
          </label>
          <button className="primary">查询</button>
        </form>
        <p className="count muted" aria-live="polite">
          {tasks.length}项任务
        </p>
        <section className="panel" aria-label="任务列表" aria-busy={loading}>
          <div className="table-row table-head">
            <span>任务</span>
            <span>状态</span>
            <span className="owner">负责人</span>
          </div>
          {error ? (
            <div role="alert" className="error">
              {error}
            </div>
          ) : loading ? (
            <div role="status" className="state">
              正在查询…
            </div>
          ) : tasks.length === 0 ? (
            <div className="state">没有匹配的任务</div>
          ) : (
            view.items.map((t) => (
              <div className="table-row" key={t.id}>
                <div>
                  <div className="task-title">{t.title}</div>
                  <div className="task-detail">{t.description}</div>
                </div>
                <div>
                  <span className={"tag " + t.status}>{t.status}</span>
                </div>
                <span className="owner">{t.owner}</span>
              </div>
            ))
          )}
        </section>
        <nav className="pager" aria-label="分页">
          <button
            disabled={loading || view.current === 1}
            onClick={() => goPage(view.current - 1)}
          >
            上一页
          </button>
          <span>
            第{view.current}页 共{view.pages}页
          </span>
          <button
            disabled={loading || view.current === view.pages}
            onClick={() => goPage(view.current + 1)}
          >
            下一页
          </button>
        </nav>
      </main>
    </>
  );
}

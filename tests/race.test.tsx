import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Task } from "../src/types";

// 用受控 Promise 替换真实查询，精确控制每次请求的完成顺序与结果，
// 从而在没有固定 sleep 的前提下可重复地复现竞态。
vi.mock("../src/api", () => ({
  searchTasks: vi.fn(),
}));

import { searchTasks } from "../src/api";
import App from "../src/App";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function task(id: number, title: string): Task {
  return { id, title, description: "", status: "TODO", owner: "测试" };
}

/** 每次调用 searchTasks 都返回一个悬挂的受控 Promise，按调用次序记录。 */
let calls: Deferred<Task[]>[] = [];

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  calls = [];
  const mock = vi.mocked(searchTasks);
  mock.mockReset();
  mock.mockImplementation(() => {
    const d = deferred<Task[]>();
    calls.push(d);
    return d.promise;
  });
});

/** 切换状态筛选以触发下一次查询（渲染内的 act 由 RTL 处理）。 */
function changeStatus(value: string) {
  fireEvent.change(screen.getByLabelText("状态"), { target: { value } });
}

describe("useTaskSearch 异步竞态", () => {
  it("旧成功：新查询开始后旧请求才成功，其结果必须被丢弃", async () => {
    render(<App />);
    expect(calls).toHaveLength(1);

    changeStatus("DOING");
    expect(calls).toHaveLength(2);

    // 新查询先成功。
    await act(async () => calls[1].resolve([task(2, "新结果")]));
    expect(screen.getByText("新结果")).toBeInTheDocument();

    // 旧查询随后“成功”（模拟已来不及取消），不得覆盖新结果。
    await act(async () => calls[0].resolve([task(1, "旧结果")]));
    expect(screen.getByText("新结果")).toBeInTheDocument();
    expect(screen.queryByText("旧结果")).not.toBeInTheDocument();
  });

  it("旧失败：不得污染新查询的错误状态（新查询随后成功）", async () => {
    render(<App />);
    changeStatus("DOING");

    await act(async () => calls[0].reject(new Error("旧失败")));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await act(async () => calls[1].resolve([task(2, "新结果")]));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("新结果")).toBeInTheDocument();
  });

  it("新旧都失败：只显示新查询的错误，旧错误不覆盖", async () => {
    render(<App />);
    changeStatus("DOING");

    await act(async () => calls[0].reject(new Error("旧失败")));
    await act(async () => calls[1].reject(new Error("新失败")));

    expect(screen.getByRole("alert")).toHaveTextContent("新失败");
    expect(screen.queryByText("旧失败")).not.toBeInTheDocument();
  });

  it("旧请求成功结束时，新查询必须仍处于 Loading", async () => {
    render(<App />);
    changeStatus("DOING");
    expect(calls).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent("正在查询…");

    // 旧请求先结束：不得提前关闭新查询的 loading。
    await act(async () => calls[0].resolve([task(1, "旧结果")]));
    expect(screen.getByRole("status")).toHaveTextContent("正在查询…");
    expect(screen.queryByText("旧结果")).not.toBeInTheDocument();

    await act(async () => calls[1].resolve([task(2, "新结果")]));
    expect(screen.getByText("新结果")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("旧请求失败结束时，新查询仍处于 Loading 且不显示旧错误", async () => {
    render(<App />);
    changeStatus("DOING");

    await act(async () => calls[0].reject(new Error("旧失败")));
    expect(screen.getByRole("status")).toHaveTextContent("正在查询…");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await act(async () => calls[1].resolve([task(2, "新结果")]));
    expect(screen.getByText("新结果")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("最新查询失败后，再次查询可以成功恢复", async () => {
    render(<App />);
    await act(async () => calls[0].reject(new Error("查询失败")));
    expect(screen.getByRole("alert")).toHaveTextContent("查询失败");

    changeStatus("DONE");
    expect(calls).toHaveLength(2);
    await act(async () => calls[1].resolve([task(3, "恢复结果")]));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("恢复结果")).toBeInTheDocument();
  });
});

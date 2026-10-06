import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../src/App";
import { readQuery, writeQuery } from "../src/query";

/** 直接把地址栏设置到指定位置，模拟“首次进入/刷新”或历史项。 */
function setUrl(url: string) {
  window.history.replaceState(null, "", url);
}

beforeEach(() => {
  vi.restoreAllMocks();
  setUrl("/");
});

describe("readQuery：解析与容错", () => {
  it("解析 q/status/page，并正确解码中文、空格与 &", () => {
    expect(readQuery("?q=%E6%8E%A5%E5%8F%A3&status=DOING&page=2")).toEqual({
      q: "接口",
      status: "DOING",
      page: 2,
    });
    expect(readQuery("?q=%E6%8E%A5+%E5%8F%A3+%26+%E6%B5%8B%E8%AF%95")).toEqual({
      q: "接 口 & 测试",
      status: "ALL",
      page: 1,
    });
  });

  it("缺省回落：q 为空、status 为 ALL、page 为 1", () => {
    expect(readQuery("")).toEqual({ q: "", status: "ALL", page: 1 });
    expect(readQuery("?foo=1#hash")).toEqual({
      q: "",
      status: "ALL",
      page: 1,
    });
  });

  it("状态仅允许 ALL/TODO/DOING/DONE，未知或大小写不符回落 ALL", () => {
    for (const raw of ["BAD", "todo", "Doing", "all", "DONE2"]) {
      expect(readQuery(`?status=${raw}`).status).toBe("ALL");
    }
    expect(readQuery("?status=DONE").status).toBe("DONE");
  });

  it("非法页码回落 1：非正、非整数、非数值、超安全整数", () => {
    for (const raw of [
      "0",
      "-1",
      "1.5",
      "abc",
      "",
      "1e3",
      "  2",
      "99999999999999999999",
    ]) {
      expect(readQuery(`?page=${encodeURIComponent(raw)}`).page).toBe(1);
    }
    expect(readQuery("?page=3").page).toBe(3);
  });
});

describe("writeQuery：写入、编码与历史", () => {
  it("默认值省略，保留无关参数与 hash", () => {
    setUrl("/path?keep=1&q=old&status=DONE&page=4#section");
    writeQuery({ q: "", status: "ALL", page: 1 }, "push");
    expect(window.location.pathname).toBe("/path");
    expect(window.location.hash).toBe("#section");
    const params = new URLSearchParams(window.location.search);
    expect(params.get("keep")).toBe("1");
    expect(params.has("q")).toBe(false);
    expect(params.has("status")).toBe(false);
    expect(params.has("page")).toBe(false);
  });

  it("中文、空格、& 经 URLSearchParams 编码且可往返", () => {
    setUrl("/");
    writeQuery({ q: "接 口 & 测", status: "TODO", page: 2 }, "push");
    const raw = window.location.search;
    // 只有 status、page 两个分隔符；q 内部的 & 已被编码，中文与空格未以原文出现。
    expect(raw.split("&").length - 1).toBe(2);
    expect(raw).not.toContain(" ");
    expect(/[\u4e00-\u9fa5]/.test(raw)).toBe(false);
    expect(readQuery(raw)).toEqual({
      q: "接 口 & 测",
      status: "TODO",
      page: 2,
    });
  });

  it("push 与 replace 使用对应的历史 API", () => {
    setUrl("/");
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");

    writeQuery({ q: "a", status: "ALL", page: 1 }, "push");
    expect(push).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?q=a");

    writeQuery({ q: "a", status: "ALL", page: 2 }, "replace");
    expect(push).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe("?q=a&page=2");
  });
});

describe("App：URL 恢复与写入", () => {
  it("首次加载从 URL 恢复输入、筛选、页码并触发查询", async () => {
    setUrl("/?status=DONE&page=2");
    render(<App />);
    expect(screen.getByLabelText("状态")).toHaveValue("DONE");
    // DONE 共 8 项，第 2 页是最后 2 项。
    expect(await screen.findByText("长标题换行")).toBeInTheDocument();
    expect(screen.getByText("交付文档整理")).toBeInTheDocument();
    expect(screen.getByText("第2页 共2页")).toBeInTheDocument();
    // 合法页码不被改写。
    expect(readQuery(window.location.search)).toEqual({
      q: "",
      status: "DONE",
      page: 2,
    });
  });

  it("URL 非法状态与页码回落为默认值", async () => {
    setUrl("/?status=BAD&page=0");
    render(<App />);
    expect(screen.getByLabelText("状态")).toHaveValue("ALL");
    expect(await screen.findByText("第1页 共4页")).toBeInTheDocument();
  });

  it("未提交的输入框内容不写入 URL", async () => {
    const user = userEvent.setup();
    setUrl("/?q=%E6%8E%A5%E5%8F%A3");
    render(<App />);
    await screen.findByText("任务列表接口对接");

    const input = screen.getByLabelText("搜索任务");
    await user.type(input, "登录");
    expect(input).toHaveValue("接口登录");
    expect(readQuery(window.location.search).q).toBe("接口");
    expect(window.location.search).not.toContain("%E7%99%BB%E5%BD%95");
  });

  it("点击查询：搜索词 trim、页码回 1、使用 replace", async () => {
    const user = userEvent.setup();
    setUrl("/?page=3");
    render(<App />);
    await screen.findByText("第3页 共4页");

    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");

    await user.type(screen.getByLabelText("搜索任务"), "  登录  ");
    await user.click(screen.getByRole("button", { name: "查询" }));

    await screen.findByText("登录功能开发");
    expect(screen.getByText("第1页 共1页")).toBeInTheDocument();
    expect(replace).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(readQuery(window.location.search)).toEqual({
      q: "登录",
      status: "ALL",
      page: 1,
    });
  });
});

describe("App：历史与页码钳制", () => {
  it("改变状态筛选：push 历史且页码回 1", async () => {
    const user = userEvent.setup();
    setUrl("/?page=2");
    render(<App />);
    await screen.findByText("第2页 共4页");

    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");

    await user.selectOptions(screen.getByLabelText("状态"), "DOING");
    expect(push).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();

    await screen.findByText("第1页 共2页");
    expect(readQuery(window.location.search)).toEqual({
      q: "",
      status: "DOING",
      page: 1,
    });
  });

  it("翻页：push 历史，且后退/前进可恢复页码", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("第1页 共4页");

    const push = vi.spyOn(window.history, "pushState");
    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(push).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe("?page=2");
    await screen.findByText("第2页 共4页");

    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(window.location.search).toBe("?page=3");
    await screen.findByText("第3页 共4页");

    window.history.back();
    await waitFor(() => expect(window.location.search).toBe("?page=2"));
    await screen.findByText("第2页 共4页");

    window.history.forward();
    await waitFor(() => expect(window.location.search).toBe("?page=3"));
    await screen.findByText("第3页 共4页");
  });

  it("越界页码要等当前查询成功后才按真实结果用 replace 修正", async () => {
    setUrl("/?page=5");
    render(<App />);
    // 加载完成前绝不能依据空列表把页码提前改回 1。
    expect(readQuery(window.location.search).page).toBe(5);

    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");

    // ALL 共 24 项 → 4 页，5 应被钳制为 4，而不是 1。
    await screen.findByText("第4页 共4页");
    await waitFor(() => expect(readQuery(window.location.search).page).toBe(4));
    expect(push).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalled();
  });

  it("空结果保持第 1 页，并用 replace 规范化地址", async () => {
    setUrl("/?q=%E4%B8%8D%E5%AD%98%E5%9C%A8&page=7");
    render(<App />);
    expect(await screen.findByText("没有匹配的任务")).toBeInTheDocument();
    expect(screen.getByText("第1页 共1页")).toBeInTheDocument();
    await waitFor(() =>
      expect(readQuery(window.location.search)).toEqual({
        q: "不存在",
        status: "ALL",
        page: 1,
      }),
    );
  });

  it("浏览器后退/前进恢复输入、筛选并重新查询", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("第1页 共4页");

    // 历史项 A：筛选 DOING。
    await user.selectOptions(screen.getByLabelText("状态"), "DOING");
    await screen.findByText("第1页 共2页");
    expect(readQuery(window.location.search)).toEqual({
      q: "",
      status: "DOING",
      page: 1,
    });

    // 在同一历史项上提交搜索（replace）。
    await user.type(screen.getByLabelText("搜索任务"), "接口");
    await user.click(screen.getByRole("button", { name: "查询" }));
    await screen.findByText("任务列表接口对接");
    expect(readQuery(window.location.search)).toEqual({
      q: "接口",
      status: "DOING",
      page: 1,
    });

    // 后退：回到初始历史项，输入清空、筛选回到 ALL，并重新查询。
    window.history.back();
    await waitFor(() => expect(window.location.search).toBe(""));
    await waitFor(() =>
      expect(screen.getByLabelText("搜索任务")).toHaveValue(""),
    );
    expect(screen.getByLabelText("状态")).toHaveValue("ALL");
    await screen.findByText("第1页 共4页");

    // 前进：恢复输入、筛选并重新查询。
    window.history.forward();
    await waitFor(() =>
      expect(readQuery(window.location.search)).toEqual({
        q: "接口",
        status: "DOING",
        page: 1,
      }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("搜索任务")).toHaveValue("接口"),
    );
    expect(screen.getByLabelText("状态")).toHaveValue("DOING");
    await screen.findByText("任务列表接口对接");
  });
});

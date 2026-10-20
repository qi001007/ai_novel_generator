import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider, useToast } from "./ui";

function ToastProbe() {
  const { pushToast } = useToast();
  return <>
    <button onClick={() => pushToast("保存成功", "success")}>成功</button>
    <button onClick={() => pushToast("连接失败", "error")}>失败</button>
  </>;
}

describe("ToastProvider", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("auto closes success at four seconds and errors at eight seconds", () => {
    render(<ToastProvider><ToastProbe /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "成功" }));
    fireEvent.click(screen.getByRole("button", { name: "失败" }));
    expect(screen.getByText("保存成功")).toBeTruthy();
    expect(screen.getByText("连接失败")).toBeTruthy();
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByText("保存成功")).toBeNull();
    expect(screen.getByText("连接失败")).toBeTruthy();
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByText("连接失败")).toBeNull();
  });

  it("can be closed immediately", () => {
    render(<ToastProvider><ToastProbe /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "成功" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭通知" }));
    expect(screen.queryByText("保存成功")).toBeNull();
  });
});

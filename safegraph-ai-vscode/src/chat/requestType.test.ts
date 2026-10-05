import { inferRequestType } from "./requestType";

describe("inferRequestType", () => {
  it("routes the Review button prompt to the read-only review workflow", () => {
    expect(
      inferRequestType(
        "Review the current workspace changes. Focus on bugs, regressions, missing tests, and risky code. Give concise findings first with file paths."
      )
    ).toBe("review");
    expect(inferRequestType("đánh giá code trong file này")).toBe("review");
  });

  it("routes report requests to the report workflow", () => {
    expect(
      inferRequestType(
        "Write a project report for this workspace: overview, current build/test status, recent changes, issues and risks by severity, and recommended next steps."
      )
    ).toBe("report");
    expect(inferRequestType("viết báo cáo dự án")).toBe("report");
  });

  it("keeps fix requests on the debug workflow even when they mention a report or review", () => {
    expect(inferRequestType("fix the bug from this crash report")).toBe("bugfix/debug");
    expect(inferRequestType("review and fix the failing tests")).toBe("bugfix/debug");
    expect(inferRequestType("sửa lỗi build")).toBe("bugfix/debug");
  });

  it("falls back to the general workflow", () => {
    expect(inferRequestType("add a dark mode toggle to settings")).toBe("general coding task");
  });
});

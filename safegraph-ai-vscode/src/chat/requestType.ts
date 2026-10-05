/**
 * Classify a chat request so the agent can pick a workflow (review, report,
 * debug, TDD, ...). Pure function: keep it free of vscode imports so it stays testable.
 */
export function inferRequestType(text: string) {
  const normalized = text.toLowerCase();
  const asksForChanges = /\b(fix|repair|implement|apply)\b|sửa|khắc phục/i.test(normalized);
  if (/\breport\b|báo cáo/i.test(normalized) && !asksForChanges) {
    return "report";
  }
  if (/^\s*(please\s+)?(review|audit|code review)\b|^\s*(hãy\s+)?(review|đánh giá|kiểm tra code)/i.test(normalized) && !asksForChanges) {
    return "review";
  }
  if (/(diagnose|debug|reproduce|perf|performance|regression|fix|bug|error|traceback|lỗi|sửa|không chạy|failed|exception|diagnostic)/i.test(normalized)) {
    return "bugfix/debug";
  }
  if (/(unexpected non-whitespace|favicon|404|console error|browser console|load resource)/i.test(normalized)) {
    return "frontend-data/static-asset-debug";
  }
  if (/(tdd|test.?first|red.?green|regression test|integration test|unit test|kiểm thử|test)/i.test(normalized)) {
    return "tdd/test-first";
  }
  if (/(architecture|kiến trúc|refactor|deep module|seam|adapter|coupling|testability|maintainability|codebase|module)/i.test(normalized)) {
    return "architecture/refactor";
  }
  if (/(clarify|grill|spec|prd|domain|glossary|adr|context\.md|requirement|yêu cầu|ngữ cảnh)/i.test(normalized)) {
    return "domain-clarification";
  }
  if (/(prototype|throwaway|spike|mockup|mockups|sample data|demo data|variation|explore design|wireframe|mvp screen|giao diện mẫu|dữ liệu mẫu)/i.test(normalized)) {
    return "prototype";
  }
  if (/(build|package|release|version|cài|install|vsix|deploy|update)/i.test(normalized)) {
    return "build/release/update";
  }
  if (/(ui|html|css|frontend|mockup|website|dashboard|giao diện|design)/i.test(normalized)) {
    return "frontend/ui";
  }
  if (/(review|audit|kiểm tra|refactor|cleanup|format)/i.test(normalized)) {
    return "review/refactor";
  }
  return "general coding task";
}

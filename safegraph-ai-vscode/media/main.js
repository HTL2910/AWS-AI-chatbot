// Diff Viewer Toggle Handler
function initDiffViewerToggles() {
  document.addEventListener('click', (e) => {
    const toggle = e.target.closest('.diffToggle');
    if (!toggle) return;

    const targetId = toggle.getAttribute('data-target');
    const content = document.getElementById(targetId);
    if (!content) return;

    const isExpanded = content.style.display !== 'none';
    content.style.display = isExpanded ? 'none' : 'block';
    toggle.setAttribute('aria-expanded', !isExpanded);

    // Smooth scroll into view if expanding
    if (!isExpanded) {
      setTimeout(() => {
        content.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    }
  });
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  initDiffViewerToggles();
});

// Also initialize when new content is added
const originalAppendChild = Element.prototype.appendChild;
Element.prototype.appendChild = function(child) {
  const result = originalAppendChild.call(this, child);
  if (child.classList && child.classList.contains('diffViewer')) {
    initDiffViewerToggles();
  }
  return result;
};

// Parse and render enhanced diff
function renderEnhancedDiff(diffText) {
  // This will be called by the main rendering logic
  // For now, return the HTML that will be inserted
  const parser = new DiffParser();
  const files = parser.parse(diffText);
  const renderer = new DiffRenderer();
  return renderer.renderHTML(files);
}

(function () {
  const vscode = acquireVsCodeApi();

  const messagesEl = document.getElementById("messages");
  const formEl = document.getElementById("composer");
  const inputEl = document.getElementById("input");
  const sendEl = document.getElementById("send");
  const newChatEl = document.getElementById("newChat");
  const statusBadgeEl = document.getElementById("statusBadge");
  const emptyStateEl = document.getElementById("emptyState");
  const composerMetaEl = document.getElementById("composerMeta");
  const agentModeEl = document.getElementById("agentMode");
  const setKeyEl = document.getElementById("setKey");
  const checkKeyEl = document.getElementById("checkKey");
  const openLogEl = document.getElementById("openLog");
  const openHistoryEl = document.getElementById("openHistory");
  const attachFileEl = document.getElementById("attachFile");
  const addActiveFileEl = document.getElementById("addActiveFile");
  const addSelectionEl = document.getElementById("addSelection");
  const reviewWorkspaceEl = document.getElementById("reviewWorkspace");
  const fixDiagnosticsEl = document.getElementById("fixDiagnostics");
  const designMockupEl = document.getElementById("designMockup");
  const fileInputEl = document.getElementById("fileInput");
  const mentionEl = document.getElementById("mention");

  const assistantById = new Map();
  const assistantState = new Map(); // id -> { text, done, stopped }
  const messagePayloadById = new Map();
  const taggedFiles = new Map(); // path -> label
  const attachments = new Map(); // id -> { id, name, text, size, mime }
  let currentMessageId = null; // track current streaming message
  let lastSubmit = { text: "", at: 0 };
  let lastAssistantFinal = { text: "", at: 0 };
  let loadingTicker = null;
  let pendingCommandFeedback = null;
  let agentMode = document.body?.dataset?.agentDefault !== "false";
  const taggedFilesEl = document.createElement("div");
  taggedFilesEl.className = "taggedFilesList";
  taggedFilesEl.hidden = true;
  formEl.parentElement.insertBefore(taggedFilesEl, formEl);

  const attachmentsEl = document.createElement("div");
  attachmentsEl.className = "taggedFilesList";
  attachmentsEl.hidden = true;
  formEl.parentElement.insertBefore(attachmentsEl, taggedFilesEl);

  const rootEl = document.querySelector(".root");

  function setStatus(text, tone) {
    if (!statusBadgeEl) return;
    statusBadgeEl.textContent = text;
    statusBadgeEl.dataset.tone = tone || "idle";
  }

  function updateEmptyState() {
    if (!emptyStateEl) return;
    const hasMessages = messagesEl.querySelector(".msg, .cmdPanel");
    emptyStateEl.hidden = !!hasMessages;
  }

  function updateComposerMeta() {
    if (!composerMetaEl) return;
    const contextCount = taggedFiles.size + attachments.size;
    const parts = [agentMode ? "Agent on" : "Agent off"];
    if (contextCount) {
      parts.push(`${contextCount} context item${contextCount === 1 ? "" : "s"}`);
    } else {
      parts.push("no context attached");
    }
    if (currentMessageId) parts.push("running");
    composerMetaEl.textContent = parts.join(" · ");
  }

  function drainPendingCommandFeedback() {
    if (!pendingCommandFeedback || currentMessageId) return;
    const text = pendingCommandFeedback;
    pendingCommandFeedback = null;
    setTimeout(() => {
      if (currentMessageId) {
        pendingCommandFeedback = text;
        return;
      }
      sendPrompt(text, { agentMode: true });
    }, 0);
  }

  function resetCurrentRequest() {
    currentMessageId = null;
    sendEl.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
    sendEl.disabled = false;
    setStatus("Ready", "idle");
    updateComposerMeta();
    drainPendingCommandFeedback();
  }

  function stopCurrentRequest() {
    if (!currentMessageId) return;
    const stoppedId = currentMessageId;
    vscode.postMessage({ type: "stop" });
    setAssistantText(stoppedId, "Stopped.", true);
    assistantState.set(stoppedId, { text: "Stopped.", done: true, stopped: true });
    resetCurrentRequest();
    setStatus("Stopped", "idle");
  }

  function updateLoadingElapsed() {
    document.querySelectorAll(".msg.assistant.loading").forEach((el) => {
      const startedAt = Number(el.getAttribute("data-started-at") || Date.now());
      const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      const target = el.querySelector(".elapsed");
      if (target) target.textContent = `${elapsed}s elapsed`;
    });
  }

  function ensureLoadingTicker() {
    if (loadingTicker) return;
    loadingTicker = setInterval(updateLoadingElapsed, 1000);
  }

  function stopLoadingTickerIfIdle() {
    if (document.querySelector(".msg.assistant.loading")) return;
    if (loadingTicker) {
      clearInterval(loadingTicker);
      loadingTicker = null;
    }
  }

  function clearChat() {
    messagesEl.innerHTML = "";
    if (emptyStateEl) messagesEl.appendChild(emptyStateEl);
    inputEl.value = "";
    autosizeInput();
    mentionEl.hidden = true;
    mentionEl.innerHTML = "";
    assistantById.clear();
    assistantState.clear();
    messagePayloadById.clear();
    lastSubmit = { text: "", at: 0 };
    lastAssistantFinal = { text: "", at: 0 };
    resetCurrentRequest();
    updateEmptyState();
    vscode.postMessage({ type: "clearChat" });
  }

  if (newChatEl) {
    newChatEl.addEventListener("click", (e) => {
      e.preventDefault();
      clearChat();
      inputEl.focus();
    });
  }

  function renderAgentMode() {
    if (!agentModeEl) return;
    agentModeEl.textContent = agentMode ? "Agent On" : "Agent Off";
    agentModeEl.classList.toggle("active", agentMode);
    updateComposerMeta();
  }

  function autosizeInput() {
    inputEl.style.height = "auto";
    const maxHeight = 160;
    inputEl.style.height = `${Math.min(inputEl.scrollHeight, maxHeight)}px`;
    inputEl.style.overflowY = inputEl.scrollHeight > maxHeight ? "auto" : "hidden";
  }

  if (agentModeEl) {
    agentModeEl.addEventListener("click", (e) => {
      e.preventDefault();
      agentMode = !agentMode;
      renderAgentMode();
      inputEl.focus();
    });
    renderAgentMode();
  }

  if (setKeyEl) {
    setKeyEl.addEventListener("click", (e) => {
      e.preventDefault();
      vscode.postMessage({ type: "setApiKey" });
      inputEl.focus();
    });
  }

  if (checkKeyEl) {
    checkKeyEl.addEventListener("click", (e) => {
      e.preventDefault();
      vscode.postMessage({ type: "checkApiKey" });
      inputEl.focus();
    });
  }

  if (openLogEl) {
    openLogEl.addEventListener("click", (e) => {
      e.preventDefault();
      vscode.postMessage({ type: "openLog" });
      inputEl.focus();
    });
  }

  if (openHistoryEl) {
    openHistoryEl.addEventListener("click", (e) => {
      e.preventDefault();
      vscode.postMessage({ type: "openHistory" });
      inputEl.focus();
    });
  }

  document.querySelectorAll(".emptyAction").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const prompt = btn.getAttribute("data-prompt") || "";
      if (prompt) sendPrompt(prompt, prompt.includes("Fix") ? { agentMode: true } : undefined);
    });
  });

  function hasExplicitUserRequest(text) {
    const s = String(text || "").toLowerCase();
    return /\b(fix|repair|debug|analy[sz]e|explain|create|build|implement|update|change|refactor|review|design|mockup|make|add|remove|delete|run|test|solve|help)\b/.test(s) ||
      /(sửa|fix|lỗi|phân tích|giải thích|tạo|làm|thiết kế|mockup|cập nhật|đổi|thêm|xoá|xóa|chạy|kiểm tra|review|debug|giúp)/i.test(s);
  }

  function looksLikePastedBug(text) {
    const s = String(text || "");
    return /traceback \(most recent call last\)|\b(file|line)\s+\d+|syntaxerror|indentationerror|typeerror|referenceerror|valueerror|keyerror|attributeerror|importerror|modulenotfounderror|exception|stack trace|npm err!|error:\s|failed:|apply failed|corrupt patch|hunk out of range|context mismatch|cannot find module|enoent|eaddrinuse|port \d+ is in use|ts\d{4}|eslint|pytest|assertionerror/i.test(s);
  }

  function looksLikeCodeOnly(text) {
    const s = String(text || "").trim();
    if (!s) return false;
    const lineCount = s.split(/\r?\n/).length;
    const codeSignals = [
      /^\s*(import|from|def|class|function|const|let|var|export|interface|type|@app\.route|if __name__|try:|except\b)/m,
      /[{}()[\];]|=>|<\/?[a-z][\s>]/i,
      /^@@\s+-\d/m,
      /^diff --git\s+/m,
      /^---\s+(a\/|\/dev\/null)/m,
      /^\+\+\+\s+(b\/|\/dev\/null)/m
    ];
    const proseWords = s.match(/\b(the|please|can|you|hãy|giúp|muốn|cần|làm|sửa|tạo|thiết|kế)\b/gi) || [];
    return lineCount >= 3 && codeSignals.some((re) => re.test(s)) && proseWords.length < 4;
  }

  function looksLikePrototypeRequest(text) {
    const s = String(text || "").toLowerCase();
    return /\b(mockup|prototype|wireframe|dashboard|landing|website|web app|app screen|ui|ux|design|sample data|demo data|mvp)\b/i.test(s) ||
      /(giao diện|mẫu|mockup|thiết kế|dữ liệu mẫu|app|dashboard|trang web|website|màn hình)/i.test(s);
  }

  function normalizeUserIntentForAgent(text) {
    const original = String(text || "").trim();
    if (!original || hasExplicitUserRequest(original)) return original;

    if (looksLikePastedBug(original)) {
      return [
        "User pasted an error/stack trace without an explicit request.",
        "Infer the task as: analyze the error, identify the affected files, fix the underlying code/config issue, validate the fix, and run safe verification commands if available.",
        "If a code change is needed, return a clean unified diff only; Safegraph will apply it automatically.",
        "",
        "Pasted content:",
        original
      ].join("\n");
    }

    if (looksLikeCodeOnly(original)) {
      return [
        "User pasted code or a malformed patch without an explicit request.",
        "Infer the task as: inspect it for bugs, incomplete edits, duplicate code, syntax errors, and integration issues. Fix the project files if needed and validate the result.",
        "If no file path is obvious, use the active file and workspace context.",
        "",
        "Pasted content:",
        original
      ].join("\n");
    }

    if (looksLikePrototypeRequest(original)) {
      return [
        "User described a UI/product mockup request.",
        "Infer the missing details and create or update a runnable mockup with realistic sample data. Do not ask for more details unless the request is unsafe or destructive.",
        "Prefer the tagged file if present. If no app structure is obvious, create a standalone HTML mockup that can be opened directly in a browser.",
        "This is an early prototype: prioritize an inspectable visual result over production completeness.",
        "",
        "User request:",
        original
      ].join("\n");
    }

    return original;
  }

  function appendInlineMarkdown(parent, text) {
    const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    let last = 0;
    for (const m of String(text || "").matchAll(re)) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      const token = m[0];
      if (token.startsWith("**")) {
        const strong = document.createElement("strong");
        strong.textContent = token.slice(2, -2);
        parent.appendChild(strong);
      } else {
        const code = document.createElement("code");
        code.textContent = token.slice(1, -1);
        parent.appendChild(code);
      }
      last = m.index + token.length;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  function renderMarkdown(container, text) {
    container.innerHTML = "";
    const source = String(text || "").replace(/\r\n/g, "\n");
    const blocks = source.split(/```(\w+)?\n([\s\S]*?)```/g);

    function renderPlainBlock(blockText) {
      const lines = blockText.split("\n");
      let paragraph = [];
      let list = null;

      function flushParagraph() {
        if (!paragraph.length) return;
        const p = document.createElement("p");
        appendInlineMarkdown(p, paragraph.join("\n"));
        container.appendChild(p);
        paragraph = [];
      }

      function flushList() {
        if (!list) return;
        container.appendChild(list);
        list = null;
      }

      for (const line of lines) {
        const bullet = line.match(/^\s*[-*]\s+(.+)$/);
        if (bullet) {
          flushParagraph();
          if (!list) list = document.createElement("ul");
          const li = document.createElement("li");
          appendInlineMarkdown(li, bullet[1]);
          list.appendChild(li);
          continue;
        }
        if (!line.trim()) {
          flushParagraph();
          flushList();
          continue;
        }
        flushList();
        paragraph.push(line);
      }

      flushParagraph();
      flushList();
    }

    for (let i = 0; i < blocks.length; i += 3) {
      renderPlainBlock(blocks[i] || "");
      if (i + 2 < blocks.length) {
        const lang = blocks[i + 1] || "";
        const body = blocks[i + 2] || "";
        const pre = document.createElement("pre");
        pre.className = "codeBlock";
        const copy = document.createElement("button");
        copy.type = "button";
        copy.className = "codeCopyBtn";
        copy.textContent = "Copy";
        copy.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(body.trim());
            copy.textContent = "Copied";
            setTimeout(() => (copy.textContent = "Copy"), 1200);
          } catch {
            copy.textContent = "Failed";
            setTimeout(() => (copy.textContent = "Copy"), 1200);
          }
        });
        const code = document.createElement("code");
        code.textContent = body.trim();
        if (lang) code.dataset.lang = lang;
        pre.appendChild(copy);
        pre.appendChild(code);
        container.appendChild(pre);
      }
    }
  }

  function appendMessage(role, text) {
    const row = document.createElement("div");
    row.className = `msg ${role}`;

    // Render assistant messages with diff blocks + Apply buttons.
    if (role === "assistant" && typeof text === "string" && text.includes("```diff")) {
      const parts = text.split(/```diff\s*/);
      const before = parts.shift();
      if (before) {
        const p = document.createElement("div");
        p.className = "markdown";
        renderMarkdown(p, before.trim());
        row.appendChild(p);
      }

      for (const part of parts) {
        const endIdx = part.indexOf("```");
        const diffBody = (endIdx >= 0 ? part.slice(0, endIdx) : part).trim();
        const rest = endIdx >= 0 ? part.slice(endIdx + 3).trim() : "";

        const block = document.createElement("div");
        block.className = "diffBlock";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "applyBtn";
        btn.textContent = "Apply";
        btn.addEventListener("click", () => {
          btn.style.display = "none";
          vscode.postMessage({ type: "applyDiff", diff: diffBody });
        });

        const pre = document.createElement("pre");
        pre.className = "diff";
        pre.textContent = diffBody;

        block.appendChild(btn);
        block.appendChild(pre);
        row.appendChild(block);

        if (rest) {
          const p2 = document.createElement("div");
          p2.className = "markdown";
          renderMarkdown(p2, rest);
          row.appendChild(p2);
        }
      }
    } else {
      row.textContent = text;
    }

    messagesEl.appendChild(row);
    updateEmptyState();
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return row;
  }

  function splitUnifiedDiffByFile(diffBody) {
    const lines = String(diffBody || "").replace(/\r\n/g, "\n").split("\n");
    const chunks = [];
    let cur = [];

    if (lines.some((l) => l.startsWith("diff --git "))) {
      for (const l of lines) {
        if (l.startsWith("diff --git ") && cur.length > 0) {
          chunks.push(cur.join("\n"));
          cur = [];
        }
        cur.push(l);
      }
      if (cur.length) chunks.push(cur.join("\n"));
      return chunks.map((c) => c.trim()).filter(Boolean);
    }

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.startsWith("--- ") && cur.length > 0) {
        chunks.push(cur.join("\n"));
        cur = [];
      }
      cur.push(l);
    }
    if (cur.length) chunks.push(cur.join("\n"));
    return chunks
      .map((c) => c.trim())
      .filter(Boolean);
  }

  function extractFileLabel(diffChunk) {
    const m = String(diffChunk).match(/^\+\+\+\s+([^\t\r\n]+).*$/m);
    if (!m) return "file";
    return m[1].replace(/^[ab]\//, "");
  }

  function stripDiffBlocks(text) {
    return String(text || "").replace(/```diff\s*[\s\S]*?```/gi, "").trim();
  }

  function summarizeUnifiedDiff(fullDiffBody) {
    const files = splitUnifiedDiffByFile(fullDiffBody);
    const summaries = files.map((fileDiff) => {
      const label = extractFileLabel(fileDiff);
      const isNew = /^---\s+\/dev\/null/m.test(fileDiff);
      const isDeleted = /^\+\+\+\s+\/dev\/null/m.test(fileDiff);
      let added = 0;
      let removed = 0;
      for (const line of String(fileDiff || "").split(/\r?\n/)) {
        if (line.startsWith("+++") || line.startsWith("---")) continue;
        if (line.startsWith("+")) added += 1;
        if (line.startsWith("-")) removed += 1;
      }
      return { label, added, removed, isNew, isDeleted };
    });
    return summaries;
  }

  function renderChangeSummary(container, fullDiffBody, hasModelSummary) {
    const summaries = summarizeUnifiedDiff(fullDiffBody);
    if (!summaries.length) return;

    const box = document.createElement("div");
    box.className = "changeSummary";

    const title = document.createElement("div");
    title.className = "changeSummaryTitle";
    title.textContent = hasModelSummary ? "Tổng kết thay đổi được phát hiện" : "Tổng kết thay đổi";
    box.appendChild(title);

    const list = document.createElement("ul");
    for (const item of summaries.slice(0, 12)) {
      const li = document.createElement("li");
      const action = item.isNew ? "Tạo mới" : item.isDeleted ? "Xoá" : "Cập nhật";
      li.textContent = `${action} ${item.label} (${item.added} dòng thêm, ${item.removed} dòng xoá)`;
      list.appendChild(li);
    }
    if (summaries.length > 12) {
      const li = document.createElement("li");
      li.textContent = `Và ${summaries.length - 12} file khác.`;
      list.appendChild(li);
    }
    box.appendChild(list);

    const hint = document.createElement("div");
    hint.className = "changeSummaryHint";
    hint.textContent = hasModelSummary
      ? "Phần dưới là patch chi tiết để kiểm tra hoặc apply."
      : "AI chưa ghi giải thích riêng, nên Safegraph tự tóm tắt từ patch. Phần dưới là patch chi tiết để kiểm tra hoặc apply.";
    box.appendChild(hint);

    container.appendChild(box);
  }

  function renderDiffPreview(container, fullDiffBody) {
    const files = splitUnifiedDiffByFile(fullDiffBody);
    const header = document.createElement("div");
    header.className = "diffHeader";

    const title = document.createElement("div");
    title.className = "diffTitle";
    title.textContent = `Diff (${files.length} file${files.length === 1 ? "" : "s"})`;

    header.appendChild(title);

    const list = document.createElement("div");
    list.className = "diffList";

    for (const fileDiff of files) {
      const item = document.createElement("div");
      item.className = "diffItem";

      const top = document.createElement("div");
      top.className = "diffItemTop";

      const label = document.createElement("div");
      label.className = "diffFile";
      label.textContent = extractFileLabel(fileDiff);

      top.appendChild(label);

      const pre = document.createElement("pre");
      pre.className = "diff";
      pre.textContent = fileDiff;

      const bottom = document.createElement("div");
      bottom.className = "diffItemBottom";

      const btnDiscard = document.createElement("button");
      btnDiscard.type = "button";
      btnDiscard.className = "discardBtn";
      btnDiscard.textContent = "Discard";
      btnDiscard.addEventListener("click", () => {
        item.remove();
      });

      const btnApply = document.createElement("button");
      btnApply.type = "button";
      btnApply.className = "applyBtn";
      btnApply.textContent = "Apply";
      btnApply.addEventListener("click", () => {
        btnApply.style.display = "none";
        vscode.postMessage({ type: "applyDiff", diff: fileDiff });
      });

      bottom.appendChild(btnDiscard);
      bottom.appendChild(btnApply);

      item.appendChild(top);
      item.appendChild(pre);
      item.appendChild(bottom);
      list.appendChild(item);
    }

    const footer = document.createElement("div");
    footer.className = "diffFooter";

    const discardAll = document.createElement("button");
    discardAll.type = "button";
    discardAll.className = "discardBtn";
    discardAll.textContent = "Discard All";
    discardAll.addEventListener("click", () => {
      container.remove();
    });

    const applyAll = document.createElement("button");
    applyAll.type = "button";
    applyAll.className = "applyBtn";
    applyAll.textContent = "Apply All";
    applyAll.addEventListener("click", () => {
      container.querySelectorAll(".applyBtn").forEach((el) => {
        if (el instanceof HTMLElement) {
          el.style.display = "none";
        }
      });
      vscode.postMessage({ type: "applyDiff", diff: fullDiffBody });
    });

    footer.appendChild(discardAll);
    footer.appendChild(applyAll);

    container.appendChild(header);
    container.appendChild(list);
    container.appendChild(footer);
  }

  function renderAutoAppliedChangeSet(msg) {
    const container = document.createElement("div");
    container.className = "liveChangePanel";
    container.dataset.changeSetId = msg.id || "";

    const header = document.createElement("div");
    header.className = "liveChangeHeader";

    const badge = document.createElement("div");
    badge.className = "liveChangeBadge";
    badge.textContent = "Live";

    const titleWrap = document.createElement("div");
    titleWrap.className = "liveChangeTitleWrap";

    const title = document.createElement("div");
    title.className = "liveChangeTitle";
    title.textContent = "Changes applied to workspace";

    const status = document.createElement("div");
    status.className = "liveChangeStatus";
    status.textContent = msg.summary || "Review the applied files, then keep or discard all changes.";

    titleWrap.append(title, status);
    header.append(badge, titleWrap);

    const body = document.createElement("div");
    body.className = "liveChangeBody";

    const summaries = summarizeUnifiedDiff(msg.diff || "");
    const fileDiffs = splitUnifiedDiffByFile(msg.diff || "");
    const stats = document.createElement("div");
    stats.className = "liveChangeStats";
    const totals = summaries.reduce(
      (acc, item) => {
        acc.added += item.added;
        acc.removed += item.removed;
        return acc;
      },
      { added: 0, removed: 0 }
    );
    [
      `${summaries.length} file${summaries.length === 1 ? "" : "s"}`,
      `+${totals.added}`,
      `-${totals.removed}`
    ].forEach((text, index) => {
      const pill = document.createElement("span");
      pill.className = index === 1 ? "statAdd" : index === 2 ? "statRemove" : "";
      pill.textContent = text;
      stats.appendChild(pill);
    });
    body.appendChild(stats);

    const toolbar = document.createElement("div");
    toolbar.className = "liveReviewToolbar";

    const copyDiff = document.createElement("button");
    copyDiff.type = "button";
    copyDiff.className = "miniBtn";
    copyDiff.textContent = "Copy diff";
    copyDiff.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(String(msg.diff || ""));
        copyDiff.textContent = "Copied";
        setTimeout(() => (copyDiff.textContent = "Copy diff"), 1200);
      } catch {
        copyDiff.textContent = "Copy failed";
        setTimeout(() => (copyDiff.textContent = "Copy diff"), 1200);
      }
    });

    const expandAll = document.createElement("button");
    expandAll.type = "button";
    expandAll.className = "miniBtn";
    expandAll.textContent = "Expand all";
    expandAll.addEventListener("click", () => {
      body.querySelectorAll(".liveFileReview").forEach((item) => {
        item.open = true;
      });
    });

    const collapseAll = document.createElement("button");
    collapseAll.type = "button";
    collapseAll.className = "miniBtn";
    collapseAll.textContent = "Collapse all";
    collapseAll.addEventListener("click", () => {
      body.querySelectorAll(".liveFileReview").forEach((item) => {
        item.open = false;
      });
    });

    toolbar.append(copyDiff, expandAll, collapseAll);
    body.appendChild(toolbar);

    const fileList = document.createElement("div");
    fileList.className = "liveFileList";
    summaries.slice(0, 12).forEach((item) => {
      const row = document.createElement("div");
      row.className = "liveFileRow";

      const name = document.createElement("div");
      name.className = "liveFileName";
      name.textContent = item.label;

      const meta = document.createElement("div");
      meta.className = "liveFileMeta";
      const action = item.isNew ? "Created" : item.isDeleted ? "Deleted" : "Updated";
      meta.textContent = `${action}  +${item.added} / -${item.removed}`;

      row.append(name, meta);
      fileList.appendChild(row);
    });
    if (summaries.length > 12) {
      const more = document.createElement("div");
      more.className = "liveFileMore";
      more.textContent = `+${summaries.length - 12} more file${summaries.length - 12 === 1 ? "" : "s"}`;
      fileList.appendChild(more);
    }
    body.appendChild(fileList);

    const reviewList = document.createElement("div");
    reviewList.className = "liveReviewList";
    for (const [index, fileDiff] of fileDiffs.entries()) {
      const fileSummary = summaries[index] || summarizeUnifiedDiff(fileDiff)[0];
      const item = document.createElement("details");
      item.className = "liveFileReview";
      item.open = index === 0 && fileDiffs.length <= 3;

      const summary = document.createElement("summary");
      summary.className = "liveFileReviewSummary";

      const label = document.createElement("span");
      label.className = "liveFileReviewName";
      label.textContent = extractFileLabel(fileDiff);

      const badge = document.createElement("span");
      badge.className = "liveFileReviewMeta";
      const action = fileSummary?.isNew ? "Created" : fileSummary?.isDeleted ? "Deleted" : "Updated";
      badge.textContent = `${action}  +${fileSummary?.added || 0} / -${fileSummary?.removed || 0}`;

      summary.append(label, badge);
      item.appendChild(summary);

      const pre = document.createElement("pre");
      pre.className = "diff liveReviewDiff";
      pre.textContent = fileDiff;

      item.appendChild(pre);
      reviewList.appendChild(item);
    }
    body.appendChild(reviewList);

    const footer = document.createElement("div");
    footer.className = "diffFooter";

    const discardAll = document.createElement("button");
    discardAll.type = "button";
    discardAll.className = "discardBtn";
    discardAll.textContent = "Discard All";
    discardAll.addEventListener("click", () => {
      setLiveChangeBusy(container, "Discarding...");
      vscode.postMessage({ type: "discardChangeSet", id: msg.id });
    });

    const keep = document.createElement("button");
    keep.type = "button";
    keep.className = "applyBtn";
    keep.textContent = "Keep Changes";
    keep.addEventListener("click", () => {
      setLiveChangeBusy(container, "Keeping applied changes...");
      vscode.postMessage({ type: "keepChangeSet", id: msg.id });
    });

    footer.append(discardAll, keep);
    container.append(header, body, footer);
    messagesEl.appendChild(container);
    updateEmptyState();
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setLiveChangeBusy(container, label) {
    container.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });
    const status = container.querySelector(".liveChangeStatus");
    if (status) status.textContent = label;
  }

  function updateLiveChangePanel(msg) {
    const container = Array.from(messagesEl.querySelectorAll(".liveChangePanel")).find(
      (item) => item.dataset.changeSetId === (msg.id || "")
    );
    if (!container) return;
    const status = container.querySelector(".liveChangeStatus");
    if (status) status.textContent = msg.message || msg.status || "";
    container.dataset.status = msg.status || "";

    if (msg.status === "error") {
      container.querySelectorAll("button").forEach((button) => {
        button.disabled = false;
      });
      return;
    }

    container.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });
  }

  function renderToolStatus(msg) {
    const id = String(msg.id || "tools");
    let panel = document.getElementById(id);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = id;
      panel.className = "toolStatusPanel";
      messagesEl.appendChild(panel);
    }

    const tools = Array.isArray(msg.tools) ? msg.tools : [];
    panel.dataset.done = msg.done ? "true" : "false";
    panel.innerHTML = "";

    const title = document.createElement("div");
    title.className = "toolStatusTitle";
    const finished = tools.filter((tool) => tool.status === "success" || tool.status === "error").length;
    title.textContent = `Tools ${finished}/${tools.length}`;
    panel.appendChild(title);

    for (const tool of tools) {
      const row = document.createElement("div");
      row.className = "toolStatusRow";
      row.dataset.status = tool.status || "queued";

      const name = document.createElement("span");
      name.className = "toolStatusName";
      name.textContent = String(tool.name || "tool").replace(/^safegraph__/, "");

      const status = document.createElement("span");
      status.className = "toolStatusBadge";
      status.textContent = String(tool.status || "queued");

      row.append(name, status);
      if (tool.detail) {
        const detail = document.createElement("span");
        detail.className = "toolStatusDetail";
        detail.textContent = String(tool.detail);
        row.appendChild(detail);
      }
      panel.appendChild(row);
    }

    messagesEl.scrollTop = messagesEl.scrollHeight;
    updateEmptyState();
  }

  function setAssistantText(id, text, done) {
    let el = assistantById.get(id);
    if (!el) {
      el = appendMessage("assistant", "");
      assistantById.set(id, el);
      currentMessageId = id;
      sendEl.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>`;
      setStatus("Thinking", "busy");
      updateComposerMeta();
    }
    assistantState.set(id, { text, done: !!done });

    if (done) {
      const finalText = String(text || "").trim();
      const now = Date.now();
      if (finalText && finalText === lastAssistantFinal.text && now - lastAssistantFinal.at < 5000) {
        el.remove();
        assistantById.delete(id);
        assistantState.delete(id);
        if (currentMessageId === id) resetCurrentRequest();
        return;
      }
      lastAssistantFinal = { text: finalText, at: now };
    }

    // During streaming (done=false), render partial text with loader animation.
    if (!done) {
      el.classList.add("loading");
      setStatus("Thinking", "busy");
      if (!el.getAttribute("data-started-at")) {
        el.setAttribute("data-started-at", String(Date.now()));
      }
      let content = el.querySelector(".assistantContent");
      if (!content) {
        el.innerHTML = "";
        content = document.createElement("div");
        content.className = "assistantContent";
        el.appendChild(content);

        const elapsed = document.createElement("div");
        elapsed.className = "elapsed";
        elapsed.textContent = "0s elapsed";
        el.appendChild(elapsed);

        const loader = document.createElement("div");
        loader.className = "loadingDots";
        loader.innerHTML = "<span></span><span></span><span></span>";
        el.appendChild(loader);
      }
      content.textContent = String(text || "Thinking...");
      updateLoadingElapsed();
      ensureLoadingTicker();
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return;
    }

    // Replace contents on final.
    el.classList.remove("loading");
    el.removeAttribute("data-started-at");
    stopLoadingTickerIfIdle();
    el.innerHTML = "";
    const rawText = String(text || "");
    const hasDiff = rawText.includes("```diff");
    const diffBodies = [];
    if (hasDiff) {
      const re = /```diff\s*([\s\S]*?)```/gi;
      for (const m of rawText.matchAll(re)) {
        const diffBody = String(m[1] || "").trim();
        if (diffBody) diffBodies.push(diffBody);
      }
    }

    const proseText = hasDiff ? stripDiffBlocks(rawText) : rawText;
    const tmp = document.createElement("div");
    tmp.className = "markdown";
    if (proseText.trim()) {
      renderMarkdown(tmp, proseText);
      el.appendChild(tmp);
    }

    if (diffBodies.length > 0) {
      renderChangeSummary(el, diffBodies.join("\n\n"), proseText.trim().length > 0);
    }

    const actionBar = document.createElement("div");
    actionBar.className = "messageActions";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "miniBtn";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(String(text || ""));
        copyBtn.textContent = "Copied";
        setTimeout(() => (copyBtn.textContent = "Copy"), 1200);
      } catch {
        copyBtn.textContent = "Copy failed";
        setTimeout(() => (copyBtn.textContent = "Copy"), 1200);
      }
    });

    const regenBtn = document.createElement("button");
    regenBtn.type = "button";
    regenBtn.className = "miniBtn";
    regenBtn.textContent = "Regenerate";
    regenBtn.addEventListener("click", () => {
      const payload = messagePayloadById.get(id);
      if (!payload || currentMessageId) return;
      const nextId = String(Date.now());
      lastSubmit = { text: "", at: 0 };
      lastAssistantFinal = { text: "", at: 0 };
      messagePayloadById.set(nextId, { ...payload, id: nextId, ts: Date.now() });
      setAssistantText(nextId, "Regenerating...", false);
      vscode.postMessage({ ...payload, id: nextId, ts: Date.now() });
    });

    actionBar.appendChild(copyBtn);
    actionBar.appendChild(regenBtn);
    el.appendChild(actionBar);

    // Reset button and currentMessageId on done
    if (currentMessageId === id) {
      resetCurrentRequest();
    }

    // Diff previews (per-file) only on done=true.
    if (diffBodies.length > 0) {
      if (diffBodies.length > 0) {
        const container = document.createElement("div");
        container.className = "diffBlock";
        renderDiffPreview(container, diffBodies.join("\n\n"));
        el.appendChild(container);
      }
    }

    // Add Continue button if message was stopped
    const state = assistantState.get(id);
    if (state && state.stopped && text && typeof text === "string") {
      const actionBar = document.createElement("div");
      actionBar.className = "messageActions";

      const continueBtn = document.createElement("button");
      continueBtn.type = "button";
      continueBtn.className = "applyBtn";
      continueBtn.textContent = "Continue";
      continueBtn.addEventListener("click", () => {
        continueBtn.disabled = true;
        continueBtn.textContent = "Continuing...";
        const promptText =
          "Continue from where you left off. Do not repeat earlier text.\n\n" +
          "Previous output:\n" +
          String(text);
        vscode.postMessage({
          type: "userMessage",
          id: String(Date.now()),
          text: promptText,
          ts: Date.now(),
          taggedFiles: Array.from(taggedFiles.keys()),
          attachments: Array.from(attachments.values()).map((a) => ({ name: a.name, text: a.text }))
        });
      });

      actionBar.appendChild(continueBtn);
      el.appendChild(actionBar);
    }

    messagesEl.scrollTop = messagesEl.scrollHeight;
    updateEmptyState();
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type === "assistantMessage")
      setAssistantText(msg.id || "assistant", msg.text, msg.done);
    if (msg.type === "error") {
      appendMessage("error", msg.message);
      resetCurrentRequest();
    }
    if (msg.type === "contextItem") addContextItem(msg);
    if (msg.type === "fileSuggestions") renderSuggestions(msg.items || []);
    if (msg.type === "commandProposed") renderCommandPanel(msg.items || []);
    if (msg.type === "commandUpdate") updateCommand(msg);
    if (msg.type === "toolStatus") renderToolStatus(msg);
    if (msg.type === "commandFinishedAndFeedback") {
      pendingCommandFeedback = String(msg.text || "");
      drainPendingCommandFeedback();
    }
    if (msg.type === "autoAppliedChangeSet") renderAutoAppliedChangeSet(msg);
    if (msg.type === "changeSetUpdate") updateLiveChangePanel(msg);
  });

  attachFileEl.addEventListener("click", (e) => {
    e.preventDefault();
    vscode.postMessage({ type: "pickFilesOrFolders" });
    inputEl.focus();
  });

  if (addActiveFileEl) {
    addActiveFileEl.addEventListener("click", (e) => {
      e.preventDefault();
      vscode.postMessage({ type: "addActiveFile" });
      inputEl.focus();
    });
  }

  if (addSelectionEl) {
    addSelectionEl.addEventListener("click", (e) => {
      e.preventDefault();
      vscode.postMessage({ type: "addSelection" });
      inputEl.focus();
    });
  }

  function sendPrompt(text, overrides) {
    if (currentMessageId) {
      return;
    }

    const rawText = String(text || inputEl.value || "");
    const cleanText = rawText.trim();
    if (!cleanText) return;

    function clearSentInput() {
      inputEl.value = "";
      inputEl.blur();
      autosizeInput();
      mentionEl.hidden = true;
      mentionEl.innerHTML = "";
      setTimeout(() => inputEl.focus(), 0);
    }

    const now = Date.now();
    if (cleanText === lastSubmit.text && now - lastSubmit.at < 2500) {
      clearSentInput();
      inputEl.focus();
      return;
    }
    lastSubmit = { text: cleanText, at: now };

    const id = String(Date.now());
    clearSentInput();
    setTimeout(clearSentInput, 0);
    appendMessage("user", cleanText);
    setAssistantText(id, "Preparing request...", false);
    setStatus("Preparing", "busy");
    inputEl.focus();
    const inferredPrototype = looksLikePrototypeRequest(cleanText);
    const agentText = normalizeUserIntentForAgent(cleanText);

    const payload = {
      type: "userMessage",
      id,
      text: agentText,
      ts: Date.now(),
      agentMode: inferredPrototype ? true : agentMode,
      taggedFiles: Array.from(taggedFiles.keys()),
      attachments: Array.from(attachments.values()).map((a) => ({ name: a.name, text: a.text })),
      ...(overrides || {})
    };
    messagePayloadById.set(id, payload);
    vscode.postMessage(payload);
    updateComposerMeta();
  }

  if (reviewWorkspaceEl) {
    reviewWorkspaceEl.addEventListener("click", (e) => {
      e.preventDefault();
      sendPrompt(
        "Review the current workspace changes. Focus on bugs, regressions, missing tests, and risky code. Give concise findings first with file paths."
      );
    });
  }

  if (fixDiagnosticsEl) {
    fixDiagnosticsEl.addEventListener("click", (e) => {
      e.preventDefault();
      sendPrompt(
        "Fix the current diagnostics, type errors, and obvious failing code in this workspace. If changes are needed, return a clean unified diff.",
        { agentMode: true }
      );
    });
  }

  if (designMockupEl) {
    designMockupEl.addEventListener("click", (e) => {
      e.preventDefault();
      sendPrompt(
        "Create an inspectable UI mockup now. Infer the product requirements from the current project, tagged files, screenshots, and user context. Use realistic sample data and enough interaction/states to judge the workflow. Prefer editing the tagged file or existing app entry; if no app structure is obvious, create a standalone HTML mockup that opens directly in a browser. Prioritize a runnable prototype over production completeness.",
        { agentMode: true }
      );
    });
  }

  const MAX_TEXT_FILE_BYTES = 800 * 1024; // 800KB per text file
  const MAX_IMAGE_FILE_BYTES = 5 * 1024 * 1024; // 5MB per image
  const MAX_OTHER_FILE_BYTES = 2 * 1024 * 1024; // 2MB per non-text file
  const MAX_TOTAL_BYTES = 20 * 1024 * 1024; // 20MB total
  const MAX_IMAGE_DATA_URL_CHARS = 650_000;
  const MAX_DROPPED_FOLDER_FILES = 80;
  const acceptedTextPattern = /\.(txt|md|json|js|ts|tsx|jsx|css|html|yaml|yml|py|java|c|cpp|h|hpp|cs|rs|go|sh|ps1|cmd|toml|xml|sql)$/i;
  const acceptedImagePattern = /\.(png|jpe?g|gif|webp|bmp)$/i;

  function currentAttachmentBytes() {
    let sum = 0;
    for (const a of attachments.values()) sum += a.size || 0;
    return sum;
  }

  function renderAttachments() {
    attachmentsEl.innerHTML = "";
    if (attachments.size === 0) {
      attachmentsEl.hidden = true;
      updateComposerMeta();
      return;
    }
    attachmentsEl.hidden = false;

    const title = document.createElement("div");
    title.className = "taggedFilesTitle";
    title.textContent = `Attachments (${attachments.size})`;
    attachmentsEl.appendChild(title);

    const list = document.createElement("div");
    list.className = "taggedFilesList";

    for (const [id, a] of attachments) {
      const item = document.createElement("div");
      item.className = "taggedFileItem";

      const nameEl = document.createElement("div");
      nameEl.className = "taggedFileName";
      nameEl.textContent = a.name || "file";
      nameEl.title = `${a.name} (${Math.round((a.size || 0) / 1024)} KB)`;

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "taggedFileRemove";
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        attachments.delete(id);
        renderAttachments();
      });

      item.appendChild(nameEl);
      item.appendChild(removeBtn);
      list.appendChild(item);
    }

    attachmentsEl.appendChild(list);
    updateComposerMeta();
  }

  function addContextItem(item) {
    if (!item || typeof item !== "object") return;
    if (item.kind === "file" && item.path) {
      taggedFiles.set(item.path, item.label || item.path);
      renderTaggedFiles();
      setStatus("Context added", "ok");
      return;
    }
    if (item.kind === "attachment" && item.text) {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const name = item.name || "selection";
      const text = String(item.text || "");
      attachments.set(id, {
        id,
        name,
        text,
        size: text.length,
        mime: "text/plain"
      });
      renderAttachments();
      setStatus("Attachment added", "ok");
    }
  }

  async function readFileAsText(file) {
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error("read failed"));
      r.onload = () => resolve(String(r.result || ""));
      r.readAsText(file);
    });
  }

  async function readFileAsDataUrl(file) {
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error("read failed"));
      r.onload = () => resolve(String(r.result || ""));
      r.readAsDataURL(file);
    });
  }

  function attachmentLimitFor(file, name, mime) {
    if (mime.startsWith("text/") || acceptedTextPattern.test(name)) return MAX_TEXT_FILE_BYTES;
    if (mime.startsWith("image/") || acceptedImagePattern.test(name)) return MAX_IMAGE_FILE_BYTES;
    return MAX_OTHER_FILE_BYTES;
  }

  async function attachFilesFromList(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    for (const item of files) {
      const file = item && item.file ? item.file : item;
      if (!file) continue;
      const displayName = String((item && item.name) || file.webkitRelativePath || file.name || "file");
      const mime = String(file.type || "");
      const limit = attachmentLimitFor(file, displayName, mime);
      if ((file.size || 0) > limit) {
        appendMessage("error", `Attachment too large: ${displayName} (max ${Math.round(limit / 1024 / 1024 * 10) / 10}MB)`);
        continue;
      }
      if (currentAttachmentBytes() + (file.size || 0) > MAX_TOTAL_BYTES) {
        appendMessage("error", `Attachments total too large (max ${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)}MB)`);
        break;
      }

      const name = displayName;
      let text = `[binary file: ${name}, ${Math.round((file.size || 0) / 1024)}KB]`;
      if (mime.startsWith("text/") || acceptedTextPattern.test(name)) {
        try {
          text = await readFileAsText(file);
        } catch {
          text = `[file could not be read as text: ${name}]`;
        }
      } else if (mime.startsWith("image/") || acceptedImagePattern.test(name)) {
        try {
          const dataUrl = await readFileAsDataUrl(file);
          const clipped = dataUrl.length > MAX_IMAGE_DATA_URL_CHARS
            ? `${dataUrl.slice(0, MAX_IMAGE_DATA_URL_CHARS)}...[image data truncated]`
            : dataUrl;
          text = [
            `[image attachment: ${name}]`,
            `mime: ${mime || "image/unknown"}`,
            `size: ${Math.round((file.size || 0) / 1024)}KB`,
            `data_url_preview: ${clipped}`
          ].join("\n");
        } catch {
          text = `[image attachment could not be read: ${name}, ${Math.round((file.size || 0) / 1024)}KB]`;
        }
      }

      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      attachments.set(id, { id, name, text, size: file.size || 0, mime });
    }

    renderAttachments();
  }

  async function fileFromEntry(entry) {
    return await new Promise((resolve, reject) => {
      try {
        entry.file(resolve, reject);
      } catch (e) {
        reject(e);
      }
    });
  }

  async function readDirectoryEntries(reader) {
    const all = [];
    for (;;) {
      const batch = await new Promise((resolve, reject) => {
        try {
          reader.readEntries(resolve, reject);
        } catch (e) {
          reject(e);
        }
      });
      if (!batch || batch.length === 0) break;
      all.push(...batch);
    }
    return all;
  }

  async function collectEntryFiles(entry, out) {
    if (!entry || out.length >= MAX_DROPPED_FOLDER_FILES) return;
    if (entry.isFile) {
      const file = await fileFromEntry(entry);
      const name = String(entry.fullPath || file.name || "file").replace(/^\/+/, "");
      out.push({ file, name });
      return;
    }
    if (!entry.isDirectory) return;

    const dirName = String(entry.name || "");
    if ([".git", "node_modules", "dist", "build", "out", "venv", ".venv", "__pycache__", ".next", ".cache"].includes(dirName)) {
      return;
    }

    const children = await readDirectoryEntries(entry.createReader());
    for (const child of children) {
      if (out.length >= MAX_DROPPED_FOLDER_FILES) break;
      await collectEntryFiles(child, out);
    }
  }

  async function collectFilesFromDataTransferItems(items) {
    const out = [];
    const list = Array.from(items || []);
    for (const item of list) {
      if (!item || item.kind !== "file") continue;
      const getEntry = item.webkitGetAsEntry || item.getAsEntry;
      const entry = typeof getEntry === "function" ? getEntry.call(item) : null;
      if (entry) {
        await collectEntryFiles(entry, out);
      }
      if (out.length >= MAX_DROPPED_FOLDER_FILES) break;
    }
    return out;
  }

  function parseDroppedUris(dataTransfer) {
    if (!dataTransfer || typeof dataTransfer.getData !== "function") return [];
    
    try {
      const explorerData = dataTransfer.getData("application/vnd.code.tree.workspaceExplorer");
      if (explorerData) {
        const parsed = JSON.parse(explorerData);
        if (Array.isArray(parsed)) {
          return parsed.map(item => {
            if (typeof item === "string") return item;
            if (item && item.scheme && item.path) return `${item.scheme}://${item.authority || ''}${item.path}`;
            if (item && item.path) return `file://${item.path}`;
            return "";
          }).filter(Boolean);
        }
      }
    } catch (e) {
      console.error("Failed to parse workspaceExplorer data", e);
    }

    const raw =
      dataTransfer.getData("text/uri-list") ||
      dataTransfer.getData("text/plain") ||
      dataTransfer.getData("text");
    return String(raw || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .filter((line) => line.startsWith("file:") || line.startsWith("/") || line.startsWith("vscode-remote:"));
  }

  if (fileInputEl) {
    fileInputEl.addEventListener("change", async (e) => {
      const input = e.target;
      await attachFilesFromList(input.files);
      // allow selecting the same file again
      input.value = "";
    });
  }

  function renderSuggestions(items) {
    if (!Array.isArray(items) || items.length === 0) {
      mentionEl.hidden = true;
      mentionEl.innerHTML = "";
      return;
    }
    mentionEl.hidden = false;
    mentionEl.innerHTML = "";
    for (const it of items) {
      const row = document.createElement("div");
      row.className = "mentionItem";
      const left = document.createElement("div");
      left.textContent = it.label || it.path;
      const right = document.createElement("div");
      right.className = "mentionPath";
      right.textContent = it.path;
      row.appendChild(left);
      row.appendChild(right);
      row.addEventListener("click", () => {
        taggedFiles.set(it.path, it.label || it.path);
        // replace current @query token with a short token
        const val = String(inputEl.value || "");
        const caret = inputEl.selectionStart ?? val.length;
        const before = val.slice(0, caret);
        const after = val.slice(caret);
        const atIdx = before.lastIndexOf("@");
        if (atIdx >= 0) {
          const newBefore = before.slice(0, atIdx) + `@${it.label || it.path} `;
          inputEl.value = newBefore + after;
        }
        mentionEl.hidden = true;
        mentionEl.innerHTML = "";
        renderTaggedFiles();
        inputEl.focus();
      });
      mentionEl.appendChild(row);
    }
  }

  function maybeSuggestFiles() {
    const val = String(inputEl.value || "");
    const caret = inputEl.selectionStart ?? val.length;
    const before = val.slice(0, caret);
    const atIdx = before.lastIndexOf("@");
    if (atIdx < 0) {
      mentionEl.hidden = true;
      return;
    }
    const q = before.slice(atIdx + 1);
    // stop if whitespace or too long
    if (q.includes(" ") || q.length > 64) {
      mentionEl.hidden = true;
      return;
    }
    vscode.postMessage({ type: "suggestFiles", query: q });
  }

  inputEl.addEventListener("input", () => {
    autosizeInput();
    maybeSuggestFiles();
  });

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      mentionEl.hidden = true;
      mentionEl.innerHTML = "";
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!currentMessageId) sendPrompt(inputEl.value);
    }
  });

  function renderTaggedFiles() {
    taggedFilesEl.innerHTML = "";
    if (taggedFiles.size === 0) {
      taggedFilesEl.hidden = true;
      updateComposerMeta();
      return;
    }
    taggedFilesEl.hidden = false;
    const title = document.createElement("div");
    title.className = "taggedFilesTitle";
    title.textContent = `Tagged Files (${taggedFiles.size})`;
    taggedFilesEl.appendChild(title);

    const list = document.createElement("div");
    list.className = "taggedFilesList";
    for (const [path, label] of taggedFiles) {
      const item = document.createElement("div");
      item.className = "taggedFileItem";
      
      const nameEl = document.createElement("div");
      nameEl.className = "taggedFileName";
      nameEl.textContent = label || path.split(/[\\/]/).pop();
      nameEl.title = path;

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "taggedFileRemove";
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        taggedFiles.delete(path);
        renderTaggedFiles();
      });

      item.appendChild(nameEl);
      item.appendChild(removeBtn);
      list.appendChild(item);
    }
    taggedFilesEl.appendChild(list);
    updateComposerMeta();
  }

  // Drag-drop support for files and folders
  const dragOverlay = document.createElement("div");
  dragOverlay.className = "dragOverlay";
  dragOverlay.hidden = true;
  dragOverlay.textContent = "Drop files or folders to attach and reference...";
  dragOverlay.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  // Overlay should cover the entire Safegraph panel (like Cursor), not just the messages list.
  (rootEl || messagesEl.parentElement).appendChild(dragOverlay);

  // Only show overlay while the user is actively dragging FILES into the webview.
  // Some environments can emit stray dragenter events which would otherwise leave
  // the overlay visible until a reload.
  let fileDragDepth = 0;
  let hideOverlayTimer = null;

  function isFileOrUriDrag(e) {
    const dt = e && e.dataTransfer;
    if (!dt || !dt.types) return false;
    try {
      return Array.from(dt.types).some((t) => {
        const type = String(t || "").toLowerCase();
        return (
          type === "files" ||
          type === "public.file-url" ||
          type === "public.url" ||
          type === "text/uri-list" ||
          type === "text/plain" ||
          type.includes("uri-list") ||
          type.includes("file-url") ||
          type.includes("code.uri") ||
          type.includes("vscode")
        );
      });
    } catch {
      return false;
    }
  }

  function updateOverlayTextFromEvent(e) {
    const dt = e && e.dataTransfer;
    if (!dt || !dt.items) return;
    const names = [];
    for (let i = 0; i < dt.items.length; i += 1) {
      const item = dt.items[i];
      if (item && item.kind === "file") {
        names.push(item.getAsFile()?.name || "file");
      }
    }
    if (names.length > 0) {
      dragOverlay.textContent = `Drop to attach: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3} more` : ""}`;
    } else {
      dragOverlay.textContent = "Drop files or folders to attach and reference...";
    }
  }

  function showOverlay(e) {
    if (hideOverlayTimer) {
      clearTimeout(hideOverlayTimer);
      hideOverlayTimer = null;
    }
    if (e) updateOverlayTextFromEvent(e);
    dragOverlay.hidden = false;
  }

  function scheduleHideOverlay(delayMs) {
    if (hideOverlayTimer) clearTimeout(hideOverlayTimer);
    hideOverlayTimer = setTimeout(() => {
      fileDragDepth = 0;
      dragOverlay.hidden = true;
      hideOverlayTimer = null;
    }, delayMs);
  }

  function handleDragEnter(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!isFileOrUriDrag(e)) return;
    fileDragDepth++;
    showOverlay(e);
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!isFileOrUriDrag(e)) return;
    try {
      e.dataTransfer.dropEffect = "copy";
    } catch {}
    showOverlay(e);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    if (fileDragDepth > 0) fileDragDepth--;
    if (fileDragDepth <= 0) scheduleHideOverlay(60);
  }

  async function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    fileDragDepth = 0;
    dragOverlay.hidden = true;
    if (hideOverlayTimer) {
      clearTimeout(hideOverlayTimer);
      hideOverlayTimer = null;
    }

    const droppedUris = parseDroppedUris(e.dataTransfer);
    const entryFiles = await collectFilesFromDataTransferItems(e.dataTransfer.items);
    if (entryFiles.length > 0) {
      await attachFilesFromList(entryFiles);
      if (entryFiles.length >= MAX_DROPPED_FOLDER_FILES) {
        appendMessage("error", `Dropped folder truncated at ${MAX_DROPPED_FOLDER_FILES} files.`);
      }
      setStatus("Attached", "ok");
      return;
    }

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      await attachFilesFromList(files);
      setStatus("Attached", "ok");
      return;
    }

    if (droppedUris.length > 0) {
      vscode.postMessage({ type: "droppedUris", uris: droppedUris });
      setStatus("Adding context", "busy");
      return;
    }

    // Debug signal in UI (better than silent no-op)
    const types = Array.from(e.dataTransfer.types || []).join(", ");
    let debugText = "";
    try { debugText = e.dataTransfer.getData("text/plain") || ""; } catch (e) {}
    let uriList = "";
    try { uriList = e.dataTransfer.getData("text/uri-list") || ""; } catch (e) {}
    let treeData = "";
    try { treeData = e.dataTransfer.getData("application/vnd.code.tree.workspaceExplorer") || ""; } catch (e) {}
    appendMessage("error", `Drop empty. Types: ${types}. Plain: ${debugText}. URI: ${uriList}. Tree: ${treeData}`);
  }

  // Keep local listeners (they help with consistent leave depth), but global listeners below
  // ensure drops work anywhere in the panel.
  (rootEl || messagesEl.parentElement).addEventListener("dragenter", handleDragEnter);
  (rootEl || messagesEl.parentElement).addEventListener("dragover", handleDragOver);
  (rootEl || messagesEl.parentElement).addEventListener("dragleave", handleDragLeave);
  (rootEl || messagesEl.parentElement).addEventListener("drop", handleDrop);

  // Safety: hide overlay if the drag operation ends outside the webview.
  window.addEventListener("dragend", () => scheduleHideOverlay(0));
  window.addEventListener("drop", () => scheduleHideOverlay(0));
  window.addEventListener("dragleave", (e) => {
    // If the cursor leaves the window entirely, hide quickly.
    if (e && e.relatedTarget == null) scheduleHideOverlay(0);
  });

  // In VS Code webviews, drop can be blocked unless we preventDefault at the window/document level.
  // Use capture to ensure we win against any nested handlers.
  function globalDragOver(e) {
    if (!isFileOrUriDrag(e)) return;
    e.preventDefault();
    try {
      e.dataTransfer.dropEffect = "copy";
    } catch {}
    showOverlay();
  }

  function globalDrop(e) {
    if (!e || !e.dataTransfer) return;
    if (!isFileOrUriDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    void handleDrop(e);
  }

  function globalDragEnter(e) {
    if (!isFileOrUriDrag(e)) return;
    e.preventDefault();
    try {
      e.dataTransfer.dropEffect = "copy";
    } catch {}
    showOverlay();
  }

  window.addEventListener("dragover", globalDragOver, true);
  window.addEventListener("drop", globalDrop, true);
  window.addEventListener("dragenter", globalDragEnter, true);
  document.addEventListener("dragover", globalDragOver, true);
  document.addEventListener("drop", globalDrop, true);
  document.addEventListener("dragenter", globalDragEnter, true);

  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!currentMessageId) sendPrompt(inputEl.value);
  });

  sendEl.addEventListener("click", (e) => {
    e.preventDefault();
    if (currentMessageId) {
      stopCurrentRequest();
      return;
    }
    sendPrompt(inputEl.value);
  });

  vscode.postMessage({ type: "ready" });
  autosizeInput();

  const cmdState = new Map(); // id -> { cmd, status, output }
  const cmdPanel = document.createElement("div");
  cmdPanel.className = "cmdPanel";
  cmdPanel.hidden = true;
  messagesEl.parentElement.insertBefore(cmdPanel, messagesEl);

  function renderCommandPanel(items) {
    if (!Array.isArray(items) || items.length === 0) return;
    cmdPanel.hidden = false;
    for (const it of items) {
      cmdState.set(it.id, {
        cmd: it.cmd,
        status: it.decision === "deny" ? "denied" : "queued",
        decision: it.decision,
        reason: it.reason || "",
        output: ""
      });
    }
    redrawCommands(items.map((it) => it.id));
  }

  function redrawCommands(ids) {
    cmdPanel.innerHTML = "";
    const title = document.createElement("div");
    title.className = "cmdTitle";
    title.textContent = "Terminal";
    cmdPanel.appendChild(title);

    for (const id of ids) {
      const st = cmdState.get(id);
      if (!st) continue;

      const row = document.createElement("div");
      row.className = "cmdRow";

      const cmd = document.createElement("div");
      cmd.className = "cmdText";
      cmd.textContent = `${st.cmd}${st.decision === "allow" ? "  [auto]" : st.decision === "ask" ? "  [approval needed]" : ""}`;
      if (st.reason) cmd.title = st.reason;

      const actions = document.createElement("div");
      actions.className = "cmdActions";

      const status = document.createElement("div");
      status.className = "cmdStatus";
      status.textContent = st.status;

      const run = document.createElement("button");
      run.type = "button";
      run.className = "applyBtn";
      run.textContent = st.decision === "ask" ? "Run" : "Run";
      run.disabled = st.status !== "queued" || st.decision === "allow" || st.decision === "deny";
      run.addEventListener("click", () => {
        vscode.postMessage({ type: "runCommand", id, cmd: st.cmd });
        st.status = "running";
        redrawCommands(ids);
      });

      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "discardBtn";
      cancel.textContent = st.status === "running" ? "Stop" : "Cancel";
      cancel.disabled = st.status !== "running";
      cancel.addEventListener("click", () => {
        vscode.postMessage({ type: "cancelCommand", id });
      });

      const fix = document.createElement("button");
      fix.type = "button";
      fix.className = "applyBtn";
      fix.textContent = "Fix with AI";
      fix.disabled = st.status !== "error";
      fix.addEventListener("click", () => {
        const terminalLog = String(st.output || "").slice(-12000);
        sendPrompt(
          [
            "Auto-debug this failed terminal command. Use the terminal log, active file, diagnostics, and repository context to find the root cause.",
            "If a code/config change is needed, return a clean unified diff so Safegraph can apply it. Include safe verification commands after the diff.",
            "",
            `Command: ${st.cmd}`,
            "",
            "Terminal log:",
            terminalLog || "(no terminal output captured)"
          ].join("\n"),
          {
            agentMode: true,
            attachments: [
              ...Array.from(attachments.values()).map((a) => ({ name: a.name, text: a.text })),
              { name: `terminal-${id}.log`, text: terminalLog || "(no terminal output captured)" }
            ]
          }
        );
      });

      actions.appendChild(status);
      actions.appendChild(run);
      actions.appendChild(cancel);
      actions.appendChild(fix);

      row.appendChild(cmd);
      row.appendChild(actions);

      const out = document.createElement("pre");
      out.className = "cmdOut";
      out.textContent = st.output || (st.decision === "ask" ? `Needs approval: ${st.reason}` : "");

      cmdPanel.appendChild(row);
      cmdPanel.appendChild(out);
    }
  }

  function updateCommand(msg) {
    const st = cmdState.get(msg.id);
    if (!st) return;
    if (msg.status) st.status = msg.status;
    if (msg.output) st.output = (st.output + msg.output).slice(-8000);
    if (msg.status === "running") setStatus("Running command", "busy");
    if (msg.status === "success") setStatus("Command passed", "ok");
    if (msg.status === "error") setStatus("Command failed", "error");
    // redraw all
    redrawCommands(Array.from(cmdState.keys()));
  }

  updateEmptyState();
  updateComposerMeta();
  setStatus("Ready", "idle");
})();

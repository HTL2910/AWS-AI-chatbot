(function () {
  const vscode = acquireVsCodeApi();

  const messagesEl = document.getElementById("messages");
  const formEl = document.getElementById("composer");
  const inputEl = document.getElementById("input");
  const sendEl = document.getElementById("send");
  const newChatEl = document.getElementById("newChat");
  const agentModeEl = document.getElementById("agentMode");
  const setKeyEl = document.getElementById("setKey");
  const checkKeyEl = document.getElementById("checkKey");
  const openLogEl = document.getElementById("openLog");
  const attachFileEl = document.getElementById("attachFile");
  const addActiveFileEl = document.getElementById("addActiveFile");
  const addSelectionEl = document.getElementById("addSelection");
  const reviewWorkspaceEl = document.getElementById("reviewWorkspace");
  const fixDiagnosticsEl = document.getElementById("fixDiagnostics");
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

  function resetCurrentRequest() {
    currentMessageId = null;
    sendEl.textContent = "Send";
    sendEl.disabled = false;
  }

  function stopCurrentRequest() {
    if (!currentMessageId) return;
    const stoppedId = currentMessageId;
    vscode.postMessage({ type: "stop" });
    setAssistantText(stoppedId, "Stopped.", true);
    resetCurrentRequest();
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
    assistantById.clear();
    assistantState.clear();
    messagePayloadById.clear();
    lastSubmit = { text: "", at: 0 };
    lastAssistantFinal = { text: "", at: 0 };
    resetCurrentRequest();
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

  function setAssistantText(id, text, done) {
    let el = assistantById.get(id);
    if (!el) {
      el = appendMessage("assistant", "");
      assistantById.set(id, el);
      currentMessageId = id;
      sendEl.textContent = "Stop";
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
    const tmp = document.createElement("div");
    tmp.className = "markdown";
    renderMarkdown(tmp, String(text || ""));
    el.appendChild(tmp);

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
    if (typeof text === "string" && text.includes("```diff")) {
      const re = /```diff\s*([\s\S]*?)```/gi;
      const diffBodies = [];
      for (const m of text.matchAll(re)) {
        const diffBody = String(m[1] || "").trim();
        if (diffBody) diffBodies.push(diffBody);
      }
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
      const currentText = String(inputEl.value || "");
      if (!currentText || currentText === rawText || currentText.trim() === cleanText) {
        inputEl.value = "";
        autosizeInput();
      }
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
    inputEl.focus();

    const payload = {
      type: "userMessage",
      id,
      text: cleanText,
      ts: Date.now(),
      agentMode,
      taggedFiles: Array.from(taggedFiles.keys()),
      attachments: Array.from(attachments.values()).map((a) => ({ name: a.name, text: a.text })),
      ...(overrides || {})
    };
    messagePayloadById.set(id, payload);
    vscode.postMessage(payload);
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

  const MAX_FILE_BYTES = 200 * 1024; // 200KB per file
  const MAX_TOTAL_BYTES = 800 * 1024; // 800KB total
  const MAX_DROPPED_FOLDER_FILES = 80;
  const acceptedTextPattern = /\.(txt|md|json|js|ts|tsx|jsx|css|html|yaml|yml|py|java|c|cpp|h|hpp|cs|rs|go|sh|ps1|cmd|toml|xml|sql)$/i;

  function currentAttachmentBytes() {
    let sum = 0;
    for (const a of attachments.values()) sum += a.size || 0;
    return sum;
  }

  function renderAttachments() {
    attachmentsEl.innerHTML = "";
    if (attachments.size === 0) {
      attachmentsEl.hidden = true;
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
  }

  function addContextItem(item) {
    if (!item || typeof item !== "object") return;
    if (item.kind === "file" && item.path) {
      taggedFiles.set(item.path, item.label || item.path);
      renderTaggedFiles();
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

  async function attachFilesFromList(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    for (const item of files) {
      const file = item && item.file ? item.file : item;
      if (!file) continue;
      const displayName = String((item && item.name) || file.webkitRelativePath || file.name || "file");
      if ((file.size || 0) > MAX_FILE_BYTES) {
        appendMessage("error", `Attachment too large: ${displayName} (max ${Math.round(MAX_FILE_BYTES / 1024)}KB)`);
        continue;
      }
      if (currentAttachmentBytes() + (file.size || 0) > MAX_TOTAL_BYTES) {
        appendMessage("error", `Attachments total too large (max ${Math.round(MAX_TOTAL_BYTES / 1024)}KB)`);
        break;
      }

      const mime = String(file.type || "");
      const name = displayName;
      let text = `[binary file: ${name}, ${Math.round((file.size || 0) / 1024)}KB]`;
      if (mime.startsWith("text/") || acceptedTextPattern.test(name)) {
        try {
          text = await readFileAsText(file);
        } catch {
          text = `[file could not be read as text: ${name}]`;
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
          type === "text/uri-list" ||
          type === "text/plain" ||
          type.includes("uri-list") ||
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
      return;
    }

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      await attachFilesFromList(files);
      return;
    }

    if (droppedUris.length > 0) {
      vscode.postMessage({ type: "droppedUris", uris: droppedUris });
      return;
    }

    // Debug signal in UI (better than silent no-op)
    appendMessage("error", "Drop received but no files or folders were attached (blocked by host or non-file drag).");
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
      cmd.textContent = `${st.cmd}${st.decision === "allow" ? "  [auto]" : st.decision === "ask" ? "  [needs approval]" : ""}`;
      if (st.reason) cmd.title = st.reason;

      const actions = document.createElement("div");
      actions.className = "cmdActions";

      const status = document.createElement("div");
      status.className = "cmdStatus";
      status.textContent = st.status;

      const run = document.createElement("button");
      run.type = "button";
      run.className = "applyBtn";
      run.textContent = "Run";
      run.disabled = st.status !== "queued" || st.decision === "allow" || st.decision === "deny";
      run.addEventListener("click", () => {
        vscode.postMessage({ type: "runCommand", id, cmd: st.cmd });
        st.status = "running";
        redrawCommands(ids);
      });

      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "discardBtn";
      cancel.textContent = "Cancel";
      cancel.disabled = st.status !== "running";
      cancel.addEventListener("click", () => {
        vscode.postMessage({ type: "cancelCommand", id });
      });

      actions.appendChild(status);
      actions.appendChild(run);
      actions.appendChild(cancel);

      row.appendChild(cmd);
      row.appendChild(actions);

      const out = document.createElement("pre");
      out.className = "cmdOut";
      out.textContent = st.output || "";

      cmdPanel.appendChild(row);
      cmdPanel.appendChild(out);
    }
  }

  function updateCommand(msg) {
    const st = cmdState.get(msg.id);
    if (!st) return;
    if (msg.status) st.status = msg.status;
    if (msg.output) st.output = (st.output + msg.output).slice(-8000);
    // redraw all
    redrawCommands(Array.from(cmdState.keys()));
  }
})();

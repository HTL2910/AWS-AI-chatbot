(function () {
  const vscode = acquireVsCodeApi();

  const messagesEl = document.getElementById("messages");
  const formEl = document.getElementById("composer");
  const inputEl = document.getElementById("input");
  const sendEl = document.getElementById("send");
  const attachFileEl = document.getElementById("attachFile");
  const fileInputEl = document.getElementById("fileInput");
  const mentionEl = document.getElementById("mention");

  const assistantById = new Map();
  const assistantState = new Map(); // id -> { text, done, stopped }
  const taggedFiles = new Map(); // path -> label
  const attachments = new Map(); // id -> { id, name, text, size, mime }
  let currentMessageId = null; // track current streaming message
  const taggedFilesEl = document.createElement("div");
  taggedFilesEl.className = "taggedFilesList";
  taggedFilesEl.hidden = true;
  formEl.parentElement.insertBefore(taggedFilesEl, formEl);

  const attachmentsEl = document.createElement("div");
  attachmentsEl.className = "taggedFilesList";
  attachmentsEl.hidden = true;
  formEl.parentElement.insertBefore(attachmentsEl, taggedFilesEl);

  const rootEl = document.querySelector(".root");

  function appendMessage(role, text) {
    const row = document.createElement("div");
    row.className = `msg ${role}`;

    // Render assistant messages with diff blocks + Apply buttons.
    if (role === "assistant" && typeof text === "string" && text.includes("```diff")) {
      const parts = text.split(/```diff\s*/);
      const before = parts.shift();
      if (before) {
        const p = document.createElement("div");
        p.className = "plain";
        p.textContent = before.trim();
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
          p2.className = "plain";
          p2.textContent = rest;
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
    // Very small splitter: groups by ---/+++ headers.
    const lines = String(diffBody || "").replace(/\r\n/g, "\n").split("\n");
    const chunks = [];
    let cur = [];
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

    // During streaming (done=false), render partial text with loader animation.
    if (!done) {
      el.classList.add("loading");
      let content = el.querySelector(".assistantContent");
      if (!content) {
        el.innerHTML = "";
        content = document.createElement("div");
        content.className = "assistantContent";
        el.appendChild(content);

        const loader = document.createElement("div");
        loader.className = "loadingDots";
        loader.innerHTML = "<span></span><span></span><span></span>";
        el.appendChild(loader);
      }
      content.textContent = String(text || "Thinking...");
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return;
    }

    // Replace contents on final.
    el.classList.remove("loading");
    el.innerHTML = "";
    const tmp = document.createElement("div");
    tmp.className = "plain";
    tmp.textContent = String(text || "");
    el.appendChild(tmp);

    // Reset button and currentMessageId on done
    if (currentMessageId === id) {
      currentMessageId = null;
      sendEl.textContent = "Send";
    }

    // Diff previews (per-file) only on done=true.
    if (typeof text === "string" && text.includes("```diff")) {
      const re = /```diff\s*([\s\S]*?)```/gi;
      for (const m of text.matchAll(re)) {
        const diffBody = String(m[1] || "").trim();
        if (!diffBody) continue;
        const container = document.createElement("div");
        container.className = "diffBlock";
        renderDiffPreview(container, diffBody);
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
    if (msg.type === "error") appendMessage("error", msg.message);
    if (msg.type === "fileSuggestions") renderSuggestions(msg.items || []);
    if (msg.type === "commandProposed") renderCommandPanel(msg.items || []);
    if (msg.type === "commandUpdate") updateCommand(msg);
  });

  attachFileEl.addEventListener("click", (e) => {
    e.preventDefault();
    // Cursor-like: attach local files (upload) instead of picking workspace paths.
    if (fileInputEl) fileInputEl.click();
  });

  const MAX_FILE_BYTES = 200 * 1024; // 200KB per file
  const MAX_TOTAL_BYTES = 800 * 1024; // 800KB total

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

    const acceptedTextPattern = /\.(txt|md|json|js|ts|tsx|jsx|css|html|yaml|yml|py|java|c|cpp|cs|rs|go|sh|ps1|cmd)$/i;

    for (const file of files) {
      if (!file) continue;
      if ((file.size || 0) > MAX_FILE_BYTES) {
        appendMessage("error", `Attachment too large: ${file.name} (max ${Math.round(MAX_FILE_BYTES / 1024)}KB)`);
        continue;
      }
      if (currentAttachmentBytes() + (file.size || 0) > MAX_TOTAL_BYTES) {
        appendMessage("error", `Attachments total too large (max ${Math.round(MAX_TOTAL_BYTES / 1024)}KB)`);
        break;
      }

      const mime = String(file.type || "");
      const name = String(file.name || "file");
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
    maybeSuggestFiles();
  });

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      mentionEl.hidden = true;
      mentionEl.innerHTML = "";
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

  // Drag-drop support for files
  const dragOverlay = document.createElement("div");
  dragOverlay.className = "dragOverlay";
  dragOverlay.hidden = true;
  dragOverlay.textContent = "Drop files to attach and reference...";
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

  function isFileDrag(e) {
    const dt = e && e.dataTransfer;
    if (!dt || !dt.types) return false;
    try {
      return Array.from(dt.types).includes("Files");
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
      dragOverlay.textContent = "Drop files to attach and reference...";
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
    if (!isFileDrag(e)) return;
    fileDragDepth++;
    showOverlay(e);
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!isFileDrag(e)) return;
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

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    fileDragDepth = 0;
    dragOverlay.hidden = true;
    if (hideOverlayTimer) {
      clearTimeout(hideOverlayTimer);
      hideOverlayTimer = null;
    }

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) {
      // Debug signal in UI (better than silent no-op)
      appendMessage("error", "Drop received but no files were attached (blocked by host or non-file drag).");
      return;
    }

    // Drag/drop = local upload (attachments), not workspace tagging.
    attachFilesFromList(files);
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
    if (!isFileDrag(e)) return;
    e.preventDefault();
    try {
      e.dataTransfer.dropEffect = "copy";
    } catch {}
    showOverlay();
  }

  function globalDrop(e) {
    if (!e || !e.dataTransfer) return;
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    handleDrop(e);
  }

  function globalDragEnter(e) {
    if (!isFileDrag(e)) return;
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
    
    // If currently streaming, stop the message instead of sending a new one
    if (currentMessageId) {
      vscode.postMessage({ type: "stop" });
      return;
    }
    
    const text = String(inputEl.value || "").trim();
    if (!text) return;
    const id = String(Date.now());
    appendMessage("user", text);
    inputEl.value = "";
    inputEl.focus();
    vscode.postMessage({
      type: "userMessage",
      id,
      text,
      ts: Date.now(),
      taggedFiles: Array.from(taggedFiles.keys()),
      attachments: Array.from(attachments.values()).map((a) => ({ name: a.name, text: a.text }))
    });
  });

  vscode.postMessage({ type: "ready" });

  const cmdState = new Map(); // id -> { cmd, status, output }
  const cmdPanel = document.createElement("div");
  cmdPanel.className = "cmdPanel";
  cmdPanel.hidden = true;
  messagesEl.parentElement.insertBefore(cmdPanel, messagesEl);

  function renderCommandPanel(items) {
    if (!Array.isArray(items) || items.length === 0) return;
    cmdPanel.hidden = false;
    for (const it of items) {
      cmdState.set(it.id, { cmd: it.cmd, status: it.decision === "deny" ? "denied" : "queued", output: "" });
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
      cmd.textContent = st.cmd;

      const actions = document.createElement("div");
      actions.className = "cmdActions";

      const status = document.createElement("div");
      status.className = "cmdStatus";
      status.textContent = st.status;

      const run = document.createElement("button");
      run.type = "button";
      run.className = "applyBtn";
      run.textContent = "Run";
      run.disabled = st.status !== "queued";
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

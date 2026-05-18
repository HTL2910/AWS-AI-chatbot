(function () {
  const vscode = acquireVsCodeApi();

  const messagesEl = document.getElementById("messages");
  const formEl = document.getElementById("composer");
  const inputEl = document.getElementById("input");
  const setKeyEl = document.getElementById("setKey");
  const sendEl = document.getElementById("send");
  const dockRightEl = document.getElementById("dockRight");
  const stopEl = document.getElementById("stop");
  const mentionEl = document.getElementById("mention");

  const assistantById = new Map();
  const assistantState = new Map(); // id -> { text, done }
  const taggedFiles = new Map(); // path -> label

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
    }
    assistantState.set(id, { text, done: !!done });

    // During streaming (done=false), render plain text only to avoid resetting interactive UI repeatedly.
    if (!done) {
      el.textContent = text;
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return;
    }

    // Replace contents on final.
    el.innerHTML = "";
    const tmp = document.createElement("div");
    tmp.className = "plain";
    tmp.textContent = String(text || "");
    el.appendChild(tmp);

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

  setKeyEl.addEventListener("click", () => {
    vscode.postMessage({ type: "setApiKey" });
  });

  dockRightEl.addEventListener("click", () => {
    vscode.postMessage({ type: "moveRight" });
  });

  stopEl.addEventListener("click", () => {
    vscode.postMessage({ type: "stop" });
  });

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

  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
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
      taggedFiles: Array.from(taggedFiles.keys())
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

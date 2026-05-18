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

  function setAssistantText(id, text) {
    let el = assistantById.get(id);
    if (!el) {
      el = appendMessage("assistant", "");
      assistantById.set(id, el);
    }
    // Replace contents
    el.innerHTML = "";
    // Reuse renderer: call appendMessage logic by temporarily rendering into el.
    // Minimal: support diff blocks with Apply.
    const tmp = document.createElement("div");
    // Use the same rendering logic as appendMessage for assistant content
    if (typeof text === "string" && text.includes("```diff")) {
      const parts = text.split(/```diff\s*/);
      const before = parts.shift();
      if (before) {
        const p = document.createElement("div");
        p.className = "plain";
        p.textContent = before.trim();
        tmp.appendChild(p);
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
          vscode.postMessage({ type: "applyDiff", diff: diffBody });
        });
        const pre = document.createElement("pre");
        pre.className = "diff";
        pre.textContent = diffBody;
        block.appendChild(btn);
        block.appendChild(pre);
        tmp.appendChild(block);
        if (rest) {
          const p2 = document.createElement("div");
          p2.className = "plain";
          p2.textContent = rest;
          tmp.appendChild(p2);
        }
      }
    } else {
      tmp.textContent = text;
    }
    el.appendChild(tmp);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type === "assistantMessage") setAssistantText(msg.id || "assistant", msg.text);
    if (msg.type === "error") appendMessage("error", msg.message);
    if (msg.type === "fileSuggestions") renderSuggestions(msg.items || []);
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
})();

import React, { useState, useEffect, useRef } from "react";
import { Send, Settings, Play, XCircle, TerminalSquare, RotateCcw, Square } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getVSCodeAPI } from "./vscode";
import "./index.css";

const vscode = getVSCodeAPI();

interface Message {
  role: "user" | "assistant";
  text: string;
  id: string;
}

interface ProposedCommand {
  id: string;
  cmd: string;
  decision: "deny" | "ask" | "allow";
  reason: string;
}

interface CommandState {
  id: string;
  cmd: string;
  status: "proposed" | "queued" | "running" | "success" | "error" | "canceled";
  output: string;
  exitCode?: number;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [commands, setCommands] = useState<Record<string, CommandState>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const commandsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === "assistantMessage") {
        if (msg.done) setIsProcessing(false);
        else setIsProcessing(true);
        
        setMessages((prev) => {
          const existing = prev.find((m) => m.id === msg.id);
          if (existing) {
            return prev.map((m) => (m.id === msg.id ? { ...m, text: msg.text } : m));
          }
          return [...prev, { role: "assistant", text: msg.text, id: msg.id }];
        });
      } else if (msg.type === "commandProposed") {
        const items = msg.items as ProposedCommand[];
        setCommands((prev) => {
          const next = { ...prev };
          for (const item of items) {
            if (!next[item.id]) {
              next[item.id] = { id: item.id, cmd: item.cmd, status: "proposed", output: "" };
            }
          }
          return next;
        });
      } else if (msg.type === "commandUpdate") {
        setCommands((prev) => {
          const current = prev[msg.id];
          if (!current) return prev;
          let newOutput = current.output;
          if (msg.output) {
            newOutput = current.output + (current.output && !current.output.endsWith("\n") ? "\n" : "") + msg.output;
          }
          return {
            ...prev,
            [msg.id]: {
              ...current,
              status: msg.status,
              output: newOutput,
              exitCode: msg.exitCode !== undefined ? msg.exitCode : current.exitCode,
            },
          };
        });
      } else if (msg.type === "commandFinishedAndFeedback") {
        setIsProcessing(true);
        const id = Date.now().toString();
        // Send the output back to the AI as a background message
        vscode.postMessage({ type: "userMessage", text: msg.text, id, ts: Date.now() });
      } else if (msg.type === "error") {
        setIsProcessing(false);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    commandsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [commands]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;
    setIsProcessing(true);
    const id = Date.now().toString();
    setMessages((prev) => [...prev, { role: "user", text: input, id }]);
    vscode.postMessage({ type: "userMessage", text: input, id, ts: Date.now() });
    setInput("");
  };

  const handleStop = () => {
    setIsProcessing(false);
    vscode.postMessage({ type: "stop" });
  };

  const handleRunCommand = (id: string, cmd: string) => {
    vscode.postMessage({ type: "runCommand", id, cmd });
  };

  const handleCancelCommand = (id: string) => {
    vscode.postMessage({ type: "cancelCommand", id });
  };

  const activeCommands = Object.values(commands).filter((c) => c.status !== "success" && c.status !== "error" && c.status !== "canceled");
  const completedCommands = Object.values(commands).filter((c) => c.status === "success" || c.status === "error" || c.status === "canceled");

  return (
    <div className="app-container">
      <header className="header">
        <div className="title">SafeGraph AI</div>
        <div className="actions">
          <button onClick={() => vscode.postMessage({ type: "checkApiKey" })} title="Check API Key">
            <Settings size={16} />
          </button>
        </div>
      </header>
      <main className="messages">
        {messages.length === 0 ? (
          <div className="empty-state">
            <h2>Ready to assist.</h2>
            <p>Ask a question or select code to get started.</p>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`message ${m.role}`}>
              <div className="message-content">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
              </div>
            </div>
          ))
        )}
        
        {completedCommands.map((c) => (
          <div key={c.id} className={`command-block completed ${c.status}`}>
            <div className="command-header">
              <TerminalSquare size={14} />
              <span className="cmd-text">{c.cmd}</span>
              <span className="status-badge">{c.status}</span>
            </div>
            {c.output && (
              <pre className="command-output">
                {c.output.slice(-2000)}
              </pre>
            )}
          </div>
        ))}

        <div ref={messagesEndRef} />
      </main>

      {activeCommands.length > 0 && (
        <div className="active-commands-panel">
          {activeCommands.map((c) => (
            <div key={c.id} className="command-block active">
              <div className="command-header">
                <TerminalSquare size={14} />
                <span className="cmd-text">{c.cmd}</span>
                {c.status === "proposed" && (
                  <div className="command-actions">
                    <button onClick={() => handleRunCommand(c.id, c.cmd)} className="btn-run" title="Run Command">
                      <Play size={14} /> Run
                    </button>
                    <button onClick={() => handleCancelCommand(c.id)} className="btn-cancel" title="Reject">
                      <XCircle size={14} />
                    </button>
                  </div>
                )}
                {c.status === "running" && (
                  <div className="command-actions">
                    <span className="running-indicator">Running...</span>
                    <button onClick={() => handleCancelCommand(c.id)} className="btn-cancel" title="Kill Process">
                      <RotateCcw size={14} /> Stop
                    </button>
                  </div>
                )}
              </div>
              {c.output && (
                <pre className="command-output">
                  {c.output.slice(-2000)}
                </pre>
              )}
            </div>
          ))}
          <div ref={commandsEndRef} />
        </div>
      )}

      <form className="input-area" onSubmit={handleSend}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question..."
          disabled={isProcessing}
        />
        {isProcessing ? (
          <button type="button" onClick={handleStop} title="Stop AI" className="btn-stop-ai">
            <Square size={16} fill="currentColor" />
          </button>
        ) : (
          <button type="submit" disabled={!input.trim()}>
            <Send size={16} />
          </button>
        )}
      </form>
    </div>
  );
}

export default App;

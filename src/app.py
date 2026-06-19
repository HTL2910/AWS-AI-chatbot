import streamlit as st
import requests
import json
import os
import subprocess
import sys
import re
from urllib.parse import quote
from dotenv import load_dotenv
from datetime import datetime
from pathlib import Path

# Load environment variables
load_dotenv()

BEDROCK_API_KEY_ENV = "AWS_BEARER_TOKEN_BEDROCK"

DEFAULT_INFERENCE_PROFILE_ARN = (
    "arn:aws:bedrock:ap-southeast-1:510900713068:application-inference-profile/jxsjbl4xo623"
)

AVAILABLE_MODELS_AP_SOUTHEAST_1 = [
    DEFAULT_INFERENCE_PROFILE_ARN,
    "global.anthropic.claude-sonnet-4-6",
    "anthropic.claude-3-haiku-20240307-v1:0",
]

# ── Configuration defaults ─────────────────────────────────────────
DEFAULT_MAX_TOKENS = 8192
DEFAULT_TEMPERATURE = 0.7
MAX_CONTEXT_MESSAGES = 50
SUMMARIZE_THRESHOLD = 40
MAX_TOOL_LOOPS = 10

SYSTEM_PROMPT_DEFAULT = """You are SafeGraph AI, an intelligent coding assistant powered by AWS Bedrock.

You have access to tools that let you read files, list directories, run Python code, search for files, and write files.
Use these tools when the user asks about code, files, or anything that requires inspecting their system.

Guidelines:
- Answer in the same language the user writes in (Vietnamese → Vietnamese, English → English).
- When showing code, use fenced Markdown code blocks with the correct language tag.
- Provide complete, runnable examples rather than pseudocode.
- Use tools proactively when they would help answer the question more accurately.
- If a tool fails, explain the error and suggest alternatives.
- Be concise but thorough."""


# ── Utility functions ──────────────────────────────────────────────
def clean_api_key(value):
    if not value:
        return None
    return value.strip().strip('"').strip("'").strip()


def get_env_api_key():
    return clean_api_key(os.getenv(BEDROCK_API_KEY_ENV) or os.getenv("API_KEY"))


def bedrock_converse_url(region, model_id):
    encoded_model_id = quote(model_id, safe="")
    return f"https://bedrock-runtime.{region}.amazonaws.com/model/{encoded_model_id}/converse"


def validate_api_key(api_key):
    if not api_key:
        return "Vui lòng nhập API key."
    if api_key.lower().startswith("set "):
        return "Không nhập cả lệnh `set`; chỉ nhập giá trị API key."
    if not (api_key.startswith("bedrock-api-key-") or api_key.startswith("ABSK")):
        return "API key Bedrock thường bắt đầu bằng `bedrock-api-key-` hoặc `ABSK`. Vui lòng kiểm tra lại key."
    return None


def is_expired_bedrock_token(response):
    body = response.text or ""
    return response.status_code == 403 and "Bearer Token has expired" in body


def format_bedrock_error(response):
    if is_expired_bedrock_token(response):
        return (
            "Bedrock API key da het han. Tao key moi trong AWS Console, cap nhat "
            "AWS_BEARER_TOKEN_BEDROCK/API_KEY trong .env hoac nhap key moi o sidebar, "
            "sau do bam 'Cau hinh Ket noi' lai."
        )
    return f"Loi {response.status_code}: {response.text}"


def clear_expired_connection(response):
    if is_expired_bedrock_token(response):
        st.session_state.api_key = None
        st.session_state.api_key_configured = False
        st.session_state.last_assistant_incomplete = False
        st.session_state.last_assistant_index = None


# ── Tool definitions for Bedrock Converse API ──────────────────────
TOOL_DEFINITIONS = [
    {
        "toolSpec": {
            "name": "read_file",
            "description": "Read the contents of a file. Returns the file content as text with line numbers.",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Absolute or relative path to the file to read."
                        },
                        "start_line": {
                            "type": "integer",
                            "description": "Optional 1-based start line number.",
                            "default": 1
                        },
                        "end_line": {
                            "type": "integer",
                            "description": "Optional 1-based end line number (inclusive)."
                        }
                    },
                    "required": ["path"]
                }
            }
        }
    },
    {
        "toolSpec": {
            "name": "list_directory",
            "description": "List files and subdirectories in a directory. Returns names, types, and sizes.",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Absolute or relative path to the directory. Defaults to current directory.",
                            "default": "."
                        },
                        "pattern": {
                            "type": "string",
                            "description": "Optional glob pattern to filter results, e.g. '*.py' or '**/*.js'.",
                            "default": "*"
                        }
                    },
                    "required": []
                }
            }
        }
    },
    {
        "toolSpec": {
            "name": "run_python",
            "description": "Execute a Python code snippet and return its stdout, stderr, and exit code. Runs in a subprocess with a 30-second timeout.",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "code": {
                            "type": "string",
                            "description": "Python code to execute."
                        }
                    },
                    "required": ["code"]
                }
            }
        }
    },
    {
        "toolSpec": {
            "name": "search_files",
            "description": "Search for a regex pattern across files in a directory. Returns matching lines with file paths and line numbers.",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "pattern": {
                            "type": "string",
                            "description": "Regex pattern to search for."
                        },
                        "path": {
                            "type": "string",
                            "description": "Directory to search in. Defaults to current directory.",
                            "default": "."
                        },
                        "file_glob": {
                            "type": "string",
                            "description": "Glob pattern to filter files, e.g. '*.py'. Defaults to all files.",
                            "default": "*"
                        }
                    },
                    "required": ["pattern"]
                }
            }
        }
    },
    {
        "toolSpec": {
            "name": "write_file",
            "description": "Write content to a file. Creates the file if it doesn't exist, overwrites if it does.",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Absolute or relative path to the file to write."
                        },
                        "content": {
                            "type": "string",
                            "description": "Content to write to the file."
                        }
                    },
                    "required": ["path", "content"]
                }
            }
        }
    }
]


# ── Tool execution handlers ────────────────────────────────────────
def tool_read_file(params: dict) -> str:
    path = params.get("path", "")
    start_line = params.get("start_line", 1)
    end_line = params.get("end_line")
    try:
        p = Path(path)
        if not p.exists():
            return f"Error: File not found: {path}"
        if not p.is_file():
            return f"Error: Not a file: {path}"
        if p.stat().st_size > 500_000:
            return f"Error: File too large ({p.stat().st_size} bytes). Use start_line/end_line to read a portion."
        lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
        total = len(lines)
        start = max(1, start_line) - 1
        end = end_line if end_line else total
        selected = lines[start:end]
        result_lines = []
        for i, line in enumerate(selected, start=start + 1):
            result_lines.append(f"{i:>6}→{line}")
        header = f"File: {p} ({total} lines)\n"
        return header + "\n".join(result_lines)
    except Exception as e:
        return f"Error reading file: {e}"


def tool_list_directory(params: dict) -> str:
    path = params.get("path", ".")
    pattern = params.get("pattern", "*")
    try:
        p = Path(path)
        if not p.exists():
            return f"Error: Directory not found: {path}"
        if not p.is_dir():
            return f"Error: Not a directory: {path}"
        matches = list(p.glob(pattern))
        if not matches:
            return f"No matches for pattern '{pattern}' in {path}"
        lines = []
        for m in sorted(matches)[:200]:
            kind = "DIR " if m.is_dir() else "FILE"
            size = m.stat().st_size if m.is_file() else "-"
            lines.append(f"{kind}  {size:>10}  {m.name}")
        return f"Directory: {p.resolve()} ({len(matches)} items)\n" + "\n".join(lines)
    except Exception as e:
        return f"Error listing directory: {e}"


def tool_run_python(params: dict) -> str:
    code = params.get("code", "")
    try:
        result = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True, text=True, timeout=30,
            cwd=os.getcwd()
        )
        output = ""
        if result.stdout:
            output += f"STDOUT:\n{result.stdout}"
        if result.stderr:
            output += f"\nSTDERR:\n{result.stderr}"
        output += f"\nExit code: {result.returncode}"
        return output.strip() or "(no output)"
    except subprocess.TimeoutExpired:
        return "Error: Code execution timed out (30s limit)"
    except Exception as e:
        return f"Error running code: {e}"


def tool_search_files(params: dict) -> str:
    pattern = params.get("pattern", "")
    path = params.get("path", ".")
    file_glob = params.get("file_glob", "*")
    try:
        p = Path(path)
        if not p.exists():
            return f"Error: Path not found: {path}"
        regex = re.compile(pattern, re.IGNORECASE)
        matches = []
        files_checked = 0
        for f in p.rglob(file_glob):
            if not f.is_file():
                continue
            if f.stat().st_size > 500_000:
                continue
            try:
                for i, line in enumerate(f.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
                    if regex.search(line):
                        matches.append(f"{f}:{i}: {line.strip()[:200]}")
            except Exception:
                continue
            files_checked += 1
            if files_checked > 500:
                break
            if len(matches) > 100:
                matches.append("... (truncated, too many matches)")
                break
        if not matches:
            return f"No matches for '{pattern}' in {path}"
        return f"Found {len(matches)} match(es) across {files_checked} file(s):\n" + "\n".join(matches)
    except re.error as e:
        return f"Invalid regex pattern: {e}"
    except Exception as e:
        return f"Error searching: {e}"


def tool_write_file(params: dict) -> str:
    path = params.get("path", "")
    content = params.get("content", "")
    try:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        return f"Successfully wrote {len(content)} chars to {p}"
    except Exception as e:
        return f"Error writing file: {e}"


TOOL_HANDLERS = {
    "read_file": tool_read_file,
    "list_directory": tool_list_directory,
    "run_python": tool_run_python,
    "search_files": tool_search_files,
    "write_file": tool_write_file,
}


def execute_tool(tool_name: str, tool_input: dict) -> str:
    """Execute a tool and return its result string."""
    handler = TOOL_HANDLERS.get(tool_name)
    if not handler:
        return f"Error: Unknown tool '{tool_name}'"
    return handler(tool_input)


# ── Smart context management ───────────────────────────────────────
def estimate_message_tokens(messages: list) -> int:
    """Rough estimate of token count (1 token ~ 3 chars)."""
    total_chars = 0
    for msg in messages:
        content = msg.get("content", "")
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    total_chars += len(str(block.get("text", "")))
                    total_chars += len(str(block.get("toolUse", {})))
                    total_chars += len(str(block.get("toolResult", {})))
                else:
                    total_chars += len(str(block))
        else:
            total_chars += len(str(content))
    return max(1, total_chars // 3)


def summarize_conversation(api_key: str, model_id: str, region: str, messages: list) -> str:
    """Use the model itself to summarize older messages, reducing context size."""
    old_messages = messages[:SUMMARIZE_THRESHOLD]
    summary_prompt = "Summarize the following conversation in 3-5 bullet points, preserving key facts, decisions, and code references. Write in the same language as the conversation:\n\n"
    for msg in old_messages:
        role = msg.get("role", "?")
        content = msg.get("content", "")
        if isinstance(content, list):
            texts = []
            for block in content:
                if isinstance(block, dict) and "text" in block:
                    texts.append(block["text"])
                elif isinstance(block, str):
                    texts.append(block)
            content = " ".join(texts)
        summary_prompt += f"{role}: {str(content)[:500]}\n"

    url = bedrock_converse_url(region, model_id)
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "messages": [{"role": "user", "content": [{"text": summary_prompt}]}],
        "inferenceConfig": {"maxTokens": 512, "temperature": 0.3},
    }
    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=30)
        if resp.status_code == 200:
            data = resp.json()
            return data.get("output", {}).get("message", {}).get("content", [{}])[0].get("text", "")
    except Exception:
        pass
    return "(Summary unavailable)"


def build_api_messages(session_messages: list) -> list:
    """Build the messages list for the Bedrock Converse API."""
    api_messages = []
    for msg in session_messages:
        role = msg["role"]
        content = msg["content"]
        if isinstance(content, list):
            # Already in API format (tool use / tool result messages)
            api_messages.append({"role": role, "content": content})
        else:
            api_messages.append({"role": role, "content": [{"text": str(content)}]})
    return api_messages


# ── CSS styles ─────────────────────────────────────────────────────
# Page configuration
st.set_page_config(
    page_title="AWS Bedrock Chatbot",
    page_icon="🤖",
    layout="wide",
    initial_sidebar_state="expanded"
)

st.markdown("""
    <style>
    .chat-message {
        padding: 1rem;
        border-radius: 0.5rem;
        margin-bottom: 1rem;
        display: flex;
        gap: 1rem;
    }
    .chat-message.user {
        background-color: #f0f0f0;
        justify-content: flex-end;
    }
    .chat-message.assistant {
        background-color: #e8f4f8;
    }
    .chat-message.error {
        background-color: #ffe8e8;
    }
    .message-content {
        max-width: 80%;
        word-wrap: break-word;
    }
    .user .message-content {
        background-color: #0084ff;
        color: white;
        padding: 0.75rem 1rem;
        border-radius: 1rem;
    }
    .assistant .message-content {
        background-color: white;
        padding: 0.75rem 1rem;
        border-radius: 1rem;
    }
    .error .message-content {
        background-color: #ff6b6b;
        color: white;
        padding: 0.75rem 1rem;
        border-radius: 1rem;
    }
    .tool-call-box {
        background: #fff3cd;
        padding: 8px;
        border-radius: 6px;
        margin: 4px 0;
        font-size: 0.9em;
    }
    .tool-result-box {
        background: #d4edda;
        padding: 8px;
        border-radius: 6px;
        margin: 4px 0;
        font-size: 0.85em;
    }
    </style>
""", unsafe_allow_html=True)

# ── Initialize session state ───────────────────────────────────────
if "messages" not in st.session_state:
    st.session_state.messages = []
if "api_key" not in st.session_state:
    st.session_state.api_key = None
if "api_key_configured" not in st.session_state:
    st.session_state.api_key_configured = False
if "last_assistant_incomplete" not in st.session_state:
    st.session_state.last_assistant_incomplete = False
if "last_assistant_index" not in st.session_state:
    st.session_state.last_assistant_index = None
if "total_tokens_used" not in st.session_state:
    st.session_state.total_tokens_used = 0
if "tool_calls_count" not in st.session_state:
    st.session_state.tool_calls_count = 0
if "conversation_summary" not in st.session_state:
    st.session_state.conversation_summary = None

# ── Sidebar configuration ──────────────────────────────────────────
with st.sidebar:
    st.title("⚙️ Cấu hình")

    # API Key input
    st.subheader("AWS Bedrock Credentials")

    env_api_key = get_env_api_key()

    if env_api_key:
        st.success("✅ Đã tìm thấy API key trong .env (AWS_BEARER_TOKEN_BEDROCK hoặc API_KEY)")
        api_key = env_api_key
    else:
        st.warning("⚠️ Chưa tìm thấy AWS_BEARER_TOKEN_BEDROCK hoặc API_KEY trong .env")
        api_key = st.text_input(
            "Nhập API_KEY:",
            type="password",
            help="Lấy từ AWS Console (bedrock-api-key-...)"
        )

    # Model selection
    model_id = st.selectbox(
        "Chọn Model:",
        AVAILABLE_MODELS_AP_SOUTHEAST_1,
        help="Chọn model Claude phù hợp",
    )

    effective_model_id = model_id

    # Region selection
    region = st.selectbox(
        "Chọn AWS Region:",
        ["ap-southeast-1"],
        help="Chọn region gần nhất với bạn",
    )
    region = "ap-southeast-1"

    # ── Token & Temperature settings ────────────────────────────
    st.divider()
    st.subheader("🎛️ Model Settings")

    max_output_tokens = st.slider(
        "Max Output Tokens",
        min_value=256, max_value=16384,
        value=DEFAULT_MAX_TOKENS, step=256,
        help="Số token tối đa cho mỗi response. Claude Sonnet hỗ trợ đến 8192, Haiku hỗ trợ 4096."
    )
    temperature = st.slider(
        "Temperature",
        min_value=0.0, max_value=1.0,
        value=DEFAULT_TEMPERATURE, step=0.05,
        help="0 = chắc chắc, 1 = sáng tạo. 0.7 là cân bằng tốt."
    )

    # ── Tool use toggle ────────────────────────────────────────
    enable_tools = st.toggle(
        "🔧 Bật Tool Use",
        value=True,
        help="Cho phép AI đọc file, liệt kê thư mục, chạy code, tìm kiếm. Bật để AI có thể hành động như một agent."
    )

    # ── System prompt ──────────────────────────────────────────
    st.divider()
    st.subheader("📝 System Prompt")
    system_prompt = st.text_area(
        "Hướng dẫn cho AI:",
        value=SYSTEM_PROMPT_DEFAULT,
        height=150,
        help="Định hướng cách AI trả lời. Thay đổi để tùy chỉnh phong cách."
    )

    st.info(f"Model: {effective_model_id}\nRegion: {region}\nMax tokens: {max_output_tokens}\nTools: {'ON' if enable_tools else 'OFF'}")

    # Configure button
    if st.button("🔧 Cấu hình Kết nối", use_container_width=True):
        try:
            api_key = clean_api_key(api_key)
            api_key_error = validate_api_key(api_key)
            if not api_key_error:
                st.session_state.api_key = api_key
                st.session_state.api_key_configured = True
                st.session_state.model_id = effective_model_id
                st.session_state.region = region
                st.success("✅ Kết nối thành công!")
            else:
                st.error(f"❌ {api_key_error}")
                st.error("❌ Vui lòng nhập API_KEY")
                st.session_state.api_key_configured = False
        except Exception as e:
            st.error(f"❌ Lỗi kết nối: {str(e)}")
            st.session_state.api_key_configured = False

    # Chat history management
    st.divider()
    st.subheader("Test Nhanh Models")

    if st.button("Chay Test (/converse)", use_container_width=True, disabled=not bool(api_key)):
        api_key_clean = clean_api_key(api_key)
        api_key_err = validate_api_key(api_key_clean)
        if api_key_err:
            st.error(f"❌ {api_key_err}")
        else:
            import time

            models_to_test = AVAILABLE_MODELS_AP_SOUTHEAST_1
            results = []
            headers = {"Authorization": f"Bearer {api_key_clean}", "Content-Type": "application/json"}
            payload = {
                "messages": [{"role": "user", "content": [{"text": "ping"}]}],
                "inferenceConfig": {"maxTokens": 16, "temperature": 0.0},
            }

            with st.spinner("Dang test..."):
                for m in models_to_test:
                    url = bedrock_converse_url(region, m)
                    t0 = time.perf_counter()
                    try:
                        r = requests.post(url, headers=headers, json=payload, timeout=20)
                        ms = int((time.perf_counter() - t0) * 1000)
                        ok = r.status_code == 200
                        err = ""
                        if not ok:
                            err = (r.text or "").strip().replace("\n", " ")[:200]
                            if is_expired_bedrock_token(r):
                                err = format_bedrock_error(r)
                            if r.status_code == 429 and "Too many tokens per day" in err:
                                results.append({"model": m, "status": r.status_code, "ms": ms, "ok": ok, "error": err})
                                break
                            if r.status_code == 400 and "on-demand throughput" in err:
                                err = err + " | Hint: cần Inference Profile ARN cho model này."
                        results.append({"model": m, "status": r.status_code, "ms": ms, "ok": ok, "error": err})
                    except Exception as ex:
                        ms = int((time.perf_counter() - t0) * 1000)
                        results.append({"model": m, "status": "ERR", "ms": ms, "ok": False, "error": str(ex)[:200]})
                    time.sleep(2.0)

            st.dataframe(results, use_container_width=True)

    st.divider()
    st.subheader("📝 Lịch sử Chat")

    col1, col2 = st.columns(2)
    with col1:
        if st.button("🗑️ Xóa Lịch sử", use_container_width=True):
            st.session_state.messages = []
            st.session_state.conversation_summary = None
            st.session_state.total_tokens_used = 0
            st.session_state.tool_calls_count = 0
            st.rerun()

    with col2:
        if st.button("💾 Lưu Chat", use_container_width=True):
            if st.session_state.messages:
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                filename = f"chat_history_{timestamp}.json"
                with open(filename, 'w', encoding='utf-8') as f:
                    json.dump(st.session_state.messages, f, ensure_ascii=False, indent=2)
                st.success(f"✅ Đã lưu: {filename}")
            else:
                st.info("ℹ️ Không có tin nhắn để lưu")

    # Display connection status + stats
    st.divider()
    if st.session_state.api_key_configured:
        st.success("🟢 Đã kết nối")
        st.caption(f"🤖 {st.session_state.model_id}")
        st.caption(f"📍 {st.session_state.region}")
    else:
        st.warning("🔴 Chưa kết nối")

    # Token usage stats
    st.divider()
    st.subheader("📊 Token Usage")
    st.metric("Tổng tokens đã dùng", f"{st.session_state.total_tokens_used:,}")
    st.metric("Tool calls", f"{st.session_state.tool_calls_count}")
    msg_count = len(st.session_state.messages)
    est_tokens = estimate_message_tokens(st.session_state.messages) if st.session_state.messages else 0
    st.metric("Tin nhắn", f"{msg_count} (~{est_tokens:,} tokens context)")
    if st.session_state.conversation_summary:
        st.info("📋 Đã tóm tắt hội thoại cũ")


# ── Helper: render a message in the chat ──────────────────────────
def render_message(role: str, content):
    """Render a chat message. Content can be a string or a list of content blocks."""
    if isinstance(content, list):
        # Complex content (tool use / tool result)
        parts_html = []
        for block in content:
            if isinstance(block, str):
                parts_html.append(block)
            elif isinstance(block, dict):
                if "text" in block:
                    parts_html.append(block["text"])
                elif "toolUse" in block:
                    tu = block["toolUse"]
                    name = tu.get("name", "unknown")
                    inp = tu.get("input", {})
                    inp_str = json.dumps(inp, ensure_ascii=False, indent=2)
                    if len(inp_str) > 500:
                        inp_str = inp_str[:500] + "..."
                    parts_html.append(
                        f'<div class="tool-call-box">'
                        f'🔧 <b>Tool Call:</b> {name}<br/><pre style="margin:4px 0;font-size:0.85em;">{inp_str}</pre></div>'
                    )
                elif "toolResult" in block:
                    tr = block["toolResult"]
                    content_items = tr.get("content", [])
                    result_text = ""
                    for ci in content_items:
                        if isinstance(ci, dict) and "text" in ci:
                            result_text += ci["text"]
                    status = tr.get("status", "")
                    icon = "✅" if status == "success" else "⚠️"
                    display_text = result_text[:1500] + ("..." if len(result_text) > 1500 else "")
                    display_escaped = display_text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                    parts_html.append(
                        f'<div class="tool-result-box">'
                        f'{icon} <b>Tool Result</b> ({status}):<br/><pre style="margin:4px 0;white-space:pre-wrap;font-size:0.8em;">{display_escaped}</pre></div>'
                    )
        text = "\n".join(parts_html)
    else:
        text = str(content)

    if role == "user":
        css_class = "user"
    else:
        css_class = "assistant"

    st.markdown(f"""
        <div class="chat-message {css_class}">
            <div class="message-content">
                {text}
            </div>
        </div>
    """, unsafe_allow_html=True)


# ── Main chat interface ────────────────────────────────────────────
st.title("🤖 AWS Bedrock Chatbot")

# Display chat messages
chat_container = st.container()
with chat_container:
    for message in st.session_state.messages:
        render_message(
            message.get("role", "assistant"),
            message.get("content", ""),
        )

# Input area
st.divider()

# Check if configured before allowing input
if not st.session_state.api_key_configured:
    st.warning("⚠️ Vui lòng cấu hình AWS credentials ở sidebar trước khi chat")
    user_input = st.text_input(
        "Nhập tin nhắn:",
        disabled=True,
        placeholder="Cấu hình credentials để bắt đầu..."
    )
else:
    user_input = st.text_input(
        "Nhập tin nhắn:",
        placeholder="Hỏi tôi bất cứ điều gì... (AI có thể đọc file, chạy code, tìm kiếm)",
        key="user_input"
    )

    # Continue button if previous response was truncated
    if st.session_state.last_assistant_incomplete and st.session_state.last_assistant_index is not None:
        if st.button("Continue", use_container_width=True):
            try:
                with st.spinner("⏳ Đang tiếp tục..."):
                    api_messages = build_api_messages(st.session_state.messages)
                    api_messages.append({"role": "user", "content": [{"text": "Continue."}]})

                    system_blocks = [{"text": system_prompt}]

                    url = bedrock_converse_url(st.session_state.region, st.session_state.model_id)
                    headers = {
                        "Authorization": f"Bearer {st.session_state.api_key}",
                        "Content-Type": "application/json",
                    }
                    payload = {
                        "system": system_blocks,
                        "messages": api_messages,
                        "inferenceConfig": {
                            "maxTokens": max_output_tokens,
                            "temperature": temperature,
                        },
                    }
                    if enable_tools:
                        payload["toolConfig"] = {"tools": TOOL_DEFINITIONS}

                    response = requests.post(url, headers=headers, json=payload, timeout=120)

                    if response.status_code != 200:
                        clear_expired_connection(response)
                        st.error(f"❌ {format_bedrock_error(response)}")
                        st.session_state.last_assistant_incomplete = False
                        st.session_state.last_assistant_index = None
                        st.rerun()

                    result = response.json()
                    stop_reason = (result.get("stopReason") or result.get("stop_reason") or "").lower()
                    usage = result.get("usage", {})
                    st.session_state.total_tokens_used += usage.get("totalTokens", 0)

                    next_text = ""
                    for block in result.get("output", {}).get("message", {}).get("content", []):
                        if "text" in block:
                            next_text += block["text"]
                    if not next_text:
                        next_text = str(result)

                    idx = st.session_state.last_assistant_index
                    st.session_state.messages[idx]["content"] = (
                        st.session_state.messages[idx]["content"].rstrip() + "\n" + next_text.lstrip()
                    )

                    st.session_state.last_assistant_incomplete = stop_reason in ("max_tokens", "max-tokens")
                    if not st.session_state.last_assistant_incomplete:
                        st.session_state.last_assistant_index = None

                    st.rerun()
            except Exception as e:
                st.error(f"❌ Lỗi kết nối: {str(e)}")
                st.session_state.last_assistant_incomplete = False
                st.session_state.last_assistant_index = None

    if user_input:
        # Add user message to history
        st.session_state.messages.append({
            "role": "user",
            "content": user_input
        })

        # Display user message
        st.markdown(f"""
            <div class="chat-message user">
                <div class="message-content">
                    {user_input}
                </div>
            </div>
        """, unsafe_allow_html=True)

        # ── Agent loop: call Bedrock with tools ────────────────────
        try:
            with st.spinner("⏳ Đang suy nghĩ..."):
                # Smart context: summarize if conversation is too long
                if len(st.session_state.messages) > MAX_CONTEXT_MESSAGES and st.session_state.api_key:
                    summary = summarize_conversation(
                        st.session_state.api_key,
                        st.session_state.model_id,
                        st.session_state.region,
                        st.session_state.messages,
                    )
                    if summary:
                        st.session_state.conversation_summary = summary
                        # Keep only recent messages
                        kept = st.session_state.messages[-SUMMARIZE_THRESHOLD:]
                        st.session_state.messages = kept

                # Build API messages
                api_messages = build_api_messages(st.session_state.messages)

                # Build system blocks
                system_blocks = [{"text": system_prompt}]
                if st.session_state.conversation_summary:
                    system_blocks.insert(0, {"text": f"Previous conversation summary:\n{st.session_state.conversation_summary}"})

                url = bedrock_converse_url(st.session_state.region, st.session_state.model_id)
                headers = {
                    "Authorization": f"Bearer {st.session_state.api_key}",
                    "Content-Type": "application/json"
                }

                # Agent loop: keep calling until model finishes (no more tool_use)
                for loop_count in range(MAX_TOOL_LOOPS + 1):
                    payload = {
                        "system": system_blocks,
                        "messages": api_messages,
                        "inferenceConfig": {
                            "maxTokens": max_output_tokens,
                            "temperature": temperature,
                        },
                    }
                    if enable_tools:
                        payload["toolConfig"] = {"tools": TOOL_DEFINITIONS}

                    response = requests.post(url, headers=headers, json=payload, timeout=120)

                    if response.status_code != 200:
                        clear_expired_connection(response)
                        st.error(f"❌ {format_bedrock_error(response)}")
                        st.session_state.messages.pop()  # Remove user message
                        break

                    result = response.json()
                    stop_reason = (result.get("stopReason") or result.get("stop_reason") or "").lower()

                    # Track token usage
                    usage = result.get("usage", {})
                    st.session_state.total_tokens_used += usage.get("totalTokens", 0)

                    # Extract content blocks from the response
                    response_content = result.get("output", {}).get("message", {}).get("content", [])

                    # Check if model wants to use tools
                    tool_use_blocks = [b for b in response_content if "toolUse" in b]
                    text_blocks = [b for b in response_content if "text" in b]

                    if tool_use_blocks and enable_tools:
                        # Add assistant's response (with tool use) to API messages
                        api_messages.append({"role": "assistant", "content": response_content})

                        # Add to session messages for display
                        st.session_state.messages.append({
                            "role": "assistant",
                            "content": response_content
                        })
                        st.session_state.tool_calls_count += len(tool_use_blocks)

                        # Execute each tool and build tool_result messages
                        tool_result_content = []
                        for tu_block in tool_use_blocks:
                            tool_info = tu_block["toolUse"]
                            tool_name = tool_info.get("name", "")
                            tool_input = tool_info.get("input", {})
                            tool_use_id = tool_info.get("toolUseId", "")

                            # Execute the tool
                            result_text = execute_tool(tool_name, tool_input)

                            # Add tool result to API messages
                            tool_result_content.append({
                                "toolResult": {
                                    "toolUseId": tool_use_id,
                                    "status": "success",
                                    "content": [{"text": result_text}]
                                }
                            })

                            # Show tool result in chat
                            st.session_state.messages.append({
                                "role": "user",
                                "content": [{
                                    "toolResult": {
                                        "toolUseId": tool_use_id,
                                        "status": "success",
                                        "content": [{"text": result_text[:2000]}]
                                    }
                                }]
                            })

                        # Add tool results as a "user" message (per Converse API spec)
                        api_messages.append({"role": "user", "content": tool_result_content})

                        # Continue the loop - model will see tool results and respond
                        continue
                    else:
                        # No tool use - this is the final response
                        assistant_text = ""
                        for b in text_blocks:
                            assistant_text += b.get("text", "")
                        if not assistant_text and response_content:
                            assistant_text = str(response_content)

                        # If there were tool_use blocks but tools disabled, note it
                        if tool_use_blocks and not enable_tools:
                            assistant_text += "\n\n_(AI đã yêu cầu dùng tool nhưng tool use đang tắt. Bật toggle 🔧 Bật Tool Use ở sidebar.)_"

                        if not assistant_text:
                            assistant_text = "(Không có phản hồi)"

                        # Add assistant message to history
                        st.session_state.messages.append({
                            "role": "assistant",
                            "content": assistant_text
                        })

                        # Track truncation
                        st.session_state.last_assistant_incomplete = stop_reason in ("max_tokens", "max-tokens")
                        st.session_state.last_assistant_index = (
                            len(st.session_state.messages) - 1 if st.session_state.last_assistant_incomplete else None
                        )

                        # Display assistant message
                        st.markdown(f"""
                            <div class="chat-message assistant">
                                <div class="message-content">
                                    {assistant_text}
                                </div>
                            </div>
                        """, unsafe_allow_html=True)

                        st.rerun()
                        break

                else:
                    # Hit max tool loops
                    st.warning(f"⚠️ Đã đạt giới hạn {MAX_TOOL_LOOPS} vòng tool calls. Dừng lại.")

        except Exception as e:
            error_message = f"❌ Lỗi kết nối: {str(e)}"
            st.session_state.messages.append({
                "role": "assistant",
                "content": error_message
            })
            st.markdown(f"""
                <div class="chat-message error">
                    <div class="message-content">
                        {error_message}
                    </div>
                </div>
            """, unsafe_allow_html=True)

import json
import logging
import os
import re
import subprocess
import sys
import uuid
from datetime import datetime
from pathlib import Path
from urllib.parse import quote
import requests

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request, session


ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / ".env")
load_dotenv(Path(__file__).resolve().parent / ".env", override=True)

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY") or os.urandom(32)

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO), format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

AWS_BEARER_TOKEN = os.getenv("AWS_BEARER_TOKEN_BEDROCK") or os.getenv("API_KEY") or ""
BEDROCK_MODEL_ID = os.getenv("ARN") or "anthropic.claude-3-5-haiku-20241022-v1:0"
BEDROCK_API_URL_CONVERSE = "https://bedrock-runtime.ap-southeast-1.amazonaws.com/model/{model_id}/converse"
BEDROCK_API_URL_INVOKE = "https://bedrock-runtime.ap-southeast-1.amazonaws.com/model/{model_id}/invoke"

MAX_MESSAGE_LENGTH = 5000
MAX_HISTORY_MESSAGES = 50
MAX_OUTPUT_TOKENS = int(os.getenv("MAX_OUTPUT_TOKENS", "8192"))
MODEL_TEMPERATURE = float(os.getenv("MODEL_TEMPERATURE", "0.7"))
MAX_TOOL_LOOPS = 10
ENABLE_TOOLS = os.getenv("ENABLE_TOOLS", "true").lower() in ("true", "1", "yes", "on")

SYSTEM_PROMPT_DEFAULT = """You are SafeGraph AI, an intelligent coding assistant powered by AWS Bedrock.

You have access to tools that let you read files, list directories, run Python code, search for files, and write files.
Use these tools when the user asks about code, files, or anything that requires inspecting their system.

Guidelines:
- Answer in the same language the user writes in (Vietnamese → Vietnamese, English → English).
- When showing code, use fenced Markdown code blocks with the correct language tag, for example ```html, ```css, ```javascript, ```python, ```typescript, or ```json.
- Provide complete, practical examples, not vague pseudocode.
- Use tools proactively when they would help answer the question more accurately.
- If a tool fails, explain the error and suggest alternatives.
- Be concise but thorough.
- Mention important caveats and verification steps briefly after the code."""

conversation_histories = {}
session_system_prompts = {}
session_token_usage = {}


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
                        "path": {"type": "string", "description": "Absolute or relative path to the file to read."},
                        "start_line": {"type": "integer", "description": "Optional 1-based start line number.", "default": 1},
                        "end_line": {"type": "integer", "description": "Optional 1-based end line number (inclusive)."}
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
                        "path": {"type": "string", "description": "Path to the directory. Defaults to '.'.", "default": "."},
                        "pattern": {"type": "string", "description": "Optional glob pattern, e.g. '*.py'.", "default": "*"}
                    },
                    "required": []
                }
            }
        }
    },
    {
        "toolSpec": {
            "name": "run_python",
            "description": "Execute a Python code snippet and return stdout, stderr, and exit code. 30-second timeout.",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "code": {"type": "string", "description": "Python code to execute."}
                    },
                    "required": ["code"]
                }
            }
        }
    },
    {
        "toolSpec": {
            "name": "search_files",
            "description": "Search for a regex pattern across files. Returns matching lines with paths and line numbers.",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "pattern": {"type": "string", "description": "Regex pattern to search for."},
                        "path": {"type": "string", "description": "Directory to search in. Defaults to '.'.", "default": "."},
                        "file_glob": {"type": "string", "description": "Glob pattern to filter files, e.g. '*.py'.", "default": "*"}
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
                        "path": {"type": "string", "description": "Path to the file to write."},
                        "content": {"type": "string", "description": "Content to write."}
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
            return f"Error: File too large ({p.stat().st_size} bytes). Use start_line/end_line."
        lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
        total = len(lines)
        start = max(1, start_line) - 1
        end = end_line if end_line else total
        selected = lines[start:end]
        result_lines = []
        for i, line in enumerate(selected, start=start + 1):
            result_lines.append(f"{i:>6}→{line}")
        return f"File: {p} ({total} lines)\n" + "\n".join(result_lines)
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
            return f"No matches for '{pattern}' in {path}"
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
            capture_output=True, text=True, timeout=30, cwd=os.getcwd()
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
            if not f.is_file() or f.stat().st_size > 500_000:
                continue
            try:
                for i, line in enumerate(f.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
                    if regex.search(line):
                        matches.append(f"{f}:{i}: {line.strip()[:200]}")
            except Exception:
                continue
            files_checked += 1
            if files_checked > 500 or len(matches) > 100:
                matches.append("... (truncated)")
                break
        if not matches:
            return f"No matches for '{pattern}' in {path}"
        return f"Found {len(matches)} match(es) across {files_checked} file(s):\n" + "\n".join(matches)
    except re.error as e:
        return f"Invalid regex: {e}"
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
    handler = TOOL_HANDLERS.get(tool_name)
    if not handler:
        return f"Error: Unknown tool '{tool_name}'"
    return handler(tool_input)


# ── Session helpers ────────────────────────────────────────────────
def current_session_id() -> str:
    session_id = session.get("chat_session_id")
    if not session_id:
        session_id = uuid.uuid4().hex
        session["chat_session_id"] = session_id
    return session_id


def current_conversation_history() -> list:
    session_id = current_session_id()
    return conversation_histories.setdefault(session_id, [])


def get_system_prompt() -> str:
    session_id = current_session_id()
    return session_system_prompts.get(session_id, SYSTEM_PROMPT_DEFAULT)


def current_token_usage() -> dict:
    session_id = current_session_id()
    return session_token_usage.setdefault(session_id, {"total_tokens": 0, "tool_calls": 0})


def is_inference_profile_model(model_id: str) -> bool:
    return model_id.startswith("arn:aws:bedrock:") and "application-inference-profile/" in model_id


def bedrock_api_url(model_id: str, operation: str) -> str:
    encoded_model_id = quote(model_id, safe="")
    if operation == "converse":
        return BEDROCK_API_URL_CONVERSE.format(model_id=encoded_model_id)
    return BEDROCK_API_URL_INVOKE.format(model_id=encoded_model_id)


# ── Core: Bedrock Converse with agent loop + tool use ─────────────
def claude_converse_with_tools(messages, system_prompt_text=None):
    """Call Bedrock Converse API with full agent loop (tool use support).
    Returns the final text response and a list of tool events for the UI."""
    if not AWS_BEARER_TOKEN or not BEDROCK_MODEL_ID:
        raise RuntimeError("Missing AWS_BEARER_TOKEN_BEDROCK/API_KEY or ARN. Add them to .env.")

    if system_prompt_text is None:
        system_prompt_text = get_system_prompt()

    token_usage = current_token_usage()
    tool_events = []  # Collect tool call/result events for the UI

    # Build Converse-format messages from the conversation history
    api_messages = []
    for msg in messages:
        role = msg.get("role")
        content = msg.get("content", [])
        # Content may already be in API format (list of dicts) or legacy format
        if isinstance(content, list) and content and isinstance(content[0], dict):
            # Check if it's legacy format with "type" key
            if "type" in content[0]:
                # Convert legacy format: [{"type":"text","text":"..."}] → [{"text":"..."}]
                converted = []
                for item in content:
                    if item.get("type") == "text":
                        converted.append({"text": item["text"]})
                    elif item.get("type") == "tool_use":
                        converted.append(item)
                    elif item.get("type") == "tool_result":
                        converted.append(item)
                    else:
                        converted.append({"text": str(item)})
                api_messages.append({"role": role, "content": converted})
            else:
                # Already in Converse API format
                api_messages.append({"role": role, "content": content})
        elif isinstance(content, str):
            api_messages.append({"role": role, "content": [{"text": content}]})
        else:
            api_messages.append({"role": role, "content": content})

    system_blocks = [{"text": system_prompt_text}]

    url = bedrock_api_url(BEDROCK_MODEL_ID, "converse")
    headers = {
        "Authorization": f"Bearer {AWS_BEARER_TOKEN}",
        "Content-Type": "application/json",
    }

    for loop_count in range(MAX_TOOL_LOOPS + 1):
        payload = {
            "system": system_blocks,
            "messages": api_messages,
            "inferenceConfig": {
                "maxTokens": MAX_OUTPUT_TOKENS,
                "temperature": MODEL_TEMPERATURE,
            },
        }
        if ENABLE_TOOLS:
            payload["toolConfig"] = {"tools": TOOL_DEFINITIONS}

        logger.debug("Bedrock request loop=%d, messages=%d", loop_count, len(api_messages))
        try:
            response = requests.post(url, headers=headers, json=payload, timeout=120)
        except requests.exceptions.RequestException as e:
            logger.error("Bedrock request exception: %s", e)
            raise RuntimeError(f"Could not connect to Bedrock API: {str(e)[:500]}") from e

        if response.status_code in (401, 403):
            raise RuntimeError("AWS Bearer token invalid or expired. Update AWS_BEARER_TOKEN_BEDROCK or API_KEY in .env.")
        if response.status_code != 200:
            error_text = response.text[:500] if response.text else "unknown error"
            raise RuntimeError(f"Bedrock API error {response.status_code}: {error_text}")

        data = response.json()

        # Track token usage
        usage = data.get("usage", {})
        token_usage["total_tokens"] += usage.get("totalTokens", 0)

        # Extract response content
        response_content = data.get("output", {}).get("message", {}).get("content", [])
        stop_reason = (data.get("stopReason") or "").lower()

        # Check for tool use
        tool_use_blocks = [b for b in response_content if "toolUse" in b]
        text_blocks = [b for b in response_content if "text" in b]

        if tool_use_blocks and ENABLE_TOOLS:
            # Add assistant message with tool_use to API messages
            api_messages.append({"role": "assistant", "content": response_content})

            # Execute tools and collect results
            tool_result_content = []
            for tu_block in tool_use_blocks:
                tool_info = tu_block["toolUse"]
                tool_name = tool_info.get("name", "")
                tool_input = tool_info.get("input", {})
                tool_use_id = tool_info.get("toolUseId", "")

                # Log tool call
                tool_events.append({
                    "type": "tool_call",
                    "name": tool_name,
                    "input": tool_input,
                })
                token_usage["tool_calls"] += 1

                # Execute the tool
                result_text = execute_tool(tool_name, tool_input)

                tool_events.append({
                    "type": "tool_result",
                    "name": tool_name,
                    "result": result_text[:2000],
                    "status": "success",
                })

                # Build tool result for API
                tool_result_content.append({
                    "toolResult": {
                        "toolUseId": tool_use_id,
                        "status": "success",
                        "content": [{"text": result_text}]
                    }
                })

            # Add tool results as "user" message per Converse API spec
            api_messages.append({"role": "user", "content": tool_result_content})
            # Continue agent loop
            continue
        else:
            # No more tool use - extract final text
            final_text = ""
            for b in text_blocks:
                final_text += b.get("text", "")

            if not final_text and response_content:
                final_text = str(response_content)

            if tool_use_blocks and not ENABLE_TOOLS:
                final_text += "\n\n_(AI requested tool use but tools are disabled. Enable ENABLE_TOOLS in .env.)_"

            if not final_text:
                final_text = "(No response)"

            return final_text, tool_events

    # Exceeded max tool loops
    return "(Agent loop limit reached - too many tool calls)", tool_events


# ── Routes ─────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/chat", methods=["POST"])
def chat():
    data = request.get_json(silent=True) or {}
    logger.debug("Incoming /chat request data: %s", data)
    user_message = str(data.get("message", "")).strip()
    if not user_message:
        return jsonify({"error": "Message is required."}), 400
    if len(user_message) > MAX_MESSAGE_LENGTH:
        return jsonify({"error": f"Message exceeds {MAX_MESSAGE_LENGTH} characters."}), 400

    conversation_history = current_conversation_history()

    conversation_history.append({
        "role": "user",
        "content": [{"text": user_message}]
    })

    # Keep history within limit (but smarter: keep more context)
    if len(conversation_history) > MAX_HISTORY_MESSAGES:
        conversation_history[:] = conversation_history[-MAX_HISTORY_MESSAGES:]

    try:
        assistant_message, tool_events = claude_converse_with_tools(conversation_history)
    except RuntimeError as e:
        logger.error("Chat error: %s", str(e), exc_info=True)
        return jsonify({"error": str(e)}), 500

    # Add assistant response to history
    conversation_history.append({
        "role": "assistant",
        "content": [{"text": assistant_message}]
    })

    token_usage = current_token_usage()

    return jsonify({
        "message": assistant_message,
        "tool_events": tool_events,
        "token_usage": token_usage,
        "timestamp": datetime.now().isoformat()
    })


@app.route("/clear", methods=["POST"])
def clear_history():
    sid = current_session_id()
    conversation_histories.pop(sid, None)
    session_token_usage.pop(sid, None)
    return jsonify({"status": "History cleared"})


@app.route("/config", methods=["GET"])
def get_config():
    """Return current configuration for the UI."""
    token_usage = current_token_usage()
    return jsonify({
        "model": BEDROCK_MODEL_ID,
        "max_tokens": MAX_OUTPUT_TOKENS,
        "temperature": MODEL_TEMPERATURE,
        "tools_enabled": ENABLE_TOOLS,
        "system_prompt": get_system_prompt(),
        "token_usage": token_usage,
    })


@app.route("/config/system_prompt", methods=["POST"])
def set_system_prompt():
    """Update the system prompt for the current session."""
    data = request.get_json(silent=True) or {}
    prompt = str(data.get("system_prompt", "")).strip()
    if not prompt:
        return jsonify({"error": "system_prompt is required."}), 400
    session_id = current_session_id()
    session_system_prompts[session_id] = prompt
    return jsonify({"status": "System prompt updated"})


@app.route("/config/settings", methods=["POST"])
def update_settings():
    """Update runtime settings."""
    global MAX_OUTPUT_TOKENS, MODEL_TEMPERATURE, ENABLE_TOOLS
    data = request.get_json(silent=True) or {}
    if "max_tokens" in data:
        MAX_OUTPUT_TOKENS = int(data["max_tokens"])
    if "temperature" in data:
        MODEL_TEMPERATURE = float(data["temperature"])
    if "enable_tools" in data:
        ENABLE_TOOLS = bool(data["enable_tools"])
    return jsonify({"status": "Settings updated"})


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5001"))
    debug = os.getenv("FLASK_DEBUG", "").lower() in {"1", "true", "yes", "on"}
    app.run(debug=debug, port=port)
import json
import logging
import os
import uuid
from datetime import datetime
from pathlib import Path
from urllib.parse import quote
import requests

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request, session


ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / ".env")
load_dotenv(Path(__file__).resolve().parent / ".env", override=True)

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY") or os.urandom(32)

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO), format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

AWS_BEARER_TOKEN = os.getenv("AWS_BEARER_TOKEN_BEDROCK") or os.getenv("API_KEY") or ""
BEDROCK_MODEL_ID = os.getenv("ARN") or "anthropic.claude-3-5-haiku-20241022-v1:0"
BEDROCK_API_URL_CONVERSE = "https://bedrock-runtime.ap-southeast-1.amazonaws.com/model/{model_id}/converse"
BEDROCK_API_URL_INVOKE = "https://bedrock-runtime.ap-southeast-1.amazonaws.com/model/{model_id}/invoke"

MAX_MESSAGE_LENGTH = 5000
MAX_HISTORY_MESSAGES = 12
MAX_OUTPUT_TOKENS = int(os.getenv("MAX_OUTPUT_TOKENS", "4096"))
MODEL_TEMPERATURE = float(os.getenv("MODEL_TEMPERATURE", "0.2"))

SYSTEM_PROMPT = """You are Safegraph AI, a senior coding assistant.

Prioritize correct, runnable code over generic explanation. When the user asks for code:
- Ask at most one clarification question only if required; otherwise make reasonable assumptions.
- State assumptions briefly before the code when they affect behavior.
- Return complete, practical examples, not vague pseudocode.
- Use fenced Markdown code blocks with the correct language tag, for example ```html, ```css, ```javascript, ```python, ```typescript, or ```json.
- For HTML answers, produce valid semantic HTML, include required tags when a full page is requested, and keep indentation consistent.
- Preserve code formatting exactly inside code fences.
- Mention important caveats and verification steps briefly after the code.

If the user writes Vietnamese, answer in Vietnamese unless they ask otherwise."""

conversation_histories = {}


def current_session_id() -> str:
    session_id = session.get("chat_session_id")
    if not session_id:
        session_id = uuid.uuid4().hex
        session["chat_session_id"] = session_id
    return session_id


def current_conversation_history() -> list:
    session_id = current_session_id()
    return conversation_histories.setdefault(session_id, [])


def is_inference_profile_model(model_id: str) -> bool:
    return model_id.startswith("arn:aws:bedrock:") and "application-inference-profile/" in model_id


def bedrock_api_url(model_id: str, operation: str) -> str:
    encoded_model_id = quote(model_id, safe="")
    if operation == "converse":
        return BEDROCK_API_URL_CONVERSE.format(model_id=encoded_model_id)
    return BEDROCK_API_URL_INVOKE.format(model_id=encoded_model_id)


def claude_converse(messages):
    """Call AWS Bedrock Claude API with conversation history."""
    logger.debug("claude_converse called with %d messages", len(messages))
    logger.debug("AWS_BEARER_TOKEN present=%s, BEDROCK_MODEL_ID=%s", bool(AWS_BEARER_TOKEN), BEDROCK_MODEL_ID)
    if not AWS_BEARER_TOKEN or not BEDROCK_MODEL_ID:
        raise RuntimeError("Missing AWS_BEARER_TOKEN_BEDROCK/API_KEY or ARN. Add them to .env.")
    # Convert Flask message format to provider-specific message formats.
    text_messages = []
    for msg in messages:
        role = msg.get("role")
        content_list = msg.get("content", [])
        text = "\n".join(item.get("text", "") for item in content_list if item.get("text"))
        if text:
            text_messages.append({"role": role, "text": text})

    try:
        if is_inference_profile_model(BEDROCK_MODEL_ID):
            url = bedrock_api_url(BEDROCK_MODEL_ID, "invoke")
            claude_messages = [
                {"role": msg["role"], "content": [{"type": "text", "text": msg["text"]}]}
                for msg in text_messages
            ]
            # Inference profile ARN uses the older Anthropic Messages API shape.
            payload = {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": MAX_OUTPUT_TOKENS,
                "temperature": MODEL_TEMPERATURE,
                "system": SYSTEM_PROMPT,
                "messages": claude_messages,
            }
        else:
            url = bedrock_api_url(BEDROCK_MODEL_ID, "converse")
            converse_messages = [
                {"role": msg["role"], "content": [{"text": msg["text"]}]}
                for msg in text_messages
            ]
            payload = {
                "system": [{"text": SYSTEM_PROMPT}],
                "messages": converse_messages,
                "inferenceConfig": {
                    "maxTokens": MAX_OUTPUT_TOKENS,
                    "temperature": MODEL_TEMPERATURE,
                },
            }

        logger.debug("Sending Bedrock request to %s with %d message(s)", url, len(text_messages))
        response = requests.post(
            url,
            headers={
                "Authorization": f"Bearer {AWS_BEARER_TOKEN}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=60,
        )
        logger.debug("Bedrock response status: %s", response.status_code)
        response.raise_for_status()
        data = response.json()
    except requests.exceptions.HTTPError as e:
        logger.error("Bedrock HTTP error: %s %s", e.response.status_code if e.response else None, e.response.text if e.response else str(e))
        if e.response is not None and e.response.status_code in (401, 403):
            raise RuntimeError("AWS Bearer token invalid or expired. Update AWS_BEARER_TOKEN_BEDROCK or API_KEY in .env.") from e
        raise RuntimeError(f"Bedrock API error {e.response.status_code if e.response else 'unknown'}: {e.response.text[:500] if e.response else str(e)}") from e
    except requests.exceptions.RequestException as e:
        logger.error("Bedrock request exception: %s", e)
        raise RuntimeError(f"Could not connect to Bedrock API: {str(e)[:500]}") from e

    output_message = data.get("output", {}) if isinstance(data, dict) else {}
    # Some Bedrock responses use top-level fields (when invoking inference profile)
    # Try common shapes
    content = []
    if isinstance(output_message, dict) and output_message.get("message"):
        content = output_message.get("message", {}).get("content", [])
    else:
        # direct response shape
        content = data.get("content", []) if isinstance(data, dict) else []

    text = "".join(item.get("text", "") for item in content if item.get("text"))
    if not text:
        raise RuntimeError(f"Claude returned an empty response. raw_response={json.dumps(data)}")
    return text
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/chat", methods=["POST"])
def chat():
    data = request.get_json(silent=True) or {}
    logger.debug("Incoming /chat request data: %s", data)
    user_message = str(data.get("message", "")).strip()
    if not user_message:
        return jsonify({"error": "Message is required."}), 400
    if len(user_message) > MAX_MESSAGE_LENGTH:
        return jsonify({"error": f"Message exceeds {MAX_MESSAGE_LENGTH} characters."}), 400
    
    conversation_history = current_conversation_history()

    conversation_history.append({
        "role": "user",
        "content": [{"type": "text", "text": user_message}]
    })
    
    # Keep history within limit
    if len(conversation_history) > MAX_HISTORY_MESSAGES:
        conversation_history.pop(0)
    
    try:
        assistant_message = claude_converse(conversation_history)
    except RuntimeError as e:
        logger.error("Chat error: %s", str(e), exc_info=True)
        return jsonify({"error": str(e)}), 500

    # Add assistant response to history
    conversation_history.append({
        "role": "assistant",
        "content": [{"type": "text", "text": assistant_message}]
    })
    
    return jsonify({
        "message": assistant_message,
        "timestamp": datetime.now().isoformat()
    })
@app.route("/clear", methods=["POST"])
def clear_history():
    conversation_histories.pop(current_session_id(), None)
    return jsonify({"status": "History cleared"})


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5001"))
    debug = os.getenv("FLASK_DEBUG", "").lower() in {"1", "true", "yes", "on"}
    app.run(debug=debug, port=port)

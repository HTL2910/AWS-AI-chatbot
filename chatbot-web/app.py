import json
import logging
import os
from datetime import datetime
from pathlib import Path
from urllib.parse import quote
import requests

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request


ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / ".env")
load_dotenv(Path(__file__).resolve().parent / ".env", override=True)

app = Flask(__name__)

logging.basicConfig(level=logging.DEBUG, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

AWS_BEARER_TOKEN = os.getenv("AWS_BEARER_TOKEN_BEDROCK") or os.getenv("API_KEY") or ""
BEDROCK_MODEL_ID = os.getenv("ARN") or "anthropic.claude-3-5-haiku-20241022-v1:0"
BEDROCK_API_URL_CONVERSE = "https://bedrock-runtime.ap-southeast-1.amazonaws.com/model/{model_id}/converse"
BEDROCK_API_URL_INVOKE = "https://bedrock-runtime.ap-southeast-1.amazonaws.com/model/{model_id}/invoke"

MAX_MESSAGE_LENGTH = 5000
MAX_HISTORY_MESSAGES = 12

conversation_history = []


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
    # Convert Flask message format to Claude format
    claude_messages = []
    for msg in messages:
        role = msg.get("role")
        content_list = msg.get("content", [])
        text = "\n".join(item.get("text", "") for item in content_list if item.get("text"))
        if text:
            claude_messages.append({"role": role, "content": [{"type": "text", "text": text}]})

    try:
        if is_inference_profile_model(BEDROCK_MODEL_ID):
            url = bedrock_api_url(BEDROCK_MODEL_ID, "invoke")
            # Inference profile ARN uses the older Anthropic API version
            payload = {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 1024,
                "messages": claude_messages,
            }
        else:
            url = bedrock_api_url(BEDROCK_MODEL_ID, "converse")
            payload = {
                "messages": claude_messages,
                "inferenceConfig": {
                    "maxTokens": 1024,
                    "temperature": 0.7,
                },
            }

        logger.debug("Sending Bedrock request to %s", url)
        logger.debug("Bedrock request payload: %s", json.dumps(payload, indent=2, ensure_ascii=False))
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
        logger.debug("Bedrock response text: %s", response.text)
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
    global conversation_history

    data = request.get_json(silent=True) or {}
    logger.debug("Incoming /chat request data: %s", data)
    user_message = str(data.get("message", "")).strip()
    if not user_message:
        return jsonify({"error": "Message is required."}), 400
    if len(user_message) > MAX_MESSAGE_LENGTH:
        return jsonify({"error": f"Message exceeds {MAX_MESSAGE_LENGTH} characters."}), 400
    
    # Add user message to history
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
    global conversation_history
    conversation_history = []
    return jsonify({"status": "History cleared"})


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5001"))
    app.run(debug=True, port=port)

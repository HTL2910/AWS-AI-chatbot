import streamlit as st
import requests
import json
import os
from dotenv import load_dotenv
from datetime import datetime

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


def clean_api_key(value):
    if not value:
        return None
    return value.strip().strip('"').strip("'").strip()


def get_env_api_key():
    return clean_api_key(os.getenv(BEDROCK_API_KEY_ENV) or os.getenv("API_KEY"))


def validate_api_key(api_key):
    if not api_key:
        return "Vui lòng nhập API key."
    if api_key.lower().startswith("set "):
        return "Không nhập cả lệnh `set`; chỉ nhập giá trị API key."
    if not (api_key.startswith("bedrock-api-key-") or api_key.startswith("ABSK")):
        return "API key Bedrock thường bắt đầu bằng `bedrock-api-key-` hoặc `ABSK`. Vui lòng kiểm tra lại key."
    return None

# Page configuration
st.set_page_config(
    page_title="AWS Bedrock Chatbot",
    page_icon="🤖",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom CSS for ChatGPT-like interface
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
    </style>
""", unsafe_allow_html=True)

# Initialize session state
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

# Sidebar configuration
with st.sidebar:
    st.title("⚙️ Cấu hình")
    
    # API Key input
    st.subheader("AWS Bedrock Credentials")
    
    # Check if API_KEY exists in .env
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

    use_inference_profile = st.checkbox(
        "Dùng Inference Profile ARN (bắt buộc nếu model không hỗ trợ on-demand)",
        value=False,
    )
    inference_profile_arn = st.text_input(
        "Inference Profile ARN (arn:aws:bedrock:...:application-inference-profile/...)",
        type="password",
        disabled=not use_inference_profile,
    )

    effective_model_id = model_id

    # Region selection
    region = st.selectbox(
        "Chọn AWS Region:",
        ["ap-southeast-1"],
        help="Chọn region gần nhất với bạn",
    )

    # Force single region behavior even if UI changes later.
    region = "ap-southeast-1"

    st.info(f"Model: {effective_model_id}\nRegion: {region}")
    
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
                st.error(f"âŒ {api_key_error}")
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
                # Some models reject specifying both temperature and top_p/topP.
                "inferenceConfig": {"maxTokens": 16, "temperature": 0.0},
            }

            with st.spinner("Dang test..."):
                for m in models_to_test:
                    url = f"https://bedrock-runtime.{region}.amazonaws.com/model/{m}/converse"
                    t0 = time.perf_counter()
                    try:
                        r = requests.post(url, headers=headers, json=payload, timeout=20)
                        ms = int((time.perf_counter() - t0) * 1000)
                        ok = r.status_code == 200
                        err = ""
                        if not ok:
                            err = (r.text or "").strip().replace("\n", " ")[:200]
                            # Stop early if daily token quota is exhausted.
                            if (
                                r.status_code == 429
                                and "Too many tokens per day" in err
                            ):
                                results.append({"model": m, "status": r.status_code, "ms": ms, "ok": ok, "error": err})
                                break
                            # Surface the common "needs inference profile" hint more clearly.
                            if r.status_code == 400 and "on-demand throughput isnâ€™t supported" in err:
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
    
    # Display connection status
    st.divider()
    if st.session_state.api_key_configured:
        st.success("🟢 Đã kết nối")
        st.caption(f"🤖 {st.session_state.model_id}")
        st.caption(f"📍 {st.session_state.region}")
    else:
        st.warning("🔴 Chưa kết nối")

# Main chat interface
st.title("🤖 AWS Bedrock Chatbot")

# Display chat messages
chat_container = st.container()
with chat_container:
    for message in st.session_state.messages:
        if message["role"] == "user":
            st.markdown(f"""
                <div class="chat-message user">
                    <div class="message-content">
                        {message["content"]}
                    </div>
                </div>
            """, unsafe_allow_html=True)
        else:
            st.markdown(f"""
                <div class="chat-message assistant">
                    <div class="message-content">
                        {message["content"]}
                    </div>
                </div>
            """, unsafe_allow_html=True)

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
        placeholder="Hỏi tôi bất cứ điều gì...",
        key="user_input"
    )

    # Cursor-like "Continue" if previous assistant response was cut by maxTokens.
    if st.session_state.last_assistant_incomplete and st.session_state.last_assistant_index is not None:
        if st.button("Continue", use_container_width=True):
            try:
                with st.spinner("⏳ Đang tiếp tục..."):
                    messages_for_api = []
                    for msg in st.session_state.messages:
                        messages_for_api.append(
                            {
                                "role": msg["role"],
                                "content": [{"text": msg["content"]}],
                            }
                        )
                    # Do not add a visible user message to history; just nudge the model to continue.
                    messages_for_api.append({"role": "user", "content": [{"text": "Continue."}]})

                    url = f"https://bedrock-runtime.{st.session_state.region}.amazonaws.com/model/{st.session_state.model_id}/converse"
                    headers = {
                        "Authorization": f"Bearer {st.session_state.api_key}",
                        "Content-Type": "application/json",
                    }
                    payload = {
                        "messages": messages_for_api,
                        "inferenceConfig": {
                            "maxTokens": 1024,
                            "temperature": 0.7,
                        },
                    }
                    response = requests.post(url, headers=headers, json=payload)

                    if response.status_code != 200:
                        st.error(f"❌ Lỗi {response.status_code}: {response.text}")
                        st.session_state.last_assistant_incomplete = False
                        st.session_state.last_assistant_index = None
                        st.rerun()

                    result = response.json()
                    stop_reason = (result.get("stopReason") or result.get("stop_reason") or "").lower()
                    next_text = (
                        result.get("output", {})
                        .get("message", {})
                        .get("content", [{}])[0]
                        .get("text", "")
                    )
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
        
        # Get response from Bedrock
        try:
            with st.spinner("⏳ Đang suy nghĩ..."):
                # Prepare messages for Bedrock Converse API format
                messages_for_api = []
                for msg in st.session_state.messages:
                    messages_for_api.append(
                        {
                            "role": msg["role"],
                            "content": [{"text": msg["content"]}],
                        }
                    )
                
                # Call Bedrock API
                url = f"https://bedrock-runtime.{st.session_state.region}.amazonaws.com/model/{st.session_state.model_id}/converse"
                
                # Headers cực kỳ quan trọng
                headers = {
                    "Authorization": f"Bearer {st.session_state.api_key}",
                    "Content-Type": "application/json"
                }
                
                # Payload format Anthropic
                payload = {
                    "messages": messages_for_api,
                    "inferenceConfig": {
                        "maxTokens": 1024,
                        "temperature": 0.7,
                    },
                }
                
                response = requests.post(url, headers=headers, json=payload)
                
                if response.status_code == 200:
                    result = response.json()
                    stop_reason = (result.get("stopReason") or result.get("stop_reason") or "").lower()
                    
                    # Converse response shape: output.message.content[].text
                    assistant_message = ""
                    try:
                        assistant_message = (
                            result.get("output", {})
                            .get("message", {})
                            .get("content", [{}])[0]
                            .get("text", "")
                        )
                    except Exception:
                        assistant_message = ""

                    if not assistant_message:
                        assistant_message = str(result)
                    
                    # Add assistant message to history
                    st.session_state.messages.append({
                        "role": "assistant",
                        "content": assistant_message
                    })

                    # Track truncation for Continue
                    st.session_state.last_assistant_incomplete = stop_reason in ("max_tokens", "max-tokens")
                    st.session_state.last_assistant_index = (
                        len(st.session_state.messages) - 1 if st.session_state.last_assistant_incomplete else None
                    )
                    
                    # Display assistant message
                    st.markdown(f"""
                        <div class="chat-message assistant">
                            <div class="message-content">
                                {assistant_message}
                            </div>
                        </div>
                    """, unsafe_allow_html=True)
                    
                    st.rerun()
                else:
                    error_message = f"❌ Lỗi {response.status_code}: {response.text}"
                    st.error(error_message)
                    st.session_state.messages.pop()  # Remove user message
                
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

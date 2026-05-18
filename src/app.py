import streamlit as st
import requests
import json
import os
from dotenv import load_dotenv
from datetime import datetime

# Load environment variables
load_dotenv()

BEDROCK_API_KEY_ENV = "AWS_BEARER_TOKEN_BEDROCK"


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
if "model_id" not in st.session_state:
    st.session_state.model_id = "anthropic.claude-3-5-sonnet-20240620-v1:0"
if "region" not in st.session_state:
    st.session_state.region = "ap-southeast-1"

# Sidebar configuration
with st.sidebar:
    st.title("⚙️ Cấu hình")
    
    # API Key input
    st.subheader("AWS Bedrock Credentials")
    
    # Check if API_KEY exists in .env
    env_api_key = get_env_api_key()
    
    if env_api_key:
        st.success("✅ API_KEY từ .env đã được tìm thấy")
        api_key = env_api_key
    else:
        st.warning("⚠️ Chưa tìm thấy API_KEY trong .env")
        api_key = st.text_input(
            "Nhập API_KEY:",
            type="password",
            help="Lấy từ AWS Console (bedrock-api-key-...)"
        )
    
    # Model selection
    model_id = st.selectbox(
        "Chọn Model:",
        [
            "anthropic.claude-3-5-sonnet-20240620-v1:0",
            "anthropic.claude-3-opus-20240229-v1:0",
            "anthropic.claude-3-haiku-20240307-v1:0"
        ],
        index=0 if st.session_state.model_id == "anthropic.claude-3-5-sonnet-20240620-v1:0" else (1 if st.session_state.model_id == "anthropic.claude-3-opus-20240229-v1:0" else 2),
        help="Chọn model Claude phù hợp"
    )
    
    # Region selection
    region = st.selectbox(
        "Chọn AWS Region:",
        ["us-east-1", "us-west-2", "eu-west-1", "ap-southeast-1"],
        index=["us-east-1", "us-west-2", "eu-west-1", "ap-southeast-1"].index(st.session_state.region),
        help="Chọn region gần nhất với bạn"
    )
    
    # Configure button
    if st.button("🔧 Cấu hình Kết nối", use_container_width=True):
        try:
            api_key = clean_api_key(api_key)
            api_key_error = validate_api_key(api_key)
            if not api_key_error:
                st.session_state.api_key = api_key
                st.session_state.api_key_configured = True
                st.session_state.model_id = model_id
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
        st.caption(f"Model: {st.session_state.model_id}")
        st.caption(f"Region: {st.session_state.region}")
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
                # Prepare messages for API - format Anthropic
                messages_for_api = []
                for msg in st.session_state.messages:
                    messages_for_api.append({
                        "role": msg["role"],
                        "content": msg["content"]
                    })
                
                # Call Bedrock API
                url = f"https://bedrock-runtime.{st.session_state.region}.amazonaws.com/model/{st.session_state.model_id}/invoke"
                
                # Headers cực kỳ quan trọng
                headers = {
                    "Authorization": f"Bearer {st.session_state.api_key}",
                    "X-Amzn-Bedrock-Api-Key": st.session_state.api_key,
                    "Content-Type": "application/json"
                }
                
                # Payload format Anthropic
                payload = {
                    "anthropic_version": "bedrock-2023-05-31",
                    "max_tokens": 1024,
                    "temperature": 0.7,
                    "messages": messages_for_api
                }
                
                response = requests.post(
                    url,
                    headers=headers,
                    data=json.dumps(payload)
                )
                
                if response.status_code == 200:
                    result = response.json()
                    assistant_message = result['content'][0]['text']
                    
                    # Add assistant message to history
                    st.session_state.messages.append({
                        "role": "assistant",
                        "content": assistant_message
                    })
                    
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

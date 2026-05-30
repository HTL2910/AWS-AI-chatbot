import streamlit as st
import boto3
from botocore.exceptions import ClientError
import json

# Page config
st.set_page_config(
    page_title="AWS Bedrock Chatbot",
    page_icon="🤖",
    layout="wide"
)

# Initialize session state
if "messages" not in st.session_state:
    st.session_state.messages = []

# Initialize Bedrock client
@st.cache_resource
def get_bedrock_client():
    return boto3.client('bedrock-runtime', region_name='us-east-1')

# Header
col1, col2 = st.columns([0.9, 0.1])
with col1:
    st.title("🤖 AWS Bedrock Chatbot")
with col2:
    if st.button("Clear History"):
        st.session_state.messages = []
        st.rerun()

# Chat display
st.markdown("---")
chat_container = st.container()

with chat_container:
    if not st.session_state.messages:
        st.info("Welcome to AWS Bedrock Chatbot. Start typing your message below...")
    else:
        for message in st.session_state.messages:
            with st.chat_message(message["role"]):
                st.markdown(message["content"])

# Input area
st.markdown("---")

def send_message(user_input):
    if not user_input.strip():
        return
    
    # Add user message
    st.session_state.messages.append({"role": "user", "content": user_input})
    
    try:
        client = get_bedrock_client()
        # Call Bedrock API here
        response = client.invoke_model(
            modelId="anthropic.claude-3-sonnet-20240229-v1:0",
            body=json.dumps({
                "anthropic_version": "bedrock-2023-06-01",
                "max_tokens": 1024,
                "messages": [{"role": "user", "content": user_input}]
            })
        )
        
        result = json.loads(response['body'].read())
        assistant_message = result['content'][0]['text']
        st.session_state.messages.append({"role": "assistant", "content": assistant_message})
        
    except ClientError as e:
        st.error(f"Error: {str(e)}")

# Chat input
user_input = st.chat_input("Type your message here...")
if user_input:
    send_message(user_input)
    st.rerun()
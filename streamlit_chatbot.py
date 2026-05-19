import streamlit as st
import boto3
import json

# Initialize Bedrock client
client = boto3.client('bedrock-runtime', region_name='us-east-1')

# Page config
st.set_page_config(page_title="AWS AI Chatbot", layout="wide")
st.title("🤖 AWS AI Chatbot")

# Initialize session state for chat history
if "messages" not in st.session_state:
    st.session_state.messages = []

# Display chat history
for message in st.session_state.messages:
    with st.chat_message(message["role"]):
        st.markdown(message["content"])

# Chat input
user_input = st.chat_input("Ask me anything...")

if user_input:
    # Add user message to history
    st.session_state.messages.append({"role": "user", "content": user_input})
    with st.chat_message("user"):
        st.markdown(user_input)
    
    # Get response from Claude
    with st.chat_message("assistant"):
        with st.spinner("Thinking..."):
            try:
                response = client.invoke_model(
                    modelId="anthropic.claude-3-sonnet-20240229-v1:0",
                    body=json.dumps({
                        "anthropic_version": "bedrock-2023-06-01",
                        "max_tokens": 1024,
                        "messages": [{"role": "user", "content": user_input}]
                    })
                )
                result = json.loads(response['body'].read())
                assistant_reply = result['content'][0]['text']
                st.markdown(assistant_reply)
                st.session_state.messages.append({"role": "assistant", "content": assistant_reply})
            except Exception as e:
                st.error(f"❌ Error: {str(e)}")
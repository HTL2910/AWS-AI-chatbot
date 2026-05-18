#!/usr/bin/env python3
"""
Test script để kiểm tra Bedrock API connection
"""

import requests
import json
import os
from urllib.parse import quote
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configuration
API_KEY = os.getenv("AWS_BEARER_TOKEN_BEDROCK") or os.getenv("API_KEY")
region = "ap-southeast-1"
model_id = "arn:aws:bedrock:ap-southeast-1:510900713068:application-inference-profile/jxsjbl4xo623"
encoded_model_id = quote(model_id, safe="")

print("=" * 70)
print("🧪 BEDROCK API TEST")
print("=" * 70)

# Check API_KEY
if not API_KEY:
    print("❌ API_KEY không tìm thấy trong .env")
    exit(1)

print(f"✅ API_KEY found: {API_KEY[:30]}...")
print(f"📍 Region: {region}")
print(f"🤖 Model: {model_id}\n")

# Test 1: Simple message
print("📝 Test 1: Gửi tin nhắn đơn giản...")
print("-" * 70)

url = f"https://bedrock-runtime.{region}.amazonaws.com/model/{encoded_model_id}/converse"

headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

payload = {
    "messages": [
        {
            "role": "user",
            "content": [{"text": "Xin chào! Bạn là ai?"}]
        }
    ],
    "inferenceConfig": {"maxTokens": 1024, "temperature": 0.7}
}

try:
    print(f"🔗 URL: {url}")
    print(f"📤 Payload: {json.dumps(payload, indent=2)}\n")
    
    response = requests.post(
        url,
        headers=headers,
        data=json.dumps(payload),
        timeout=30
    )
    
    print(f"📊 Status Code: {response.status_code}")
    print(f"📋 Response Headers: {dict(response.headers)}\n")
    
    if response.status_code == 200:
        print("✅ SUCCESS!")
        result = response.json()
        print(f"📝 Response: {json.dumps(result, indent=2)}\n")
        
        content = result.get("output", {}).get("message", {}).get("content", [])
        if content:
            message = "".join(part.get("text", "") for part in content)
            print(f"💬 Claude: {message}\n")
    else:
        print(f"❌ ERROR {response.status_code}")
        print(f"📝 Response: {response.text}\n")
        
except requests.exceptions.Timeout:
    print("❌ Timeout - Kết nối quá lâu")
except requests.exceptions.ConnectionError as e:
    print(f"❌ Connection Error: {e}")
except Exception as e:
    print(f"❌ Error: {e}")

# Test 2: Multi-turn conversation
print("\n" + "=" * 70)
print("📝 Test 2: Cuộc trò chuyện nhiều lượt...")
print("-" * 70)

messages = [
    {"role": "user", "content": [{"text": "Tôi tên là Hùng"}]},
    {"role": "assistant", "content": [{"text": "Rất vui được gặp bạn, Hùng!"}]},
    {"role": "user", "content": [{"text": "Tôi là ai?"}]}
]

payload = {
    "messages": messages,
    "inferenceConfig": {"maxTokens": 1024, "temperature": 0.7}
}

try:
    response = requests.post(
        url,
        headers=headers,
        data=json.dumps(payload),
        timeout=30
    )
    
    if response.status_code == 200:
        print("✅ SUCCESS!")
        result = response.json()
        content = result.get("output", {}).get("message", {}).get("content", [])
        if content:
            message = "".join(part.get("text", "") for part in content)
            print(f"💬 Claude: {message}\n")
    else:
        print(f"❌ ERROR {response.status_code}: {response.text}\n")
        
except Exception as e:
    print(f"❌ Error: {e}\n")

print("=" * 70)
print("✅ TEST HOÀN THÀNH")
print("=" * 70)

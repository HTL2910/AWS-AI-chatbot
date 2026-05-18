#!/usr/bin/env python3
"""
Test script để kiểm tra Bedrock API connection
"""

import requests
import json
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configuration
API_KEY = os.getenv("API_KEY")
region = "ap-southeast-1"
model_id = "anthropic.claude-3-5-sonnet-20240620-v1:0"

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

url = f"https://bedrock-runtime.{region}.amazonaws.com/model/{model_id}/invoke"

headers = {
    "Authorization": f"Bearer {API_KEY}",
    "X-Amzn-Bedrock-Api-Key": API_KEY,
    "Content-Type": "application/json"
}

payload = {
    "anthropic_version": "bedrock-2023-05-31",
    "max_tokens": 1024,
    "temperature": 0.7,
    "messages": [
        {
            "role": "user",
            "content": "Xin chào! Bạn là ai?"
        }
    ]
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
        
        # Extract message
        if 'content' in result and len(result['content']) > 0:
            message = result['content'][0]['text']
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
    {"role": "user", "content": "Tôi tên là Hùng"},
    {"role": "assistant", "content": "Rất vui được gặp bạn, Hùng!"},
    {"role": "user", "content": "Tôi là ai?"}
]

payload = {
    "anthropic_version": "bedrock-2023-05-31",
    "max_tokens": 1024,
    "temperature": 0.7,
    "messages": messages
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
        if 'content' in result and len(result['content']) > 0:
            message = result['content'][0]['text']
            print(f"💬 Claude: {message}\n")
    else:
        print(f"❌ ERROR {response.status_code}: {response.text}\n")
        
except Exception as e:
    print(f"❌ Error: {e}\n")

print("=" * 70)
print("✅ TEST HOÀN THÀNH")
print("=" * 70)

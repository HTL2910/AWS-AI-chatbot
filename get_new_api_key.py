#!/usr/bin/env python3
"""
Script để lấy Bedrock API Key mới từ AWS Console
"""

import webbrowser
import os
from pathlib import Path

print("=" * 70)
print("🔑 LẤY BEDROCK API KEY MỚI")
print("=" * 70)
print()

print("📋 HƯỚNG DẪN:")
print()
print("1️⃣  Mở AWS Console:")
print("   - Truy cập: https://console.aws.amazon.com")
print("   - Đăng nhập với tài khoản AWS của bạn")
print()

print("2️⃣  Tìm Bedrock API Key:")
print("   - Tìm kiếm 'Bedrock' trong search bar")
print("   - Chọn 'Amazon Bedrock'")
print("   - Chọn 'API Keys' ở sidebar trái")
print("   - Chọn 'Create API Key'")
print()

print("3️⃣  Copy API Key:")
print("   - Sẽ thấy một chuỗi bắt đầu bằng 'bedrock-api-key-'")
print("   - Click 'Copy' hoặc select all và Ctrl+C")
print()

print("4️⃣  Dán vào đây:")
api_key = input("🔐 Nhập API Key (bedrock-api-key-...): ").strip().strip('"').strip("'")

if not api_key:
    print("❌ Không nhập gì cả!")
    exit(1)

if not api_key.startswith("bedrock-api-key-"):
    print("❌ API Key không hợp lệ! Phải bắt đầu bằng 'bedrock-api-key-'")
    exit(1)

# Update .env file
env_file = Path(".env")
env_content = f"API_KEY='{api_key}'\n"

env_file.write_text(env_content)
print()
print("✅ Đã cập nhật .env file!")
print(f"📝 API Key: {api_key[:40]}...")
print()

# Test the API key
print("🧪 Kiểm tra API Key...")
print()

import requests
import json

region = "ap-southeast-1"
model_id = "anthropic.claude-3-5-sonnet-20240620-v1:0"
url = f"https://bedrock-runtime.{region}.amazonaws.com/model/{model_id}/invoke"

headers = {
    "Authorization": f"Bearer {api_key}",
    "X-Amzn-Bedrock-Api-Key": api_key,
    "Content-Type": "application/json"
}

payload = {
    "anthropic_version": "bedrock-2023-05-31",
    "max_tokens": 100,
    "messages": [
        {
            "role": "user",
            "content": "Xin chào!"
        }
    ]
}

try:
    response = requests.post(
        url,
        headers=headers,
        data=json.dumps(payload),
        timeout=10
    )
    
    if response.status_code == 200:
        print("✅ API Key hợp lệ!")
        print("🚀 Bạn có thể chạy ứng dụng ngay bây giờ!")
        print()
        print("Chạy lệnh:")
        print("  streamlit run src/app.py")
    else:
        print(f"❌ Lỗi {response.status_code}: {response.text}")
        
except Exception as e:
    print(f"❌ Lỗi kết nối: {e}")

print()
print("=" * 70)

#!/usr/bin/env python3
"""
Debug script để kiểm tra app.py
"""

import os
from dotenv import load_dotenv

print("=" * 70)
print("🔍 DEBUG APP.PY")
print("=" * 70)

# Load .env
load_dotenv()

api_key = os.getenv("API_KEY")
print(f"\n1️⃣ API_KEY từ .env:")
print(f"   Value: {api_key[:50] if api_key else 'NOT FOUND'}...")
print(f"   Length: {len(api_key) if api_key else 0}")

# Check if requests is imported
try:
    import requests
    print(f"\n2️⃣ requests module: ✅ OK")
except ImportError:
    print(f"\n2️⃣ requests module: ❌ NOT INSTALLED")

# Check if streamlit is imported
try:
    import streamlit as st
    print(f"3️⃣ streamlit module: ✅ OK")
except ImportError:
    print(f"3️⃣ streamlit module: ❌ NOT INSTALLED")

# Check app.py syntax
try:
    with open("src/app.py", "r") as f:
        code = f.read()
    compile(code, "src/app.py", "exec")
    print(f"4️⃣ app.py syntax: ✅ OK")
except SyntaxError as e:
    print(f"4️⃣ app.py syntax: ❌ ERROR - {e}")

print("\n" + "=" * 70)
print("✅ DEBUG HOÀN THÀNH")
print("=" * 70)

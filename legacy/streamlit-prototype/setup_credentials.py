"""
Script để cấu hình AWS credentials từ API Key
Chạy: python setup_credentials.py
"""

import os
import json
import base64
from pathlib import Path
from urllib.parse import unquote

def extract_credentials_from_presigned_url(presigned_url):
    """
    Trích xuất AWS credentials từ presigned URL
    """
    try:
        # Decode URL-encoded string
        decoded = unquote(presigned_url)
        
        # Tìm các thành phần credentials
        credentials = {}
        
        # Tìm X-Amz-Credential
        if 'X-Amz-Credential=' in decoded:
            cred_start = decoded.find('X-Amz-Credential=') + len('X-Amz-Credential=')
            cred_end = decoded.find('&', cred_start)
            cred_part = decoded[cred_start:cred_end]
            
            # Format: AKIAIOSFODNN7EXAMPLE/20260514/us-east-1/bedrock/aws4_request
            parts = cred_part.split('/')
            if len(parts) >= 1:
                credentials['access_key'] = parts[0]
                if len(parts) >= 3:
                    credentials['date'] = parts[1]
                    credentials['region'] = parts[2]
        
        # Tìm X-Amz-Security-Token
        if 'X-Amz-Security-Token=' in decoded:
            token_start = decoded.find('X-Amz-Security-Token=') + len('X-Amz-Security-Token=')
            token_end = decoded.find('&', token_start)
            if token_end == -1:
                token_end = len(decoded)
            credentials['session_token'] = decoded[token_start:token_end]
        
        return credentials
    except Exception as e:
        print(f"❌ Lỗi khi trích xuất credentials: {e}")
        return None

def setup_credentials_interactive():
    """
    Cấu hình credentials tương tác
    """
    print("\n" + "="*60)
    print("🔐 AWS Bedrock Chatbot - Cấu Hình Credentials")
    print("="*60 + "\n")
    
    print("Bạn có 2 cách để cấu hình:\n")
    print("1️⃣  Sử dụng Access Key ID + Secret Access Key")
    print("2️⃣  Sử dụng Presigned URL (từ AWS Console)\n")
    
    choice = input("Chọn cách (1 hoặc 2): ").strip()
    
    credentials = {}
    
    if choice == "1":
        print("\n📝 Nhập AWS Credentials:")
        access_key = input("Access Key ID: ").strip()
        secret_key = input("Secret Access Key: ").strip()
        region = input("Region (mặc định: us-east-1): ").strip() or "us-east-1"
        
        if access_key and secret_key:
            credentials = {
                'access_key': access_key,
                'secret_key': secret_key,
                'region': region
            }
        else:
            print("❌ Access Key hoặc Secret Key không được để trống!")
            return False
    
    elif choice == "2":
        print("\n📝 Nhập Presigned URL:")
        print("(Bạn có thể lấy từ AWS Console hoặc STS)")
        presigned_url = input("Presigned URL: ").strip()
        
        if presigned_url:
            extracted = extract_credentials_from_presigned_url(presigned_url)
            if extracted:
                credentials = extracted
                print(f"\n✅ Trích xuất thành công!")
                print(f"   Access Key: {credentials.get('access_key', 'N/A')}")
                print(f"   Region: {credentials.get('region', 'N/A')}")
            else:
                print("❌ Không thể trích xuất credentials từ URL!")
                return False
        else:
            print("❌ URL không được để trống!")
            return False
    
    else:
        print("❌ Lựa chọn không hợp lệ!")
        return False
    
    # Lưu vào .env
    env_file = Path(".env")
    
    # Đọc nội dung hiện tại nếu file tồn tại
    env_content = ""
    if env_file.exists():
        with open(env_file, 'r', encoding='utf-8') as f:
            env_content = f.read()
    
    # Cập nhật hoặc thêm credentials
    lines = env_content.split('\n') if env_content else []
    updated_lines = []
    
    keys_to_update = {
        'AWS_ACCESS_KEY_ID': credentials.get('access_key', ''),
        'AWS_SECRET_ACCESS_KEY': credentials.get('secret_key', ''),
        'AWS_DEFAULT_REGION': credentials.get('region', 'us-east-1'),
        'AWS_SESSION_TOKEN': credentials.get('session_token', '')
    }
    
    updated_keys = set()
    
    for line in lines:
        updated = False
        for key, value in keys_to_update.items():
            if line.startswith(f"{key}="):
                if value:  # Chỉ cập nhật nếu có giá trị
                    updated_lines.append(f"{key}={value}")
                    updated_keys.add(key)
                updated = True
                break
        if not updated and line.strip():
            updated_lines.append(line)
    
    # Thêm các key chưa có
    for key, value in keys_to_update.items():
        if key not in updated_keys and value:
            updated_lines.append(f"{key}={value}")
    
    # Lưu vào file
    with open(env_file, 'w', encoding='utf-8') as f:
        f.write('\n'.join(updated_lines))
    
    print(f"\n✅ Credentials đã được lưu vào .env")
    print(f"📁 File: {env_file.absolute()}\n")
    
    # Hiển thị thông tin (ẩn secret key)
    print("📋 Thông tin đã lưu:")
    print(f"   Access Key ID: {credentials.get('access_key', 'N/A')}")
    print(f"   Secret Key: {'*' * 20}")
    print(f"   Region: {credentials.get('region', 'us-east-1')}")
    if credentials.get('session_token'):
        print(f"   Session Token: {'*' * 20}")
    
    print("\n⚠️  Lưu ý bảo mật:")
    print("   - Không commit .env lên Git")
    print("   - Không chia sẻ credentials với ai")
    print("   - Rotate credentials định kỳ")
    
    return True

def verify_credentials():
    """
    Kiểm tra xem credentials có hợp lệ không
    """
    print("\n🔍 Kiểm tra credentials...\n")
    
    try:
        import boto3
        from dotenv import load_dotenv
        
        load_dotenv()
        
        # Tạo client để kiểm tra
        client = boto3.client('bedrock-runtime')
        
        # Thử gọi API để kiểm tra
        response = client.list_foundation_models()
        
        print("✅ Credentials hợp lệ!")
        print(f"   Tìm thấy {len(response.get('modelSummaries', []))} models")
        
        # Hiển thị các model Claude
        claude_models = [m for m in response.get('modelSummaries', []) 
                        if 'claude' in m.get('modelId', '').lower()]
        
        if claude_models:
            print("\n📦 Các model Claude khả dụng:")
            for model in claude_models[:5]:  # Hiển thị 5 model đầu
                print(f"   - {model['modelId']}")
        
        return True
    
    except Exception as e:
        print(f"❌ Lỗi kiểm tra credentials: {e}")
        print("\n💡 Gợi ý:")
        print("   - Kiểm tra lại Access Key và Secret Key")
        print("   - Đảm bảo IAM User có quyền Bedrock")
        print("   - Kiểm tra region có hỗ trợ Bedrock không")
        return False

def main():
    """
    Main function
    """
    print("\n🚀 AWS Bedrock Chatbot - Setup Script\n")
    
    # Kiểm tra xem .env đã tồn tại chưa
    env_file = Path(".env")
    if env_file.exists():
        print("📁 File .env đã tồn tại")
        choice = input("Bạn có muốn cập nhật credentials không? (y/n): ").strip().lower()
        if choice != 'y':
            print("⏭️  Bỏ qua cấu hình")
            return
    
    # Cấu hình credentials
    if setup_credentials_interactive():
        # Kiểm tra credentials
        verify = input("\nBạn có muốn kiểm tra credentials không? (y/n): ").strip().lower()
        if verify == 'y':
            verify_credentials()
        
        print("\n✨ Setup hoàn tất!")
        print("🚀 Chạy ứng dụng: streamlit run app.py\n")
    else:
        print("\n❌ Setup thất bại!")

if __name__ == "__main__":
    main()

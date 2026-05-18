"""
Ví dụ sử dụng AWS Bedrock API với boto3
Chạy: python example_usage.py
"""

import boto3
import json
from dotenv import load_dotenv
import os

# Load environment variables
load_dotenv()

def example_1_basic_chat():
    """
    Ví dụ 1: Chat cơ bản với Bedrock
    """
    print("\n" + "="*60)
    print("📝 Ví dụ 1: Chat Cơ Bản")
    print("="*60 + "\n")
    
    # Khởi tạo client
    client = boto3.client(
        'bedrock-runtime',
        region_name='us-east-1'
    )
    
    # Chuẩn bị message
    messages = [
        {
            "role": "user",
            "content": "Xin chào! Bạn là ai?"
        }
    ]
    
    # Gọi API
    response = client.converse(
        modelId='anthropic.claude-3-5-sonnet-20240620-v1:0',
        messages=messages,
        inferenceConfig={
            "maxTokens": 1024,
            "temperature": 0.7,
            "topP": 0.9
        }
    )
    
    # Lấy response
    assistant_message = response['output']['message']['content'][0]['text']
    print(f"🤖 Assistant: {assistant_message}\n")

def example_2_multi_turn_conversation():
    """
    Ví dụ 2: Cuộc trò chuyện nhiều lượt
    """
    print("\n" + "="*60)
    print("📝 Ví dụ 2: Cuộc Trò Chuyện Nhiều Lượt")
    print("="*60 + "\n")
    
    client = boto3.client(
        'bedrock-runtime',
        region_name='us-east-1'
    )
    
    # Lịch sử chat
    messages = []
    
    # Lượt 1
    user_input_1 = "Hãy giải thích về machine learning"
    messages.append({"role": "user", "content": user_input_1})
    
    response_1 = client.converse(
        modelId='anthropic.claude-3-5-sonnet-20240620-v1:0',
        messages=messages,
        inferenceConfig={"maxTokens": 1024, "temperature": 0.7}
    )
    
    assistant_response_1 = response_1['output']['message']['content'][0]['text']
    messages.append({"role": "assistant", "content": assistant_response_1})
    
    print(f"👤 User: {user_input_1}")
    print(f"🤖 Assistant: {assistant_response_1[:200]}...\n")
    
    # Lượt 2
    user_input_2 = "Có thể cho ví dụ cụ thể không?"
    messages.append({"role": "user", "content": user_input_2})
    
    response_2 = client.converse(
        modelId='anthropic.claude-3-5-sonnet-20240620-v1:0',
        messages=messages,
        inferenceConfig={"maxTokens": 1024, "temperature": 0.7}
    )
    
    assistant_response_2 = response_2['output']['message']['content'][0]['text']
    messages.append({"role": "assistant", "content": assistant_response_2})
    
    print(f"👤 User: {user_input_2}")
    print(f"🤖 Assistant: {assistant_response_2[:200]}...\n")

def example_3_system_prompt():
    """
    Ví dụ 3: Sử dụng system prompt để định hướng AI
    """
    print("\n" + "="*60)
    print("📝 Ví dụ 3: Sử Dụng System Prompt")
    print("="*60 + "\n")
    
    client = boto3.client(
        'bedrock-runtime',
        region_name='us-east-1'
    )
    
    # System prompt
    system_prompt = """
    Bạn là một trợ lý AI chuyên về lập trình Python.
    Hãy trả lời các câu hỏi về Python một cách chi tiết và cung cấp ví dụ code.
    Luôn sử dụng tiếng Việt.
    """
    
    messages = [
        {
            "role": "user",
            "content": "Làm thế nào để tạo một list comprehension trong Python?"
        }
    ]
    
    response = client.converse(
        modelId='anthropic.claude-3-5-sonnet-20240620-v1:0',
        messages=messages,
        system=system_prompt,
        inferenceConfig={"maxTokens": 1024, "temperature": 0.7}
    )
    
    assistant_message = response['output']['message']['content'][0]['text']
    print(f"🤖 Assistant: {assistant_message}\n")

def example_4_different_models():
    """
    Ví dụ 4: So sánh các model khác nhau
    """
    print("\n" + "="*60)
    print("📝 Ví dụ 4: So Sánh Các Model")
    print("="*60 + "\n")
    
    client = boto3.client(
        'bedrock-runtime',
        region_name='us-east-1'
    )
    
    models = [
        'anthropic.claude-3-5-sonnet-20240620-v1:0',
        'anthropic.claude-3-opus-20240229-v1:0',
        'anthropic.claude-3-haiku-20240307-v1:0'
    ]
    
    user_message = "Giải thích ngắn gọn về AI là gì?"
    
    for model in models:
        try:
            response = client.converse(
                modelId=model,
                messages=[{"role": "user", "content": user_message}],
                inferenceConfig={"maxTokens": 256, "temperature": 0.7}
            )
            
            assistant_message = response['output']['message']['content'][0]['text']
            model_name = model.split('/')[-1].split('-')[2]  # Lấy tên model
            
            print(f"📦 Model: {model_name}")
            print(f"   Response: {assistant_message[:150]}...\n")
        
        except Exception as e:
            print(f"❌ Lỗi với model {model}: {e}\n")

def example_5_temperature_effect():
    """
    Ví dụ 5: Ảnh hưởng của temperature đến response
    """
    print("\n" + "="*60)
    print("📝 Ví dụ 5: Ảnh Hưởng Của Temperature")
    print("="*60 + "\n")
    
    client = boto3.client(
        'bedrock-runtime',
        region_name='us-east-1'
    )
    
    user_message = "Viết một câu thơ ngắn về mùa xuân"
    temperatures = [0.1, 0.5, 0.9]
    
    for temp in temperatures:
        response = client.converse(
            modelId='anthropic.claude-3-5-sonnet-20240620-v1:0',
            messages=[{"role": "user", "content": user_message}],
            inferenceConfig={"maxTokens": 256, "temperature": temp}
        )
        
        assistant_message = response['output']['message']['content'][0]['text']
        
        print(f"🌡️  Temperature: {temp}")
        print(f"   Response: {assistant_message}\n")

def example_6_error_handling():
    """
    Ví dụ 6: Xử lý lỗi
    """
    print("\n" + "="*60)
    print("📝 Ví dụ 6: Xử Lý Lỗi")
    print("="*60 + "\n")
    
    client = boto3.client(
        'bedrock-runtime',
        region_name='us-east-1'
    )
    
    try:
        # Thử gọi API với model không tồn tại
        response = client.converse(
            modelId='anthropic.claude-invalid-model',
            messages=[{"role": "user", "content": "Hello"}],
            inferenceConfig={"maxTokens": 1024}
        )
    
    except client.exceptions.ModelNotFound:
        print("❌ Lỗi: Model không tồn tại")
    
    except client.exceptions.AccessDenied:
        print("❌ Lỗi: Không có quyền truy cập")
    
    except Exception as e:
        print(f"❌ Lỗi: {type(e).__name__}: {e}")
    
    print()

def example_7_list_models():
    """
    Ví dụ 7: Liệt kê các model khả dụng
    """
    print("\n" + "="*60)
    print("📝 Ví dụ 7: Liệt Kê Các Model Khả Dụng")
    print("="*60 + "\n")
    
    client = boto3.client(
        'bedrock-runtime',
        region_name='us-east-1'
    )
    
    try:
        response = client.list_foundation_models()
        
        print(f"📦 Tổng số models: {len(response['modelSummaries'])}\n")
        
        # Lọc các model Claude
        claude_models = [m for m in response['modelSummaries'] 
                        if 'claude' in m.get('modelId', '').lower()]
        
        print("🤖 Các model Claude khả dụng:")
        for model in claude_models:
            print(f"   - {model['modelId']}")
            print(f"     Provider: {model.get('modelProvider', 'N/A')}")
            print(f"     Input tokens: {model.get('inputTokenCount', 'N/A')}")
            print()
    
    except Exception as e:
        print(f"❌ Lỗi: {e}")

def main():
    """
    Main function - Chạy tất cả ví dụ
    """
    print("\n🚀 AWS Bedrock - Ví Dụ Sử Dụng\n")
    
    try:
        # Kiểm tra credentials
        print("🔍 Kiểm tra credentials...")
        client = boto3.client('bedrock-runtime', region_name='us-east-1')
        response = client.list_foundation_models()
        print(f"✅ Credentials hợp lệ! Tìm thấy {len(response['modelSummaries'])} models\n")
        
        # Chạy các ví dụ
        examples = [
            ("1", "Chat Cơ Bản", example_1_basic_chat),
            ("2", "Cuộc Trò Chuyện Nhiều Lượt", example_2_multi_turn_conversation),
            ("3", "Sử Dụng System Prompt", example_3_system_prompt),
            ("4", "So Sánh Các Model", example_4_different_models),
            ("5", "Ảnh Hưởng Của Temperature", example_5_temperature_effect),
            ("6", "Xử Lý Lỗi", example_6_error_handling),
            ("7", "Liệt Kê Các Model", example_7_list_models),
        ]
        
        print("Chọn ví dụ để chạy:")
        for num, name, _ in examples:
            print(f"  {num}. {name}")
        print("  0. Chạy tất cả")
        print("  q. Thoát")
        
        choice = input("\nNhập lựa chọn: ").strip()
        
        if choice == 'q':
            print("\n👋 Tạm biệt!")
            return
        
        if choice == '0':
            for _, _, func in examples:
                try:
                    func()
                except Exception as e:
                    print(f"❌ Lỗi: {e}\n")
        else:
            for num, _, func in examples:
                if num == choice:
                    func()
                    break
    
    except Exception as e:
        print(f"❌ Lỗi: {e}")
        print("\n💡 Gợi ý:")
        print("   - Kiểm tra AWS credentials")
        print("   - Kiểm tra IAM permissions")
        print("   - Kiểm tra region hỗ trợ Bedrock")

if __name__ == "__main__":
    main()

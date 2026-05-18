# 📦 AWS Bedrock Chatbot - Tóm Tắt Dự Án

## 🎯 Mục Đích

Tạo một ứng dụng Chatbot hiện đại sử dụng:
- **Streamlit** - Giao diện web
- **Amazon Bedrock** - AI API
- **Claude 3.5 Sonnet** - Model AI
- **Python** - Ngôn ngữ lập trình

## 📁 Cấu Trúc Dự Án

```
TestAWS/
├── app.py                      # ⭐ Ứng dụng Streamlit chính
├── setup_credentials.py        # 🔐 Script cấu hình credentials
├── example_usage.py            # 📚 Ví dụ sử dụng API
├── requirements.txt            # 📦 Dependencies
├── .env                        # 🔑 AWS credentials (không commit!)
├── .gitignore                  # 🚫 Ignore files
├── README.md                   # 📖 Hướng dẫn chính
├── QUICK_START_WINDOWS.md      # ⚡ Quick start cho Windows
├── HUONG_DAN_AWS.md           # 📚 Hướng dẫn chi tiết AWS
├── CREDENTIALS_GUIDE.md        # 🔐 Hướng dẫn credentials
└── PROJECT_SUMMARY.md          # 📄 File này
```

## 🚀 Bắt Đầu Nhanh

### 1. Cài Đặt Dependencies
```bash
pip install -r requirements.txt
```

### 2. Cấu Hình AWS Credentials
```bash
python setup_credentials.py
```

### 3. Chạy Ứng Dụng
```bash
streamlit run app.py
```

## 📋 Các File Chi Tiết

### 1. **app.py** - Ứng Dụng Chính
- Giao diện Streamlit giống ChatGPT
- Quản lý lịch sử chat
- Cấu hình AWS credentials
- Gọi Bedrock API
- Lưu/xóa chat history

**Tính năng:**
- ✅ Chat interface hiện đại
- ✅ Lưu lịch sử trong session
- ✅ Export chat history
- ✅ Chọn model và region
- ✅ Xử lý lỗi

### 2. **setup_credentials.py** - Cấu Hình Credentials
Script tương tác để cấu hình AWS credentials

**Hỗ trợ:**
- ✅ Nhập Access Key + Secret Key
- ✅ Trích xuất từ Presigned URL
- ✅ Lưu vào .env
- ✅ Kiểm tra credentials

**Chạy:**
```bash
python setup_credentials.py
```

### 3. **example_usage.py** - Ví Dụ Sử Dụng
7 ví dụ về cách sử dụng Bedrock API

**Ví dụ:**
1. Chat cơ bản
2. Cuộc trò chuyện nhiều lượt
3. Sử dụng system prompt
4. So sánh các model
5. Ảnh hưởng của temperature
6. Xử lý lỗi
7. Liệt kê models

**Chạy:**
```bash
python example_usage.py
```

### 4. **requirements.txt** - Dependencies
```
streamlit==1.35.0
boto3==1.34.0
python-dotenv==1.0.0
```

### 5. **.env** - AWS Credentials
```env
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_DEFAULT_REGION=us-east-1
```

⚠️ **Không commit lên Git!**

### 6. **.gitignore** - Ignore Files
Danh sách files không commit:
- .env
- chat_history_*.json
- __pycache__/
- .streamlit/

### 7. **README.md** - Hướng Dẫn Chính
- Tổng quan dự án
- Cài đặt nhanh
- Cách sử dụng
- Troubleshooting
- Tài liệu tham khảo

### 8. **QUICK_START_WINDOWS.md** - Quick Start
Hướng dẫn nhanh cho Windows:
- Cài đặt dependencies
- Cấu hình credentials
- Chạy ứng dụng
- Lỗi thường gặp

### 9. **HUONG_DAN_AWS.md** - Hướng Dẫn Chi Tiết
Hướng dẫn toàn diện:
- Tạo AWS Access Keys
- Cấu hình IAM permissions
- Cấp quyền Bedrock
- Bảo mật best practices
- Troubleshooting chi tiết

### 10. **CREDENTIALS_GUIDE.md** - Hướng Dẫn Credentials
4 cách cấu hình credentials:
1. File .env
2. AWS CLI Configuration
3. Environment Variables
4. Presigned URL

## 🔑 Cấu Hình AWS Credentials

### Cách 1: File .env (Khuyến nghị)
```env
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_DEFAULT_REGION=us-east-1
```

### Cách 2: AWS CLI
```bash
aws configure
```

### Cách 3: Environment Variables
```bash
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_DEFAULT_REGION="us-east-1"
```

### Cách 4: Presigned URL
```bash
python setup_credentials.py
# Chọn option 2
```

## 🤖 Models Khả Dụng

| Model | Tốc Độ | Chất Lượng | Giá | Khuyến Nghị |
|-------|--------|-----------|-----|-----------|
| Claude 3.5 Sonnet | ⚡⚡⚡ | ⭐⭐⭐⭐⭐ | $ | ✅ |
| Claude 3 Opus | ⚡⚡ | ⭐⭐⭐⭐⭐ | $$ | Cho tasks phức tạp |
| Claude 3 Haiku | ⚡⚡⚡⚡ | ⭐⭐⭐ | $ | Cho tasks đơn giản |

## 🌍 Regions Hỗ Trợ

- `us-east-1` (N. Virginia) - ✅ Khuyến nghị
- `us-west-2` (Oregon)
- `eu-west-1` (Ireland)
- `ap-southeast-1` (Singapore)

## 🛡️ Bảo Mật

### ✅ Nên Làm
- Lưu credentials trong .env
- Sử dụng IAM User (không Root)
- Giới hạn quyền (chỉ Bedrock)
- Rotate keys định kỳ
- Sử dụng MFA

### ❌ Không Nên Làm
- Không commit .env lên Git
- Không chia sẻ Secret Key
- Không hardcode credentials
- Không sử dụng Root Account
- Không để credentials trong logs

## 🧪 Kiểm Tra Credentials

### Python
```python
import boto3
client = boto3.client('bedrock-runtime')
response = client.list_foundation_models()
print("✅ Credentials hợp lệ!")
```

### AWS CLI
```bash
aws sts get-caller-identity
```

## 🐛 Troubleshooting

| Lỗi | Nguyên Nhân | Giải Pháp |
|-----|-----------|----------|
| InvalidSignatureException | Access Key sai | Kiểm tra .env |
| AccessDenied | Không có quyền | Thêm Bedrock policy |
| ModelNotFound | Model không khả dụng | Thử region khác |
| ModuleNotFoundError | Dependencies chưa cài | pip install -r requirements.txt |

## 📊 Workflow

```
1. Cài đặt dependencies
   ↓
2. Cấu hình AWS credentials
   ↓
3. Chạy ứng dụng
   ↓
4. Mở sidebar
   ↓
5. Nhập API Key (nếu cần)
   ↓
6. Chọn model và region
   ↓
7. Click "Cấu hình Kết Nối"
   ↓
8. Bắt đầu chat!
```

## 💡 Tips & Tricks

### Tăng Tốc Độ
```python
"maxTokens": 512,      # Giảm từ 1024
"temperature": 0.5,    # Giảm từ 0.7
```

### Tăng Chất Lượng
```python
"maxTokens": 2048,     # Tăng từ 1024
"temperature": 0.3,    # Giảm từ 0.7
"topP": 0.7,          # Giảm từ 0.9
```

### Lưu Chat Tự Động
Thêm vào app.py:
```python
import atexit

def save_on_exit():
    if st.session_state.messages:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        with open(f"chat_history_{timestamp}.json", 'w') as f:
            json.dump(st.session_state.messages, f, indent=2)

atexit.register(save_on_exit)
```

## 📚 Tài Liệu Tham Khảo

- [AWS Bedrock Docs](https://docs.aws.amazon.com/bedrock/)
- [Boto3 Documentation](https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/bedrock-runtime.html)
- [Streamlit Docs](https://docs.streamlit.io/)
- [Claude API Guide](https://docs.anthropic.com/claude/reference/getting-started-with-the-api)
- [AWS IAM Best Practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)

## 🎓 Học Thêm

### Streamlit
- [Streamlit Tutorial](https://docs.streamlit.io/library/get-started)
- [Streamlit Components](https://docs.streamlit.io/library/api-reference)

### Boto3
- [Boto3 Guide](https://boto3.amazonaws.com/v1/documentation/api/latest/guide/index.html)
- [Bedrock Runtime API](https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/bedrock-runtime.html)

### AWS
- [AWS Free Tier](https://aws.amazon.com/free/)
- [AWS Bedrock Pricing](https://aws.amazon.com/bedrock/pricing/)

## 🤝 Đóng Góp

Nếu bạn tìm thấy bug hoặc có gợi ý:
1. Tạo issue
2. Tạo pull request
3. Liên hệ support

## 📄 License

MIT License - Tự do sử dụng cho mục đích cá nhân và thương mại.

## 🎉 Chúc Bạn Thành Công!

Nếu có bất kỳ câu hỏi nào, vui lòng tham khảo các file hướng dẫn hoặc liên hệ support.

---

**Phiên bản:** 1.0.0  
**Cập nhật lần cuối:** May 2026  
**Tác giả:** AWS Bedrock Chatbot Team

## 📞 Liên Hệ & Hỗ Trợ

- 📧 Email: support@example.com
- 💬 Discord: [Link Discord]
- 🐛 Issues: [GitHub Issues]
- 📖 Wiki: [Project Wiki]

---

**Cảm ơn bạn đã sử dụng AWS Bedrock Chatbot! 🙏**

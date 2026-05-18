# 🤖 AWS Bedrock Chatbot - Streamlit

Một ứng dụng Chatbot hiện đại xây dựng bằng **Streamlit** và **Amazon Bedrock**, có giao diện giống ChatGPT với lịch sử chat được lưu trữ.

## ✨ Tính Năng

- 💬 **Chat Interface** - Giao diện giống ChatGPT
- 🤖 **Multiple Models** - Hỗ trợ Claude 3.5 Sonnet, Opus, Haiku
- 📝 **Chat History** - Lưu lịch sử chat trong session
- 💾 **Export Chat** - Lưu chat history dưới dạng JSON
- 🔐 **Secure Credentials** - Cấu hình AWS credentials an toàn
- 🌍 **Multi-Region** - Hỗ trợ nhiều AWS regions
- ⚡ **Real-time Response** - Phản hồi nhanh từ Bedrock

## 📋 Yêu Cầu

- Python 3.8+
- AWS Account với Bedrock access
- pip (Python package manager)

## 🚀 Cài Đặt Nhanh

### 1. Clone hoặc Download Project

```bash
cd TestAWS
```

### 2. Cài Đặt Dependencies

```bash
pip install -r requirements.txt
```

### 3. Cấu Hình AWS Credentials

**Cách 1: Sử dụng Setup Script (Khuyến nghị)**

```bash
python setup_credentials.py
```

Script sẽ hướng dẫn bạn nhập credentials và lưu vào `.env`

**Cách 2: Cấu Hình Thủ Công**

Tạo hoặc chỉnh sửa file `.env`:

```env
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here
AWS_DEFAULT_REGION=us-east-1
```

### 4. Chạy Ứng Dụng

```bash
streamlit run app.py
```

Ứng dụng sẽ mở tại: `http://localhost:8501`

## 📖 Hướng Dẫn Chi Tiết

Xem file **HUONG_DAN_AWS.md** để có hướng dẫn chi tiết về:
- Tạo AWS Access Keys
- Cấu hình IAM permissions
- Troubleshooting
- Best practices bảo mật

## 🎯 Cách Sử Dụng

1. **Mở Sidebar** (bên trái)
2. **Nhập AWS Bedrock API Key** (nếu chưa cấu hình qua .env)
3. **Chọn Model** - Khuyến nghị: Claude 3.5 Sonnet
4. **Chọn Region** - Gần nhất với bạn
5. **Click "🔧 Cấu Hình Kết Nối"**
6. **Bắt đầu chat!**

## 📁 Cấu Trúc Project

```
TestAWS/
├── app.py                    # Main Streamlit app
├── setup_credentials.py      # Script cấu hình credentials
├── requirements.txt          # Python dependencies
├── .env                      # AWS credentials (không commit!)
├── README.md                 # File này
├── HUONG_DAN_AWS.md         # Hướng dẫn chi tiết
└── chat_history_*.json      # Lịch sử chat (tự động tạo)
```

## 🔧 Cấu Hình AWS Credentials

### Từ Access Key ID + Secret Key

```python
# Tự động từ .env
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

### Từ Presigned URL

Nếu bạn có presigned URL từ AWS Console:

```bash
python setup_credentials.py
# Chọn option 2 và dán presigned URL
```

Script sẽ tự động trích xuất credentials.

## 🛡️ Bảo Mật

### ✅ Nên Làm
- Lưu credentials trong `.env`
- Sử dụng IAM User (không phải Root)
- Giới hạn quyền (chỉ Bedrock)
- Rotate keys định kỳ

### ❌ Không Nên Làm
- Không commit `.env` lên Git
- Không chia sẻ Secret Key
- Không hardcode credentials
- Không sử dụng Root Account

### .gitignore

```
.env
.env.local
*.json
chat_history_*.json
__pycache__/
*.pyc
```

## 🐛 Troubleshooting

### Lỗi: "InvalidSignatureException"
```
❌ Nguyên nhân: Access Key hoặc Secret Key sai
✅ Giải pháp: Kiểm tra lại credentials trong .env
```

### Lỗi: "AccessDenied"
```
❌ Nguyên nhân: IAM User không có quyền Bedrock
✅ Giải pháp: Thêm AmazonBedrockFullAccess policy
```

### Lỗi: "ModelNotFound"
```
❌ Nguyên nhân: Model không khả dụng ở region
✅ Giải pháp: Thử region khác (us-east-1 hoặc us-west-2)
```

### Lỗi: "ModuleNotFoundError: No module named 'streamlit'"
```
❌ Nguyên nhân: Dependencies chưa cài đặt
✅ Giải pháp: pip install -r requirements.txt
```

## 📊 Models Khả Dụng

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

## 💡 Tips & Tricks

### Tăng Tốc Độ Response
```python
# Trong app.py, tìm inferenceConfig
"maxTokens": 512,      # Giảm từ 1024
"temperature": 0.5,    # Giảm từ 0.7
```

### Tăng Chất Lượng Response
```python
"maxTokens": 2048,     # Tăng từ 1024
"temperature": 0.3,    # Giảm từ 0.7
"topP": 0.7,          # Giảm từ 0.9
```

### Lưu Chat History Tự Động
Ứng dụng đã hỗ trợ lưu manual. Để lưu tự động, thêm vào app.py:

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

## 🤝 Đóng Góp

Nếu bạn tìm thấy bug hoặc có gợi ý, vui lòng tạo issue hoặc pull request.

## 📄 License

MIT License - Tự do sử dụng cho mục đích cá nhân và thương mại.

## 🎉 Chúc Bạn Thành Công!

Nếu có bất kỳ câu hỏi nào, vui lòng tham khảo **HUONG_DAN_AWS.md** hoặc liên hệ support.

---

**Phiên bản:** 1.0.0  
**Cập nhật lần cuối:** May 2026  
**Tác giả:** AWS Bedrock Chatbot Team

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
cd aws-bedrock-chatbot
```

### 2. Cài Đặt Dependencies

```bash
pip install -r config/requirements.txt
```

### 3. Cấu Hình AWS Credentials

```bash
python src/setup_credentials.py
```

### 4. Chạy Ứng Dụng

```bash
streamlit run src/app.py
```

Ứng dụng sẽ mở tại: `http://localhost:8501`

## 📖 Hướng Dẫn Chi Tiết

Xem thư mục `docs/` để có hướng dẫn chi tiết:

- **docs/START_HERE.md** - Bắt đầu nhanh (5 phút)
- **docs/HOW_TO_USE.md** - Cách sử dụng ứng dụng
- **docs/HUONG_DAN_AWS.md** - Hướng dẫn AWS
- **docs/CREDENTIALS_GUIDE.md** - Hướng dẫn credentials

## 📁 Cấu Trúc Project

```
aws-bedrock-chatbot/
├── src/                          # Source code
│   ├── app.py                   # Ứng dụng Streamlit chính
│   └── setup_credentials.py     # Cấu hình credentials
│
├── docs/                         # Tài liệu
│   ├── START_HERE.md            # Bắt đầu nhanh
│   ├── README.md                # Tài liệu chính
│   ├── HOW_TO_USE.md            # Cách sử dụng
│   ├── HUONG_DAN_AWS.md         # Hướng dẫn AWS
│   ├── CREDENTIALS_GUIDE.md     # Hướng dẫn credentials
│   └── ...
│
├── examples/                     # Ví dụ
│   └── example_usage.py         # 7 ví dụ sử dụng API
│
├── config/                       # Cấu hình
│   ├── requirements.txt         # Dependencies
│   └── .env.example             # Ví dụ .env
│
├── .gitignore                    # Git ignore
└── README.md                     # File này
```

## 🔧 Cấu Hình AWS Credentials

### Cách 1: Setup Script (Khuyến nghị)

```bash
python src/setup_credentials.py
```

### Cách 2: Cấu Hình Thủ Công

Tạo file `.env` ở root directory:

```env
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_DEFAULT_REGION=us-east-1
```

### Cách 3: AWS CLI

```bash
aws configure
```

## 🎯 Sử Dụng Ứng Dụng

1. **Chạy ứng dụng:** `streamlit run src/app.py`
2. **Mở Sidebar** (bên trái)
3. **Nhập API Key** (nếu chưa cấu hình .env)
4. **Chọn Model** - Khuyến nghị: Claude 3.5 Sonnet
5. **Chọn Region** - Gần nhất với bạn
6. **Click "🔧 Cấu Hình Kết Nối"**
7. **Bắt đầu chat!**

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

## 🐛 Troubleshooting

| Lỗi | Giải Pháp |
|-----|----------|
| ModuleNotFoundError | `pip install -r config/requirements.txt` |
| InvalidSignatureException | Kiểm tra API Key trong .env |
| AccessDenied | Thêm Bedrock policy trong IAM |
| ModelNotFound | Thử region khác (us-west-2) |

## 📚 Tài Liệu Tham Khảo

- [AWS Bedrock Docs](https://docs.aws.amazon.com/bedrock/)
- [Boto3 Documentation](https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/bedrock-runtime.html)
- [Streamlit Docs](https://docs.streamlit.io/)
- [Claude API Guide](https://docs.anthropic.com/claude/reference/getting-started-with-the-api)

## 📄 License

MIT License - Tự do sử dụng cho mục đích cá nhân và thương mại.

## 🎉 Chúc Bạn Thành Công!

Nếu có bất kỳ câu hỏi nào, vui lòng tham khảo thư mục `docs/` hoặc liên hệ support.

---

**Phiên bản:** 1.0.0  
**Cập nhật lần cuối:** May 2026  
**Tác giả:** AWS Bedrock Chatbot Team

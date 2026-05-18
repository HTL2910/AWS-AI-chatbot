# 📖 Hướng Dẫn Sử Dụng Ứng Dụng

## 🎯 Mục Đích

Hướng dẫn chi tiết cách sử dụng ứng dụng AWS Bedrock Chatbot.

## 🚀 Bước 1: Chuẩn Bị

### 1.1 Cài Đặt Python
- Tải từ [python.org](https://www.python.org)
- Chọn phiên bản 3.8 trở lên
- Đảm bảo chọn "Add Python to PATH"

### 1.2 Cài Đặt Dependencies
```bash
pip install -r requirements.txt
```

### 1.3 Cấu Hình AWS Credentials
```bash
python setup_credentials.py
```

## 🎮 Bước 2: Chạy Ứng Dụng

### 2.1 Mở Terminal
- **Windows:** PowerShell hoặc Command Prompt
- **Mac:** Terminal
- **Linux:** Terminal

### 2.2 Chạy Ứng Dụng
```bash
streamlit run app.py
```

### 2.3 Trình Duyệt Tự Động Mở
Ứng dụng sẽ tự động mở tại: `http://localhost:8501`

Nếu không mở, hãy truy cập URL trên trong trình duyệt.

## 🎨 Bước 3: Giao Diện Ứng Dụng

### 3.1 Sidebar (Bên Trái)

```
┌─────────────────────────────┐
│  ⚙️ Cấu Hình                │
├─────────────────────────────┤
│ AWS Credentials             │
│ ┌─────────────────────────┐ │
│ │ Nhập AWS Bedrock API Key│ │
│ └─────────────────────────┘ │
│                             │
│ Chọn Model:                 │
│ ┌─────────────────────────┐ │
│ │ Claude 3.5 Sonnet ▼     │ │
│ └─────────────────────────┘ │
│                             │
│ Chọn AWS Region:            │
│ ┌─────────────────────────┐ │
│ │ us-east-1 ▼             │ │
│ └─────────────────────────┘ │
│                             │
│ [🔧 Cấu Hình Kết Nối]       │
│                             │
│ 📝 Lịch Sử Chat             │
│ [🗑️ Xóa Lịch Sử]           │
│ [💾 Lưu Chat]              │
│                             │
│ 🟢 Đã Kết Nối              │
│ Model: Claude 3.5 Sonnet    │
│ Region: us-east-1           │
└─────────────────────────────┘
```

### 3.2 Main Chat Area (Giữa)

```
┌─────────────────────────────────────┐
│  🤖 AWS Bedrock Chatbot             │
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────────────────────┐   │
│  │ 👤 User: Xin chào!          │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ 🤖 Assistant: Xin chào! Tôi │   │
│  │ là Claude...                │   │
│  └─────────────────────────────┘   │
│                                     │
├─────────────────────────────────────┤
│ Nhập tin nhắn:                      │
│ ┌─────────────────────────────────┐ │
│ │ Hỏi tôi bất cứ điều gì...      │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

## 🔧 Bước 4: Cấu Hình Kết Nối

### 4.1 Nhập API Key

1. **Mở Sidebar** (bên trái)
2. **Tìm mục "AWS Credentials"**
3. **Nhập AWS Bedrock API Key**
   - Nếu đã cấu hình .env, có thể để trống
   - Nếu muốn nhập trực tiếp, dán API Key

### 4.2 Chọn Model

Có 3 model khả dụng:

| Model | Tốc Độ | Chất Lượng | Khuyến Nghị |
|-------|--------|-----------|-----------|
| Claude 3.5 Sonnet | ⚡⚡⚡ | ⭐⭐⭐⭐⭐ | ✅ |
| Claude 3 Opus | ⚡⚡ | ⭐⭐⭐⭐⭐ | Cho tasks phức tạp |
| Claude 3 Haiku | ⚡⚡⚡⚡ | ⭐⭐⭐ | Cho tasks đơn giản |

**Khuyến nghị:** Chọn **Claude 3.5 Sonnet** cho hầu hết các trường hợp.

### 4.3 Chọn Region

Chọn region gần nhất với bạn:
- `us-east-1` (N. Virginia) - ✅ Khuyến nghị
- `us-west-2` (Oregon)
- `eu-west-1` (Ireland)
- `ap-southeast-1` (Singapore)

### 4.4 Cấu Hình Kết Nối

1. **Click nút "🔧 Cấu Hình Kết Nối"**
2. **Chờ thông báo "✅ Kết nối thành công!"**
3. **Kiểm tra status ở dưới:** "🟢 Đã kết nối"

## 💬 Bước 5: Bắt Đầu Chat

### 5.1 Nhập Tin Nhắn

1. **Nhấp vào ô "Nhập tin nhắn"** ở dưới cùng
2. **Gõ câu hỏi hoặc yêu cầu**
3. **Nhấn Enter hoặc click nút gửi**

### 5.2 Ví Dụ Câu Hỏi

```
- Xin chào, bạn là ai?
- Giải thích về machine learning
- Viết một bài thơ về mùa xuân
- Làm thế nào để học lập trình Python?
- Tóm tắt lịch sử Việt Nam
```

### 5.3 Xem Response

- **Response từ AI** sẽ hiển thị dưới tin nhắn của bạn
- **Màu xanh** = Tin nhắn của bạn
- **Màu trắng** = Response từ AI

## 📝 Bước 6: Quản Lý Lịch Sử Chat

### 6.1 Xem Lịch Sử

- Tất cả tin nhắn được lưu trong session
- Cuộn lên để xem các tin nhắn cũ
- Lịch sử được giữ lại khi làm mới trang

### 6.2 Xóa Lịch Sử

1. **Mở Sidebar**
2. **Tìm mục "📝 Lịch Sử Chat"**
3. **Click nút "🗑️ Xóa Lịch Sử"**
4. **Xác nhận xóa**

### 6.3 Lưu Chat

1. **Mở Sidebar**
2. **Tìm mục "📝 Lịch Sử Chat"**
3. **Click nút "💾 Lưu Chat"**
4. **File JSON sẽ được tạo:** `chat_history_YYYYMMDD_HHMMSS.json`

### 6.4 Xem File Lưu

File lưu có định dạng JSON:
```json
[
  {
    "role": "user",
    "content": "Xin chào!"
  },
  {
    "role": "assistant",
    "content": "Xin chào! Tôi là Claude..."
  }
]
```

## 🎯 Bước 7: Các Tính Năng Nâng Cao

### 7.1 Cuộc Trò Chuyện Nhiều Lượt

AI sẽ nhớ các tin nhắn trước đó:

```
👤 User: Tôi tên là Hùng
🤖 Assistant: Rất vui được gặp bạn, Hùng!

👤 User: Tôi là ai?
🤖 Assistant: Bạn là Hùng, như bạn vừa nói!
```

### 7.2 Thay Đổi Model Giữa Chat

1. **Mở Sidebar**
2. **Chọn model khác**
3. **Click "🔧 Cấu Hình Kết Nối"**
4. **Lịch sử chat sẽ được giữ lại**

### 7.3 Thay Đổi Region

1. **Mở Sidebar**
2. **Chọn region khác**
3. **Click "🔧 Cấu Hình Kết Nối"**

## ⚠️ Bước 8: Xử Lý Lỗi

### 8.1 Lỗi: "Chưa kết nối"

```
❌ Lỗi: 🔴 Chưa kết nối
✅ Giải pháp:
   1. Kiểm tra API Key
   2. Click "🔧 Cấu Hình Kết Nối"
   3. Chờ thông báo "✅ Kết nối thành công!"
```

### 8.2 Lỗi: "InvalidSignatureException"

```
❌ Lỗi: InvalidSignatureException
✅ Giải pháp:
   1. Kiểm tra lại API Key
   2. Đảm bảo không có khoảng trắng thừa
   3. Tạo API Key mới nếu cần
```

### 8.3 Lỗi: "AccessDenied"

```
❌ Lỗi: AccessDenied
✅ Giải pháp:
   1. Vào AWS IAM Console
   2. Thêm AmazonBedrockFullAccess policy
   3. Chờ 1-2 phút để policy có hiệu lực
   4. Thử lại
```

### 8.4 Lỗi: "ModelNotFound"

```
❌ Lỗi: ModelNotFound
✅ Giải pháp:
   1. Thử region khác (us-west-2 hoặc eu-west-1)
   2. Kiểm tra model có khả dụng ở region đó không
```

## 💡 Bước 9: Tips & Tricks

### 9.1 Tăng Tốc Độ Response

- Chọn model **Claude 3 Haiku** (nhanh nhất)
- Hoặc chỉnh sửa `maxTokens` trong code

### 9.2 Tăng Chất Lượng Response

- Chọn model **Claude 3 Opus** (chất lượng cao nhất)
- Hoặc chỉnh sửa `temperature` trong code

### 9.3 Sử Dụng Prompts Hiệu Quả

**Tốt:**
```
Viết một bài thơ 4 câu về mùa xuân bằng tiếng Việt
```

**Tốt hơn:**
```
Viết một bài thơ 4 câu về mùa xuân bằng tiếng Việt.
Sử dụng các hình ảnh sinh động và cảm xúc tích cực.
```

### 9.4 Lưu Chat Thường Xuyên

- Lưu chat sau mỗi cuộc trò chuyện quan trọng
- Tạo backup của các file JSON

## 🛑 Bước 10: Dừng Ứng Dụng

### 10.1 Dừng Server

Nhấn **Ctrl+C** trong terminal:

```
^C
Keyboard interrupt received; exiting.
```

### 10.2 Đóng Trình Duyệt

Đóng tab hoặc cửa sổ trình duyệt.

## 📚 Tài Liệu Tham Khảo

- **README.md** - Tổng quan dự án
- **HUONG_DAN_AWS.md** - Hướng dẫn AWS chi tiết
- **CREDENTIALS_GUIDE.md** - Hướng dẫn credentials
- **QUICK_START_WINDOWS.md** - Quick start cho Windows

## 🎓 Học Thêm

### Streamlit
- [Streamlit Documentation](https://docs.streamlit.io/)
- [Streamlit Components](https://docs.streamlit.io/library/api-reference)

### AWS Bedrock
- [AWS Bedrock Documentation](https://docs.aws.amazon.com/bedrock/)
- [Claude API Guide](https://docs.anthropic.com/claude/reference/getting-started-with-the-api)

### Python
- [Python Documentation](https://docs.python.org/3/)
- [Boto3 Guide](https://boto3.amazonaws.com/v1/documentation/api/latest/guide/index.html)

## 🤝 Hỗ Trợ

Nếu gặp vấn đề:
1. Kiểm tra các file hướng dẫn
2. Xem phần Troubleshooting
3. Liên hệ support

## 🎉 Chúc Bạn Thành Công!

Bây giờ bạn đã sẵn sàng sử dụng AWS Bedrock Chatbot. Hãy bắt đầu chat ngay!

---

**Phiên bản:** 1.0.0  
**Cập nhật lần cuối:** May 2026

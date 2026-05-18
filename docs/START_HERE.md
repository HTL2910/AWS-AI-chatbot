# 🚀 START HERE - Bắt Đầu Ngay

## ⚡ 5 Phút Để Chạy Ứng Dụng

### Bước 1: Cài Đặt (1 phút)
```bash
pip install -r requirements.txt
```

### Bước 2: Cấu Hình (2 phút)
```bash
python setup_credentials.py
```
Làm theo hướng dẫn trên màn hình.

### Bước 3: Chạy (1 phút)
```bash
streamlit run app.py
```

### Bước 4: Chat (1 phút)
- Mở Sidebar (bên trái)
- Click "🔧 Cấu Hình Kết Nối"
- Bắt đầu chat!

---

## 📚 Các File Hướng Dẫn

| File | Mục Đích |
|------|---------|
| **README.md** | 📖 Tổng quan dự án |
| **HOW_TO_USE.md** | 🎮 Cách sử dụng ứng dụng |
| **QUICK_START_WINDOWS.md** | ⚡ Quick start cho Windows |
| **HUONG_DAN_AWS.md** | 📚 Hướng dẫn AWS chi tiết |
| **CREDENTIALS_GUIDE.md** | 🔐 Hướng dẫn credentials |
| **PROJECT_SUMMARY.md** | 📦 Tóm tắt dự án |
| **example_usage.py** | 📝 Ví dụ sử dụng API |

---

## 🔑 Lấy AWS Credentials

### Nhanh nhất: Sử dụng Setup Script
```bash
python setup_credentials.py
```

### Hoặc: Cấu hình thủ công
1. Vào [AWS Console](https://console.aws.amazon.com)
2. Tìm **IAM** → **Users** → Chọn user
3. Tab **Security credentials** → **Create access key**
4. Copy **Access Key ID** và **Secret Access Key**
5. Tạo file `.env`:
```env
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_DEFAULT_REGION=us-east-1
```

---

## 🎯 Cấu Hình Quyền Bedrock

1. Vào AWS IAM Console
2. Chọn user của bạn
3. **Add permissions** → **Attach policies directly**
4. Tìm **AmazonBedrockFullAccess**
5. Chọn → **Add permissions**

---

## 🎮 Sử Dụng Ứng Dụng

1. **Chạy:** `streamlit run app.py`
2. **Mở Sidebar** (bên trái)
3. **Nhập API Key** (nếu cần)
4. **Chọn Model:** Claude 3.5 Sonnet (khuyến nghị)
5. **Chọn Region:** us-east-1
6. **Click:** "🔧 Cấu Hình Kết Nối"
7. **Chat!**

---

## ⚠️ Lỗi Thường Gặp

| Lỗi | Giải Pháp |
|-----|----------|
| ModuleNotFoundError | `pip install -r requirements.txt` |
| InvalidSignatureException | Kiểm tra API Key trong .env |
| AccessDenied | Thêm Bedrock policy trong IAM |
| ModelNotFound | Thử region khác (us-west-2) |

---

## 📞 Cần Giúp?

1. **Xem README.md** - Tổng quan
2. **Xem HOW_TO_USE.md** - Cách sử dụng
3. **Xem HUONG_DAN_AWS.md** - Hướng dẫn chi tiết
4. **Xem CREDENTIALS_GUIDE.md** - Cấu hình credentials

---

## 🎉 Sẵn Sàng?

```bash
# 1. Cài đặt
pip install -r requirements.txt

# 2. Cấu hình
python setup_credentials.py

# 3. Chạy
streamlit run app.py

# 4. Chat!
```

**Chúc bạn thành công! 🚀**

# ⚡ Quick Start - Windows

## 🚀 Bắt Đầu Nhanh (5 Phút)

### Bước 1: Cài Đặt Dependencies

Mở **PowerShell** hoặc **Command Prompt** trong thư mục project:

```powershell
pip install -r requirements.txt
```

### Bước 2: Cấu Hình AWS Credentials

**Cách A: Sử dụng Setup Script (Dễ nhất)**

```powershell
python setup_credentials.py
```

Làm theo hướng dẫn trên màn hình.

**Cách B: Chỉnh Sửa File .env Thủ Công**

1. Mở file `.env` bằng Notepad
2. Thêm hoặc cập nhật:

```env
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_DEFAULT_REGION=us-east-1
```

3. Lưu file (Ctrl+S)

### Bước 3: Chạy Ứng Dụng

```powershell
streamlit run app.py
```

✅ Ứng dụng sẽ tự động mở tại: `http://localhost:8501`

## 🔑 Lấy AWS Credentials

### Từ AWS Console

1. Đăng nhập: https://console.aws.amazon.com
2. Tìm kiếm **IAM**
3. Chọn **Users** → Chọn user của bạn
4. Tab **Security credentials**
5. **Create access key**
6. Chọn **Application running outside AWS**
7. Copy **Access Key ID** và **Secret Access Key**

### Từ AWS CLI

```powershell
aws iam create-access-key --user-name your-username
```

## 🎯 Sử Dụng Ứng Dụng

1. **Mở Sidebar** (bên trái)
2. **Nhập API Key** (nếu chưa cấu hình .env)
3. **Chọn Model** → Claude 3.5 Sonnet (khuyến nghị)
4. **Chọn Region** → us-east-1
5. **Click "🔧 Cấu Hình Kết Nối"**
6. **Bắt đầu chat!**

## ⚠️ Lỗi Thường Gặp

### "ModuleNotFoundError: No module named 'streamlit'"
```powershell
pip install -r requirements.txt
```

### "InvalidSignatureException"
- Kiểm tra lại Access Key và Secret Key
- Đảm bảo không có khoảng trắng thừa

### "AccessDenied"
- Vào AWS IAM → Thêm **AmazonBedrockFullAccess** policy

### "ModelNotFound"
- Thử region khác: us-west-2 hoặc eu-west-1

## 📝 Cấu Hình AWS Credentials Bằng CLI

```powershell
aws configure
```

Nhập khi được yêu cầu:
- AWS Access Key ID: `AKIAIOSFODNN7EXAMPLE`
- AWS Secret Access Key: `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`
- Default region: `us-east-1`
- Default output format: `json`

Credentials sẽ được lưu tại: `C:\Users\YourUsername\.aws\credentials`

## 🛑 Dừng Ứng Dụng

Nhấn **Ctrl+C** trong PowerShell/Command Prompt

## 📚 Tài Liệu Đầy Đủ

Xem **HUONG_DAN_AWS.md** để có hướng dẫn chi tiết.

---

**Chúc bạn thành công! 🎉**

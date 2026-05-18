# 🚀 Hướng Dẫn Cấu Hình AWS Bedrock Chatbot

## 📋 Yêu Cầu Trước Tiên

1. **Tài khoản AWS** - Đăng ký tại [aws.amazon.com](https://aws.amazon.com)
2. **Python 3.8+** - Cài đặt từ [python.org](https://www.python.org)
3. **pip** - Thường đi kèm với Python

## 🔑 Bước 1: Tạo AWS Access Key

### Cách 1: Sử dụng AWS Console (Khuyến nghị)

1. Đăng nhập vào [AWS Management Console](https://console.aws.amazon.com)
2. Tìm kiếm **IAM** (Identity and Access Management)
3. Chọn **Users** ở menu bên trái
4. Chọn user của bạn (hoặc tạo user mới)
5. Chọn tab **Security credentials**
6. Kéo xuống **Access keys** và click **Create access key**
7. Chọn **Application running outside AWS** → **Next**
8. Đặt tên cho key (ví dụ: "bedrock-chatbot") → **Create access key**
9. **Lưu lại:**
   - Access Key ID
   - Secret Access Key

⚠️ **Quan trọng:** Lưu Secret Access Key ngay lập tức, bạn không thể xem lại sau này!

### Cách 2: Sử dụng AWS CLI

```bash
aws iam create-access-key --user-name your-username
```

## 🔐 Bước 2: Cấu Hình AWS Credentials

### Phương Pháp 1: Sử dụng File .env (Khuyến nghị cho Development)

1. Mở file `.env` trong thư mục dự án
2. Thêm hoặc cập nhật các dòng sau:

```env
AWS_ACCESS_KEY_ID=your_access_key_id_here
AWS_SECRET_ACCESS_KEY=your_secret_access_key_here
AWS_DEFAULT_REGION=us-east-1
```

**Ví dụ:**
```env
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_DEFAULT_REGION=us-east-1
```

### Phương Pháp 2: Sử dụng AWS CLI Configuration

```bash
aws configure
```

Nhập thông tin khi được yêu cầu:
- AWS Access Key ID: `AKIAIOSFODNN7EXAMPLE`
- AWS Secret Access Key: `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`
- Default region: `us-east-1`
- Default output format: `json`

Credentials sẽ được lưu tại:
- **Windows:** `C:\Users\YourUsername\.aws\credentials`
- **Mac/Linux:** `~/.aws/credentials`

### Phương Pháp 3: Sử dụng Environment Variables (Command Line)

**Windows (PowerShell):**
```powershell
$env:AWS_ACCESS_KEY_ID="AKIAIOSFODNN7EXAMPLE"
$env:AWS_SECRET_ACCESS_KEY="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
$env:AWS_DEFAULT_REGION="us-east-1"
```

**Windows (CMD):**
```cmd
set AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
set AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
set AWS_DEFAULT_REGION=us-east-1
```

**Mac/Linux:**
```bash
export AWS_ACCESS_KEY_ID="AKIAIOSFODNN7EXAMPLE"
export AWS_SECRET_ACCESS_KEY="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
export AWS_DEFAULT_REGION="us-east-1"
```

## 🎯 Bước 3: Cấp Quyền Bedrock cho IAM User

1. Đăng nhập AWS Console
2. Vào **IAM** → **Users**
3. Chọn user của bạn
4. Chọn **Add permissions** → **Attach policies directly**
5. Tìm kiếm **AmazonBedrockFullAccess** hoặc **AmazonBedrockReadOnlyAccess**
6. Chọn policy → **Next** → **Add permissions**

**Hoặc tạo Custom Policy:**

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "bedrock:InvokeModel",
                "bedrock:InvokeModelWithResponseStream"
            ],
            "Resource": "arn:aws:bedrock:*::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0"
        }
    ]
}
```

## 📦 Bước 4: Cài Đặt Dependencies

```bash
pip install -r requirements.txt
```

Hoặc cài đặt thủ công:
```bash
pip install streamlit boto3 python-dotenv
```

## 🚀 Bước 5: Chạy Ứng Dụng

```bash
streamlit run app.py
```

Ứng dụng sẽ mở tại: `http://localhost:8501`

## 🔧 Cấu Hình Trong Ứng Dụng

1. **Mở Sidebar** (bên trái)
2. **Nhập AWS Bedrock API Key** hoặc để trống nếu đã cấu hình qua .env
3. **Chọn Model:**
   - `anthropic.claude-3-5-sonnet-20240620-v1:0` (Khuyến nghị - cân bằng tốc độ & chất lượng)
   - `anthropic.claude-3-opus-20240229-v1:0` (Mạnh nhất nhưng chậm hơn)
   - `anthropic.claude-3-haiku-20240307-v1:0` (Nhanh nhất nhưng kém chất lượng)
4. **Chọn AWS Region** (gần nhất với bạn)
5. **Click "🔧 Cấu Hình Kết Nối"**

## 🛡️ Bảo Mật - Các Lưu Ý Quan Trọng

### ✅ Nên Làm:
- ✅ Lưu credentials trong file `.env` (không commit lên Git)
- ✅ Sử dụng IAM User thay vì Root Account
- ✅ Giới hạn quyền (chỉ cấp Bedrock access)
- ✅ Rotate access keys định kỳ (mỗi 90 ngày)
- ✅ Sử dụng MFA (Multi-Factor Authentication)

### ❌ Không Nên Làm:
- ❌ Không commit `.env` lên Git
- ❌ Không chia sẻ Access Key Secret
- ❌ Không sử dụng Root Account credentials
- ❌ Không để credentials trong source code
- ❌ Không sử dụng cùng credentials cho nhiều ứng dụng

## 📝 File .gitignore

Thêm vào `.gitignore` để tránh commit credentials:

```
.env
.env.local
*.json
chat_history_*.json
__pycache__/
*.pyc
.streamlit/
```

## 🐛 Troubleshooting

### Lỗi: "InvalidSignatureException"
- **Nguyên nhân:** Access Key hoặc Secret Key sai
- **Giải pháp:** Kiểm tra lại credentials trong .env

### Lỗi: "AccessDenied"
- **Nguyên nhân:** IAM User không có quyền Bedrock
- **Giải pháp:** Thêm AmazonBedrockFullAccess policy

### Lỗi: "ModelNotFound"
- **Nguyên nhân:** Model không khả dụng ở region đã chọn
- **Giải pháp:** Thử region khác (us-east-1 hoặc us-west-2)

### Lỗi: "ThrottlingException"
- **Nguyên nhân:** Gửi quá nhiều request
- **Giải pháp:** Chờ một lúc rồi thử lại

## 📚 Tài Liệu Tham Khảo

- [AWS Bedrock Documentation](https://docs.aws.amazon.com/bedrock/)
- [Boto3 Bedrock Client](https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/bedrock-runtime.html)
- [Streamlit Documentation](https://docs.streamlit.io/)
- [AWS IAM Best Practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)

## 💡 Tips & Tricks

### Tăng Tốc Độ Response
```python
"maxTokens": 512,  # Giảm từ 1024
"temperature": 0.5,  # Giảm từ 0.7
```

### Tăng Chất Lượng Response
```python
"maxTokens": 2048,  # Tăng từ 1024
"temperature": 0.3,  # Giảm từ 0.7
"topP": 0.7,  # Giảm từ 0.9
```

### Lưu Chat History Tự Động
Thêm vào app.py:
```python
import atexit

def save_chat_on_exit():
    if st.session_state.messages:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        with open(f"chat_history_{timestamp}.json", 'w') as f:
            json.dump(st.session_state.messages, f, indent=2)

atexit.register(save_chat_on_exit)
```

---

**Chúc bạn thành công! 🎉**

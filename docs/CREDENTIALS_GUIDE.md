# 🔐 Hướng Dẫn Chi Tiết: Cấu Hình AWS Credentials

## 📌 Tổng Quan

Có 3 cách để cấu hình AWS credentials cho ứng dụng:

1. **File .env** (Khuyến nghị cho Development)
2. **AWS CLI Configuration**
3. **Environment Variables**

---

## 🔑 Cách 1: Sử Dụng File .env (Khuyến Nghị)

### Bước 1: Tạo Access Key

1. Đăng nhập [AWS Console](https://console.aws.amazon.com)
2. Tìm kiếm **IAM** → **Users**
3. Chọn user của bạn
4. Tab **Security credentials**
5. **Create access key**
6. Chọn **Application running outside AWS**
7. Copy:
   - **Access Key ID**: `AKIAIOSFODNN7EXAMPLE`
   - **Secret Access Key**: `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`

### Bước 2: Tạo File .env

Tạo file `.env` trong thư mục project:

```env
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_DEFAULT_REGION=us-east-1
```

### Bước 3: Sử Dụng Trong Code

```python
from dotenv import load_dotenv
import os

load_dotenv()

access_key = os.getenv("AWS_ACCESS_KEY_ID")
secret_key = os.getenv("AWS_SECRET_ACCESS_KEY")
region = os.getenv("AWS_DEFAULT_REGION")
```

### ✅ Ưu Điểm
- Dễ sử dụng
- Phù hợp cho development
- Có thể thay đổi nhanh

### ❌ Nhược Điểm
- Phải cẩn thận không commit lên Git
- Không an toàn cho production

---

## 🔑 Cách 2: Sử Dụng AWS CLI Configuration

### Bước 1: Cài Đặt AWS CLI

**Windows (PowerShell):**
```powershell
# Sử dụng Chocolatey
choco install awscli

# Hoặc download từ: https://aws.amazon.com/cli/
```

**Mac:**
```bash
brew install awscli
```

**Linux:**
```bash
sudo apt-get install awscli
```

### Bước 2: Cấu Hình Credentials

```bash
aws configure
```

Nhập thông tin:
```
AWS Access Key ID [None]: AKIAIOSFODNN7EXAMPLE
AWS Secret Access Key [None]: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
Default region name [None]: us-east-1
Default output format [None]: json
```

### Bước 3: Kiểm Tra

```bash
aws sts get-caller-identity
```

Output:
```json
{
    "UserId": "AIDACKCEVSQ6C2EXAMPLE",
    "Account": "123456789012",
    "Arn": "arn:aws:iam::123456789012:user/your-username"
}
```

### Vị Trí Lưu Trữ

- **Windows**: `C:\Users\YourUsername\.aws\credentials`
- **Mac/Linux**: `~/.aws/credentials`

### File Credentials

```
[default]
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
region = us-east-1
```

### ✅ Ưu Điểm
- Tiêu chuẩn AWS
- Hỗ trợ multiple profiles
- Tự động được boto3 nhận diện

### ❌ Nhược Điểm
- Phức tạp hơn
- Credentials lưu trên disk

---

## 🔑 Cách 3: Sử Dụng Environment Variables

### Windows (PowerShell)

```powershell
$env:AWS_ACCESS_KEY_ID="AKIAIOSFODNN7EXAMPLE"
$env:AWS_SECRET_ACCESS_KEY="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
$env:AWS_DEFAULT_REGION="us-east-1"

# Kiểm tra
echo $env:AWS_ACCESS_KEY_ID
```

### Windows (Command Prompt)

```cmd
set AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
set AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
set AWS_DEFAULT_REGION=us-east-1

# Kiểm tra
echo %AWS_ACCESS_KEY_ID%
```

### Mac/Linux (Bash)

```bash
export AWS_ACCESS_KEY_ID="AKIAIOSFODNN7EXAMPLE"
export AWS_SECRET_ACCESS_KEY="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
export AWS_DEFAULT_REGION="us-east-1"

# Kiểm tra
echo $AWS_ACCESS_KEY_ID
```

### ✅ Ưu Điểm
- Không lưu trên disk
- Phù hợp cho CI/CD
- Tạm thời (chỉ trong session hiện tại)

### ❌ Nhược Điểm
- Phải set lại mỗi lần mở terminal
- Không an toàn nếu terminal bị lộ

---

## 🔑 Cách 4: Sử Dụng Presigned URL

Nếu bạn có presigned URL từ AWS Console:

### Bước 1: Lấy Presigned URL

1. Vào AWS Console
2. Tìm kiếm **STS** (Security Token Service)
3. Hoặc sử dụng AWS CLI:

```bash
aws sts get-session-token --duration-seconds 3600
```

### Bước 2: Trích Xuất Credentials

Sử dụng script `setup_credentials.py`:

```bash
python setup_credentials.py
# Chọn option 2 (Presigned URL)
# Dán presigned URL
```

Script sẽ tự động trích xuất:
- Access Key ID
- Secret Access Key
- Session Token
- Region

### Bước 3: Lưu Vào .env

```env
AWS_ACCESS_KEY_ID=ASIACKCEVSQ6C2EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_SESSION_TOKEN=IQoDYXdzEJr...
AWS_DEFAULT_REGION=us-east-1
```

---

## 🔐 Cấp Quyền Bedrock cho IAM User

### Bước 1: Vào IAM Console

1. Đăng nhập AWS Console
2. Tìm kiếm **IAM**
3. Chọn **Users**
4. Chọn user của bạn

### Bước 2: Thêm Policy

1. Chọn **Add permissions** → **Attach policies directly**
2. Tìm kiếm **AmazonBedrockFullAccess**
3. Chọn policy
4. **Next** → **Add permissions**

### Hoặc Tạo Custom Policy

1. Chọn **Add permissions** → **Create inline policy**
2. Chọn **JSON**
3. Dán policy:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "bedrock:InvokeModel",
                "bedrock:InvokeModelWithResponseStream",
                "bedrock:ListFoundationModels"
            ],
            "Resource": "*"
        }
    ]
}
```

4. **Next** → **Create policy**

---

## 🧪 Kiểm Tra Credentials

### Sử dụng Python

```python
import boto3

try:
    client = boto3.client('bedrock-runtime', region_name='us-east-1')
    response = client.list_foundation_models()
    print("✅ Credentials hợp lệ!")
    print(f"Tìm thấy {len(response['modelSummaries'])} models")
except Exception as e:
    print(f"❌ Lỗi: {e}")
```

### Sử dụng AWS CLI

```bash
aws sts get-caller-identity
```

Output:
```json
{
    "UserId": "AIDACKCEVSQ6C2EXAMPLE",
    "Account": "123456789012",
    "Arn": "arn:aws:iam::123456789012:user/your-username"
}
```

---

## 🛡️ Bảo Mật Best Practices

### ✅ Nên Làm

1. **Sử dụng IAM User** (không phải Root Account)
   ```
   Root Account: Tài khoản chính, có quyền tối đa
   IAM User: Tài khoản phụ, có quyền giới hạn
   ```

2. **Giới Hạn Quyền** (Principle of Least Privilege)
   ```json
   {
       "Effect": "Allow",
       "Action": [
           "bedrock:InvokeModel"  // Chỉ cấp quyền cần thiết
       ],
       "Resource": "arn:aws:bedrock:*::foundation-model/anthropic.claude-3-5-sonnet-*"
   }
   ```

3. **Rotate Keys Định Kỳ**
   - Mỗi 90 ngày tạo key mới
   - Xóa key cũ

4. **Sử dụng MFA** (Multi-Factor Authentication)
   - Thêm lớp bảo mật thứ 2

5. **Giám Sát Hoạt Động**
   - Sử dụng CloudTrail để theo dõi API calls

### ❌ Không Nên Làm

1. **Không Commit .env Lên Git**
   ```bash
   # Thêm vào .gitignore
   .env
   .env.local
   ```

2. **Không Chia Sẻ Secret Key**
   - Chỉ chia sẻ Access Key ID nếu cần

3. **Không Hardcode Credentials**
   ```python
   # ❌ Sai
   client = boto3.client('bedrock-runtime',
       aws_access_key_id='AKIAIOSFODNN7EXAMPLE',
       aws_secret_access_key='wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
   )
   
   # ✅ Đúng
   client = boto3.client('bedrock-runtime')  # Tự động từ .env hoặc CLI config
   ```

4. **Không Sử Dụng Root Account**
   - Luôn sử dụng IAM User

5. **Không Để Credentials Trong Logs**
   ```python
   # ❌ Sai
   print(f"Key: {secret_key}")
   
   # ✅ Đúng
   print("Key: ****")
   ```

---

## 🔄 Thay Đổi Credentials

### Nếu Credentials Bị Lộ

1. **Vào AWS IAM Console**
2. **Deactivate** access key cũ
3. **Tạo access key mới**
4. **Cập nhật** .env hoặc config
5. **Xóa** access key cũ sau 24 giờ

### Rotate Keys Định Kỳ

```bash
# 1. Tạo key mới
aws iam create-access-key --user-name your-username

# 2. Cập nhật .env
# AWS_ACCESS_KEY_ID=new_key
# AWS_SECRET_ACCESS_KEY=new_secret

# 3. Kiểm tra hoạt động
python setup_credentials.py

# 4. Xóa key cũ
aws iam delete-access-key --user-name your-username --access-key-id old_key_id
```

---

## 📊 So Sánh Các Phương Pháp

| Phương Pháp | Dễ Sử Dụng | Bảo Mật | Phù Hợp Cho |
|------------|-----------|--------|-----------|
| .env | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | Development |
| AWS CLI | ⭐⭐⭐ | ⭐⭐⭐⭐ | Development |
| Environment Variables | ⭐⭐⭐ | ⭐⭐⭐⭐ | CI/CD |
| Presigned URL | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Temporary Access |
| IAM Role (EC2) | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Production |

---

## 🆘 Troubleshooting

### Lỗi: "InvalidSignatureException"
```
❌ Nguyên nhân: Access Key hoặc Secret Key sai
✅ Giải pháp:
   1. Kiểm tra lại credentials
   2. Đảm bảo không có khoảng trắng thừa
   3. Tạo key mới nếu cần
```

### Lỗi: "AccessDenied"
```
❌ Nguyên nhân: IAM User không có quyền Bedrock
✅ Giải pháp:
   1. Vào AWS IAM Console
   2. Thêm AmazonBedrockFullAccess policy
   3. Chờ 1-2 phút để policy có hiệu lực
```

### Lỗi: "NoCredentialsError"
```
❌ Nguyên nhân: Credentials không được tìm thấy
✅ Giải pháp:
   1. Kiểm tra .env tồn tại
   2. Kiểm tra AWS CLI config
   3. Kiểm tra environment variables
```

### Lỗi: "ExpiredToken"
```
❌ Nguyên nhân: Session token hết hạn
✅ Giải pháp:
   1. Tạo session token mới
   2. Cập nhật .env
   3. Khởi động lại ứng dụng
```

---

## 📚 Tài Liệu Tham Khảo

- [AWS IAM Documentation](https://docs.aws.amazon.com/iam/)
- [AWS Bedrock Documentation](https://docs.aws.amazon.com/bedrock/)
- [Boto3 Credentials](https://boto3.amazonaws.com/v1/documentation/api/latest/guide/credentials.html)
- [AWS CLI Configuration](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html)

---

**Chúc bạn thành công! 🎉**

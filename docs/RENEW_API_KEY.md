# 🔄 Cách Cập Nhật API Key Mới (Bearer Token Expired)

## 🚨 Vấn Đề

Bạn nhận được lỗi:
```
❌ ERROR 403: {"Message":"Bearer Token has expired"}
```

**Nguyên nhân**: API Key trong `.env` đã hết hạn (thường hết sau 1 tuần)

---

## ✅ Giải Pháp: Lấy API Key Mới

### Cách 1: Sử Dụng Script Tự Động (Khuyến Nghị)

#### Bước 1: Chạy Script

```bash
python get_new_api_key.py
```

#### Bước 2: Làm Theo Hướng Dẫn

Script sẽ hướng dẫn bạn:
1. Mở AWS Console
2. Tìm Bedrock API Keys
3. Tạo API Key mới
4. Copy và dán vào script

#### Bước 3: Kiểm Tra

Script sẽ tự động:
- Cập nhật file `.env`
- Kiểm tra API Key có hợp lệ không
- Báo kết quả

---

### Cách 2: Cập Nhật Thủ Công

#### Bước 1: Mở AWS Console

1. Truy cập: https://console.aws.amazon.com
2. Đăng nhập với tài khoản AWS

#### Bước 2: Tìm Bedrock API Keys

1. Tìm kiếm **"Bedrock"** trong search bar
2. Chọn **"Amazon Bedrock"**
3. Ở sidebar trái, chọn **"API Keys"**

#### Bước 3: Tạo API Key Mới

1. Chọn **"Create API Key"**
2. Chọn **"Create"**
3. Sẽ thấy một chuỗi bắt đầu bằng `bedrock-api-key-`

#### Bước 4: Copy API Key

1. Click **"Copy"** hoặc select all + Ctrl+C
2. Chuỗi sẽ giống như:
   ```
   bedrock-api-key-...
   ```

#### Bước 5: Cập Nhật File .env

1. Mở file `.env` trong project
2. Thay thế giá trị cũ:
   ```env
   API_KEY='bedrock-api-key-...'  # Dán API Key mới ở đây
   ```
3. Lưu file (Ctrl+S)

#### Bước 6: Kiểm Tra

Chạy test script:
```bash
python test_bedrock.py
```

Nếu thấy `✅ SUCCESS!` thì API Key đã hợp lệ.

---

## 🧪 Kiểm Tra API Key

### Cách 1: Chạy Test Script

```bash
python test_bedrock.py
```

**Kết quả thành công:**
```
✅ SUCCESS!
📝 Response: {...}
💬 Claude: Xin chào! Tôi là một trí tuệ nhân tạo...
```

**Kết quả thất bại:**
```
❌ ERROR 403: {"Message":"Bearer Token has expired"}
```

### Cách 2: Chạy Ứng Dụng

```bash
streamlit run src/app.py
```

1. Mở http://localhost:8501
2. Ở sidebar, chọn **"Cấu hình Kết nối"**
3. Nếu thấy `✅ Kết nối thành công!` thì API Key hợp lệ

---

## ⏰ Thời Hạn API Key

- **Thời hạn**: Thường 7 ngày (có thể khác tùy cấu hình AWS)
- **Cách kiểm tra**: Xem trong AWS Console → Bedrock → API Keys
- **Khi hết hạn**: Phải tạo key mới

---

## 🔄 Tự Động Cập Nhật (Nâng Cao)

Nếu muốn tự động cập nhật API Key, bạn có thể:

1. **Sử dụng AWS Lambda** để tạo key mới định kỳ
2. **Sử dụng AWS Secrets Manager** để lưu trữ key an toàn
3. **Sử dụng IAM Roles** thay vì API Keys (khuyến nghị cho production)

---

## 🆘 Troubleshooting

### Lỗi: "Bearer Token has expired"
```
❌ Nguyên nhân: API Key đã hết hạn
✅ Giải pháp: Tạo API Key mới theo hướng dẫn trên
```

### Lỗi: "Authentication failed"
```
❌ Nguyên nhân: API Key không hợp lệ
✅ Giải pháp:
   1. Kiểm tra API Key có bắt đầu bằng "bedrock-api-key-" không
   2. Kiểm tra không có khoảng trắng thừa
   3. Tạo API Key mới
```

### Lỗi: "AccessDenied"
```
❌ Nguyên nhân: Tài khoản AWS không có quyền Bedrock
✅ Giải pháp:
   1. Vào AWS IAM Console
   2. Thêm policy "AmazonBedrockFullAccess"
   3. Chờ 1-2 phút để policy có hiệu lực
```

---

## 📚 Tài Liệu Tham Khảo

- [AWS Bedrock Documentation](https://docs.aws.amazon.com/bedrock/)
- [AWS API Keys](https://docs.aws.amazon.com/general/latest/gr/aws-sec-cred-types.html)
- [Bedrock API Reference](https://docs.aws.amazon.com/bedrock/latest/APIReference/)

---

**Chúc bạn thành công! 🎉**

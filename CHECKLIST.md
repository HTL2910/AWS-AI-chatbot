# ✅ CHECKLIST - Cập Nhật API Key & Chạy Ứng Dụng

## 🔑 Bước 1: Cập Nhật API Key

- [ ] Chạy script: `python get_new_api_key.py`
- [ ] Mở AWS Console (https://console.aws.amazon.com)
- [ ] Tìm Bedrock → API Keys
- [ ] Tạo API Key mới
- [ ] Copy API Key (bắt đầu bằng `bedrock-api-key-`)
- [ ] Dán vào script
- [ ] Script cập nhật `.env` file
- [ ] Script kiểm tra API Key hợp lệ

## 🧪 Bước 2: Kiểm Tra Kết Nối

- [ ] Chạy: `python test_bedrock.py`
- [ ] Kiểm tra kết quả:
  - [ ] Status Code: 200
  - [ ] Response: Có tin nhắn từ Claude
  - [ ] Không có lỗi 403

## 🚀 Bước 3: Chạy Ứng Dụng

- [ ] Chạy: `streamlit run src/app.py`
- [ ] Mở browser: http://localhost:8501
- [ ] Ở sidebar:
  - [ ] Chọn "Cấu hình Kết nối"
  - [ ] Kiểm tra: `✅ Kết nối thành công!`
- [ ] Chat test:
  - [ ] Nhập tin nhắn
  - [ ] Nhận được phản hồi từ Claude
  - [ ] Không có lỗi 403

## 📝 Bước 4: Lưu Lịch Sử (Tùy Chọn)

- [ ] Chat một vài tin nhắn
- [ ] Chọn "💾 Lưu Chat" ở sidebar
- [ ] Kiểm tra file `chat_history_*.json` được tạo

## 🔄 Bước 5: Git Push (Sau Khi Xác Nhận Hoạt Động)

- [ ] Xác nhận ứng dụng hoạt động tốt
- [ ] Chạy: `git push -u origin main --force`
- [ ] Kiểm tra GitHub: https://github.com/HTL2910/AWS-AI-chatbot

## 📚 Bước 6: Tiếp Theo (Tùy Chọn)

- [ ] Đọc docs/RENEW_API_KEY.md (hướng dẫn chi tiết)
- [ ] Đọc docs/CREDENTIALS_GUIDE.md (AWS credentials)
- [ ] Bắt đầu SafeGraph AI project (VS Code Extension)

---

## 🆘 Troubleshooting

### Nếu gặp lỗi "Bearer Token has expired"
- [ ] Kiểm tra API Key trong `.env`
- [ ] Tạo API Key mới
- [ ] Chạy `python get_new_api_key.py` lại

### Nếu gặp lỗi "Authentication failed"
- [ ] Kiểm tra API Key có bắt đầu bằng `bedrock-api-key-` không
- [ ] Kiểm tra không có khoảng trắng thừa
- [ ] Tạo API Key mới

### Nếu gặp lỗi "AccessDenied"
- [ ] Vào AWS IAM Console
- [ ] Thêm policy "AmazonBedrockFullAccess"
- [ ] Chờ 1-2 phút

### Nếu Streamlit không mở
- [ ] Kiểm tra port 8501 không bị chiếm
- [ ] Chạy: `streamlit run src/app.py --logger.level=debug`
- [ ] Xem logs để tìm lỗi

---

## 📊 Trạng Thái Dự Án

| Tính Năng | Trạng Thái | Ghi Chú |
|----------|-----------|--------|
| Streamlit UI | ✅ Hoàn thành | ChatGPT-like interface |
| Bedrock API | ✅ Hoàn thành | Headers + payload format |
| Chat History | ✅ Hoàn thành | Lưu trong session |
| Export Chat | ✅ Hoàn thành | JSON format |
| Multi-Model | ✅ Hoàn thành | Claude 3.5, 3, Haiku |
| Multi-Region | ✅ Hoàn thành | US, EU, AP regions |
| Documentation | ✅ Hoàn thành | 11 files in Vietnamese |
| API Key | 🔄 Cần cập nhật | Bearer token expired |
| Git Push | ⏳ Chờ API Key | Sẽ push sau |
| SafeGraph AI | ⏳ Tiếp theo | VS Code Extension |

---

**Chúc bạn thành công! 🎉**

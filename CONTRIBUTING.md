# 🤝 Contributing Guide

Cảm ơn bạn đã quan tâm đến dự án này! Hướng dẫn này sẽ giúp bạn đóng góp hiệu quả.

## 🎯 Cách Đóng Góp

### 1. Báo Cáo Bug

Nếu bạn tìm thấy bug:

1. Kiểm tra xem bug đã được báo cáo chưa
2. Tạo issue mới với:
   - Tiêu đề rõ ràng
   - Mô tả chi tiết
   - Các bước tái hiện
   - Kết quả mong đợi vs thực tế
   - Thông tin hệ thống (OS, Python version, etc.)

### 2. Đề Xuất Tính Năng

Nếu bạn có ý tưởng tính năng mới:

1. Tạo issue với label `enhancement`
2. Mô tả tính năng chi tiết
3. Giải thích lợi ích
4. Cung cấp ví dụ sử dụng

### 3. Pull Request

#### Chuẩn Bị

```bash
# 1. Fork repository
# 2. Clone fork của bạn
git clone https://github.com/your-username/aws-bedrock-chatbot.git

# 3. Tạo branch mới
git checkout -b feature/your-feature-name

# 4. Cài đặt dependencies
pip install -r config/requirements.txt
```

#### Phát Triển

```bash
# 1. Thực hiện thay đổi
# 2. Test thay đổi
python src/app.py

# 3. Commit với message rõ ràng
git commit -m "feat: add new feature"

# 4. Push lên fork
git push origin feature/your-feature-name

# 5. Tạo Pull Request
```

#### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat`: Tính năng mới
- `fix`: Sửa bug
- `docs`: Thay đổi tài liệu
- `style`: Định dạng code
- `refactor`: Tái cấu trúc code
- `test`: Thêm test
- `chore`: Thay đổi build, dependencies

**Ví dụ:**
```
feat(chat): add message export functionality

- Add JSON export for chat history
- Add CSV export option
- Add timestamp to exported messages

Closes #123
```

## 📋 Code Style

### Python

```python
# Sử dụng PEP 8
# - 4 spaces indentation
# - Max line length: 100 characters
# - Use type hints

def chat_with_bedrock(
    message: str,
    model_id: str,
    region: str
) -> str:
    """
    Chat with Bedrock API.
    
    Args:
        message: User message
        model_id: Model ID
        region: AWS region
        
    Returns:
        Assistant response
    """
    pass
```

### Docstrings

```python
def function_name(param1: str, param2: int) -> bool:
    """
    Brief description.
    
    Longer description if needed.
    
    Args:
        param1: Description of param1
        param2: Description of param2
        
    Returns:
        Description of return value
        
    Raises:
        ValueError: When something is wrong
    """
    pass
```

## 🧪 Testing

```bash
# Chạy ứng dụng
streamlit run src/app.py

# Chạy ví dụ
python src/example_usage.py

# Kiểm tra credentials
python src/setup_credentials.py
```

## 📝 Tài Liệu

Nếu bạn thêm tính năng mới, vui lòng:

1. Cập nhật `docs/HOW_TO_USE.md`
2. Thêm ví dụ vào `examples/example_usage.py`
3. Cập nhật `README.md` nếu cần

## 🔍 Review Process

1. Tạo Pull Request
2. Chờ review từ maintainers
3. Thực hiện các thay đổi được yêu cầu
4. Merge khi được phê duyệt

## 📚 Tài Liệu Tham Khảo

- [AWS Bedrock Docs](https://docs.aws.amazon.com/bedrock/)
- [Streamlit Docs](https://docs.streamlit.io/)
- [Boto3 Guide](https://boto3.amazonaws.com/v1/documentation/api/latest/guide/index.html)

## 🎉 Cảm Ơn!

Cảm ơn bạn đã đóng góp cho dự án này!

---

**Happy Contributing! 🚀**

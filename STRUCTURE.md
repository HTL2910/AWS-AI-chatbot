# 📁 Cấu Trúc Project

## Tổng Quan

```
aws-bedrock-chatbot/
├── src/                          # Source code
│   ├── app.py                   # Ứng dụng Streamlit chính
│   └── setup_credentials.py     # Cấu hình AWS credentials
│
├── docs/                         # Tài liệu
│   ├── START_HERE.md            # Bắt đầu nhanh
│   ├── HOW_TO_USE.md            # Cách sử dụng
│   ├── HUONG_DAN_AWS.md         # Hướng dẫn AWS
│   ├── CREDENTIALS_GUIDE.md     # Hướng dẫn credentials
│   ├── PROJECT_SUMMARY.md       # Tóm tắt dự án
│   └── ...
│
├── examples/                     # Ví dụ
│   └── example_usage.py         # 7 ví dụ sử dụng API
│
├── config/                       # Cấu hình
│   ├── requirements.txt         # Dependencies
│   └── .env.example             # Ví dụ .env
│
├── .github/                      # GitHub configuration
│   ├── workflows/               # CI/CD workflows
│   │   └── lint.yml            # Linting workflow
│   └── ISSUE_TEMPLATE/          # Issue templates
│       ├── bug_report.md
│       └── feature_request.md
│
├── .gitignore                    # Git ignore
├── .editorconfig                 # Editor configuration
├── README.md                     # Tài liệu chính
├── QUICKSTART.md                 # Quick start guide
├── CONTRIBUTING.md               # Hướng dẫn đóng góp
├── CHANGELOG.md                  # Lịch sử thay đổi
├── LICENSE                       # MIT License
├── MANIFEST.in                   # Package manifest
├── pyproject.toml                # Project configuration
└── STRUCTURE.md                  # File này
```

## Chi Tiết Các Thư Mục

### 📂 src/

**Mục đích:** Chứa source code chính của ứng dụng

**Files:**
- `app.py` - Ứng dụng Streamlit chính
  - Giao diện chat
  - Quản lý lịch sử
  - Cấu hình credentials
  - Gọi Bedrock API

- `setup_credentials.py` - Script cấu hình credentials
  - Cấu hình tương tác
  - Nhập Access Key + Secret Key
  - Trích xuất từ Presigned URL
  - Lưu vào .env
  - Kiểm tra credentials

### 📂 docs/

**Mục đích:** Chứa tất cả tài liệu

**Files:**
- `START_HERE.md` - Bắt đầu nhanh (5 phút)
- `HOW_TO_USE.md` - Hướng dẫn sử dụng chi tiết
- `HUONG_DAN_AWS.md` - Hướng dẫn AWS chi tiết
- `CREDENTIALS_GUIDE.md` - Hướng dẫn credentials
- `PROJECT_SUMMARY.md` - Tóm tắt dự án
- Và các file hướng dẫn khác

### 📂 examples/

**Mục đích:** Chứa ví dụ sử dụng API

**Files:**
- `example_usage.py` - 7 ví dụ sử dụng Bedrock API
  1. Chat cơ bản
  2. Cuộc trò chuyện nhiều lượt
  3. Sử dụng system prompt
  4. So sánh các model
  5. Ảnh hưởng của temperature
  6. Xử lý lỗi
  7. Liệt kê models

### 📂 config/

**Mục đích:** Chứa cấu hình

**Files:**
- `requirements.txt` - Python dependencies
  - streamlit==1.35.0
  - boto3==1.34.0
  - python-dotenv==1.0.0

- `.env.example` - Ví dụ file .env
  - AWS_ACCESS_KEY_ID
  - AWS_SECRET_ACCESS_KEY
  - AWS_DEFAULT_REGION

### 📂 .github/

**Mục đích:** GitHub configuration

**Subdirectories:**
- `workflows/` - CI/CD workflows
  - `lint.yml` - Linting workflow
- `ISSUE_TEMPLATE/` - Issue templates
  - `bug_report.md` - Template báo cáo bug
  - `feature_request.md` - Template đề xuất tính năng

## File Cấu Hình Root

### `.gitignore`
Danh sách files không commit lên Git:
- .env
- chat_history_*.json
- __pycache__/
- .streamlit/
- Và nhiều file khác

### `.editorconfig`
Cấu hình editor:
- Indentation: 4 spaces (Python)
- Line length: 100 characters
- Charset: UTF-8
- End of line: LF

### `pyproject.toml`
Cấu hình project:
- Metadata (name, version, description)
- Dependencies
- Optional dependencies (dev)
- Tool configurations (black, isort, flake8)

### `MANIFEST.in`
Danh sách files để include trong package:
- README.md
- LICENSE
- CHANGELOG.md
- docs/
- examples/
- config/

## File Tài Liệu Root

### `README.md`
Tài liệu chính:
- Tính năng
- Yêu cầu
- Cài đặt nhanh
- Cấu hình
- Sử dụng
- Troubleshooting

### `QUICKSTART.md`
Quick start guide:
- 4 bước cài đặt
- Link tới tài liệu

### `CONTRIBUTING.md`
Hướng dẫn đóng góp:
- Cách báo cáo bug
- Cách đề xuất tính năng
- Cách tạo Pull Request
- Code style
- Testing

### `CHANGELOG.md`
Lịch sử thay đổi:
- Version history
- Added features
- Bug fixes
- Breaking changes

### `LICENSE`
MIT License

### `STRUCTURE.md`
File này - Giải thích cấu trúc project

## Quy Tắc Tổ Chức

### Naming Convention

**Python Files:**
- Sử dụng snake_case
- Ví dụ: `setup_credentials.py`, `example_usage.py`

**Directories:**
- Sử dụng lowercase
- Ví dụ: `src/`, `docs/`, `examples/`

**Documentation:**
- Sử dụng UPPERCASE hoặc CamelCase
- Ví dụ: `README.md`, `CONTRIBUTING.md`

### File Organization

**Source Code (src/):**
- Chỉ chứa Python files
- Không chứa tài liệu
- Không chứa config

**Documentation (docs/):**
- Chỉ chứa Markdown files
- Không chứa code
- Không chứa config

**Configuration (config/):**
- Chỉ chứa config files
- Không chứa code
- Không chứa tài liệu

**Examples (examples/):**
- Chỉ chứa ví dụ code
- Không chứa tài liệu
- Không chứa config

## Best Practices

### Khi Thêm File Mới

1. **Xác định loại file:**
   - Code → `src/`
   - Tài liệu → `docs/`
   - Ví dụ → `examples/`
   - Config → `config/`

2. **Đặt tên file:**
   - Sử dụng naming convention
   - Tên phải mô tả nội dung

3. **Cập nhật tài liệu:**
   - Cập nhật README.md nếu cần
   - Cập nhật CHANGELOG.md
   - Cập nhật STRUCTURE.md nếu cần

### Khi Sửa File

1. **Giữ cấu trúc:**
   - Không di chuyển file không cần thiết
   - Giữ naming convention

2. **Cập nhật tài liệu:**
   - Cập nhật docstrings
   - Cập nhật CHANGELOG.md

3. **Test thay đổi:**
   - Chạy linting
   - Chạy ứng dụng
   - Chạy ví dụ

## Tóm Tắt

| Thư Mục | Mục Đích | Nội Dung |
|---------|---------|---------|
| `src/` | Source code | Python files |
| `docs/` | Tài liệu | Markdown files |
| `examples/` | Ví dụ | Python examples |
| `config/` | Cấu hình | Config files |
| `.github/` | GitHub config | Workflows, templates |

---

**Last Updated:** May 14, 2026

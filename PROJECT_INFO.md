# 📋 Project Information

## 🎯 Tổng Quan

**AWS Bedrock Chatbot** là một ứng dụng Chatbot hiện đại xây dựng bằng Streamlit và Amazon Bedrock, có giao diện giống ChatGPT.

## 📊 Thống Kê Project

### Files
- **Total Files:** 30+
- **Source Code:** 2 files (Python)
- **Documentation:** 11 files (Markdown)
- **Configuration:** 8 files
- **Examples:** 1 file

### Size
- **Total Size:** ~150 KB
- **Source Code:** ~20 KB
- **Documentation:** ~80 KB
- **Configuration:** ~5 KB

### Languages
- **Python:** 3.8+
- **Markdown:** Documentation
- **YAML:** CI/CD workflows

## 🏗️ Cấu Trúc

```
aws-bedrock-chatbot/
├── src/                    # Source code (2 files)
├── docs/                   # Documentation (11 files)
├── examples/               # Examples (1 file)
├── config/                 # Configuration (2 files)
├── .github/                # GitHub config (3 files)
└── Root files              # Project files (11 files)
```

## 📦 Dependencies

### Core
- streamlit==1.35.0
- boto3==1.34.0
- python-dotenv==1.0.0

### Development (Optional)
- black>=23.0.0
- flake8>=6.0.0
- isort>=5.12.0
- pytest>=7.0.0

## 🚀 Quick Start

```bash
# 1. Install
pip install -r config/requirements.txt

# 2. Configure
python src/setup_credentials.py

# 3. Run
streamlit run src/app.py

# 4. Chat!
```

## 📖 Documentation

### Getting Started
- **QUICKSTART.md** - 5 phút để bắt đầu
- **docs/START_HERE.md** - Hướng dẫn chi tiết

### Usage
- **docs/HOW_TO_USE.md** - Cách sử dụng ứng dụng
- **docs/HUONG_DAN_AWS.md** - Hướng dẫn AWS
- **docs/CREDENTIALS_GUIDE.md** - Hướng dẫn credentials

### Development
- **CONTRIBUTING.md** - Hướng dẫn đóng góp
- **STRUCTURE.md** - Cấu trúc project
- **CHANGELOG.md** - Lịch sử thay đổi

## 🔑 Key Features

✅ **Chat Interface** - Giống ChatGPT  
✅ **Multiple Models** - Sonnet, Opus, Haiku  
✅ **Chat History** - Lưu trong session  
✅ **Export Chat** - JSON format  
✅ **Secure Credentials** - .env configuration  
✅ **Multi-Region** - 4 AWS regions  
✅ **Professional Structure** - Production-ready  

## 🛠️ Technologies

- **Frontend:** Streamlit
- **Backend:** Python
- **AI:** Amazon Bedrock (Claude)
- **AWS:** IAM, Bedrock Runtime
- **CI/CD:** GitHub Actions
- **Package:** setuptools, pyproject.toml

## 📋 File Organization

### Source Code (src/)
- `app.py` - Main Streamlit application
- `setup_credentials.py` - AWS credentials setup

### Documentation (docs/)
- 11 Markdown files with comprehensive guides
- All in Vietnamese
- Step-by-step instructions
- Troubleshooting guides

### Examples (examples/)
- `example_usage.py` - 7 API usage examples

### Configuration (config/)
- `requirements.txt` - Python dependencies
- `.env.example` - Environment variables template

### GitHub (.github/)
- `workflows/lint.yml` - Linting CI/CD
- `ISSUE_TEMPLATE/` - Issue templates

### Root Files
- `README.md` - Main documentation
- `QUICKSTART.md` - Quick start guide
- `CONTRIBUTING.md` - Contribution guide
- `CHANGELOG.md` - Version history
- `LICENSE` - MIT License
- `STRUCTURE.md` - Project structure
- `pyproject.toml` - Project configuration
- `.gitignore` - Git ignore rules
- `.editorconfig` - Editor configuration
- `MANIFEST.in` - Package manifest

## 🎯 Use Cases

1. **Personal Chatbot** - Chat with Claude AI
2. **Learning Tool** - Learn about AWS Bedrock
3. **Development Template** - Base for larger projects
4. **API Examples** - Learn Bedrock API usage
5. **Production Ready** - Professional structure

## 🔐 Security

✅ Credentials in .env (not committed)  
✅ IAM User support (not Root)  
✅ Limited permissions (Bedrock only)  
✅ Session tokens support  
✅ Error handling  

## 📈 Scalability

- **Single User:** ✅ Supported
- **Multiple Users:** ⚠️ Requires database
- **Production:** ⚠️ Requires authentication
- **High Traffic:** ⚠️ Requires load balancing

## 🔄 CI/CD

- **Linting:** GitHub Actions
- **Testing:** Manual (pytest ready)
- **Deployment:** Manual (ready for automation)

## 📚 Learning Resources

- AWS Bedrock Documentation
- Streamlit Documentation
- Boto3 Guide
- Claude API Reference

## 🤝 Contributing

See **CONTRIBUTING.md** for:
- Bug reporting
- Feature requests
- Pull requests
- Code style
- Testing

## 📄 License

MIT License - Free for personal and commercial use

## 🎉 Status

**Version:** 1.0.0  
**Status:** Production Ready  
**Last Updated:** May 14, 2026  

## 📞 Support

- 📖 Check documentation in `docs/`
- 🐛 Report bugs in GitHub Issues
- 💡 Suggest features in GitHub Issues
- 🤝 Contribute via Pull Requests

## 🚀 Next Steps

1. Read **QUICKSTART.md** (5 minutes)
2. Run `python src/setup_credentials.py`
3. Run `streamlit run src/app.py`
4. Start chatting!

---

**Happy Coding! 🎉**

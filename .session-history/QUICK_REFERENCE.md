# ⚡ Quick Reference

## Commands

| Command | Purpose |
|---------|---------|
| `python3 generate_session_summary.py` | Generate new summary |
| `./session-summary.sh view` | View latest summary |
| `./session-summary.sh list` | List all summaries |
| `make summary` | Generate (if Makefile exists) |
| `make summary-view` | View latest (if Makefile exists) |

## VS Code Integration

**Keyboard Shortcut:** `Cmd+Shift+P` (macOS) or `Ctrl+Shift+P` (Windows/Linux)

Then type:
- `Generate Session Summary`
- `View Latest Summary`
- `List All Summaries`

## File Locations

| File | Purpose |
|------|---------|
| `.session-history/SUMMARY_latest.md` | Latest summary (symlink) |
| `.session-history/SUMMARY_*.md` | All summaries |
| `.session-history/config.json` | Configuration |
| `.session-history/search.py` | Search tool |
| `generate_session_summary.py` | Generator script |
| `session-summary.sh` | Shell wrapper |

## Workflow

1. **Work on code** → Make changes
2. **Generate summary** → `python3 generate_session_summary.py`
3. **Review changes** → `./session-summary.sh view`
4. **Commit** → `git add . && git commit -m "..."`
5. **Repeat** → Back to step 1

---

📖 Full guide: See `USAGE_GUIDE.md`
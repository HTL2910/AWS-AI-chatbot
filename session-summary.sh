#!/bin/bash
# Session Summary Helper Script
# Usage: ./session-summary.sh [generate|list|view]

PROJECT_ROOT="/Applications/PythonCode/AWS-AI-chatbot"
HISTORY_DIR="$PROJECT_ROOT/.session-history"
PYTHON_SCRIPT="$PROJECT_ROOT/generate_session_summary.py"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Ensure history directory exists
mkdir -p "$HISTORY_DIR"

case "${1:-generate}" in
  generate)
    echo -e "${BLUE}📋 Generating session summary...${NC}"
    python3 "$PYTHON_SCRIPT"
    ;;

  list)
    echo -e "${BLUE}📋 Recent session summaries:${NC}"
    ls -1t "$HISTORY_DIR"/SUMMARY_*.md 2>/dev/null | head -10 | while read file; do
      echo -e "${GREEN}✓${NC} $(basename "$file")"
    done
    ;;

  view)
    echo -e "${BLUE}📋 Latest session summary:${NC}"
    latest=$(ls -t "$HISTORY_DIR"/SUMMARY_*.md 2>/dev/null | head -1)
    if [ -n "$latest" ]; then
      cat "$latest"
    else
      echo -e "${YELLOW}⚠ No summaries found${NC}"
    fi
    ;;

  *)
    echo "Usage: $0 {generate|list|view}"
    exit 1
    ;;
esac

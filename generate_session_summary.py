#!/usr/bin/env python3
"""
Session Summary Generator
Automatically creates a summary of changes made during a session.
"""

import os
import json
import subprocess
from datetime import datetime
from pathlib import Path


class SessionSummaryGenerator:
    def __init__(self, project_root="/Applications/PythonCode/AWS-AI-chatbot"):
        self.project_root = Path(project_root)
        self.history_dir = self.project_root / ".session-history"
        self.history_dir.mkdir(exist_ok=True)
        self.timestamp = datetime.now()

    def get_git_changes(self):
        """Get all git changes since last commit"""
        try:
            # Modified files
            modified = subprocess.check_output(
                ["git", "diff", "--name-only"],
                cwd=self.project_root,
                text=True
            ).strip().split("\n")
            modified = [f for f in modified if f]

            # New files
            new_files = subprocess.check_output(
                ["git", "ls-files", "--others", "--exclude-standard"],
                cwd=self.project_root,
                text=True
            ).strip().split("\n")
            new_files = [f for f in new_files if f]

            # Deleted files
            deleted = subprocess.check_output(
                ["git", "diff", "--name-only", "--diff-filter=D"],
                cwd=self.project_root,
                text=True
            ).strip().split("\n")
            deleted = [f for f in deleted if f]

            # Get diff stats
            stats = subprocess.check_output(
                ["git", "diff", "--stat"],
                cwd=self.project_root,
                text=True
            ).strip()

            return {
                "modified": modified,
                "new": new_files,
                "deleted": deleted,
                "stats": stats
            }
        except Exception as e:
            print(f"Error getting git changes: {e}")
            return {"modified": [], "new": [], "deleted": [], "stats": ""}

    def get_lines_changed(self):
        """Get total lines added/removed"""
        try:
            output = subprocess.check_output(
                ["git", "diff", "--numstat"],
                cwd=self.project_root,
                text=True
            ).strip()

            added = 0
            removed = 0
            for line in output.split("\n"):
                if line:
                    parts = line.split("\t")
                    if len(parts) >= 2:
                        try:
                            added += int(parts[0])
                            removed += int(parts[1])
                        except ValueError:
                            pass

            return added, removed
        except Exception:
            return 0, 0

    def format_file_list(self, files):
        """Format file list as markdown"""
        if not files:
            return "- None"
        return "\n".join([f"- `{f}`" for f in files])

    def generate_summary(self, objectives="", completed_tasks="", next_steps="", risks=""):
        """Generate session summary"""
        changes = self.get_git_changes()
        added, removed = self.get_lines_changed()

        # Read template
        template_path = self.project_root / ".session-history" / "SESSION_SUMMARY_TEMPLATE.md"
        if not template_path.exists():
            print(f"Template not found at {template_path}")
            return None

        with open(template_path, "r") as f:
            template = f.read()

        # Fill template
        summary = template.format(
            DATE=self.timestamp.strftime("%Y-%m-%d %H:%M:%S"),
            DURATION="[Auto-calculated]",
            PHASE="v0.9.0 - Automated Testing & Quality Gates",
            STATUS="In Progress",
            OBJECTIVES=objectives or "Implement Phase 2 features",
            COMPLETED_TASKS=completed_tasks or "- [ ] Task 1\n- [ ] Task 2",
            MODIFIED_FILES=self.format_file_list(changes["modified"]),
            NEW_FILES=self.format_file_list(changes["new"]),
            DELETED_FILES=self.format_file_list(changes["deleted"]),
            COMMANDS="[Commands will be logged here]",
            TEST_RESULTS="[Test results will be logged here]",
            BUILD_STATUS="[Build status will be logged here]",
            QUALITY_CHECKS="[Quality checks will be logged here]",
            LINES_ADDED=added,
            LINES_REMOVED=removed,
            FILES_MODIFIED=len(changes["modified"]),
            NEW_FILES_COUNT=len(changes["new"]),
            NEXT_STEPS=next_steps or "- Continue with Phase 2 implementation",
            RISKS_NOTES=risks or "- No critical risks identified",
            REFERENCES="- AUTONOMOUS_DELIVERY_ROADMAP.md\n- SAFEGRAPH_MVP_PLAN.md"
        )

        return summary

    def save_summary(self, summary, session_name=None):
        """Save summary to file"""
        if not summary:
            return None

        if not session_name:
            session_name = self.timestamp.strftime("%Y%m%d_%H%M%S")

        filename = f"SUMMARY_{session_name}.md"
        filepath = self.history_dir / filename

        with open(filepath, "w") as f:
            f.write(summary)

        # Create symlink to latest
        latest_link = self.history_dir / "SUMMARY_latest.md"
        try:
            if latest_link.exists() or latest_link.is_symlink():
                latest_link.unlink()
            latest_link.symlink_to(filepath.name)
        except Exception as e:
            print(f"Warning: Could not create latest symlink: {e}")

        print(f"✅ Summary saved: {filepath}")
        return filepath

    def list_summaries(self):
        """List all saved summaries"""
        summaries = sorted(self.history_dir.glob("SUMMARY_*.md"), reverse=True)
        return summaries


if __name__ == "__main__":
    import sys

    generator = SessionSummaryGenerator()

    if len(sys.argv) > 1 and sys.argv[1] == "list":
        print("📋 Recent Session Summaries:")
        for summary in generator.list_summaries()[:10]:
            print(f"  - {summary.name}")
    else:
        summary = generator.generate_summary()
        if summary:
            filepath = generator.save_summary(summary)
            print("\n" + "="*60)
            print(summary)
            print("="*60)
        else:
            print("❌ Failed to generate summary")

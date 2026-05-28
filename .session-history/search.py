#!/usr/bin/env python3
"""
Search and filter session summaries
"""

import sys
from pathlib import Path
from datetime import datetime, timedelta


class SummarySearcher:
    def __init__(self, history_dir="."):
        self.history_dir = Path(history_dir)

    def get_all_summaries(self):
        """Get all summary files sorted by date (newest first)"""
        summaries = sorted(
            self.history_dir.glob("SUMMARY_*.md"),
            reverse=True
        )
        return summaries

    def search_by_keyword(self, keyword):
        """Search summaries by keyword"""
        results = []
        for summary_file in self.get_all_summaries():
            try:
                with open(summary_file, "r") as f:
                    content = f.read()
                    if keyword.lower() in content.lower():
                        results.append(summary_file)
            except Exception as e:
                print(f"Error reading {summary_file}: {e}")
        return results

    def search_by_date(self, days_ago=1):
        """Search summaries from last N days"""
        cutoff = datetime.now() - timedelta(days=days_ago)
        results = []
        for summary_file in self.get_all_summaries():
            try:
                mtime = datetime.fromtimestamp(summary_file.stat().st_mtime)
                if mtime >= cutoff:
                    results.append(summary_file)
            except Exception as e:
                print(f"Error checking {summary_file}: {e}")
        return results

    def search_by_phase(self, phase):
        """Search summaries by phase"""
        return self.search_by_keyword(f"Phase: {phase}")

    def print_results(self, results, title="Search Results"):
        """Print search results"""
        print(f"\n📋 {title}")
        print("=" * 60)
        if not results:
            print("No results found")
            return

        for i, result in enumerate(results, 1):
            mtime = datetime.fromtimestamp(result.stat().st_mtime)
            print(f"{i}. {result.name}")
            print(f"   Modified: {mtime.strftime('%Y-%m-%d %H:%M:%S')}")


if __name__ == "__main__":
    searcher = SummarySearcher()

    if len(sys.argv) < 2:
        print("Usage: python search.py <keyword|--date N|--phase PHASE>")
        sys.exit(1)

    if sys.argv[1] == "--date":
        days = int(sys.argv[2]) if len(sys.argv) > 2 else 1
        results = searcher.search_by_date(days)
        searcher.print_results(results, f"Summaries from last {days} day(s)")
    else:
        results = searcher.search_by_keyword(sys.argv[1])
        searcher.print_results(results, f"Summaries matching '{sys.argv[1]}'")

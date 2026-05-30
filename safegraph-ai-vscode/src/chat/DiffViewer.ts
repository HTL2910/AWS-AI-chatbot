/**
 * DiffViewer - Enhanced diff display with expand/collapse and syntax highlighting
 * Features:
 * - Collapsible sections (default collapsed for compact view)
 * - Color-coded lines: green for additions, red for deletions, gray for context
 * - File-level grouping with statistics
 */

export interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'header';
  content: string;
  lineNum?: number;
}

export interface DiffSection {
  header: string;
  lines: DiffLine[];
  startLine: number;
  endLine: number;
}

export interface DiffFile {
  path: string;
  sections: DiffSection[];
  stats: {
    additions: number;
    deletions: number;
    total: number;
  };
}

export class DiffParser {
  static parse(diffText: string): DiffFile[] {
    const files: DiffFile[] = [];
    const lines = diffText.split('\n');
    let currentFile: DiffFile | null = null;
    let currentSection: DiffSection | null = null;
    let lineNum = 0;

    for (const line of lines) {
      // File header: --- a/path or +++ b/path
      if (line.startsWith('---') || line.startsWith('+++')) {
        if (currentFile && currentSection) {
          currentFile.sections.push(currentSection);
        }
        const path = line.replace(/^[\+\-]{3}\s+[ab]\//, '').trim();
        if (path && path !== '/dev/null') {
          currentFile = {
            path,
            sections: [],
            stats: { additions: 0, deletions: 0, total: 0 }
          };
          files.push(currentFile);
        }
        continue;
      }

      // Hunk header: @@ -10,5 +20,7 @@
      if (line.startsWith('@@')) {
        if (currentSection) {
          currentFile?.sections.push(currentSection);
        }
        currentSection = {
          header: line,
          lines: [],
          startLine: lineNum,
          endLine: lineNum
        };
        continue;
      }

      if (!currentSection || !currentFile) continue;

      // Parse diff lines
      if (line.startsWith('+') && !line.startsWith('+++')) {
        currentSection.lines.push({
          type: 'add',
          content: line.substring(1),
          lineNum: lineNum++
        });
        currentFile.stats.additions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        currentSection.lines.push({
          type: 'remove',
          content: line.substring(1),
          lineNum: lineNum++
        });
        currentFile.stats.deletions++;
      } else if (line.startsWith(' ')) {
        currentSection.lines.push({
          type: 'context',
          content: line.substring(1),
          lineNum: lineNum++
        });
      }
      currentSection.endLine = lineNum;
      currentFile.stats.total++;
    }

    if (currentSection && currentFile) {
      currentFile.sections.push(currentSection);
    }

    return files;
  }
}

export class DiffRenderer {
  static renderHTML(files: DiffFile[]): string {
    let html = '<div class="diffViewer">';

    for (const file of files) {
      html += this.renderFile(file);
    }

    html += '</div>';
    return html;
  }

  private static renderFile(file: DiffFile): string {
    const { additions, deletions } = file.stats;
    const fileId = `diff-${file.path.replace(/[^a-z0-9]/gi, '-')}`;

    let html = `
      <div class="diffFile" data-file="${file.path}">
        <div class="diffFileHeader">
          <button class="diffToggle" data-target="${fileId}" title="Toggle file diff">
            <span class="diffToggleIcon">▶</span>
          </button>
          <span class="diffFileName">${file.path}</span>
          <span class="diffStats">
            <span class="diffStat add">+${additions}</span>
            <span class="diffStat remove">−${deletions}</span>
          </span>
        </div>
        <div id="${fileId}" class="diffContent" style="display: none;">
    `;

    for (const section of file.sections) {
      html += this.renderSection(section);
    }

    html += '</div></div>';
    return html;
  }

  private static renderSection(section: DiffSection): string {
    let html = `<div class="diffSection">
      <div class="diffHunkHeader">${section.header}</div>
      <div class="diffLines">`;

    for (const line of section.lines) {
      const className = `diffLine diffLine-${line.type}`;
      html += `<div class="${className}">${this.escapeHtml(line.content)}</div>`;
    }

    html += '</div></div>';
    return html;
  }

  private static escapeHtml(text: string): string {
    const map: { [key: string]: string } = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }
}
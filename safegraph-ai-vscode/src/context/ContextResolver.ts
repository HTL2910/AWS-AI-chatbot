/**
 * Context Resolver - Detect workspace, repo, target folder, and web docs
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import {
  ContextInfo,
  TargetFolder,
  RepoInfo,
  ProjectStructure,
  FileInfo,
  WebDocsBundle,
  ContextResolver as IContextResolver,
} from '../types/Context';

export class ContextResolver implements IContextResolver {
  private workspaceFolder: string;
  private tags: Map<string, string> = new Map();
  private webDocsCache: Map<string, WebDocsBundle> = new Map();

  constructor(workspaceFolder: string) {
    this.workspaceFolder = workspaceFolder;
  }

  async resolveContext(): Promise<ContextInfo> {
    const context: ContextInfo = {
      workspaceFolder: this.workspaceFolder,
      tags: this.tags,
      timestamp: Date.now(),
    };

    try {
      context.targetFolder = await this.detectTargetFolder();
      context.repo = await this.detectRepository();
      context.projectStructure = await this.indexProject(100);
    } catch (error) {
      console.error('Error resolving context:', error);
    }

    return context;
  }

  async detectTargetFolder(): Promise<TargetFolder | undefined> {
    try {
      const stats = fs.statSync(this.workspaceFolder);
      if (!stats.isDirectory()) return undefined;

      const files = fs.readdirSync(this.workspaceFolder);
      const fileCount = files.length;

      // Detect languages
      const languages = this.detectLanguagesInFolder(this.workspaceFolder);

      // Check for git
      const hasGit = fs.existsSync(path.join(this.workspaceFolder, '.git'));

      const tag = this.tags.get(this.workspaceFolder);

      return {
        path: this.workspaceFolder,
        name: path.basename(this.workspaceFolder),
        isTagged: !!tag,
        tag,
        fileCount,
        languages,
        hasGit,
      };
    } catch (error) {
      console.error('Error detecting target folder:', error);
      return undefined;
    }
  }

  async detectRepository(): Promise<RepoInfo | undefined> {
    try {
      const gitDir = path.join(this.workspaceFolder, '.git');
      if (!fs.existsSync(gitDir)) {
        return undefined;
      }

      const branch = this.execGitCommand('rev-parse --abbrev-ref HEAD');
      const remoteUrl = this.execGitCommand('config --get remote.origin.url');
      const lastCommitHash = this.execGitCommand('rev-parse HEAD');
      const lastCommitMessage = this.execGitCommand('log -1 --pretty=%B');
      const lastCommitAuthor = this.execGitCommand('log -1 --pretty=%an');
      const lastCommitDate = parseInt(this.execGitCommand('log -1 --pretty=%at')) * 1000;

      // Check if dirty
      const status = this.execGitCommand('status --porcelain');
      const isDirty = status.length > 0;

      return {
        path: this.workspaceFolder,
        isGit: true,
        branch: branch.trim(),
        remoteUrl: remoteUrl.trim(),
        isDirty,
        lastCommit: {
          hash: lastCommitHash.trim(),
          message: lastCommitMessage.trim(),
          author: lastCommitAuthor.trim(),
          date: lastCommitDate,
        },
      };
    } catch (error) {
      console.error('Error detecting repository:', error);
      return undefined;
    }
  }

  async indexProject(maxFiles: number = 100): Promise<ProjectStructure> {
    const structure: ProjectStructure = {
      root: this.workspaceFolder,
      files: [],
      directories: [],
      mainLanguages: [],
    };

    try {
      const files = this.indexFilesRecursive(this.workspaceFolder, maxFiles);
      structure.files = files;

      // Detect directories
      const dirs = new Set<string>();
      for (const file of files) {
        const dir = path.dirname(file.path);
        if (dir !== this.workspaceFolder) {
          dirs.add(dir);
        }
      }
      structure.directories = Array.from(dirs);

      // Detect languages
      structure.mainLanguages = this.detectLanguagesFromFiles(files);

      // Detect package manager
      structure.packageManager = this.detectPackageManager();

      // Detect build tool
      structure.buildTool = this.detectBuildTool();
    } catch (error) {
      console.error('Error indexing project:', error);
    }

    return structure;
  }

  private indexFilesRecursive(dir: string, maxFiles: number, count: number = 0): FileInfo[] {
    const files: FileInfo[] = [];

    if (count >= maxFiles) return files;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (count >= maxFiles) break;

        // Skip hidden and node_modules
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          files.push(...this.indexFilesRecursive(fullPath, maxFiles, count + files.length));
        } else {
          const stats = fs.statSync(fullPath);
          const ext = path.extname(entry.name).toLowerCase();
          files.push({
            path: fullPath,
            name: entry.name,
            language: this.detectLanguageFromExt(ext),
            size: stats.size,
            modified: stats.mtimeMs,
            isDirectory: false,
          });
          count++;
        }
      }
    } catch (error) {
      console.error(`Error indexing directory ${dir}:`, error);
    }

    return files;
  }

  private detectLanguagesInFolder(folderPath: string): string[] {
    const languages = new Set<string>();
    try {
      const files = fs.readdirSync(folderPath);
      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        const lang = this.detectLanguageFromExt(ext);
        if (lang) languages.add(lang);
      }
    } catch (error) {
      console.error('Error detecting languages:', error);
    }
    return Array.from(languages);
  }

  private detectLanguagesFromFiles(files: FileInfo[]): string[] {
    const languages = new Set<string>();
    for (const file of files) {
      if (file.language) languages.add(file.language);
    }
    return Array.from(languages);
  }

  private detectLanguageFromExt(ext: string): string | undefined {
    const langMap: Record<string, string> = {
      '.ts': 'TypeScript',
      '.tsx': 'TypeScript',
      '.js': 'JavaScript',
      '.jsx': 'JavaScript',
      '.py': 'Python',
      '.java': 'Java',
      '.go': 'Go',
      '.rs': 'Rust',
      '.cpp': 'C++',
      '.c': 'C',
      '.cs': 'C#',
      '.rb': 'Ruby',
      '.php': 'PHP',
      '.swift': 'Swift',
      '.kt': 'Kotlin',
      '.html': 'HTML',
      '.css': 'CSS',
      '.scss': 'SCSS',
      '.json': 'JSON',
      '.yaml': 'YAML',
      '.yml': 'YAML',
      '.md': 'Markdown',
    };
    return langMap[ext];
  }

  private detectPackageManager(): string | undefined {
    const managers = [
      { file: 'package.json', manager: 'npm' },
      { file: 'yarn.lock', manager: 'yarn' },
      { file: 'pnpm-lock.yaml', manager: 'pnpm' },
      { file: 'Pipfile', manager: 'pipenv' },
      { file: 'requirements.txt', manager: 'pip' },
      { file: 'Gemfile', manager: 'bundler' },
      { file: 'Cargo.toml', manager: 'cargo' },
      { file: 'go.mod', manager: 'go' },
    ];

    for (const { file, manager } of managers) {
      if (fs.existsSync(path.join(this.workspaceFolder, file))) {
        return manager;
      }
    }
    return undefined;
  }

  private detectBuildTool(): string | undefined {
    const tools = [
      { file: 'webpack.config.js', tool: 'webpack' },
      { file: 'vite.config.js', tool: 'vite' },
      { file: 'tsconfig.json', tool: 'tsc' },
      { file: 'Makefile', tool: 'make' },
      { file: 'build.gradle', tool: 'gradle' },
      { file: 'pom.xml', tool: 'maven' },
      { file: 'setup.py', tool: 'setuptools' },
    ];

    for (const { file, tool } of tools) {
      if (fs.existsSync(path.join(this.workspaceFolder, file))) {
        return tool;
      }
    }
    return undefined;
  }

  private execGitCommand(command: string): string {
    try {
      return execSync(`git -C "${this.workspaceFolder}" ${command}`, { encoding: 'utf-8' });
    } catch (error) {
      return '';
    }
  }

  tagFolder(folderPath: string, tag: string): void {
    this.tags.set(folderPath, tag);
  }

  getTaggedFolders(): Map<string, string> {
    return new Map(this.tags);
  }

  async fetchWebDocsBundle(seedUrl: string): Promise<WebDocsBundle> {
    const cacheKey = this.generateCacheKey(seedUrl);
    const cached = this.webDocsCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const bundle: WebDocsBundle = {
      seedUrl,
      pages: [],
      relatedUrls: [],
      cached: false,
      cacheKey,
    };

    // Placeholder: actual implementation would fetch and parse
    // This is a stub for the FDE roadmap
    bundle.cached = true;
    this.webDocsCache.set(cacheKey, bundle);

    return bundle;
  }

  cacheWebDocs(bundle: WebDocsBundle): void {
    this.webDocsCache.set(bundle.cacheKey, bundle);
  }

  getCachedWebDocs(cacheKey: string): WebDocsBundle | undefined {
    return this.webDocsCache.get(cacheKey);
  }

  private generateCacheKey(url: string): string {
    return `webdocs_${Buffer.from(url).toString('base64')}`;
  }
}

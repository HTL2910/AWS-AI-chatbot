/**
 * Context Type Definitions
 * Workspace, repository, and folder context
 */

export interface TargetFolder {
  path: string;
  name: string;
  isTagged: boolean;
  tag?: string;
  fileCount: number;
  languages: string[];
  hasGit: boolean;
}

export interface RepoInfo {
  path: string;
  isGit: boolean;
  branch?: string;
  remoteUrl?: string;
  isDirty?: boolean;
  lastCommit?: {
    hash: string;
    message: string;
    author: string;
    date: number;
  };
}

export interface FileInfo {
  path: string;
  name: string;
  language?: string;
  size: number;
  modified: number;
  isDirectory: boolean;
}

export interface ProjectStructure {
  root: string;
  files: FileInfo[];
  directories: string[];
  mainLanguages: string[];
  packageManager?: string; // npm, pip, cargo, etc.
  buildTool?: string; // webpack, gradle, make, etc.
}

export interface WebDocsBundle {
  seedUrl: string;
  pages: {
    url: string;
    title: string;
    content: string;
    fetchedAt: number;
  }[];
  relatedUrls: string[];
  cached: boolean;
  cacheKey: string;
}

export interface ContextInfo {
  workspaceFolder: string;
  targetFolder?: TargetFolder;
  activeFile?: string;
  selectedText?: string;
  repo?: RepoInfo;
  projectStructure?: ProjectStructure;
  webDocsBundle?: WebDocsBundle;
  tags: Map<string, string>; // folder path -> tag
  timestamp: number;
}

export interface ContextResolver {
  resolveContext(): Promise<ContextInfo>;
  detectTargetFolder(): Promise<TargetFolder | undefined>;
  detectRepository(): Promise<RepoInfo | undefined>;
  indexProject(maxFiles?: number): Promise<ProjectStructure>;
  tagFolder(folderPath: string, tag: string): void;
  getTaggedFolders(): Map<string, string>;
  fetchWebDocsBundle(seedUrl: string): Promise<WebDocsBundle>;
  cacheWebDocs(bundle: WebDocsBundle): void;
  getCachedWebDocs(cacheKey: string): WebDocsBundle | undefined;
}

export interface FileIndexer {
  indexFiles(rootPath: string, maxFiles?: number): Promise<FileInfo[]>;
  detectLanguages(files: FileInfo[]): string[];
  buildSemanticTree(files: FileInfo[]): any;
}

export interface WebDocsBundler {
  fetchPage(url: string): Promise<string>;
  parseMarkdown(content: string): Promise<any>;
  followLinks(content: string, baseUrl: string): Promise<string[]>;
  synthesizePages(pages: string[]): Promise<string>;
  cacheBundle(bundle: WebDocsBundle): void;
}

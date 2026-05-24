import * as vscode from "vscode";
import * as crypto from "crypto";
import * as path from "path";
import * as ts from "typescript";

type ParserKind = "document-symbol" | "typescript-ast" | "text-fallback";

type RepositoryChunk = {
  id: string;
  path: string;
  language: string;
  kind: string;
  name: string;
  qualifiedName: string;
  startLine: number;
  endLine: number;
  text: string;
  parser: ParserKind;
  symbols: string[];
  references: string[];
  tokens: Record<string, number>;
};

type RepositoryIndex = {
  version: number;
  root: string;
  updatedAt: number;
  files: Record<string, { mtime: number; size: number }>;
  chunks: RepositoryChunk[];
  definitions: Record<string, string[]>;
  stats?: {
    indexedFiles: number;
    reusedFiles: number;
    changedFiles: number;
    skippedFiles: number;
    buildMs: number;
  };
};

export type RepositoryContextOptions = {
  query: string;
  storageUri?: vscode.Uri;
  rootUri?: vscode.Uri;
  maxFiles?: number;
  maxChunks?: number;
  maxChars?: number;
};

const INDEX_VERSION = 3;
const SOURCE_GLOB =
  "**/*.{ts,tsx,js,jsx,py,java,go,rs,cs,cpp,c,h,hpp,md,json,yaml,yml,toml,html,css,scss,sql,sh}";
const EXCLUDE_GLOB =
  "**/{node_modules,.git,dist,build,out,venv,.venv,__pycache__,coverage,.next,.turbo,target,vendor}/**";
const MAX_FILE_BYTES = 220_000;
const SYMBOL_PROVIDER_TIMEOUT_MS = 900;
const INDEX_BATCH_SIZE = 8;

function workspaceRoot(rootUri?: vscode.Uri) {
  return rootUri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
}

function relativePath(root: vscode.Uri, uri: vscode.Uri) {
  return path.relative(root.fsPath, uri.fsPath).replace(/\\/g, "/");
}

function languageForFile(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  const byExt: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescriptreact",
    ".js": "javascript",
    ".jsx": "javascriptreact",
    ".py": "python",
    ".java": "java",
    ".go": "go",
    ".rs": "rust",
    ".cs": "csharp",
    ".cpp": "cpp",
    ".c": "c",
    ".h": "c",
    ".hpp": "cpp",
    ".md": "markdown",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "toml",
    ".html": "html",
    ".css": "css",
    ".scss": "scss",
    ".sql": "sql",
    ".sh": "shell"
  };
  return byExt[ext] || ext.replace(".", "") || "text";
}

function tokenize(text: string) {
  const tokens: Record<string, number> = {};
  const words = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .match(/[a-z0-9_]{2,}/g);
  for (const word of words || []) {
    tokens[word] = (tokens[word] || 0) + 1;
  }
  return tokens;
}

function normalizeSymbol(name: string) {
  return name.trim().replace(/^#/, "").toLowerCase();
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function baseSymbolName(name: string) {
  const parts = name.split(".");
  return parts[parts.length - 1] || name;
}

function chunkId(filePath: string, startLine: number, endLine: number, qualifiedName: string) {
  return crypto.createHash("sha1").update(`${filePath}:${startLine}:${endLine}:${qualifiedName}`).digest("hex").slice(0, 16);
}

const REFERENCE_STOP_WORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "new",
  "throw",
  "typeof",
  "sizeof",
  "print",
  "console",
  "log",
  "len",
  "range",
  "str",
  "int",
  "float",
  "bool",
  "dict",
  "list",
  "set"
]);

function extractReferences(text: string) {
  const refs: string[] = [];
  const callPattern = /(?:\bnew\s+)?\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\(/g;
  for (const match of text.matchAll(callPattern)) {
    const symbol = match[1];
    const base = baseSymbolName(symbol);
    if (!REFERENCE_STOP_WORDS.has(base.toLowerCase())) refs.push(symbol, base);
  }

  const importPattern = /\b(?:import|from|require)\s*(?:\(?\s*["']?)([A-Za-z_$][\w$]*)?/g;
  for (const match of text.matchAll(importPattern)) {
    if (match[1]) refs.push(match[1]);
  }
  return unique(refs.map(normalizeSymbol));
}

function pushChunk(
  chunks: RepositoryChunk[],
  filePath: string,
  language: string,
  kind: string,
  name: string,
  qualifiedName: string,
  lines: string[],
  start: number,
  end: number,
  lineOffset = 0,
  parser: ParserKind = "text-fallback"
) {
  const localStart = Math.max(0, start - lineOffset - 1);
  const localEnd = Math.max(localStart, end - lineOffset);
  const body = lines.slice(localStart, localEnd).join("\n").trim();
  if (!body) return;
  const text = body.length > 12_000 ? `${body.slice(0, 7_000)}\n\n[...chunk truncated...]\n\n${body.slice(-4_000)}` : body;
  const normalizedName = normalizeSymbol(name);
  const normalizedQualifiedName = normalizeSymbol(qualifiedName);
  const symbols = unique([normalizedName, normalizedQualifiedName, normalizeSymbol(baseSymbolName(qualifiedName))]);
  const references = extractReferences(text).filter((ref) => !symbols.includes(ref));
  const metadata = `${filePath} ${language} ${kind} ${name} ${qualifiedName} ${parser} ${references.join(" ")}`;
  chunks.push({
    id: chunkId(filePath, start, end, qualifiedName),
    path: filePath,
    language,
    kind,
    name,
    qualifiedName,
    startLine: start,
    endLine: end,
    text,
    parser,
    symbols,
    references,
    tokens: tokenize(`${metadata}\n${text}`)
  });
}

function symbolPattern(language: string) {
  if (language === "python") {
    return /^(\s*)(async\s+def|def|class)\s+([A-Za-z_][\w]*)/;
  }
  if (language === "go") {
    return /^\s*(func)\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)/;
  }
  if (language === "rust") {
    return /^\s*(?:pub\s+)?(fn|struct|enum|impl|trait)\s+([A-Za-z_][\w]*)?/;
  }
  if (language === "java" || language === "csharp") {
    return /^\s*(?:public|private|protected|static|final|abstract|async|\s)*\s*(class|interface|enum|void|[\w<>\[\], ?]+)\s+([A-Za-z_][\w]*)\s*(?:\(|extends|implements|\{)/;
  }
  if (["typescript", "typescriptreact", "javascript", "javascriptreact"].includes(language)) {
    return /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(class|function|interface|type|const|let|var)\s+([A-Za-z_$][\w$]*)/;
  }
  return null;
}

function splitLargeFile(
  chunks: RepositoryChunk[],
  filePath: string,
  language: string,
  lines: string[],
  preferredName = "file",
  lineOffset = 0,
  parser: ParserKind = "text-fallback"
) {
  const blockSize = language === "markdown" ? 90 : 120;
  for (let i = 0; i < lines.length; i += blockSize) {
    const localStart = i + 1;
    const localEnd = Math.min(lines.length, i + blockSize);
    const globalStart = lineOffset + localStart;
    const globalEnd = lineOffset + localEnd;
    const name = `${preferredName}:${globalStart}`;
    pushChunk(chunks, filePath, language, "chunk", name, name, lines, globalStart, globalEnd, lineOffset, parser);
  }
}

function vscodeKindName(kind: vscode.SymbolKind) {
  return vscode.SymbolKind[kind] || "Symbol";
}

function symbolChunkKind(kind: vscode.SymbolKind) {
  switch (kind) {
    case vscode.SymbolKind.Class:
      return "class";
    case vscode.SymbolKind.Method:
      return "method";
    case vscode.SymbolKind.Function:
      return "function";
    case vscode.SymbolKind.Constructor:
      return "constructor";
    case vscode.SymbolKind.Interface:
      return "interface";
    case vscode.SymbolKind.Enum:
      return "enum";
    case vscode.SymbolKind.Struct:
      return "struct";
    case vscode.SymbolKind.Module:
      return "module";
    case vscode.SymbolKind.Namespace:
      return "namespace";
    default:
      return vscodeKindName(kind).toLowerCase();
  }
}

function isIndexableSymbolKind(kind: vscode.SymbolKind) {
  return [
    vscode.SymbolKind.Class,
    vscode.SymbolKind.Method,
    vscode.SymbolKind.Function,
    vscode.SymbolKind.Constructor,
    vscode.SymbolKind.Interface,
    vscode.SymbolKind.Enum,
    vscode.SymbolKind.Struct,
    vscode.SymbolKind.Module,
    vscode.SymbolKind.Namespace
  ].includes(kind);
}

function flattenDocumentSymbols(
  symbols: vscode.DocumentSymbol[],
  parentNames: string[] = []
): { symbol: vscode.DocumentSymbol; qualifiedName: string }[] {
  const result: { symbol: vscode.DocumentSymbol; qualifiedName: string }[] = [];
  for (const symbol of symbols) {
    const qualifiedName = [...parentNames, symbol.name].join(".");
    if (isIndexableSymbolKind(symbol.kind)) result.push({ symbol, qualifiedName });
    result.push(...flattenDocumentSymbols(symbol.children || [], [...parentNames, symbol.name]));
  }
  return result;
}

function isDocumentSymbolArray(value: unknown): value is vscode.DocumentSymbol[] {
  return Array.isArray(value) && value.every((item) => item && typeof item === "object" && "range" in item);
}

async function extractDocumentSymbolChunks(uri: vscode.Uri, filePath: string, text: string) {
  const language = languageForFile(filePath);
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const symbols = await withTimeout(
    vscode.commands.executeCommand<vscode.DocumentSymbol[] | vscode.SymbolInformation[] | undefined>(
      "vscode.executeDocumentSymbolProvider",
      uri
    ),
    SYMBOL_PROVIDER_TIMEOUT_MS
  );
  if (!isDocumentSymbolArray(symbols) || symbols.length === 0) return [];

  const chunks: RepositoryChunk[] = [];
  for (const { symbol, qualifiedName } of flattenDocumentSymbols(symbols)) {
    const start = symbol.range.start.line + 1;
    const end = symbol.range.end.line + 1;
    if (start < 1 || end < start) continue;
    pushChunk(
      chunks,
      filePath,
      language,
      symbolChunkKind(symbol.kind),
      symbol.name,
      qualifiedName,
      lines,
      start,
      end,
      0,
      "document-symbol"
    );
  }
  return chunks;
}

function withTimeout<T>(promise: Thenable<T>, timeoutMs: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      }
    );
  });
}

function hasTypeScriptAstParser(filePath: string) {
  const language = languageForFile(filePath);
  return ["typescript", "typescriptreact", "javascript", "javascriptreact"].includes(language);
}

function shouldTryDocumentSymbols(filePath: string) {
  const language = languageForFile(filePath);
  return [
    "python",
    "java",
    "go",
    "rust",
    "csharp",
    "cpp",
    "c"
  ].includes(language);
}

function tsKindToChunkKind(node: ts.Node) {
  if (ts.isClassDeclaration(node)) return "class";
  if (ts.isMethodDeclaration(node)) return "method";
  if (ts.isFunctionDeclaration(node)) return "function";
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  if (ts.isEnumDeclaration(node)) return "enum";
  if (ts.isVariableStatement(node)) return "variable";
  return "symbol";
}

function tsNodeName(node: ts.Node) {
  if (
    (ts.isClassDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node)) &&
    node.name
  ) {
    return node.name.getText();
  }
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isVariableStatement(node)) {
    const first = node.declarationList.declarations[0]?.name.getText();
    return first || "variable";
  }
  return "";
}

function extractTypeScriptAstChunks(filePath: string, text: string) {
  const language = languageForFile(filePath);
  if (!["typescript", "typescriptreact", "javascript", "javascriptreact"].includes(language)) return [];

  const scriptKind = language === "typescriptreact" ? ts.ScriptKind.TSX : language === "javascriptreact" ? ts.ScriptKind.JSX : language === "javascript" ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, scriptKind);
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const chunks: RepositoryChunk[] = [];

  function lineOf(position: number) {
    return source.getLineAndCharacterOfPosition(position).line + 1;
  }

  function visit(node: ts.Node, parents: string[]) {
    const name = tsNodeName(node);
    const isChunk =
      ts.isClassDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isVariableStatement(node);

    const nextParents = name && !ts.isConstructorDeclaration(node) ? [...parents, name] : parents;
    if (isChunk && name) {
      const start = lineOf(node.getStart(source));
      const end = lineOf(node.getEnd());
      const qualifiedName = [...parents, name].join(".");
      pushChunk(
        chunks,
        filePath,
        language,
        tsKindToChunkKind(node),
        name,
        qualifiedName,
        lines,
        start,
        end,
        0,
        "typescript-ast"
      );
    }
    ts.forEachChild(node, (child) => visit(child, nextParents));
  }

  visit(source, []);
  return chunks;
}

function extractFallbackChunks(filePath: string, text: string) {
  const language = languageForFile(filePath);
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const chunks: RepositoryChunk[] = [];
  const pattern = symbolPattern(language);

  if (!pattern || lines.length < 30) {
    splitLargeFile(chunks, filePath, language, lines);
    return chunks;
  }

  const symbols: { kind: string; name: string; line: number }[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(pattern);
    if (!match) continue;
    const kind = language === "python" ? match[2].replace(/\s+/g, " ") : match[1];
    const name = language === "python" ? match[3] : match[2] || match[1];
    symbols.push({ kind, name, line: i + 1 });
  }

  if (symbols.length === 0) {
    splitLargeFile(chunks, filePath, language, lines);
    return chunks;
  }

  if (symbols[0].line > 1) {
    pushChunk(chunks, filePath, language, "preamble", "module", "module", lines, 1, symbols[0].line - 1);
  }

  for (let i = 0; i < symbols.length; i += 1) {
    const start = symbols[i].line;
    const end = i + 1 < symbols.length ? symbols[i + 1].line - 1 : lines.length;
    if (end - start > 180) {
      splitLargeFile(chunks, filePath, language, lines.slice(start - 1, end), symbols[i].name, start - 1);
    } else {
      pushChunk(chunks, filePath, language, symbols[i].kind, symbols[i].name, symbols[i].name, lines, start, end);
    }
  }

  return chunks;
}

async function extractChunks(uri: vscode.Uri, filePath: string, text: string) {
  if (hasTypeScriptAstParser(filePath)) {
    const tsChunks = extractTypeScriptAstChunks(filePath, text);
    if (tsChunks.length > 0) return tsChunks;
  }

  if (shouldTryDocumentSymbols(filePath)) {
    try {
      const symbolChunks = await extractDocumentSymbolChunks(uri, filePath, text);
      if (symbolChunks.length > 0) return symbolChunks;
    } catch {
      // Language servers are optional; fall through to bundled parsers.
    }
  }

  return extractFallbackChunks(filePath, text);
}

function indexFileName(root: vscode.Uri) {
  const digest = crypto.createHash("sha1").update(root.fsPath).digest("hex").slice(0, 12);
  return `repository-index-${digest}.json`;
}

async function readCachedIndex(storageUri: vscode.Uri | undefined, root: vscode.Uri) {
  if (!storageUri) return undefined;
  try {
    const uri = vscode.Uri.joinPath(storageUri, indexFileName(root));
    const bytes = await vscode.workspace.fs.readFile(uri);
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as RepositoryIndex;
    if (parsed.version === INDEX_VERSION && parsed.root === root.fsPath) return parsed;
  } catch {
    // Cache misses are expected.
  }
  return undefined;
}

async function writeCachedIndex(storageUri: vscode.Uri | undefined, root: vscode.Uri, index: RepositoryIndex) {
  if (!storageUri) return;
  try {
    await vscode.workspace.fs.createDirectory(storageUri);
    const uri = vscode.Uri.joinPath(storageUri, indexFileName(root));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(index), "utf8"));
  } catch {
    // A failed cache write should not block chat.
  }
}

async function buildIndex(root: vscode.Uri, maxFiles: number, storageUri?: vscode.Uri) {
  const startedAt = Date.now();
  const files = await vscode.workspace.findFiles(new vscode.RelativePattern(root, SOURCE_GLOB), EXCLUDE_GLOB, maxFiles);
  const cached = await readCachedIndex(storageUri, root);
  const stats: Record<string, { mtime: number; size: number }> = {};
  const cachedChunksByPath = new Map<string, RepositoryChunk[]>();
  for (const chunk of cached?.chunks || []) {
    const list = cachedChunksByPath.get(chunk.path) || [];
    list.push(chunk);
    cachedChunksByPath.set(chunk.path, list);
  }
  let cacheValid = Boolean(cached);

  for (const uri of files) {
    const rel = relativePath(root, uri);
    const stat = await vscode.workspace.fs.stat(uri);
    stats[rel] = { mtime: stat.mtime, size: stat.size };
    const previous = cached?.files[rel];
    if (!previous || previous.mtime !== stat.mtime || previous.size !== stat.size) cacheValid = false;
  }

  if (cached && cacheValid && Object.keys(cached.files).length === Object.keys(stats).length) {
    return cached;
  }

  const chunks: RepositoryChunk[] = [];
  let reusedFiles = 0;
  let changedFiles = 0;
  let skippedFiles = 0;

  const processFile = async (uri: vscode.Uri) => {
    const rel = relativePath(root, uri);
    const stat = stats[rel];
    if (!stat || stat.size > MAX_FILE_BYTES) {
      skippedFiles += 1;
      return [];
    }

    const previous = cached?.files[rel];
    const previousChunks = cachedChunksByPath.get(rel);
    if (previous && previousChunks && previous.mtime === stat.mtime && previous.size === stat.size) {
      reusedFiles += 1;
      return previousChunks;
    }

    changedFiles += 1;
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(bytes).toString("utf8");
      if (text.includes("\u0000")) {
        skippedFiles += 1;
        return [];
      }
      return await extractChunks(uri, rel, text);
    } catch {
      skippedFiles += 1;
      return [];
    }
  };

  for (let i = 0; i < files.length; i += INDEX_BATCH_SIZE) {
    const batch = files.slice(i, i + INDEX_BATCH_SIZE);
    const batchChunks = await Promise.all(batch.map(processFile));
    for (const fileChunks of batchChunks) chunks.push(...fileChunks);
  }

  const definitions = buildDefinitions(chunks);
  const index: RepositoryIndex = {
    version: INDEX_VERSION,
    root: root.fsPath,
    updatedAt: Date.now(),
    files: stats,
    chunks,
    definitions,
    stats: {
      indexedFiles: Object.keys(stats).length - skippedFiles,
      reusedFiles,
      changedFiles,
      skippedFiles,
      buildMs: Date.now() - startedAt
    }
  };
  await writeCachedIndex(storageUri, root, index);
  return index;
}

function buildDefinitions(chunks: RepositoryChunk[]) {
  const definitions: Record<string, string[]> = {};
  for (const chunk of chunks) {
    for (const symbol of chunk.symbols) {
      if (!definitions[symbol]) definitions[symbol] = [];
      definitions[symbol].push(chunk.id);
    }
  }
  return definitions;
}

function scoreChunks(query: string, chunks: RepositoryChunk[]) {
  const queryTokens = tokenize(query);
  const queryTerms = Object.keys(queryTokens);
  if (queryTerms.length === 0) return [];

  const documentFrequency: Record<string, number> = {};
  for (const chunk of chunks) {
    for (const term of Object.keys(chunk.tokens)) {
      documentFrequency[term] = (documentFrequency[term] || 0) + 1;
    }
  }

  const totalDocs = Math.max(1, chunks.length);
  const idf = (term: string) => Math.log(1 + totalDocs / (1 + (documentFrequency[term] || 0)));
  const queryWeights = new Map<string, number>();
  let queryNorm = 0;
  for (const term of queryTerms) {
    const weight = queryTokens[term] * idf(term);
    queryWeights.set(term, weight);
    queryNorm += weight * weight;
  }
  queryNorm = Math.sqrt(queryNorm) || 1;

  return chunks
    .map((chunk) => {
      let dot = 0;
      let norm = 0;
      for (const [term, count] of Object.entries(chunk.tokens)) {
        const weight = count * idf(term);
        norm += weight * weight;
        dot += (queryWeights.get(term) || 0) * weight;
      }
      let score = dot / (queryNorm * (Math.sqrt(norm) || 1));
      const lowerPath = chunk.path.toLowerCase();
      const normalizedSymbols = new Set([...chunk.symbols, ...chunk.references]);
      for (const term of queryTerms) {
        if (normalizedSymbols.has(term)) score += 0.16;
        if (chunk.path.toLowerCase().includes(term)) score += 0.08;
      }
      if (/\b(test|spec)\b/i.test(query) && /(?:^|\/)(test|tests|spec|__tests__)\//i.test(lowerPath)) score += 0.2;
      if (/\b(style|css|layout|ui|frontend|giao diện|thiết kế)\b/i.test(query) && /\.(css|scss|html|tsx|jsx)$/i.test(lowerPath)) score += 0.12;
      if (/\b(api|route|server|backend|bedrock)\b/i.test(query) && /\.(py|ts|js)$/i.test(lowerPath)) score += 0.1;
      return { chunk, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
}

function definitionChunksForSymbols(symbols: string[], index: RepositoryIndex, byId: Map<string, RepositoryChunk>) {
  const found: RepositoryChunk[] = [];
  for (const symbol of symbols) {
    const normalized = normalizeSymbol(symbol);
    const base = normalizeSymbol(baseSymbolName(symbol));
    const ids = unique([...(index.definitions[normalized] || []), ...(index.definitions[base] || [])]);
    for (const id of ids.slice(0, 3)) {
      const chunk = byId.get(id);
      if (chunk) found.push(chunk);
    }
  }
  return found;
}

function expandWithSymbolGraph(
  query: string,
  ranked: { chunk: RepositoryChunk; score: number }[],
  index: RepositoryIndex,
  maxChunks: number
) {
  const byId = new Map(index.chunks.map((chunk) => [chunk.id, chunk]));
  const selected = new Map<string, { chunk: RepositoryChunk; score: number; reason: string }>();

  for (const item of ranked.slice(0, maxChunks)) {
    selected.set(item.chunk.id, { ...item, reason: "semantic-match" });
  }

  const querySymbols = unique([...extractReferences(query), ...Object.keys(tokenize(query)).map(normalizeSymbol)]);
  for (const chunk of definitionChunksForSymbols(querySymbols, index, byId)) {
    if (selected.size >= maxChunks) break;
    selected.set(chunk.id, { chunk, score: 1, reason: "query-symbol-definition" });
  }

  for (const item of ranked.slice(0, Math.min(6, ranked.length))) {
    const relatedDefinitions = definitionChunksForSymbols(item.chunk.references, index, byId);
    for (const chunk of relatedDefinitions) {
      if (selected.size >= maxChunks) break;
      if (chunk.id === item.chunk.id) continue;
      selected.set(chunk.id, { chunk, score: Math.max(0.01, item.score * 0.82), reason: "referenced-symbol-definition" });
    }
    if (selected.size >= maxChunks) break;
  }

  return Array.from(selected.values()).slice(0, maxChunks);
}

export async function buildRepositoryContext(options: RepositoryContextOptions) {
  const root = workspaceRoot(options.rootUri);
  if (!root) return "";

  const maxFiles = options.maxFiles ?? 800;
  const maxChunks = options.maxChunks ?? 10;
  const maxChars = options.maxChars ?? 18_000;
  const index = await buildIndex(root, maxFiles, options.storageUri);
  const ranked = scoreChunks(options.query, index.chunks);
  const selected = expandWithSymbolGraph(options.query, ranked, index, Math.max(1, maxChunks * 2));
  if (selected.length === 0) return "";

  const parts = [
    [
      `Repository code-specific context (@Repository): selected relevant chunks from ${index.chunks.length} indexed AST/symbol chunks.`,
      `Index stats: ${index.stats?.indexedFiles ?? Object.keys(index.files).length} files indexed, ${index.stats?.reusedFiles ?? 0} reused, ${index.stats?.changedFiles ?? 0} changed, ${index.stats?.skippedFiles ?? 0} skipped, ${index.stats?.buildMs ?? 0}ms build/cache refresh.`,
      "Includes semantic matches plus symbol-graph definitions for referenced functions/classes/methods."
    ].join("\n")
  ];

  let included = 0;
  for (const { chunk, score, reason } of selected) {
    const block = [
      `--- ${chunk.path}:${chunk.startLine}-${chunk.endLine} (${chunk.language}, ${chunk.kind} ${chunk.qualifiedName}, parser ${chunk.parser}, reason ${reason}, score ${score.toFixed(3)}) ---`,
      chunk.text
    ].join("\n");
    const next = `${parts.join("\n\n")}\n\n${block}`;
    if (included >= Math.max(1, maxChunks) || next.length > maxChars) break;
    parts.push(block);
    included += 1;
  }

  const body = parts.join("\n\n");
  if (body.length <= maxChars) return body;
  return `${body.slice(0, Math.floor(maxChars * 0.65))}\n\n[...repository context truncated...]\n\n${body.slice(-Math.floor(maxChars * 0.35))}`;
}

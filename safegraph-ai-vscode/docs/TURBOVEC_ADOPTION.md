# Turbovec Adoption Notes

Source reviewed: <https://github.com/RyanCodrai/turbovec>

## Summary

`turbovec` is a Rust vector index with Python bindings built on TurboQuant. It is useful for dense vector retrieval, not for chat orchestration by itself.

For Safegraph AI, the relevant idea is to add an optional semantic vector retrieval layer beside the current repository RAG. The current Safegraph index is lexical/symbol-oriented; turbovec would help find code by semantic meaning, synonyms, and natural-language intent.

The product goal is not "more context." The goal is better selected context:

- Spend fewer prompt tokens.
- Understand a project faster from the smallest useful set of chunks.
- Let the model code from repository knowledge instead of broad guesses.
- Preserve local/private indexing for sensitive codebases.
- Reuse task-state filters so retrieval follows the current work, not the whole repo every turn.

## Why It Fits Safegraph AI

The repo advertises these properties that map well to a local coding agent:

- Local/private index: useful for repository code that should not leave the machine.
- Online ingest: files can be added without a separate train/rebuild step.
- Stable ids via `IdMapIndex`: useful for chunk ids that survive deletes and updates.
- Filtered search/allowlists: useful for narrowing retrieval by file path, language, changed files, active folder, or task scope.
- Compressed vectors: useful for large workspaces where an in-memory float32 embedding store would be too large.

## Where To Apply It

Best targets in Safegraph AI:

- Repository RAG in `src/context/repositoryIndex.ts`
- Long-lived memory retrieval
- Web/documentation bundle retrieval
- Context-scout subagent notes

The highest-value path is hybrid retrieval:

1. Use the existing lexical/symbol index to produce candidates.
2. Use turbovec dense vectors to retrieve or rerank semantically related chunks.
3. Apply filters from task state: changed files, tagged files, active folder, diagnostics, file extensions.
4. Return only compact snippets to the prompt.

This should reduce token waste in three places:

- Repository RAG: retrieve semantically relevant code instead of sending broad file lists and long chunks.
- Task continuation: query only chunks related to the active task state and changed files.
- Follow-up debugging: restrict search to failed verification output, touched files, and nearby symbols.

## Why Not Add It Directly Yet

Do not add turbovec as a hard dependency in the VS Code extension yet.

Reasons:

- Safegraph is TypeScript/Node; turbovec currently exposes Rust and Python APIs, not a Node API.
- Adding native binaries or Python wheels can make the VSIX larger and platform-specific.
- Semantic retrieval requires an embedding model. Turbovec stores/searches vectors; it does not generate embeddings.
- Bedrock embeddings would add network/API cost; local embeddings would add model/runtime complexity.

## Recommended Architecture

Add an optional sidecar/provider interface:

```text
Safegraph extension (TypeScript)
  -> VectorRagProvider interface
    -> lexical-symbol provider (current default)
    -> turbovec sidecar provider (optional)
```

The turbovec sidecar can be one of:

- Python process using `turbovec` package
- Rust binary wrapping the `turbovec` crate
- MCP server exposing vector index operations

Suggested provider methods:

```ts
type VectorRagProvider = {
  indexChunks(chunks: RepositoryChunk[]): Promise<void>;
  removeChunks(ids: string[]): Promise<void>;
  search(query: string, options: {
    k: number;
    allowIds?: string[];
    filters?: {
      paths?: string[];
      languages?: string[];
      changedOnly?: boolean;
    };
  }): Promise<Array<{ id: string; score: number }>>;
};
```

## Proposed Safegraph Settings

```json
{
  "safegraph.vectorRag.enabled": false,
  "safegraph.vectorRag.provider": "turbovec-sidecar",
  "safegraph.vectorRag.embeddingProvider": "bedrock",
  "safegraph.vectorRag.dim": 1536,
  "safegraph.vectorRag.bitWidth": 4,
  "safegraph.vectorRag.maxResults": 12
}
```

Keep it disabled by default until packaging, platform support, and embedding cost are understood.

## Implementation Plan

Phase 1: adapter only

- Add `VectorRagProvider` interface.
- Add no-op/default lexical provider.
- Add settings, but keep vector RAG disabled.
- No new native dependency.

Phase 2: optional sidecar

- Add sidecar protocol over JSON lines or MCP.
- Implement `index`, `remove`, `search`, `stats`.
- Store index files under VS Code `globalStorageUri`.

Phase 3: hybrid retrieval

- Keep current symbol/lexical retrieval.
- Use turbovec for semantic recall.
- Rerank using task state, diagnostics, changed files, active file, and path filters.
- Cache results per task to control token usage.

Phase 4: packaging

- Decide whether to ship prebuilt sidecar binaries, use Python optional install, or expose MCP-only integration.
- Keep VSIX size and platform support under control.

## Recommendation

Turbovec is worth adopting as an optional vector RAG backend, not as a core dependency today.

The safest next code step is to add the provider interface and configuration first, then build a sidecar proof of concept. This keeps Safegraph stable while opening a path to faster and more semantic retrieval for large repos.

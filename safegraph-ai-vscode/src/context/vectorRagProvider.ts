export type VectorRagChunk = {
  id: string;
  path: string;
  language: string;
  text: string;
  symbols?: string[];
  metadata?: Record<string, string | number | boolean>;
};

export type VectorRagSearchOptions = {
  k: number;
  allowIds?: string[];
  filters?: {
    paths?: string[];
    languages?: string[];
    changedOnly?: boolean;
  };
};

export type VectorRagSearchResult = {
  id: string;
  score: number;
  reason?: string;
};

export interface VectorRagProvider {
  readonly name: string;
  indexChunks(chunks: VectorRagChunk[]): Promise<void>;
  removeChunks(ids: string[]): Promise<void>;
  search(query: string, options: VectorRagSearchOptions): Promise<VectorRagSearchResult[]>;
  stats?(): Promise<Record<string, string | number | boolean>>;
}

export class DisabledVectorRagProvider implements VectorRagProvider {
  readonly name = "disabled";

  async indexChunks(_chunks: VectorRagChunk[]): Promise<void> {
    return;
  }

  async removeChunks(_ids: string[]): Promise<void> {
    return;
  }

  async search(_query: string, _options: VectorRagSearchOptions): Promise<VectorRagSearchResult[]> {
    return [];
  }

  async stats(): Promise<Record<string, string | number | boolean>> {
    return {
      enabled: false,
      provider: this.name
    };
  }
}

export function createVectorRagProvider(enabled: boolean): VectorRagProvider {
  if (!enabled) return new DisabledVectorRagProvider();

  // Placeholder for a future turbovec sidecar/MCP implementation. Keeping this
  // disabled by default avoids adding native Python/Rust dependencies to the VSIX.
  return new DisabledVectorRagProvider();
}

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface BuildArtifact {
  name: string;
  path: string;
  type: 'vsix' | 'tarball' | 'zip' | 'wheel' | 'other';
  size: number;
  hash?: string;
  timestamp: string;
}

export interface BuildConfig {
  name: string;
  version: string;
  outputDir: string;
  includePatterns?: string[];
  excludePatterns?: string[];
  scripts?: {
    prebuild?: string;
    build: string;
    postbuild?: string;
  };
}

/**
 * Builds release artifacts (VSIX, tarballs, wheels, etc.)
 */
export class ArtifactBuilder {
  private workspaceRoot: string;
  private config: BuildConfig;

  constructor(workspaceRoot: string, config: BuildConfig) {
    this.workspaceRoot = workspaceRoot;
    this.config = config;
  }

  /**
   * Calculate SHA256 hash of a file
   */
  private calculateHash(filePath: string): string {
    try {
      const output = execSync(`shasum -a 256 "${filePath}"`, {
        encoding: 'utf-8',
      });
      return output.split(' ')[0];
    } catch (error) {
      console.error(`Failed to calculate hash for ${filePath}:`, error);
      return '';
    }
  }

  /**
   * Run prebuild script if defined
   */
  private runPrebuild(): boolean {
    if (!this.config.scripts?.prebuild) {
      return true;
    }

    try {
      console.log(`🔨 Running prebuild: ${this.config.scripts.prebuild}`);
      execSync(this.config.scripts.prebuild, {
        cwd: this.workspaceRoot,
        stdio: 'inherit',
      });
      console.log('✅ Prebuild completed');
      return true;
    } catch (error) {
      console.error('❌ Prebuild failed:', error);
      return false;
    }
  }

  /**
   * Run main build script
   */
  private runBuild(): boolean {
    try {
      console.log(`🔨 Running build: ${this.config.scripts?.build}`);
      execSync(this.config.scripts?.build || '', {
        cwd: this.workspaceRoot,
        stdio: 'inherit',
      });
      console.log('✅ Build completed');
      return true;
    } catch (error) {
      console.error('❌ Build failed:', error);
      return false;
    }
  }

  /**
   * Run postbuild script if defined
   */
  private runPostbuild(): boolean {
    if (!this.config.scripts?.postbuild) {
      return true;
    }

    try {
      console.log(`🔨 Running postbuild: ${this.config.scripts.postbuild}`);
      execSync(this.config.scripts.postbuild, {
        cwd: this.workspaceRoot,
        stdio: 'inherit',
      });
      console.log('✅ Postbuild completed');
      return true;
    } catch (error) {
      console.error('❌ Postbuild failed:', error);
      return false;
    }
  }

  /**
   * Ensure output directory exists
   */
  private ensureOutputDir(): void {
    const outputPath = path.join(this.workspaceRoot, this.config.outputDir);
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
    }
  }

  /**
   * Collect built artifacts from output directory
   */
  private collectArtifacts(): BuildArtifact[] {
    const outputPath = path.join(this.workspaceRoot, this.config.outputDir);
    const artifacts: BuildArtifact[] = [];

    if (!fs.existsSync(outputPath)) {
      return artifacts;
    }

    const files = fs.readdirSync(outputPath);
    for (const file of files) {
      const filePath = path.join(outputPath, file);
      const stat = fs.statSync(filePath);

      if (stat.isFile()) {
        const ext = path.extname(file).toLowerCase();
        let type: BuildArtifact['type'] = 'other';

        if (ext === '.vsix') type = 'vsix';
        else if (ext === '.tar' || ext === '.gz') type = 'tarball';
        else if (ext === '.zip') type = 'zip';
        else if (ext === '.whl') type = 'wheel';

        artifacts.push({
          name: file,
          path: filePath,
          type,
          size: stat.size,
          hash: this.calculateHash(filePath),
          timestamp: new Date().toISOString(),
        });
      }
    }

    return artifacts;
  }

  /**
   * Execute full build pipeline
   */
  async build(): Promise<BuildArtifact[]> {
    console.log(`\n📦 Building artifacts for ${this.config.name} v${this.config.version}`);

    this.ensureOutputDir();

    if (!this.runPrebuild()) {
      throw new Error('Prebuild failed');
    }

    if (!this.runBuild()) {
      throw new Error('Build failed');
    }

    if (!this.runPostbuild()) {
      throw new Error('Postbuild failed');
    }

    const artifacts = this.collectArtifacts();
    console.log(`✅ Built ${artifacts.length} artifacts`);

    return artifacts;
  }
}

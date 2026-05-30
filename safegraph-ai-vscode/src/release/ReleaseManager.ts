import * as fs from 'fs';
import * as path from 'path';
import { ChangeDetector, ChangeSet } from './versioning/ChangeDetector';
import { VersionBumper, Version } from './versioning/VersionBumper';
import { ChangelogGenerator } from './versioning/ChangelogGenerator';
import { TagManager } from './versioning/TagManager';
import { ArtifactBuilder, BuildArtifact, BuildConfig } from './artifacts/ArtifactBuilder';
import { ArtifactSigner } from './artifacts/ArtifactSigner';
import { ArtifactUploader, UploadTarget } from './artifacts/ArtifactUploader';
import { ArtifactValidator } from './artifacts/ArtifactValidator';

export interface ReleaseConfig {
  workspaceRoot: string;
  buildConfig: BuildConfig;
  uploadTargets?: UploadTarget[];
  gpgKeyId?: string;
  skipSigning?: boolean;
  skipUpload?: boolean;
  dryRun?: boolean;
}

export interface ReleaseReport {
  version: string;
  previousVersion: string;
  changes: ChangeSet;
  artifacts: BuildArtifact[];
  validationPassed: boolean;
  uploadResults?: any[];
  timestamp: string;
  success: boolean;
  errors: string[];
}

/**
 * Orchestrates the complete release process
 * Coordinates: versioning, changelog, build, sign, validate, upload
 */
export class ReleaseManager {
  private config: ReleaseConfig;
  private changeDetector: ChangeDetector;
  private changelogGenerator: ChangelogGenerator;
  private tagManager: TagManager;
  private artifactValidator: ArtifactValidator;

  constructor(config: ReleaseConfig) {
    this.config = config;
    this.changeDetector = new ChangeDetector(config.workspaceRoot);
    this.changelogGenerator = new ChangelogGenerator(config.workspaceRoot);
    this.tagManager = new TagManager(config.workspaceRoot);
    this.artifactValidator = new ArtifactValidator();
  }

  /**
   * Get current version from package.json
   */
  private getCurrentVersion(): Version {
    const packageJsonPath = path.join(this.config.workspaceRoot, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    return VersionBumper.parseVersion(packageJson.version);
  }

  /**
   * Update version in package.json
   */
  private updatePackageVersion(version: Version): void {
    const packageJsonPath = path.join(this.config.workspaceRoot, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    packageJson.version = VersionBumper.toString(version);
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf-8');
    console.log(`✅ Updated package.json version to ${packageJson.version}`);
  }

  /**
   * Detect changes since last tag
   */
  private detectChanges(): ChangeSet {
    const latestTag = this.changeDetector.getLatestTag();
    if (!latestTag) {
      console.log('⚠️ No previous tags found, treating all commits as changes');
      return this.changeDetector.detectChanges('HEAD~100', 'HEAD');
    }

    console.log(`📊 Detecting changes since ${latestTag}`);
    return this.changeDetector.detectChanges(latestTag, 'HEAD');
  }

  /**
   * Determine next version based on changes
   */
  private determineNextVersion(currentVersion: Version, changes: ChangeSet): Version {
    const hasBreaking = changes.breaking.length > 0;
    const hasFeatures = changes.features.length > 0;
    const hasFixes = changes.fixes.length > 0;

    console.log(`\n📈 Version bump analysis:`);
    console.log(`   Breaking changes: ${changes.breaking.length}`);
    console.log(`   Features: ${changes.features.length}`);
    console.log(`   Fixes: ${changes.fixes.length}`);

    const nextVersion = VersionBumper.determineNextVersion(
      currentVersion,
      hasBreaking,
      hasFeatures,
      hasFixes
    );

    console.log(`   Current: ${VersionBumper.toString(currentVersion)}`);
    console.log(`   Next: ${VersionBumper.toString(nextVersion)}`);

    return nextVersion;
  }

  /**
   * Build artifacts
   */
  private async buildArtifacts(): Promise<BuildArtifact[]> {
    console.log(`\n🔨 Building artifacts...`);
    const builder = new ArtifactBuilder(this.config.workspaceRoot, this.config.buildConfig);
    return await builder.build();
  }

  /**
   * Validate artifacts
   */
  private validateArtifacts(artifacts: BuildArtifact[]): boolean {
    console.log(`\n✔️ Validating artifacts...`);
    const results = this.artifactValidator.validateArtifacts(artifacts);

    let allValid = true;
    for (const result of results) {
      if (result.valid) {
        console.log(`   ✅ ${result.artifact}`);
      } else {
        console.log(`   ❌ ${result.artifact}`);
        for (const error of result.errors) {
          console.log(`      - ${error}`);
        }
        allValid = false;
      }
    }

    return allValid;
  }

  /**
   * Sign artifacts
   */
  private signArtifacts(artifacts: BuildArtifact[]): void {
    if (this.config.skipSigning) {
      console.log(`\n⏭️ Skipping artifact signing`);
      return;
    }

    console.log(`\n🔐 Signing artifacts...`);
    const signer = new ArtifactSigner(this.config.workspaceRoot, this.config.gpgKeyId);
    signer.signArtifacts(artifacts);
  }

  /**
   * Upload artifacts
   */
  private async uploadArtifacts(artifacts: BuildArtifact[]): Promise<any[]> {
    if (this.config.skipUpload || !this.config.uploadTargets || this.config.uploadTargets.length === 0) {
      console.log(`\n⏭️ Skipping artifact upload`);
      return [];
    }

    console.log(`\n📤 Uploading artifacts...`);
    const uploader = new ArtifactUploader(this.config.uploadTargets);
    return await uploader.uploadArtifacts(artifacts);
  }

  /**
   * Create git tag
   */
  private createTag(version: Version): void {
    const versionString = VersionBumper.toString(version);
    const tagName = `v${versionString}`;
    const message = `Release ${versionString}`;

    console.log(`\n🏷️ Creating git tag: ${tagName}`);
    this.tagManager.createTag(tagName, message);
  }

  /**
   * Generate release report
   */
  private generateReport(
    nextVersion: Version,
    currentVersion: Version,
    changes: ChangeSet,
    artifacts: BuildArtifact[],
    validationPassed: boolean,
    uploadResults: any[],
    errors: string[]
  ): ReleaseReport {
    return {
      version: VersionBumper.toString(nextVersion),
      previousVersion: VersionBumper.toString(currentVersion),
      changes,
      artifacts,
      validationPassed,
      uploadResults,
      timestamp: new Date().toISOString(),
      success: errors.length === 0 && validationPassed,
      errors,
    };
  }

  /**
   * Execute full release process
   */
  async release(): Promise<ReleaseReport> {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 Starting Release Process`);
    console.log(`${'='.repeat(60)}\n`);

    const errors: string[] = [];
    const currentVersion = this.getCurrentVersion();

    try {
      // Step 1: Detect changes
      const changes = this.detectChanges();

      // Step 2: Determine next version
      const nextVersion = this.determineNextVersion(currentVersion, changes);

      // Step 3: Update version
      if (!this.config.dryRun) {
        this.updatePackageVersion(nextVersion);
      }

      // Step 4: Update changelog
      console.log(`\n📝 Updating CHANGELOG...`);
      this.changelogGenerator.updateChangelog(
        VersionBumper.toString(nextVersion),
        changes
      );

      // Step 5: Build artifacts
      const artifacts = await this.buildArtifacts();
      if (artifacts.length === 0) {
        errors.push('No artifacts were built');
      }

      // Step 6: Validate artifacts
      const validationPassed = this.validateArtifacts(artifacts);
      if (!validationPassed) {
        errors.push('Artifact validation failed');
      }

      // Step 7: Sign artifacts
      this.signArtifacts(artifacts);

      // Step 8: Create git tag
      if (!this.config.dryRun) {
        this.createTag(nextVersion);
      }

      // Step 9: Upload artifacts
      const uploadResults = await this.uploadArtifacts(artifacts);

      // Step 10: Generate report
      const report = this.generateReport(
        nextVersion,
        currentVersion,
        changes,
        artifacts,
        validationPassed,
        uploadResults,
        errors
      );

      console.log(`\n${'='.repeat(60)}`);
      if (report.success) {
        console.log(`✅ Release completed successfully!`);
      } else {
        console.log(`⚠️ Release completed with errors`);
      }
      console.log(`${'='.repeat(60)}\n`);

      return report;
    } catch (error) {
      errors.push(String(error));
      return this.generateReport(
        currentVersion,
        currentVersion,
        { breaking: [], features: [], fixes: [], other: [] },
        [],
        false,
        [],
        errors
      );
    }
  }
}

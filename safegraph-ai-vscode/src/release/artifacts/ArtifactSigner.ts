import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { BuildArtifact } from './ArtifactBuilder';

export interface SignatureInfo {
  artifactPath: string;
  signaturePath: string;
  algorithm: 'sha256' | 'gpg' | 'rsa';
  timestamp: string;
  verified: boolean;
}

/**
 * Signs artifacts using GPG or RSA keys
 * Generates .sig files for verification
 */
export class ArtifactSigner {
  private workspaceRoot: string;
  private gpgKeyId?: string;

  constructor(workspaceRoot: string, gpgKeyId?: string) {
    this.workspaceRoot = workspaceRoot;
    this.gpgKeyId = gpgKeyId;
  }

  /**
   * Check if GPG is available
   */
  private isGpgAvailable(): boolean {
    try {
      execSync('which gpg', { encoding: 'utf-8' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Sign artifact with GPG
   */
  signWithGpg(artifactPath: string): SignatureInfo | null {
    if (!this.isGpgAvailable()) {
      console.warn('⚠️ GPG not available, skipping GPG signature');
      return null;
    }

    try {
      const signaturePath = `${artifactPath}.sig`;
      const command = this.gpgKeyId
        ? `gpg --default-key ${this.gpgKeyId} --detach-sign --armor "${artifactPath}"`
        : `gpg --detach-sign --armor "${artifactPath}"`;

      execSync(command, { encoding: 'utf-8' });

      if (!fs.existsSync(signaturePath)) {
        console.error(`❌ Signature file not created: ${signaturePath}`);
        return null;
      }

      console.log(`✅ GPG signature created: ${signaturePath}`);

      return {
        artifactPath,
        signaturePath,
        algorithm: 'gpg',
        timestamp: new Date().toISOString(),
        verified: true,
      };
    } catch (error) {
      console.error(`❌ GPG signing failed for ${artifactPath}:`, error);
      return null;
    }
  }

  /**
   * Generate SHA256 checksum file
   */
  generateChecksum(artifactPath: string): SignatureInfo | null {
    try {
      const checksumPath = `${artifactPath}.sha256`;
      const output = execSync(`shasum -a 256 "${artifactPath}"`, {
        encoding: 'utf-8',
      });

      fs.writeFileSync(checksumPath, output, 'utf-8');
      console.log(`✅ SHA256 checksum created: ${checksumPath}`);

      return {
        artifactPath,
        signaturePath: checksumPath,
        algorithm: 'sha256',
        timestamp: new Date().toISOString(),
        verified: true,
      };
    } catch (error) {
      console.error(`❌ Checksum generation failed for ${artifactPath}:`, error);
      return null;
    }
  }

  /**
   * Sign multiple artifacts
   */
  signArtifacts(artifacts: BuildArtifact[]): SignatureInfo[] {
    const signatures: SignatureInfo[] = [];

    for (const artifact of artifacts) {
      console.log(`\n🔐 Signing artifact: ${artifact.name}`);

      // Always generate SHA256 checksum
      const checksumInfo = this.generateChecksum(artifact.path);
      if (checksumInfo) {
        signatures.push(checksumInfo);
      }

      // Generate GPG signature if available
      const gpgInfo = this.signWithGpg(artifact.path);
      if (gpgInfo) {
        signatures.push(gpgInfo);
      }
    }

    return signatures;
  }

  /**
   * Verify artifact signature
   */
  verifySignature(artifactPath: string, signaturePath: string): boolean {
    try {
      execSync(`gpg --verify "${signaturePath}" "${artifactPath}"`, {
        encoding: 'utf-8',
      });
      return true;
    } catch (error) {
      console.error(`❌ Signature verification failed:`, error);
      return false;
    }
  }
}

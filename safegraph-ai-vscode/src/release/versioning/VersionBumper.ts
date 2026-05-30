/**
 * Semantic Versioning: MAJOR.MINOR.PATCH
 * - MAJOR: breaking changes
 * - MINOR: new features (backward compatible)
 * - PATCH: bug fixes (backward compatible)
 */

export interface Version {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string; // e.g., "alpha", "beta", "rc.1"
  metadata?: string;   // e.g., "build.123"
}

export class VersionBumper {
  /**
   * Parse version string to Version object
   * Supports: 1.2.3, 1.2.3-alpha, 1.2.3-alpha.1, 1.2.3+build.123, 1.2.3-alpha+build.123
   */
  static parseVersion(versionString: string): Version {
    const cleanVersion = versionString.replace(/^v/, ''); // Remove leading 'v'
    
    // Split metadata (after +)
    const [versionPart, metadata] = cleanVersion.split('+');
    
    // Split prerelease (after -)
    const [numericPart, prerelease] = versionPart.split('-');
    
    // Parse major.minor.patch
    const [major, minor, patch] = numericPart.split('.').map(Number);

    return {
      major: major || 0,
      minor: minor || 0,
      patch: patch || 0,
      prerelease: prerelease || undefined,
      metadata: metadata || undefined,
    };
  }

  /**
   * Convert Version object to string
   */
  static toString(version: Version): string {
    let result = `${version.major}.${version.minor}.${version.patch}`;
    if (version.prerelease) {
      result += `-${version.prerelease}`;
    }
    if (version.metadata) {
      result += `+${version.metadata}`;
    }
    return result;
  }

  /**
   * Bump MAJOR version (breaking changes)
   */
  static bumpMajor(version: Version): Version {
    return {
      major: version.major + 1,
      minor: 0,
      patch: 0,
    };
  }

  /**
   * Bump MINOR version (new features)
   */
  static bumpMinor(version: Version): Version {
    return {
      major: version.major,
      minor: version.minor + 1,
      patch: 0,
    };
  }

  /**
   * Bump PATCH version (bug fixes)
   */
  static bumpPatch(version: Version): Version {
    return {
      major: version.major,
      minor: version.minor,
      patch: version.patch + 1,
    };
  }

  /**
   * Determine next version based on changes
   * - If breaking changes: bump MAJOR
   * - Else if features: bump MINOR
   * - Else if fixes: bump PATCH
   * - Else: no change
   */
  static determineNextVersion(
    currentVersion: Version,
    hasBreakingChanges: boolean,
    hasFeatures: boolean,
    hasFixes: boolean
  ): Version {
    if (hasBreakingChanges) {
      return this.bumpMajor(currentVersion);
    }
    if (hasFeatures) {
      return this.bumpMinor(currentVersion);
    }
    if (hasFixes) {
      return this.bumpPatch(currentVersion);
    }
    return currentVersion;
  }
}

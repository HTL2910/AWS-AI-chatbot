/**
 * Artifact Store
 * Persistent storage for artifacts
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Artifact, ArtifactType } from './ArtifactTypes';

export class ArtifactStore {
  private static readonly STORAGE_KEY = 'safegraph.artifacts';
  private artifacts: Map<string, Artifact> = new Map();
  private context: vscode.ExtensionContext;
  private storagePath: string;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.storagePath = path.join(context.globalStorageUri.fsPath, 'artifacts');
    this.ensureStorageDirectory();
    this.loadArtifacts();
  }

  private ensureStorageDirectory(): void {
    try {
      if (!fs.existsSync(this.storagePath)) {
        fs.mkdirSync(this.storagePath, { recursive: true });
      }
    } catch (error) {
      console.error('[ArtifactStore] Failed to create storage directory:', error);
    }
  }

  private loadArtifacts(): void {
    try {
      const stored = this.context.globalState.get<Record<string, Artifact>>(
        ArtifactStore.STORAGE_KEY,
        {}
      );
      this.artifacts = new Map(Object.entries(stored));
    } catch (error) {
      console.error('[ArtifactStore] Failed to load artifacts:', error);
    }
  }

  private async saveArtifacts(): Promise<void> {
    try {
      const obj = Object.fromEntries(this.artifacts);
      await this.context.globalState.update(ArtifactStore.STORAGE_KEY, obj);
    } catch (error) {
      console.error('[ArtifactStore] Failed to save artifacts:', error);
    }
  }

  public async createArtifact(
    type: ArtifactType,
    taskId: string,
    agentId: string,
    title: string,
    description: string,
    content: any,
    metadata?: any
  ): Promise<Artifact> {
    const artifact: Artifact = {
      id: this.generateArtifactId(),
      type,
      taskId,
      agentId,
      title,
      description,
      content,
      metadata: metadata || {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'draft',
      feedback: []
    };

    // Save binary content to disk if applicable
    if (this.isBinaryArtifact(type)) {
      await this.saveBinaryContent(artifact);
    }

    this.artifacts.set(artifact.id, artifact);
    await this.saveArtifacts();

    return artifact;
  }

  public async updateArtifact(
    artifactId: string,
    updates: Partial<Artifact>
  ): Promise<Artifact | null> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) return null;

    const updated = {
      ...artifact,
      ...updates,
      updatedAt: Date.now()
    };

    // Save binary content if updated
    if (updates.content && this.isBinaryArtifact(updated.type)) {
      await this.saveBinaryContent(updated);
    }

    this.artifacts.set(artifactId, updated);
    await this.saveArtifacts();

    return updated;
  }

  public getArtifact(artifactId: string): Artifact | undefined {
    return this.artifacts.get(artifactId);
  }

  public getArtifactsByTask(taskId: string): Artifact[] {
    return Array.from(this.artifacts.values()).filter(a => a.taskId === taskId);
  }

  public getArtifactsByAgent(agentId: string): Artifact[] {
    return Array.from(this.artifacts.values()).filter(a => a.agentId === agentId);
  }

  public getArtifactsByType(type: ArtifactType): Artifact[] {
    return Array.from(this.artifacts.values()).filter(a => a.type === type);
  }

  public getArtifactsByStatus(status: Artifact['status']): Artifact[] {
    return Array.from(this.artifacts.values()).filter(a => a.status === status);
  }

  public getAllArtifacts(): Artifact[] {
    return Array.from(this.artifacts.values());
  }

  public async deleteArtifact(artifactId: string): Promise<boolean> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) return false;

    // Delete binary content if exists
    if (this.isBinaryArtifact(artifact.type)) {
      await this.deleteBinaryContent(artifact);
    }

    this.artifacts.delete(artifactId);
    await this.saveArtifacts();

    return true;
  }

  public async addFeedback(
    artifactId: string,
    userId: string,
    comment: string
  ): Promise<Artifact | null> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) return null;

    const feedback = {
      id: this.generateFeedbackId(),
      userId,
      comment,
      timestamp: Date.now(),
      resolved: false
    };

    artifact.feedback = artifact.feedback || [];
    artifact.feedback.push(feedback);
    artifact.status = 'pending_review';
    artifact.updatedAt = Date.now();

    this.artifacts.set(artifactId, artifact);
    await this.saveArtifacts();

    return artifact;
  }

  public async resolveFeedback(
    artifactId: string,
    feedbackId: string
  ): Promise<Artifact | null> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact || !artifact.feedback) return null;

    const feedback = artifact.feedback.find(f => f.id === feedbackId);
    if (feedback) {
      feedback.resolved = true;
      artifact.updatedAt = Date.now();
    }

    this.artifacts.set(artifactId, artifact);
    await this.saveArtifacts();

    return artifact;
  }

  public async approveArtifact(artifactId: string): Promise<Artifact | null> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) return null;

    artifact.status = 'approved';
    artifact.updatedAt = Date.now();

    this.artifacts.set(artifactId, artifact);
    await this.saveArtifacts();

    return artifact;
  }

  public async rejectArtifact(artifactId: string): Promise<Artifact | null> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) return null;

    artifact.status = 'rejected';
    artifact.updatedAt = Date.now();

    this.artifacts.set(artifactId, artifact);
    await this.saveArtifacts();

    return artifact;
  }

  private isBinaryArtifact(type: ArtifactType): boolean {
    return type === 'screenshot' || type === 'recording';
  }

  private async saveBinaryContent(artifact: Artifact): Promise<void> {
    if (!artifact.content || !artifact.content.path) return;

    try {
      const sourcePath = artifact.content.path;
      const destPath = path.join(this.storagePath, `${artifact.id}${path.extname(sourcePath)}`);
      
      if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, destPath);
        artifact.content.path = destPath;
      }
    } catch (error) {
      console.error('[ArtifactStore] Failed to save binary content:', error);
    }
  }

  private async deleteBinaryContent(artifact: Artifact): Promise<void> {
    if (!artifact.content || !artifact.content.path) return;

    try {
      if (fs.existsSync(artifact.content.path)) {
        fs.unlinkSync(artifact.content.path);
      }
    } catch (error) {
      console.error('[ArtifactStore] Failed to delete binary content:', error);
    }
  }

  private generateArtifactId(): string {
    return `artifact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateFeedbackId(): string {
    return `feedback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  public getStoragePath(): string {
    return this.storagePath;
  }
}

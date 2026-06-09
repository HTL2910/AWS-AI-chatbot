/**
 * Notification Manager
 * Send notifications for task completion and events
 */

import * as vscode from 'vscode';
import { EventEmitter } from 'events';

export interface Notification {
  id: string;
  type: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
  actions?: NotificationAction[];
  timestamp: number;
  read: boolean;
}

export interface NotificationAction {
  label: string;
  action: string;
}

export class NotificationManager extends EventEmitter {
  private notifications: Notification[] = [];
  private output: vscode.OutputChannel;

  constructor(output: vscode.OutputChannel) {
    super();
    this.output = output;
  }

  public notify(
    type: Notification['type'],
    title: string,
    message: string,
    actions?: NotificationAction[]
  ): string {
    const notification: Notification = {
      id: this.generateNotificationId(),
      type,
      title,
      message,
      actions,
      timestamp: Date.now(),
      read: false
    };

    this.notifications.push(notification);
    this.emit('notification', notification);
    this.showNotification(notification);
    this.output.appendLine(`[NotificationManager] ${type.toUpperCase()}: ${title} - ${message}`);

    return notification.id;
  }

  private showNotification(notification: Notification): void {
    let message: string;

    switch (notification.type) {
      case 'info':
        message = `ℹ️ ${notification.title}: ${notification.message}`;
        vscode.window.showInformationMessage(message);
        break;
      case 'warning':
        message = `⚠️ ${notification.title}: ${notification.message}`;
        vscode.window.showWarningMessage(message);
        break;
      case 'error':
        message = `❌ ${notification.title}: ${notification.message}`;
        vscode.window.showErrorMessage(message);
        break;
      case 'success':
        message = `✅ ${notification.title}: ${notification.message}`;
        vscode.window.showInformationMessage(message);
        break;
    }

    // Show with actions if available
    if (notification.actions && notification.actions.length > 0) {
      const buttons = notification.actions.map(a => a.label);
      vscode.window
        .showInformationMessage(`${notification.title}: ${notification.message}`, ...buttons)
        .then(selection => {
          if (selection) {
            const action = notification.actions!.find(a => a.label === selection);
            if (action) {
              this.emit('actionTriggered', {
                notificationId: notification.id,
                action: action.action
              });
            }
          }
        });
    }
  }

  public markAsRead(notificationId: string): void {
    const notification = this.notifications.find(n => n.id === notificationId);
    if (notification) {
      notification.read = true;
      this.emit('notificationRead', notification);
    }
  }

  public markAllAsRead(): void {
    for (const notification of this.notifications) {
      notification.read = true;
    }
    this.emit('allNotificationsRead');
  }

  public getNotification(notificationId: string): Notification | undefined {
    return this.notifications.find(n => n.id === notificationId);
  }

  public getUnreadNotifications(): Notification[] {
    return this.notifications.filter(n => !n.read);
  }

  public getAllNotifications(): Notification[] {
    return [...this.notifications].sort((a, b) => b.timestamp - a.timestamp);
  }

  public getNotificationsByType(type: Notification['type']): Notification[] {
    return this.notifications.filter(n => n.type === type);
  }

  public deleteNotification(notificationId: string): boolean {
    const index = this.notifications.findIndex(n => n.id === notificationId);
    if (index !== -1) {
      const notification = this.notifications.splice(index, 1)[0];
      this.emit('notificationDeleted', notification);
      return true;
    }
    return false;
  }

  public clearOldNotifications(maxAge: number = 86400000): number {
    const now = Date.now();
    const initialCount = this.notifications.length;
    
    this.notifications = this.notifications.filter(
      n => now - n.timestamp < maxAge
    );

    const deletedCount = initialCount - this.notifications.length;
    if (deletedCount > 0) {
      this.emit('oldNotificationsCleared', deletedCount);
    }

    return deletedCount;
  }

  public clearAllNotifications(): void {
    this.notifications = [];
    this.emit('allNotificationsCleared');
  }

  private generateNotificationId(): string {
    return `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  public notifyTaskCompleted(taskId: string, title: string): void {
    this.notify('success', 'Task Completed', `${title} has been completed successfully.`, [
      { label: 'View Details', action: 'view_task_details' },
      { label: 'Dismiss', action: 'dismiss' }
    ]);
  }

  public notifyTaskFailed(taskId: string, title: string, error: string): void {
    this.notify('error', 'Task Failed', `${title} failed: ${error}`, [
      { label: 'View Error', action: 'view_error' },
      { label: 'Retry', action: 'retry_task' },
      { label: 'Dismiss', action: 'dismiss' }
    ]);
  }

  public notifyAgentStatus(agentId: string, status: string): void {
    this.notify('info', 'Agent Status Update', `Agent ${agentId} is now ${status}`);
  }

  public notifyArtifactGenerated(artifactId: string, title: string): void {
    this.notify('info', 'Artifact Generated', `${title} has been generated and is ready for review.`, [
      { label: 'View Artifact', action: 'view_artifact' },
      { label: 'Dismiss', action: 'dismiss' }
    ]);
  }
}

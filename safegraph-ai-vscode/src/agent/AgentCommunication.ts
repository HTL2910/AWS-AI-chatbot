/**
 * Agent Communication
 * Inter-agent messaging system
 */

import { EventEmitter } from 'events';
import { AgentMessage, AgentType } from './AgentTypes';

export class AgentCommunication extends EventEmitter {
  private messageQueue: Map<string, AgentMessage[]> = new Map();
  private correlationMap: Map<string, AgentMessage[]> = new Map();

  constructor() {
    super();
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.on('message', this.handleMessage.bind(this));
  }

  private handleMessage(message: AgentMessage): void {
    // Store message in correlation map if it has a correlation ID
    if (message.correlationId) {
      if (!this.correlationMap.has(message.correlationId)) {
        this.correlationMap.set(message.correlationId, []);
      }
      this.correlationMap.get(message.correlationId)!.push(message);
    }

    // Add to recipient's queue
    if (!this.messageQueue.has(message.to)) {
      this.messageQueue.set(message.to, []);
    }
    this.messageQueue.get(message.to)!.push(message);
  }

  sendMessage(from: string, to: string, type: AgentMessage['type'], content: any, correlationId?: string): void {
    const message: AgentMessage = {
      from,
      to,
      type,
      content,
      timestamp: Date.now(),
      correlationId
    };

    this.emit('message', message);
  }

  sendRequest(from: string, to: string, content: any): string {
    const correlationId = this.generateCorrelationId();
    this.sendMessage(from, to, 'request', content, correlationId);
    return correlationId;
  }

  sendResponse(from: string, to: string, content: any, correlationId: string): void {
    this.sendMessage(from, to, 'response', content, correlationId);
  }

  sendNotification(from: string, to: string, content: any): void {
    this.sendMessage(from, to, 'notification', content);
  }

  sendError(from: string, to: string, error: Error, correlationId?: string): void {
    this.sendMessage(from, to, 'error', {
      message: error.message,
      stack: error.stack,
      name: error.name
    }, correlationId);
  }

  getMessages(agentId: string): AgentMessage[] {
    return this.messageQueue.get(agentId) || [];
  }

  consumeMessages(agentId: string): AgentMessage[] {
    const messages = this.getMessages(agentId);
    this.messageQueue.set(agentId, []);
    return messages;
  }

  getCorrelatedMessages(correlationId: string): AgentMessage[] {
    return this.correlationMap.get(correlationId) || [];
  }

  waitForResponse(correlationId: string, timeout: number = 30000): Promise<AgentMessage> {
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        const messages = this.getCorrelatedMessages(correlationId);
        const response = messages.find(m => m.type === 'response');
        
        if (response) {
          clearInterval(checkInterval);
          resolve(response);
        }
      }, 100);

      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error(`Timeout waiting for response with correlation ID: ${correlationId}`));
      }, timeout);
    });
  }

  private generateCorrelationId(): string {
    return `corr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  clearQueue(agentId: string): void {
    this.messageQueue.delete(agentId);
  }

  clearCorrelation(correlationId: string): void {
    this.correlationMap.delete(correlationId);
  }
}

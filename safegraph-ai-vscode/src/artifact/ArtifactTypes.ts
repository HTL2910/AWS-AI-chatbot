/**
 * Artifact Type Definitions
 * Defines various artifact types for verification
 */

export type ArtifactType = 
  | 'task_list'
  | 'implementation_plan'
  | 'screenshot'
  | 'recording'
  | 'test_report'
  | 'code_review'
  | 'architecture_diagram'
  | 'diff_summary'
  | 'execution_log'
  | 'user_feedback';

export interface Artifact {
  id: string;
  type: ArtifactType;
  taskId: string;
  agentId: string;
  title: string;
  description: string;
  content: any;
  metadata: ArtifactMetadata;
  createdAt: number;
  updatedAt: number;
  status: 'draft' | 'pending_review' | 'approved' | 'rejected' | 'archived';
  feedback?: ArtifactFeedback[];
}

export interface ArtifactMetadata {
  mimeType?: string;
  size?: number;
  format?: string;
  language?: string;
  tags?: string[];
  relatedArtifacts?: string[];
  checksum?: string;
}

export interface ArtifactFeedback {
  id: string;
  userId: string;
  comment: string;
  timestamp: number;
  resolved: boolean;
}

export interface TaskListArtifact {
  tasks: {
    id: string;
    description: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    priority: number;
    estimatedDuration?: number;
    dependencies?: string[];
  }[];
  summary: string;
  totalEstimatedDuration?: number;
}

export interface ImplementationPlanArtifact {
  phases: {
    id: string;
    name: string;
    description: string;
    tasks: string[];
    dependencies?: string[];
  }[];
  risks: {
    description: string;
    severity: 'low' | 'medium' | 'high';
    mitigation: string;
  }[];
  assumptions: string[];
  successCriteria: string[];
}

export interface ScreenshotArtifact {
  path: string;
  description: string;
  timestamp: number;
  viewport?: {
    width: number;
    height: number;
  };
  url?: string;
}

export interface RecordingArtifact {
  path: string;
  description: string;
  duration: number;
  format: 'webm' | 'mp4' | 'gif';
  timestamp: number;
  thumbnail?: string;
}

export interface TestReportArtifact {
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
  };
  tests: {
    name: string;
    status: 'passed' | 'failed' | 'skipped';
    duration: number;
    error?: string;
  }[];
  coverage?: {
    lines: number;
    functions: number;
    branches: number;
    statements: number;
  };
}

export interface CodeReviewArtifact {
  summary: string;
  overallRating: 'excellent' | 'good' | 'fair' | 'poor';
  findings: {
    type: 'security' | 'performance' | 'style' | 'bug' | 'suggestion';
    severity: 'critical' | 'high' | 'medium' | 'low';
    file: string;
    line?: number;
    description: string;
    suggestion?: string;
  }[];
  metrics: {
    complexity: number;
    maintainability: number;
    testCoverage: number;
    duplication: number;
  };
}

export interface ArchitectureDiagramArtifact {
  type: 'component' | 'sequence' | 'flow' | 'deployment';
  format: 'mermaid' | 'plantuml' | 'svg';
  content: string;
  description: string;
  components: {
    id: string;
    name: string;
    type: string;
    responsibilities: string[];
  }[];
}

export interface DiffSummaryArtifact {
  summary: string;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  changes: {
    file: string;
    type: 'added' | 'modified' | 'deleted';
    additions: number;
    deletions: number;
  }[];
  riskAssessment: 'low' | 'medium' | 'high';
}

export interface ExecutionLogArtifact {
  command: string;
  exitCode: number;
  output: string;
  error?: string;
  duration: number;
  timestamp: number;
  workingDirectory: string;
}

export const ARTifact_TEMPLATES: Record<ArtifactType, Partial<Artifact>> = {
  task_list: {
    type: 'task_list',
    title: 'Task List',
    description: 'Breakdown of tasks to be completed'
  },
  implementation_plan: {
    type: 'implementation_plan',
    title: 'Implementation Plan',
    description: 'Detailed plan for implementation'
  },
  screenshot: {
    type: 'screenshot',
    title: 'Screenshot',
    description: 'Visual capture of application state'
  },
  recording: {
    type: 'recording',
    title: 'Screen Recording',
    description: 'Recording of application behavior'
  },
  test_report: {
    type: 'test_report',
    title: 'Test Report',
    description: 'Summary of test execution results'
  },
  code_review: {
    type: 'code_review',
    title: 'Code Review',
    description: 'Review of code quality and issues'
  },
  architecture_diagram: {
    type: 'architecture_diagram',
    title: 'Architecture Diagram',
    description: 'Visual representation of system architecture'
  },
  diff_summary: {
    type: 'diff_summary',
    title: 'Diff Summary',
    description: 'Summary of code changes'
  },
  execution_log: {
    type: 'execution_log',
    title: 'Execution Log',
    description: 'Log of command execution'
  },
  user_feedback: {
    type: 'user_feedback',
    title: 'User Feedback',
    description: 'Feedback from user review'
  }
};

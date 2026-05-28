/**
 * Mode Manager - Detect and manage development modes
 */

import { ModeType, ModeConfig, ModeContext, ModeDetectionResult, ModeManager as IModeManager } from '../types/Mode';

export class ModeManager implements IModeManager {
  private currentMode: ModeType = ModeType.CODE;
  private modeConfigs: Map<ModeType, ModeConfig> = new Map();

  constructor() {
    this.initializeModes();
  }

  private initializeModes(): void {
    // Code Mode
    this.modeConfigs.set(ModeType.CODE, {
      type: ModeType.CODE,
      name: 'Code',
      description: 'Analyze, refactor, and optimize code',
      icon: '💻',
      color: '#007ACC',
      tools: ['code_analyzer_v1', 'file_manager_v1', 'diff_applier_v1'],
      defaultTimeout: 30000,
      requiresApproval: true,
      contextDetectors: ['detectCodeFile', 'detectProgrammingLanguage'],
    });

    // Web Research Mode
    this.modeConfigs.set(ModeType.WEB_RESEARCH, {
      type: ModeType.WEB_RESEARCH,
      name: 'Web Research',
      description: 'Fetch and analyze web documentation',
      icon: '🔍',
      color: '#0078D4',
      tools: ['web_research_v1'],
      defaultTimeout: 45000,
      requiresApproval: false,
      contextDetectors: ['detectResearchRequest', 'detectDocumentationUrl'],
    });

    // Docs Mode
    this.modeConfigs.set(ModeType.DOCS, {
      type: ModeType.DOCS,
      name: 'Docs',
      description: 'Generate and update documentation',
      icon: '📚',
      color: '#107C10',
      tools: ['file_manager_v1', 'code_analyzer_v1'],
      defaultTimeout: 20000,
      requiresApproval: false,
      contextDetectors: ['detectDocRequest', 'detectReadmeFile'],
    });

    // Debug Mode
    this.modeConfigs.set(ModeType.DEBUG, {
      type: ModeType.DEBUG,
      name: 'Debug',
      description: 'Analyze and fix errors',
      icon: '🐛',
      color: '#E81123',
      tools: ['code_analyzer_v1', 'terminal_executor_v1', 'diff_applier_v1'],
      defaultTimeout: 60000,
      requiresApproval: true,
      contextDetectors: ['detectErrorMessage', 'detectFailedTest', 'detectStackTrace'],
    });

    // UI Design Mode
    this.modeConfigs.set(ModeType.UI_DESIGN, {
      type: ModeType.UI_DESIGN,
      name: 'UI Design',
      description: 'Create UI mockups and components',
      icon: '🎨',
      color: '#FFB900',
      tools: ['file_manager_v1', 'code_analyzer_v1'],
      defaultTimeout: 25000,
      requiresApproval: false,
      contextDetectors: ['detectUIRequest', 'detectHTMLFile', 'detectReactComponent'],
    });

    // Review Mode
    this.modeConfigs.set(ModeType.REVIEW, {
      type: ModeType.REVIEW,
      name: 'Review',
      description: 'Code review, security audit, performance analysis',
      icon: '✅',
      color: '#107C10',
      tools: ['code_analyzer_v1'],
      defaultTimeout: 40000,
      requiresApproval: false,
      contextDetectors: ['detectReviewRequest', 'detectPullRequest'],
    });
  }

  getCurrentMode(): ModeType {
    return this.currentMode;
  }

  setMode(mode: ModeType): void {
    if (this.modeConfigs.has(mode)) {
      this.currentMode = mode;
    }
  }

  detectMode(context: ModeContext): ModeDetectionResult {
    const scores: Map<ModeType, { score: number; reasons: string[] }> = new Map();

    // Initialize scores
    for (const mode of this.modeConfigs.keys()) {
      scores.set(mode, { score: 0, reasons: [] });
    }

    // Detect based on file type
    if (context.activeFile) {
      const ext = context.activeFile.split('.').pop()?.toLowerCase();
      if (['ts', 'tsx', 'js', 'jsx', 'py', 'java', 'go', 'rs'].includes(ext || '')) {
        const codeScore = scores.get(ModeType.CODE)!;
        codeScore.score += 30;
        codeScore.reasons.push(`Programming file detected: .${ext}`);
      }
      if (['html', 'css', 'scss', 'vue', 'svelte'].includes(ext || '')) {
        const uiScore = scores.get(ModeType.UI_DESIGN)!;
        uiScore.score += 35;
        uiScore.reasons.push(`UI file detected: .${ext}`);
      }
      if (['md', 'txt', 'rst'].includes(ext || '')) {
        const docsScore = scores.get(ModeType.DOCS)!;
        docsScore.score += 30;
        docsScore.reasons.push(`Documentation file detected: .${ext}`);
      }
    }

    // Detect based on user intent
    if (context.userIntent) {
      const intent = context.userIntent.toLowerCase();
      if (intent.includes('refactor') || intent.includes('optimize') || intent.includes('analyze')) {
        const codeScore = scores.get(ModeType.CODE)!;
        codeScore.score += 25;
        codeScore.reasons.push('Code analysis intent detected');
      }
      if (intent.includes('research') || intent.includes('documentation') || intent.includes('fetch')) {
        const researchScore = scores.get(ModeType.WEB_RESEARCH)!;
        researchScore.score += 25;
        researchScore.reasons.push('Research intent detected');
      }
      if (intent.includes('debug') || intent.includes('fix') || intent.includes('error')) {
        const debugScore = scores.get(ModeType.DEBUG)!;
        debugScore.score += 30;
        debugScore.reasons.push('Debug intent detected');
      }
      if (intent.includes('ui') || intent.includes('design') || intent.includes('mockup')) {
        const uiScore = scores.get(ModeType.UI_DESIGN)!;
        uiScore.score += 30;
        uiScore.reasons.push('UI design intent detected');
      }
      if (intent.includes('review') || intent.includes('audit') || intent.includes('security')) {
        const reviewScore = scores.get(ModeType.REVIEW)!;
        reviewScore.score += 30;
        reviewScore.reasons.push('Review intent detected');
      }
      if (intent.includes('document') || intent.includes('readme') || intent.includes('guide')) {
        const docsScore = scores.get(ModeType.DOCS)!;
        docsScore.score += 25;
        docsScore.reasons.push('Documentation intent detected');
      }
    }

    // Find best match
    let bestMode = ModeType.CODE;
    let bestScore = 0;
    const alternatives: { mode: ModeType; confidence: number }[] = [];

    for (const [mode, data] of scores) {
      if (data.score > bestScore) {
        bestScore = data.score;
        bestMode = mode;
      }
      if (data.score > 0) {
        alternatives.push({ mode, confidence: Math.min(data.score / 100, 1) });
      }
    }

    const confidence = Math.min(bestScore / 100, 1);
    const reasons = scores.get(bestMode)?.reasons || [];

    return {
      detectedMode: bestMode,
      confidence,
      reasons,
      alternativeModes: alternatives.filter(a => a.mode !== bestMode).sort((a, b) => b.confidence - a.confidence),
    };
  }

  getConfig(mode: ModeType): ModeConfig {
    return this.modeConfigs.get(mode) || this.modeConfigs.get(ModeType.CODE)!;
  }

  getAllModes(): ModeConfig[] {
    return Array.from(this.modeConfigs.values());
  }

  isAvailableTool(toolId: string, mode: ModeType): boolean {
    const config = this.modeConfigs.get(mode);
    return config ? config.tools.includes(toolId) : false;
  }
}

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stdin } from 'bun';

type StopHookInput = {
  conversation_id: string;
  generation_id: string;
  status: 'completed' | 'aborted' | 'error';
  loop_count: number;
};

type StopHookOutput = {
  followup_message?: string;
};

type ArchitectureViolation = {
  type: 'structure' | 'state-boundary' | 'separation' | 'isolation' | 'dependency' | 'api';
  severity: 'high' | 'medium' | 'low';
  filePath: string;
  description: string;
  suggestion: string;
  expectedLocation?: string;
};

type AnalysisResult = {
  generation_id: string;
  edited_files: string[];
  feature_id: string | null;
  feature_name: string | null;
  translation_duplicates: Array<{
    keys: string[];
    en_value: string;
    zh_value: string;
    suggested_location: string;
  }>;
  modularity_issues: string[];
  consistency_issues: string[];
  architecture_violations?: ArchitectureViolation[];
  feature_metrics: any | null;
  simplification_opportunities: any[];
  suggestions: string;
};

type QueueFeature = {
  id: string;
  name: string;
  files: string[];
  status: string;
  priority: number;
  lastAnalyzed: string | null;
  metrics: any;
};

type RefactorQueue = {
  features: QueueFeature[];
  currentFeature: string | null;
  iteration: number;
  lastUpdated: string | null;
};

const PROJECT_DIR = process.env.CURSOR_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || '.';
const STATE_DIR = join(PROJECT_DIR, '.cursor', 'hooks', 'state');
const QUEUE_PATH = join(PROJECT_DIR, '.cursor', 'hooks', 'refactor-queue.json');

async function parseHookInput<T>(): Promise<T> {
  const text = await stdin.text();
  return JSON.parse(text) as T;
}

async function findLatestAnalysis(generationId: string): Promise<AnalysisResult | null> {
  try {
    const files = await readdir(STATE_DIR);
    const analysisFiles = files
      .filter(f => f.startsWith('analysis-') && f.endsWith('.json'))
      .sort()
      .reverse();
    const exactMatch = analysisFiles.find(f => f === `analysis-${generationId}.json`);
    if (exactMatch) {
      const content = await readFile(join(STATE_DIR, exactMatch), 'utf8');
      return JSON.parse(content) as AnalysisResult;
    }
    if (analysisFiles.length > 0) {
      const latest = analysisFiles[0];
      const content = await readFile(join(STATE_DIR, latest), 'utf8');
      return JSON.parse(content) as AnalysisResult;
    }
    return null;
  } catch (error) {
    console.error('[generate-followup] Failed to read analysis:', error);
    return null;
  }
}

async function loadQueue(): Promise<RefactorQueue | null> {
  try {
    const content = await readFile(QUEUE_PATH, 'utf8');
    return JSON.parse(content) as RefactorQueue;
  } catch (error) {
    console.error('[generate-followup] Failed to load queue:', error);
    return null;
  }
}

async function updateQueue(queue: RefactorQueue): Promise<void> {
  try {
    queue.lastUpdated = new Date().toISOString();
    await writeFile(QUEUE_PATH, JSON.stringify(queue, null, 2), 'utf8');
  } catch (error) {
    console.error('[generate-followup] Failed to update queue:', error);
  }
}

function generateFeatureRefactoringTask(feature: QueueFeature, metrics: any, opportunities: any[]): string {
  const parts: string[] = [];
  parts.push(`## Feature Refactoring: ${feature.name}\n`);
  parts.push('### Current State\n');
  if (metrics) {
    parts.push(`- useState: ${metrics.totalUseState} instances`);
    parts.push(`- useEffect: ${metrics.totalUseEffect} instances`);
    parts.push(`- Props: ${metrics.averageProps} average per component`);
    parts.push(`- Complexity Score: ${metrics.complexityScore}\n`);
  } else {
    parts.push('Metrics not yet calculated. Analyzing feature...\n');
  }
  
  if (opportunities.length > 0) {
    parts.push('### Simplification Opportunities\n\n');
    
    const byType = opportunities.reduce((acc, opp) => {
      if (!acc[opp.type]) acc[opp.type] = [];
      acc[opp.type].push(opp);
      return acc;
    }, {} as Record<string, any[]>);
    
    if (byType['state-reduction']) {
      parts.push('#### State Reduction\n');
      byType['state-reduction'].slice(0, 3).forEach(opp => {
        parts.push(`- **${opp.filePath}**: ${opp.description}`);
      });
      parts.push('');
    }
    
    if (byType['effect-elimination']) {
      parts.push('#### useEffect Elimination\n');
      byType['effect-elimination'].slice(0, 3).forEach(opp => {
        parts.push(`- **${opp.filePath}**: ${opp.description}`);
      });
      parts.push('');
    }
    
    if (byType['props-reduction']) {
      parts.push('#### Props Reduction\n');
      byType['props-reduction'].slice(0, 3).forEach(opp => {
        parts.push(`- **${opp.filePath}**: ${opp.description}`);
      });
      parts.push('');
    }
    
    if (byType['code-deduplication']) {
      parts.push('#### Code Deduplication\n');
      byType['code-deduplication'].forEach(opp => {
        parts.push(`- ${opp.description}`);
      });
      parts.push('');
    }
    
    parts.push('### Action Items\n');
    opportunities.slice(0, 5).forEach((opp, idx) => {
      parts.push(`${idx + 1}. [${opp.priority.toUpperCase()}] ${opp.type} in ${opp.filePath}`);
      parts.push(`   ${opp.description}`);
    });
  }
  
  parts.push('\n**Focus on reducing state, useEffect, and props holistically across this feature.**');
  return parts.join('\n');
}

function generateFollowupMessage(analysis: AnalysisResult | null, queue: RefactorQueue | null): string {
  if (!analysis) return '';
  
  const parts: string[] = [];
  
  if (analysis.feature_id && analysis.feature_metrics) {
    const feature = queue?.features.find(f => f.id === analysis.feature_id);
    if (feature) {
      return generateFeatureRefactoringTask(feature, analysis.feature_metrics, analysis.simplification_opportunities);
    }
  }
  
  parts.push('## 🏗️ Architecture & Code Analysis Review\n');
  parts.push('Please review the following analysis of recent edits:\n');
  
  // Architecture violations - highest priority
  if (analysis.architecture_violations && analysis.architecture_violations.length > 0) {
    parts.push('### 🚨 Architecture Violations (Scalability Issues)\n');
    
    const byType = analysis.architecture_violations.reduce((acc, v) => {
      if (!acc[v.type]) acc[v.type] = [];
      acc[v.type].push(v);
      return acc;
    }, {} as Record<string, ArchitectureViolation[]>);
    
    // Structure violations (most critical)
    if (byType.structure) {
      parts.push('#### ❌ Structure: Files Not Organized by Feature/Domain\n');
      parts.push('**Issue**: Files are organized by type (components/, hooks/, utils/) instead of by feature/domain.\n');
      parts.push('**Impact**: Makes scaling impossible, creates coupling, prevents feature ownership.\n\n');
      byType.structure.forEach(v => {
        parts.push(`- **${v.filePath}**`);
        parts.push(`  - ${v.description}`);
        if (v.expectedLocation) {
          parts.push(`  - **Move to**: \`${v.expectedLocation}\``);
        }
        parts.push('');
      });
      parts.push('**Action**: Refactor to feature-based structure:\n');
      parts.push('```\n');
      parts.push('src/features/\n');
      parts.push('  /auth\n');
      parts.push('    AuthPage.tsx (pages/)\n');
      parts.push('    auth.api.ts\n');
      parts.push('    auth.store.ts\n');
      parts.push('    useAuth.ts (hooks/)\n');
      parts.push('    LoginForm.tsx (components/)\n');
      parts.push('    index.ts\n');
      parts.push('```\n\n');
    }
    
    // State boundary violations
    if (byType['state-boundary']) {
      parts.push('#### ⚠️ State Boundaries: Review Local vs Global State\n');
      parts.push('**Rule**: Local state first → global state last\n');
      parts.push('**Use**: useState for UI, useReducer for complex local logic\n');
      parts.push('**Global state only for**: auth, user, permissions, app config, cross-feature data\n\n');
      byType['state-boundary'].forEach(v => {
        parts.push(`- **${v.filePath}**`);
        parts.push(`  - ${v.description}`);
        parts.push(`  - **Fix**: ${v.suggestion}`);
        parts.push('');
      });
      parts.push('');
    }
    
    // Separation of concerns
    if (byType.separation) {
      parts.push('#### 🔀 Separation of Concerns: Mixed Responsibilities\n');
      parts.push('**Component roles**:\n');
      parts.push('- UI components → dumb, visual only\n');
      parts.push('- Logic hooks → smart, business logic\n');
      parts.push('- Data layer → APIs, queries\n');
      parts.push('- State layer → stores\n');
      parts.push('- Orchestration → pages/controllers\n\n');
      byType.separation.forEach(v => {
        parts.push(`- **${v.filePath}**`);
        parts.push(`  - ${v.description}`);
        parts.push(`  - **Fix**: ${v.suggestion}`);
        parts.push('');
      });
      parts.push('');
    }
    
    // Feature isolation
    if (byType.isolation) {
      parts.push('#### 🔒 Feature Isolation: Cross-Feature Dependencies\n');
      parts.push('**Rule**: Features should be isolated. If a feature can be deleted in one folder → architecture is healthy.\n');
      parts.push('**Communication**: Through APIs/services, not direct imports.\n\n');
      byType.isolation.forEach(v => {
        parts.push(`- **${v.filePath}**`);
        parts.push(`  - ${v.description}`);
        parts.push(`  - **Fix**: ${v.suggestion}`);
        parts.push('');
      });
      parts.push('');
    }
    
    // API design
    if (byType.api) {
      parts.push('#### 📡 API Design: Feature Interface Issues\n');
      parts.push('**Rule**: Design APIs between features (internal contracts)\n');
      parts.push('**Think like**: Backend microservices — but inside React\n\n');
      byType.api.forEach(v => {
        parts.push(`- **${v.filePath}**`);
        parts.push(`  - ${v.description}`);
        parts.push(`  - **Fix**: ${v.suggestion}`);
        parts.push('');
      });
      parts.push('');
    }
  }
  
  if (analysis.translation_duplicates.length > 0) {
    parts.push('### 📝 Translation Consolidation Opportunities\n');
    parts.push(`Found ${analysis.translation_duplicates.length} duplicate translation sets:\n`);
    for (const dup of analysis.translation_duplicates.slice(0, 5)) {
      parts.push(`- **Keys**: ${dup.keys.join(', ')}`);
      parts.push(`  - English: "${dup.en_value}"`);
      parts.push(`  - Chinese: "${dup.zh_value}"`);
      parts.push(`  - Suggested location: \`${dup.suggested_location}\` section\n`);
    }
  }
  
  if (analysis.modularity_issues.length > 0) {
    parts.push('### 🔧 Modularity Suggestions\n');
    for (const issue of analysis.modularity_issues) {
      parts.push(`- ${issue}\n`);
    }
  }
  
  if (analysis.consistency_issues.length > 0) {
    parts.push('### ✅ Consistency & Architecture\n');
    for (const issue of analysis.consistency_issues) {
      parts.push(`- ${issue}\n`);
    }
  }
  
  if (analysis.suggestions) {
    parts.push('### 📋 Additional Notes\n');
    parts.push(analysis.suggestions);
    parts.push('\n');
  }
  
  parts.push('\n---\n');
  parts.push('\n**🎯 Scalable Architecture Checklist:**\n');
  parts.push('1. ✅ Files organized by domain/feature, not file type');
  parts.push('2. ✅ State boundaries respected (local first, global last)');
  parts.push('3. ✅ Responsibilities separated (UI, logic, data, state)');
  parts.push('4. ✅ Features isolated (can delete feature in one folder)');
  parts.push('5. ✅ APIs designed between features (internal contracts)');
  parts.push('6. ✅ Code follows existing patterns and is properly modularized');
  parts.push('7. ✅ Duplicate translations consolidated where appropriate');
  parts.push('8. ✅ New code integrates well with existing implementations');
  
  return parts.join('\n');
}

async function main() {
  try {
    const payload = await parseHookInput<StopHookInput>();
    const { generation_id, status, loop_count } = payload;
    
    if (status !== 'completed' || loop_count > 0) {
      process.stdout.write('{}\n');
      return;
    }
    
    const analysis = await findLatestAnalysis(generation_id);
    const queue = await loadQueue();
    
    if (!analysis || (
      analysis.translation_duplicates.length === 0 &&
      analysis.modularity_issues.length === 0 &&
      analysis.consistency_issues.length === 0 &&
      !analysis.feature_metrics
    )) {
      process.stdout.write('{}\n');
      return;
    }
    
    if (analysis.feature_id && queue) {
      const feature = queue.features.find(f => f.id === analysis.feature_id);
      if (feature && analysis.feature_metrics) {
        feature.metrics = {
          useStateCount: analysis.feature_metrics.totalUseState,
          useEffectCount: analysis.feature_metrics.totalUseEffect,
          propsCount: analysis.feature_metrics.averageProps,
          complexityScore: analysis.feature_metrics.complexityScore,
        };
        feature.lastAnalyzed = new Date().toISOString();
        if (feature.status === 'pending') {
          feature.status = 'in-progress';
          queue.currentFeature = feature.id;
        }
        await updateQueue(queue);
      }
    }
    
    const followupMessage = generateFollowupMessage(analysis, queue);
    
    const response: StopHookOutput = {};
    if (followupMessage) {
      response.followup_message = followupMessage;
    }
    
    process.stdout.write(JSON.stringify(response) + '\n');
  } catch (error) {
    console.error('[generate-followup] Error:', error);
    process.stdout.write('{}\n');
  }
}

main();

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { stdin } from 'bun';
import { detectFeature, getFeatureInfo } from './utils/feature-detector';
import { calculateFeatureMetrics, identifyOpportunities } from './utils/metrics-calculator';
import { analyzeArchitecture, type ArchitectureViolation } from './utils/architecture-analyzer';

type AfterFileEditInput = {
  file_path: string;
  edits: Array<{ old_string: string; new_string: string }>;
  conversation_id: string;
  generation_id: string;
  workspace_roots: string[];
};

type TranslationDuplicate = {
  keys: string[];
  en_value: string;
  zh_value: string;
  suggested_location: string;
};

type AnalysisResult = {
  generation_id: string;
  edited_files: string[];
  feature_id: string | null;
  feature_name: string | null;
  translation_duplicates: TranslationDuplicate[];
  modularity_issues: string[];
  consistency_issues: string[];
  architecture_violations: ArchitectureViolation[];
  feature_metrics: any | null;
  simplification_opportunities: any[];
  suggestions: string;
};

const PROJECT_DIR = process.env.CURSOR_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || '.';
const STATE_DIR = join(PROJECT_DIR, '.cursor', 'hooks', 'state');

async function parseHookInput<T>(): Promise<T> {
  const text = await stdin.text();
  return JSON.parse(text) as T;
}

async function loadTranslations(projectDir: string): Promise<{ en: any; zh: any }> {
  try {
    const enPath = join(projectDir, 'src', 'locales', 'en.json');
    const zhPath = join(projectDir, 'src', 'locales', 'zh.json');
    const [enContent, zhContent] = await Promise.all([
      readFile(enPath, 'utf8').catch(() => '{}'),
      readFile(zhPath, 'utf8').catch(() => '{}')
    ]);
    return { en: JSON.parse(enContent), zh: JSON.parse(zhContent) };
  } catch (error) {
    console.error('[analyze-edits] Failed to load translations:', error);
    return { en: {}, zh: {} };
  }
}

function flattenTranslations(obj: any, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null) {
      Object.assign(result, flattenTranslations(value, fullKey));
    } else {
      result[fullKey] = String(value);
    }
  }
  return result;
}

function findDuplicateTranslations(en: any, zh: any): TranslationDuplicate[] {
  const enFlat = flattenTranslations(en);
  const zhFlat = flattenTranslations(zh);
  const duplicates: TranslationDuplicate[] = [];
  const enValueToKeys: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(enFlat)) {
    const val = String(value).trim();
    if (!val) continue;
    if (!enValueToKeys[val]) enValueToKeys[val] = [];
    enValueToKeys[val].push(key);
  }
  for (const [enValue, keys] of Object.entries(enValueToKeys)) {
    if (keys.length > 1) {
      const zhValuePairs = keys.map(k => ({
        key: k,
        zhValue: zhFlat[k] ? String(zhFlat[k]).trim() : null
      })).filter(pair => pair.zhValue !== null);
      if (zhValuePairs.length === keys.length) {
        const zhValues = zhValuePairs.map(p => p.zhValue!);
        const uniqueZhValues = new Set(zhValues);
        if (uniqueZhValues.size === 1) {
          const zhValue = zhValues[0];
          let suggestedLocation = 'common';
          const hasCommonKey = keys.some(k => k.startsWith('common.'));
          if (!hasCommonKey) suggestedLocation = keys[0].split('.')[0];
          duplicates.push({
            keys: keys.sort(),
            en_value: enValue,
            zh_value: zhValue,
            suggested_location: suggestedLocation
          });
        }
      }
    }
  }
  return duplicates.sort((a, b) => b.keys.length - a.keys.length);
}

function analyzeModularity(filePath: string, edits: any[]): string[] {
  const issues: string[] = [];
  const fileExt = filePath.split('.').pop()?.toLowerCase();
  if (fileExt === 'tsx' || fileExt === 'ts') {
    const allNewCode = edits.map(e => e.new_string).join('\n');
    if (allNewCode.includes('function') && allNewCode.split('function').length > 3) {
      issues.push('Multiple functions in single file - consider extracting to separate modules');
    }
    if (allNewCode.includes('useState') && allNewCode.split('useState').length > 5) {
      issues.push('Many useState hooks - consider using a reducer or custom hook');
    }
    if (allNewCode.length > 500 && !filePath.includes('hooks/') && !filePath.includes('features/')) {
      issues.push('Large code block added - verify if it can be extracted to a hook or utility');
    }
  }
  return issues;
}

function analyzeConsistency(filePath: string, projectDir: string): string[] {
  const issues: string[] = [];
  
  // Check if file is in old structure
  if (filePath.includes('/components/') && !filePath.includes('/ui/') && !filePath.includes('/features/')) {
    if (filePath.includes('Button') || filePath.includes('Input') || filePath.includes('Select')) {
      issues.push('Component might belong in components/ui/ if it\'s a reusable UI component, or in features/[feature]/components/ if feature-specific');
    } else {
      issues.push('Component should be organized by feature: src/features/[feature-name]/components/');
    }
  }
  
  if (filePath.includes('/hooks/') && !filePath.includes('/features/')) {
    issues.push('Hook should be organized by feature: src/features/[feature-name]/hooks/');
  }
  
  if (filePath.includes('/services/') && !filePath.includes('/features/')) {
    issues.push('Service should be organized by feature: src/features/[feature-name]/[feature].service.ts');
  }
  
  if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
    issues.push('Verify translations are used via useTranslation hook, not hardcoded strings');
  }
  
  return issues;
}

async function saveAnalysis(result: AnalysisResult) {
  try {
    await mkdir(STATE_DIR, { recursive: true });
    const filePath = join(STATE_DIR, `analysis-${result.generation_id}.json`);
    await writeFile(filePath, JSON.stringify(result, null, 2), 'utf8');
  } catch (error) {
    console.error('[analyze-edits] Failed to save analysis:', error);
  }
}

async function main() {
  try {
    const payload = await parseHookInput<AfterFileEditInput>();
    const { file_path, edits, generation_id, workspace_roots } = payload;
    const projectDir = workspace_roots[0] || PROJECT_DIR;
    
    const featureId = detectFeature(file_path);
    const featureInfo = getFeatureInfo(featureId, projectDir);
    
    const { en, zh } = await loadTranslations(projectDir);
    const translationDuplicates = findDuplicateTranslations(en, zh);
    const modularityIssues = analyzeModularity(file_path, edits);
    const consistencyIssues = analyzeConsistency(file_path, projectDir);
    
    // Architecture analysis - the core of scalable architecture enforcement
    let architectureViolations: ArchitectureViolation[] = [];
    try {
      architectureViolations = await analyzeArchitecture(file_path, projectDir);
    } catch (error) {
      console.error('[analyze-edits] Failed to analyze architecture:', error);
    }
    
    let featureMetrics = null;
    let simplificationOpportunities: any[] = [];
    
    if (featureId !== 'other' && featureInfo.files.length > 0) {
      try {
        featureMetrics = await calculateFeatureMetrics(featureInfo.files, featureId, projectDir);
        simplificationOpportunities = identifyOpportunities(featureMetrics);
      } catch (error) {
        console.error('[analyze-edits] Failed to calculate feature metrics:', error);
      }
    }
    
    const suggestions: string[] = [];
    
    // Architecture violations - highest priority
    if (architectureViolations.length > 0) {
      suggestions.push('\n🏗️ ARCHITECTURE VIOLATIONS (Scalability Issues):\n');
      const byType = architectureViolations.reduce((acc, v) => {
        if (!acc[v.type]) acc[v.type] = [];
        acc[v.type].push(v);
        return acc;
      }, {} as Record<string, ArchitectureViolation[]>);
      
      // Structure violations (most critical)
      if (byType.structure) {
        suggestions.push('❌ STRUCTURE: Files not organized by feature/domain');
        byType.structure.forEach(v => {
          suggestions.push(`   • ${v.description}`);
          if (v.expectedLocation) {
            suggestions.push(`     → Move to: ${v.expectedLocation}`);
          }
        });
        suggestions.push('');
      }
      
      // State boundary violations
      if (byType['state-boundary']) {
        suggestions.push('⚠️ STATE BOUNDARIES: Review local vs global state usage');
        byType['state-boundary'].forEach(v => {
          suggestions.push(`   • ${v.description}`);
          suggestions.push(`     → ${v.suggestion}`);
        });
        suggestions.push('');
      }
      
      // Separation of concerns
      if (byType.separation) {
        suggestions.push('🔀 SEPARATION: Component/hook mixing multiple responsibilities');
        byType.separation.forEach(v => {
          suggestions.push(`   • ${v.description}`);
          suggestions.push(`     → ${v.suggestion}`);
        });
        suggestions.push('');
      }
      
      // Feature isolation
      if (byType.isolation) {
        suggestions.push('🔒 ISOLATION: Cross-feature dependencies detected');
        byType.isolation.forEach(v => {
          suggestions.push(`   • ${v.description}`);
          suggestions.push(`     → ${v.suggestion}`);
        });
        suggestions.push('');
      }
      
      // API design
      if (byType.api) {
        suggestions.push('📡 API DESIGN: Feature interface needs improvement');
        byType.api.forEach(v => {
          suggestions.push(`   • ${v.description}`);
          suggestions.push(`     → ${v.suggestion}`);
        });
        suggestions.push('');
      }
    }
    
    if (translationDuplicates.length > 0) {
      suggestions.push(`\n📝 Found ${translationDuplicates.length} duplicate translation sets that can be consolidated.`);
    }
    if (modularityIssues.length > 0) suggestions.push(...modularityIssues);
    if (consistencyIssues.length > 0) suggestions.push(...consistencyIssues);
    
    if (featureMetrics) {
      suggestions.push(`\n📊 Feature Analysis: ${featureInfo.name}`);
      suggestions.push(`- Total useState: ${featureMetrics.totalUseState}`);
      suggestions.push(`- Total useEffect: ${featureMetrics.totalUseEffect}`);
      suggestions.push(`- Average props: ${featureMetrics.averageProps}`);
      suggestions.push(`- Complexity score: ${featureMetrics.complexityScore}`);
      if (simplificationOpportunities.length > 0) {
        suggestions.push(`\n💡 Found ${simplificationOpportunities.length} simplification opportunities:`);
        simplificationOpportunities.slice(0, 5).forEach((opp, idx) => {
          suggestions.push(`${idx + 1}. [${opp.priority.toUpperCase()}] ${opp.type}: ${opp.description}`);
        });
      }
    }
    
    // Add architecture guidance
    if (architectureViolations.length > 0) {
      suggestions.push('\n\n🎯 ARCHITECTURE PRINCIPLES REMINDER:');
      suggestions.push('1. Scale by structure, not features → Organize by domain (features/auth/, features/events/)');
      suggestions.push('2. Control complexity with state boundaries → Local state first, global state last');
      suggestions.push('3. Separate responsibilities → UI components (dumb), Logic hooks (smart), Data layer (APIs), State layer (stores)');
      suggestions.push('4. Design APIs between features → Features communicate through contracts, not direct imports');
      suggestions.push('5. Feature isolation → If a feature can be deleted in one folder, architecture is healthy');
    }
    
    const result: AnalysisResult = {
      generation_id,
      edited_files: [file_path],
      feature_id: featureId !== 'other' ? featureId : null,
      feature_name: featureId !== 'other' ? featureInfo.name : null,
      translation_duplicates: translationDuplicates,
      modularity_issues: modularityIssues,
      consistency_issues: consistencyIssues,
      architecture_violations: architectureViolations,
      feature_metrics: featureMetrics,
      simplification_opportunities: simplificationOpportunities,
      suggestions: suggestions.join('\n')
    };
    
    await saveAnalysis(result);
    process.stdout.write('{}\n');
  } catch (error) {
    console.error('[analyze-edits] Error:', error);
    process.stdout.write('{}\n');
  }
}

main();

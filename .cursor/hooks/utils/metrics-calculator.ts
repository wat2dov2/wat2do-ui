import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface FileMetrics {
  filePath: string;
  useStateCount: number;
  useEffectCount: number;
  propsCount: number;
  lineCount: number;
  classNameCount: number;
  customHookCount: number;
  complexityScore: number;
}

export interface FeatureMetrics {
  featureId: string;
  totalFiles: number;
  totalUseState: number;
  totalUseEffect: number;
  averageProps: number;
  totalLines: number;
  totalClassName: number;
  totalCustomHooks: number;
  complexityScore: number;
  fileMetrics: FileMetrics[];
}

function countUseState(code: string): number {
  const useStateRegex = /useState\s*\(/g;
  const matches = code.match(useStateRegex);
  return matches ? matches.length : 0;
}

function countUseEffect(code: string): number {
  const useEffectRegex = /useEffect\s*\(/g;
  const matches = code.match(useEffectRegex);
  return matches ? matches.length : 0;
}

function countProps(code: string): number {
  const interfaceRegex = /interface\s+\w+Props\s*\{([^}]+)\}/gs;
  const typeRegex = /type\s+\w+Props\s*=\s*\{([^}]+)\}/gs;
  let propsCount = 0;
  const interfaceMatches = [...code.matchAll(interfaceRegex)];
  for (const match of interfaceMatches) {
    const props = match[1];
    const propLines = props.split('\n').filter(line => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('*');
    });
    propsCount = Math.max(propsCount, propLines.length);
  }
  const typeMatches = [...code.matchAll(typeRegex)];
  for (const match of typeMatches) {
    const props = match[1];
    const propLines = props.split('\n').filter(line => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('*');
    });
    propsCount = Math.max(propsCount, propLines.length);
  }
  return propsCount;
}

function countClassName(code: string): number {
  const classNameRegex = /className\s*=\s*["'`]([^"'`]+)["'`]/g;
  const matches = [...code.matchAll(classNameRegex)];
  let totalClasses = 0;
  for (const match of matches) {
    const classString = match[1];
    const classes = classString.trim().split(/\s+/).filter(c => c.length > 0);
    totalClasses += classes.length;
  }
  return totalClasses;
}

function countCustomHooks(code: string): number {
  const customHookRegex = /(?:function|const|export\s+(?:function|const))\s+use[A-Z]\w*/g;
  const matches = code.match(customHookRegex);
  return matches ? matches.length : 0;
}

function calculateComplexityScore(metrics: Omit<FileMetrics, 'complexityScore'>): number {
  const stateWeight = 3;
  const effectWeight = 4;
  const propsWeight = 1;
  const linesWeight = 0.01;
  const classesWeight = 0.1;
  const hooksWeight = 2;
  return (
    metrics.useStateCount * stateWeight +
    metrics.useEffectCount * effectWeight +
    metrics.propsCount * propsWeight +
    metrics.lineCount * linesWeight +
    metrics.classNameCount * classesWeight +
    metrics.customHookCount * hooksWeight
  );
}

export async function calculateFileMetrics(
  filePath: string,
  projectDir: string
): Promise<FileMetrics | null> {
  try {
    const fullPath = join(projectDir, filePath);
    const code = await readFile(fullPath, 'utf8');
    const useStateCount = countUseState(code);
    const useEffectCount = countUseEffect(code);
    const propsCount = countProps(code);
    const lineCount = code.split('\n').length;
    const classNameCount = countClassName(code);
    const customHookCount = countCustomHooks(code);
    const metrics: Omit<FileMetrics, 'complexityScore'> = {
      filePath,
      useStateCount,
      useEffectCount,
      propsCount,
      lineCount,
      classNameCount,
      customHookCount,
    };
    return {
      ...metrics,
      complexityScore: calculateComplexityScore(metrics),
    };
  } catch (error) {
    console.error(`[metrics-calculator] Failed to analyze ${filePath}:`, error);
    return null;
  }
}

export async function calculateFeatureMetrics(
  filePaths: string[],
  featureId: string,
  projectDir: string
): Promise<FeatureMetrics> {
  const fileMetricsResults = await Promise.all(
    filePaths.map(path => calculateFileMetrics(path, projectDir))
  );
  const fileMetrics = fileMetricsResults.filter((m): m is FileMetrics => m !== null);
  const totalUseState = fileMetrics.reduce((sum, m) => sum + m.useStateCount, 0);
  const totalUseEffect = fileMetrics.reduce((sum, m) => sum + m.useEffectCount, 0);
  const totalProps = fileMetrics.reduce((sum, m) => sum + m.propsCount, 0);
  const totalLines = fileMetrics.reduce((sum, m) => sum + m.lineCount, 0);
  const totalClassName = fileMetrics.reduce((sum, m) => sum + m.classNameCount, 0);
  const totalCustomHooks = fileMetrics.reduce((sum, m) => sum + m.customHookCount, 0);
  const totalComplexity = fileMetrics.reduce((sum, m) => sum + m.complexityScore, 0);
  const averageProps = fileMetrics.length > 0 ? totalProps / fileMetrics.length : 0;
  return {
    featureId,
    totalFiles: fileMetrics.length,
    totalUseState,
    totalUseEffect,
    averageProps: Math.round(averageProps * 10) / 10,
    totalLines,
    totalClassName,
    totalCustomHooks,
    complexityScore: Math.round(totalComplexity * 10) / 10,
    fileMetrics,
  };
}

export interface SimplificationOpportunity {
  type: 'state-reduction' | 'effect-elimination' | 'props-reduction' | 'code-deduplication' | 'tailwind-reduction';
  filePath: string;
  description: string;
  lineNumbers?: number[];
  priority: 'high' | 'medium' | 'low';
}

export function identifyOpportunities(metrics: FeatureMetrics): SimplificationOpportunity[] {
  const opportunities: SimplificationOpportunity[] = [];
  for (const fileMetric of metrics.fileMetrics) {
    if (fileMetric.useStateCount >= 3) {
      opportunities.push({
        type: 'state-reduction',
        filePath: fileMetric.filePath,
        description: `${fileMetric.useStateCount} useState instances detected. Consider combining related state into useReducer or custom hook.`,
        priority: fileMetric.useStateCount >= 5 ? 'high' : 'medium',
      });
    }
    if (fileMetric.useEffectCount >= 2) {
      opportunities.push({
        type: 'effect-elimination',
        filePath: fileMetric.filePath,
        description: `${fileMetric.useEffectCount} useEffect instances detected. Review for opportunities to use derived state (useMemo) or event handlers instead.`,
        priority: fileMetric.useEffectCount >= 4 ? 'high' : 'medium',
      });
    }
    if (fileMetric.propsCount >= 5) {
      opportunities.push({
        type: 'props-reduction',
        filePath: fileMetric.filePath,
        description: `${fileMetric.propsCount} props detected. Consider using Context API or component composition to reduce prop drilling.`,
        priority: fileMetric.propsCount >= 8 ? 'high' : 'medium',
      });
    }
    if (fileMetric.classNameCount >= 50) {
      opportunities.push({
        type: 'tailwind-reduction',
        filePath: fileMetric.filePath,
        description: `High Tailwind class usage (${fileMetric.classNameCount} classes). Consider extracting common patterns into reusable components.`,
        priority: fileMetric.classNameCount >= 100 ? 'high' : 'medium',
      });
    }
  }
  if (metrics.fileMetrics.length > 1) {
    const highComplexityFiles = metrics.fileMetrics.filter(m => m.complexityScore > 50);
    if (highComplexityFiles.length > 1) {
      opportunities.push({
        type: 'code-deduplication',
        filePath: metrics.fileMetrics[0].filePath,
        description: `Multiple files with high complexity detected. Look for shared patterns that can be extracted into custom hooks or utilities.`,
        priority: 'medium',
      });
    }
  }
  return opportunities.sort((a, b) => {
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    return priorityOrder[b.priority] - priorityOrder[a.priority];
  });
}

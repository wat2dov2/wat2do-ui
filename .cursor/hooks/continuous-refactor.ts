import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getFeatureInfo } from './utils/feature-detector';
import { calculateFeatureMetrics, identifyOpportunities } from './utils/metrics-calculator';

const PROJECT_DIR = process.env.CURSOR_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || '.';
const QUEUE_PATH = join(PROJECT_DIR, '.cursor', 'hooks', 'refactor-queue.json');

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

async function loadQueue(): Promise<RefactorQueue> {
  try {
    const content = await readFile(QUEUE_PATH, 'utf8');
    return JSON.parse(content) as RefactorQueue;
  } catch (error) {
    console.error('[continuous-refactor] Failed to load queue:', error);
    throw error;
  }
}

async function saveQueue(queue: RefactorQueue): Promise<void> {
  try {
    queue.lastUpdated = new Date().toISOString();
    await writeFile(QUEUE_PATH, JSON.stringify(queue, null, 2), 'utf8');
  } catch (error) {
    console.error('[continuous-refactor] Failed to save queue:', error);
    throw error;
  }
}

function getNextFeature(queue: RefactorQueue): QueueFeature | null {
  const pendingFeatures = queue.features
    .filter(f => f.status === 'pending')
    .sort((a, b) => a.priority - b.priority);
  return pendingFeatures.length > 0 ? pendingFeatures[0] : null;
}

async function analyzeFeature(feature: QueueFeature): Promise<void> {
  console.log(`[continuous-refactor] Analyzing feature: ${feature.name}`);
  
  try {
    const featureInfo = getFeatureInfo(feature.id as any, PROJECT_DIR);
    const metrics = await calculateFeatureMetrics(featureInfo.files, feature.id, PROJECT_DIR);
    const opportunities = identifyOpportunities(metrics);
    
    feature.metrics = {
      useStateCount: metrics.totalUseState,
      useEffectCount: metrics.totalUseEffect,
      propsCount: metrics.averageProps,
      complexityScore: metrics.complexityScore,
    };
    feature.lastAnalyzed = new Date().toISOString();
    feature.status = 'in-progress';
    
    console.log(`[continuous-refactor] Feature ${feature.name} metrics:`);
    console.log(`  - useState: ${metrics.totalUseState}`);
    console.log(`  - useEffect: ${metrics.totalUseEffect}`);
    console.log(`  - props: ${metrics.averageProps}`);
    console.log(`  - complexity: ${metrics.complexityScore}`);
    console.log(`  - opportunities: ${opportunities.length}`);
  } catch (error) {
    console.error(`[continuous-refactor] Failed to analyze ${feature.name}:`, error);
    feature.status = 'error';
  }
}

async function main() {
  try {
    const queue = await loadQueue();
    
    const nextFeature = getNextFeature(queue);
    if (!nextFeature) {
      console.log('[continuous-refactor] No pending features to analyze');
      return;
    }
    
    queue.currentFeature = nextFeature.id;
    queue.iteration += 1;
    
    await analyzeFeature(nextFeature);
    await saveQueue(queue);
    
    console.log(`[continuous-refactor] Analysis complete for ${nextFeature.name}`);
  } catch (error) {
    console.error('[continuous-refactor] Error:', error);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}

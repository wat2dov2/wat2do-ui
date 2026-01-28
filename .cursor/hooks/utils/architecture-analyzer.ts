import { readFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { existsSync } from 'node:fs';

export interface ArchitectureViolation {
  type: 'structure' | 'state-boundary' | 'separation' | 'isolation' | 'dependency' | 'api';
  severity: 'high' | 'medium' | 'low';
  filePath: string;
  description: string;
  suggestion: string;
  expectedLocation?: string;
}

export interface FeatureStructure {
  featureName: string;
  hasPages: boolean;
  hasComponents: boolean;
  hasHooks: boolean;
  hasApi: boolean;
  hasStore: boolean;
  hasIndex: boolean;
  files: string[];
  violations: ArchitectureViolation[];
}

/**
 * Expected feature-based structure:
 * /features
 *   /auth
 *     AuthPage.tsx (pages/)
 *     auth.api.ts
 *     auth.store.ts
 *     useAuth.ts (hooks/)
 *     LoginForm.tsx (components/)
 *     index.ts
 */
const FEATURE_PATTERNS = {
  pages: /(?:Page|Container|View)\.tsx?$/,
  components: /\.tsx?$/,
  hooks: /^use[A-Z]\w+\.tsx?$/,
  api: /\.api\.tsx?$/,
  store: /\.store\.tsx?$/,
  service: /\.service\.tsx?$/,
};

const EXPECTED_FEATURE_STRUCTURE = {
  pages: ['pages/', ''],
  components: ['components/', ''],
  hooks: ['hooks/', ''],
  api: [''],
  store: [''],
  service: [''],
};

/**
 * Detect if a file is in the wrong location based on feature-based architecture
 */
export function detectStructureViolation(
  filePath: string,
  projectDir: string
): ArchitectureViolation | null {
  const fileName = basename(filePath);
  const dir = dirname(filePath);
  const relativePath = filePath.replace(projectDir + '/', '');

  // Check if file is in old structure (components/, hooks/, utils/, services/)
  const oldStructurePatterns = [
    { pattern: /^src\/components\/(?!ui\/)/, issue: 'File in components/ instead of feature folder' },
    { pattern: /^src\/hooks\//, issue: 'File in hooks/ instead of feature folder' },
    { pattern: /^src\/utils\//, issue: 'File in utils/ instead of feature folder' },
    { pattern: /^src\/services\//, issue: 'File in services/ instead of feature folder' },
  ];

  for (const { pattern, issue } of oldStructurePatterns) {
    if (pattern.test(relativePath)) {
      // Determine which feature this belongs to
      const featureName = inferFeatureName(fileName, dir);
      const expectedLocation = suggestFeatureLocation(fileName, featureName);

      return {
        type: 'structure',
        severity: 'high',
        filePath,
        description: issue,
        suggestion: `Move to feature-based structure: ${expectedLocation}`,
        expectedLocation,
      };
    }
  }

  return null;
}

/**
 * Infer feature name from file name and path
 */
function inferFeatureName(fileName: string, dir: string): string {
  // Common patterns
  if (fileName.includes('Event') && !fileName.includes('Admin')) return 'events';
  if (fileName.includes('Admin')) return 'admin';
  if (fileName.includes('Auth') || fileName.includes('Login')) return 'auth';
  if (fileName.includes('Filter')) return 'filters';
  if (fileName.includes('Onboarding')) return 'onboarding';
  if (fileName.includes('Billing') || fileName.includes('Credit')) return 'billing';
  if (fileName.includes('Profile') || fileName.includes('Settings')) return 'profile';
  if (fileName.includes('Club')) return 'clubs';
  if (fileName.includes('Search')) return 'search';
  if (fileName.includes('Dashboard')) return 'dashboard';

  // Try to extract from directory
  const dirParts = dir.split('/');
  const featureDir = dirParts.find(part => 
    ['events', 'admin', 'auth', 'filters', 'onboarding', 'billing', 'profile', 'clubs', 'search', 'dashboard'].includes(part)
  );
  if (featureDir) return featureDir;

  return 'unknown';
}

/**
 * Suggest proper feature location
 */
function suggestFeatureLocation(fileName: string, featureName: string): string {
  const isPage = FEATURE_PATTERNS.pages.test(fileName);
  const isHook = FEATURE_PATTERNS.hooks.test(fileName);
  const isApi = FEATURE_PATTERNS.api.test(fileName);
  const isStore = FEATURE_PATTERNS.store.test(fileName);
  const isService = FEATURE_PATTERNS.service.test(fileName);

  if (isPage) return `src/features/${featureName}/pages/${fileName}`;
  if (isHook) return `src/features/${featureName}/hooks/${fileName}`;
  if (isApi) return `src/features/${featureName}/${featureName}.api.ts`;
  if (isStore) return `src/features/${featureName}/${featureName}.store.ts`;
  if (isService) return `src/features/${featureName}/${featureName}.service.ts`;
  
  // Default to components
  return `src/features/${featureName}/components/${fileName}`;
}

/**
 * Analyze state boundaries - check if global state is used when local state would suffice
 */
export async function analyzeStateBoundaries(
  filePath: string,
  projectDir: string
): Promise<ArchitectureViolation[]> {
  const violations: ArchitectureViolation[] = [];

  try {
    const fullPath = join(projectDir, filePath);
    if (!existsSync(fullPath)) return violations;

    const code = await readFile(fullPath, 'utf8');

    // Check for excessive global state usage
    const globalStatePatterns = [
      { pattern: /useAppUI|useAppEvents|useAppPromotions|useAppNavigation/g, name: 'Global app hooks' },
      { pattern: /useContext\s*\([^)]*Context\)/g, name: 'Context usage' },
    ];

    const useStateCount = (code.match(/useState\s*\(/g) || []).length;
    const globalStateCount = globalStatePatterns.reduce((sum, { pattern }) => {
      return sum + (code.match(pattern) || []).length;
    }, 0);

    // If file has many useState but also uses global state, might be mixing concerns
    if (useStateCount >= 3 && globalStateCount > 0) {
      violations.push({
        type: 'state-boundary',
        severity: 'medium',
        filePath,
        description: `File uses ${useStateCount} local useState hooks and ${globalStateCount} global state hooks. Consider if all state needs to be global.`,
        suggestion: 'Review state boundaries: Use local state first, global state only for cross-feature data. Consider useReducer for complex local logic.',
      });
    }

    // Check if component is using global state when it shouldn't
    const isComponent = /\.tsx$/.test(filePath) && !filePath.includes('Page') && !filePath.includes('Container');
    if (isComponent && globalStateCount > 0 && useStateCount === 0) {
      violations.push({
        type: 'state-boundary',
        severity: 'high',
        filePath,
        description: 'UI component is using global state but has no local state. Components should be dumb and receive props.',
        suggestion: 'Make component receive data via props. Move state management to parent or hook.',
      });
    }

  } catch (error) {
    console.error(`[architecture-analyzer] Failed to analyze state boundaries for ${filePath}:`, error);
  }

  return violations;
}

/**
 * Analyze separation of concerns - check if component is doing too much
 */
export async function analyzeSeparationOfConcerns(
  filePath: string,
  projectDir: string
): Promise<ArchitectureViolation[]> {
  const violations: ArchitectureViolation[] = [];

  try {
    const fullPath = join(projectDir, filePath);
    if (!existsSync(fullPath)) return violations;

    const code = await readFile(fullPath, 'utf8');
    const fileName = basename(filePath);

    // Check if component is mixing concerns
    const hasUI = /return\s*\(|<[A-Z]|className|style/.test(code);
    const hasDataFetching = /fetch\(|axios\.|\.get\(|\.post\(|useQuery|useMutation/.test(code);
    const hasBusinessLogic = /if\s*\([^)]*\)\s*\{[^}]{50,}/.test(code);
    const hasStateManagement = /useState|useReducer|useContext/.test(code);

    const concernCount = [hasUI, hasDataFetching, hasBusinessLogic, hasStateManagement].filter(Boolean).length;

    if (concernCount >= 3 && /\.tsx$/.test(filePath)) {
      violations.push({
        type: 'separation',
        severity: 'high',
        filePath,
        description: `Component appears to handle ${concernCount} different concerns (UI, data fetching, business logic, state).`,
        suggestion: 'Separate responsibilities: Extract data fetching to hooks/API layer, business logic to services, state to stores/hooks, keep component for UI only.',
      });
    }

    // Check if component is fetching data directly
    if (hasDataFetching && /\.tsx$/.test(filePath) && !filePath.includes('Page')) {
      violations.push({
        type: 'separation',
        severity: 'medium',
        filePath,
        description: 'Component is fetching data directly. Data fetching should be in API layer or hooks.',
        suggestion: 'Move data fetching to a hook (useFeatureData.ts) or API file (feature.api.ts). Component should receive data via props.',
      });
    }

    // Check if hook is rendering UI
    if (hasUI && /^use[A-Z]/.test(fileName)) {
      violations.push({
        type: 'separation',
        severity: 'high',
        filePath,
        description: 'Hook appears to contain UI code. Hooks should contain logic only.',
        suggestion: 'Move UI code to a component. Hook should return data and callbacks only.',
      });
    }

  } catch (error) {
    console.error(`[architecture-analyzer] Failed to analyze separation for ${filePath}:`, error);
  }

  return violations;
}

/**
 * Analyze feature isolation - check for cross-feature dependencies
 */
export async function analyzeFeatureIsolation(
  filePath: string,
  projectDir: string
): Promise<ArchitectureViolation[]> {
  const violations: ArchitectureViolation[] = [];

  try {
    const fullPath = join(projectDir, filePath);
    if (!existsSync(fullPath)) return violations;

    const code = await readFile(fullPath, 'utf8');
    const currentFeature = inferFeatureName(basename(filePath), dirname(filePath));

    // Check for direct imports from other features
    const importPattern = /from\s+['"]@\/features\/([^'"]+)\//g;
    const imports = [...code.matchAll(importPattern)];

    for (const match of imports) {
      const importedFeature = match[1];
      if (importedFeature !== currentFeature && currentFeature !== 'unknown') {
        violations.push({
          type: 'isolation',
          severity: 'high',
          filePath,
          description: `Feature "${currentFeature}" directly imports from feature "${importedFeature}". Features should be isolated.`,
          suggestion: `Create an API/service interface in shared/ or use dependency injection. Features should communicate through contracts, not direct imports.`,
        });
      }
    }

    // Check for imports from old structure that should be in features
    const oldStructureImports = [
      { pattern: /from\s+['"]@\/components\/(?!ui\/)/, name: 'components/' },
      { pattern: /from\s+['"]@\/hooks\//, name: 'hooks/' },
      { pattern: /from\s+['"]@\/services\//, name: 'services/' },
    ];

    for (const { pattern, name } of oldStructureImports) {
      if (pattern.test(code)) {
        violations.push({
          type: 'isolation',
          severity: 'medium',
          filePath,
          description: `File imports from ${name} which should be organized by feature.`,
          suggestion: `Refactor to feature-based structure. Move related files to src/features/[feature-name]/`,
        });
      }
    }

  } catch (error) {
    console.error(`[architecture-analyzer] Failed to analyze isolation for ${filePath}:`, error);
  }

  return violations;
}

/**
 * Analyze API design - check if features expose proper interfaces
 */
export async function analyzeAPIDesign(
  filePath: string,
  projectDir: string
): Promise<ArchitectureViolation[]> {
  const violations: ArchitectureViolation[] = [];

  try {
    const fullPath = join(projectDir, filePath);
    if (!existsSync(fullPath)) return violations;

    const code = await readFile(fullPath, 'utf8');
    const fileName = basename(filePath);

    // Check if feature has API file
    const isFeatureRoot = filePath.includes('/features/') && !filePath.includes('/pages/') && !filePath.includes('/components/') && !filePath.includes('/hooks/');
    
    if (isFeatureRoot && !fileName.includes('.api.') && !fileName.includes('.store.') && !fileName.includes('index.')) {
      // Check if feature exports are scattered
      const hasExports = /export\s+(?:function|const|class|interface|type)/.test(code);
      if (hasExports && !fileName.includes('index')) {
        violations.push({
          type: 'api',
          severity: 'low',
          filePath,
          description: 'Feature root file exports functions/types. Consider organizing exports in index.ts and creating feature.api.ts for external interface.',
          suggestion: 'Create feature.api.ts for external interface and index.ts for feature exports. Keep implementation details private.',
        });
      }
    }

    // Check if API file exists but doesn't follow pattern
    if (fileName.includes('.api.')) {
      const hasInternalImports = /from\s+['"]\.\/(?:components|hooks|pages)/.test(code);
      if (hasInternalImports) {
        violations.push({
          type: 'api',
          severity: 'medium',
          filePath,
          description: 'API file imports from internal feature structure. API should only expose interface, not depend on internals.',
          suggestion: 'API file should be a facade. Move implementation to hooks/services, keep API file as thin interface layer.',
        });
      }
    }

  } catch (error) {
    console.error(`[architecture-analyzer] Failed to analyze API design for ${filePath}:`, error);
  }

  return violations;
}

/**
 * Get all architecture violations for a file
 */
export async function analyzeArchitecture(
  filePath: string,
  projectDir: string
): Promise<ArchitectureViolation[]> {
  const violations: ArchitectureViolation[] = [];

  // Structure violations
  const structureViolation = detectStructureViolation(filePath, projectDir);
  if (structureViolation) violations.push(structureViolation);

  // State boundary violations
  const stateViolations = await analyzeStateBoundaries(filePath, projectDir);
  violations.push(...stateViolations);

  // Separation of concerns violations
  const separationViolations = await analyzeSeparationOfConcerns(filePath, projectDir);
  violations.push(...separationViolations);

  // Feature isolation violations
  const isolationViolations = await analyzeFeatureIsolation(filePath, projectDir);
  violations.push(...isolationViolations);

  // API design violations
  const apiViolations = await analyzeAPIDesign(filePath, projectDir);
  violations.push(...apiViolations);

  return violations;
}

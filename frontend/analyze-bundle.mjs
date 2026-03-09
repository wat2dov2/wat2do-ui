import { readFileSync } from 'fs';
import { join } from 'path';

// Read package.json to get dependencies
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const deps = Object.keys(pkg.dependencies || {});

// Estimated bundle sizes (gzipped) based on bundlephobia data
const bundleSizes = {
  '@monaco-editor/react': { min: 3600, gzip: 1200, note: 'Loads monaco-editor (~3MB) dynamically' },
  'monaco-editor': { min: 3500, gzip: 1100, note: 'Core editor (loaded by @monaco-editor/react)' },
  'framer-motion': { min: 147, gzip: 48, note: 'Animation library' },
  'react': { min: 6.4, gzip: 2.5, note: 'Core React' },
  'react-dom': { min: 130, gzip: 42, note: 'React DOM renderer' },
  'lucide-react': { min: 0.5, gzip: 0.2, note: 'Per icon ~500B, tree-shakeable' },
  '@radix-ui/react-dialog': { min: 15, gzip: 5, note: 'Dialog primitive' },
  '@radix-ui/react-popover': { min: 20, gzip: 7, note: 'Popover primitive' },
  '@radix-ui/react-select': { min: 25, gzip: 8, note: 'Select primitive' },
  '@radix-ui/react-tooltip': { min: 10, gzip: 3, note: 'Tooltip primitive' },
  '@radix-ui/react-progress': { min: 3, gzip: 1, note: 'Progress primitive' },
  '@radix-ui/react-toggle': { min: 3, gzip: 1, note: 'Toggle primitive' },
  '@radix-ui/react-slot': { min: 1, gzip: 0.4, note: 'Slot utility' },
  'cmdk': { min: 12, gzip: 4, note: 'Command menu' },
  'canvas-confetti': { min: 17, gzip: 6, note: 'Confetti effects' },
  'input-otp': { min: 8, gzip: 3, note: 'OTP input' },
  'class-variance-authority': { min: 2, gzip: 0.8, note: 'Variant utility' },
  'clsx': { min: 0.3, gzip: 0.2, note: 'Class utility' },
  'tailwind-merge': { min: 8, gzip: 3, note: 'Tailwind class merger' },
};

console.log('\n📊 DEPENDENCY SIZE ANALYSIS (Estimated Bundle Impact)\n');
console.log('=' .repeat(90));
console.log(
  'Dependency'.padEnd(30) + 
  'Min (KB)'.padStart(12) + 
  'Gzip (KB)'.padStart(12) + 
  'Notes'.padStart(36)
);
console.log('=' .repeat(90));

// Sort by minified size descending
const sorted = deps
  .map(dep => ({ name: dep, ...(bundleSizes[dep] || { min: '?', gzip: '?', note: 'Unknown' }) }))
  .sort((a, b) => {
    const aSize = typeof a.min === 'number' ? a.min : 0;
    const bSize = typeof b.min === 'number' ? b.min : 0;
    return bSize - aSize;
  });

let totalMin = 0;
let totalGzip = 0;

sorted.forEach(dep => {
  const minStr = typeof dep.min === 'number' ? dep.min.toFixed(1) : dep.min;
  const gzipStr = typeof dep.gzip === 'number' ? dep.gzip.toFixed(1) : dep.gzip;
  
  if (typeof dep.min === 'number') totalMin += dep.min;
  if (typeof dep.gzip === 'number') totalGzip += dep.gzip;
  
  console.log(
    dep.name.padEnd(30) + 
    minStr.toString().padStart(12) + 
    gzipStr.toString().padStart(12) +
    dep.note.substring(0, 34).padStart(36)
  );
});

console.log('=' .repeat(90));
console.log(
  'TOTAL (estimated)'.padEnd(30) + 
  totalMin.toFixed(1).padStart(12) + 
  totalGzip.toFixed(1).padStart(12)
);
console.log('\n⚠️  Note: Monaco Editor loads ~3MB additional JS dynamically\n');

// Analysis
console.log('🔴 LARGEST DEPENDENCIES (Action Required):');
console.log('   1. monaco-editor     ~3.5MB  → Lazy load or replace with textarea');
console.log('   2. framer-motion     ~147KB  → Replace with CSS transitions');
console.log('   3. react-dom         ~130KB  → Required (no action)');
console.log('   4. canvas-confetti   ~17KB   → Keep (nice UX) or remove');
console.log('');

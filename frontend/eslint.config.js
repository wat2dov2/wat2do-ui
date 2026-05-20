import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

const legacyImportPatterns = [
  {
    group: ["@/components/*", "@/components/**"],
    message: "Use feature-owned modules or shared/ instead of the legacy components/ tree.",
  },
];

export default defineConfig([
  globalIgnores([
    "dist",
    ".vercel",
    "node_modules",
    "coverage",
    "playwright-report",
    "src/shared/generated/**",
  ]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  // Architecture boundary: do not add new imports from the legacy components/ tree.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: legacyImportPatterns,
      }],
    },
  },
  // Architecture boundary: shared/ must never import from features/
  {
    files: ["src/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          ...legacyImportPatterns,
          {
            group: ["@/features/*", "@/features/**"],
            message: "shared/ must not import from features/. Move the needed code to shared/ or pass it as a parameter.",
          },
        ],
      }],
    },
  },
]);

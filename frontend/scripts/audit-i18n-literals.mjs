import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, "..");
const srcRoot = path.join(frontendRoot, "src");

const USER_FACING_ATTRS = new Set([
  "alt",
  "aria-label",
  "description",
  "emptyMessage",
  "label",
  "loadingText",
  "placeholder",
  "title",
]);

const ALLOWED_JSX_TEXT = new Set([
  // Keyboard shortcut glyphs.
  "K",
  "F",
  "G",
  "C",
  "N",
  // Visual placeholder, not copy.
  "&mdash;",
]);

const findings = [];

function hasLetters(value) {
  return /[A-Za-z]/.test(value);
}

function normalizeJsxText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function location(sourceFile, node) {
  const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${path.relative(frontendRoot, sourceFile.fileName)}:${pos.line + 1}:${pos.character + 1}`;
}

function addFinding(sourceFile, node, kind, value) {
  findings.push(`${location(sourceFile, node)} ${kind}: ${JSON.stringify(value)}`);
}

// Helper to recursively get all dot-notation keys of a JSON object
function getFlattenedKeys(obj, prefix = "") {
  let keys = [];
  for (const key in obj) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof obj[key] === "object" && obj[key] !== null && !Array.isArray(obj[key])) {
      keys = keys.concat(getFlattenedKeys(obj[key], fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

// 1. Find all locales folders and check key parity + build global enBundle
function findLocalesFolders(dir, list = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "locales") {
        list.push(fullPath);
      } else if (entry.name !== "node_modules" && entry.name !== ".git") {
        findLocalesFolders(fullPath, list);
      }
    }
  }
  return list;
}

const localesFolders = findLocalesFolders(srcRoot);
const globalEnBundle = {};

// Helper to merge nested objects
function deepMerge(target, source) {
  for (const key in source) {
    if (typeof source[key] === "object" && source[key] !== null && !Array.isArray(source[key])) {
      target[key] = target[key] || {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
}

for (const folder of localesFolders) {
  const enPath = path.join(folder, "en.json");
  const zhPath = path.join(folder, "zh.json");
  
  let enKeys = new Set();
  let zhKeys = new Set();
  
  if (fs.existsSync(enPath)) {
    try {
      const enContent = JSON.parse(fs.readFileSync(enPath, "utf8"));
      enKeys = new Set(getFlattenedKeys(enContent));
      deepMerge(globalEnBundle, enContent);
    } catch (err) {
      findings.push(`Failed to parse English locale JSON: ${path.relative(frontendRoot, enPath)} (${err.message})`);
    }
  }
  
  if (fs.existsSync(zhPath)) {
    try {
      const zhContent = JSON.parse(fs.readFileSync(zhPath, "utf8"));
      zhKeys = new Set(getFlattenedKeys(zhContent));
    } catch (err) {
      findings.push(`Failed to parse Chinese locale JSON: ${path.relative(frontendRoot, zhPath)} (${err.message})`);
    }
  }
  
  // Check key parity between en.json and zh.json
  const relativeFolder = path.relative(frontendRoot, folder);
  for (const key of enKeys) {
    if (!zhKeys.has(key)) {
      findings.push(`Missing key in Simplified Chinese (${relativeFolder}/zh.json): "${key}" (present in en.json)`);
    }
  }
  for (const key of zhKeys) {
    if (!enKeys.has(key)) {
      findings.push(`Missing key in English (${relativeFolder}/en.json): "${key}" (present in zh.json)`);
    }
  }
}

const globalEnKeys = new Set(getFlattenedKeys(globalEnBundle));

function scanFile(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const isTs = filePath.endsWith(".ts") && !filePath.endsWith(".d.ts");
  const scriptKind = isTs ? ts.ScriptKind.TS : ts.ScriptKind.TSX;
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  );

  function visit(node) {
    if (!isTs) {
      if (ts.isJsxText(node)) {
        const text = normalizeJsxText(node.getFullText());
        if (hasLetters(text) && !ALLOWED_JSX_TEXT.has(text)) {
          addFinding(sourceFile, node, "JSX text", text);
        }
      }

      if (ts.isJsxAttribute(node) && USER_FACING_ATTRS.has(node.name.getText())) {
        const initializer = node.initializer;
        if (initializer && ts.isStringLiteral(initializer) && hasLetters(initializer.text)) {
          addFinding(sourceFile, node, `attribute ${node.name.getText()}`, initializer.text);
        }
        if (initializer && ts.isJsxExpression(initializer)) {
          const expression = initializer.expression;
          if (
            expression &&
            (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) &&
            hasLetters(expression.text)
          ) {
            addFinding(sourceFile, node, `attribute ${node.name.getText()}`, expression.text);
          }
        }
      }
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sourceFile);
      if (/(^|\.)showToast$|(^|\.)toast$|(^|\.)alert$/.test(callee)) {
        const firstArg = node.arguments[0];
        if (
          firstArg &&
          (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg)) &&
          hasLetters(firstArg.text)
        ) {
          addFinding(sourceFile, firstArg, `call ${callee}`, firstArg.text);
        }
      }
      
      // Audit translation key references: t("key")
      if (callee === "t") {
        const firstArg = node.arguments[0];
        if (firstArg) {
          let key = null;
          let isTemplateExpr = false;
          let prefix = null;

          if (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg)) {
            key = firstArg.text;
          } else if (ts.isTemplateExpression(firstArg)) {
            isTemplateExpr = true;
            prefix = firstArg.head.text;
          }

          if (key !== null) {
            if (!globalEnKeys.has(key)) {
              addFinding(sourceFile, firstArg, "Missing translation key in configuration", key);
            }
          } else if (isTemplateExpr && prefix) {
            // Check if any key starts with prefix
            let prefixFound = false;
            for (const k of globalEnKeys) {
              if (k.startsWith(prefix)) {
                prefixFound = true;
                break;
              }
            }
            if (!prefixFound) {
              addFinding(sourceFile, firstArg, "Missing translation key prefix in configuration", prefix);
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (fullPath.includes(`${path.sep}shared${path.sep}generated${path.sep}`)) {
        continue;
      }
      walk(fullPath);
      continue;
    }
    if (
      entry.isFile() &&
      (entry.name.endsWith(".tsx") || (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")))
    ) {
      scanFile(fullPath);
    }
  }
}

walk(srcRoot);

if (findings.length > 0) {
  console.error("Found user-facing frontend literals that should use the locale, key parity mismatches, or missing i18n configurations:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log("No hardcoded JSX/toast user-facing literals found, and all i18n keys are correctly configured.");

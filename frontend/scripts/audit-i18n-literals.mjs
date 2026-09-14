import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, "..");
const srcRoot = path.join(frontendRoot, "src");

const NON_USER_FACING_DIRECTORIES = [
  path.join(srcRoot, "features", "design-system") + path.sep,
];

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

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function unwrapExpression(node) {
  let current = node;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function readSupportedLanguageCodes() {
  const languagesPath = path.join(srcRoot, "shared", "constants", "languages.ts");
  const source = fs.readFileSync(languagesPath, "utf8");
  const sourceFile = ts.createSourceFile(
    languagesPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let codes = null;

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(sourceFile) === "SUPPORTED_LANGUAGES" &&
      node.initializer
    ) {
      const initializer = unwrapExpression(node.initializer);
      if (!ts.isArrayLiteralExpression(initializer)) {
        return;
      }
      codes = initializer.elements.flatMap((element) => {
        const language = unwrapExpression(element);
        if (!ts.isObjectLiteralExpression(language)) {
          return [];
        }
        const codeProperty = language.properties.find(
          (property) =>
            ts.isPropertyAssignment(property) &&
            property.name.getText(sourceFile).replaceAll(/["']/g, "") === "code",
        );
        if (!codeProperty || !ts.isPropertyAssignment(codeProperty)) {
          return [];
        }
        const value = unwrapExpression(codeProperty.initializer);
        return ts.isStringLiteral(value) ? [value.text] : [];
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  if (!codes || codes.length === 0 || codes[0] !== "en") {
    throw new Error("SUPPORTED_LANGUAGES must be a non-empty array starting with English");
  }
  if (new Set(codes).size !== codes.length) {
    throw new Error("SUPPORTED_LANGUAGES contains duplicate locale codes");
  }
  return codes;
}

function getFlattenedEntries(obj, prefix = "", entries = new Map()) {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      getFlattenedEntries(value, fullKey, entries);
    } else {
      entries.set(fullKey, value);
    }
  }
  return entries;
}

function pluralParts(key) {
  const match = key.match(PLURAL_SUFFIX);
  return match ? { stem: key.slice(0, -match[0].length), category: match[1] } : null;
}

function tokenSignature(value) {
  if (typeof value !== "string") {
    return [];
  }
  return [
    ...(value.match(/{{[^{}]+}}/g) ?? []),
    ...(value.match(/<\/?[A-Za-z][^>]*>/g) ?? []),
    ...(value.match(/https?:\/\/[^\s<>"')\]]+/g) ?? []),
    ...(value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []),
  ].sort();
}

function sameTokens(left, right) {
  return JSON.stringify(tokenSignature(left)) === JSON.stringify(tokenSignature(right));
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

const supportedLanguageCodes = readSupportedLanguageCodes();
const localesFolders = findLocalesFolders(srcRoot).sort();
const globalEnBundle = {};
const globalEnglishSources = new Map();

// Helper to merge nested objects
function deepMerge(target, source, sourcePath, prefix = "") {
  for (const [key, value] of Object.entries(source)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      target[key] = target[key] || {};
      deepMerge(target[key], value, sourcePath, fullKey);
    } else {
      const existingSource = globalEnglishSources.get(fullKey);
      if (existingSource) {
        findings.push(
          `Duplicate merged English key "${fullKey}" in ${existingSource} and ${sourcePath}`,
        );
      }
      globalEnglishSources.set(fullKey, sourcePath);
      target[key] = value;
    }
  }
}

for (const folder of localesFolders) {
  const enPath = path.join(folder, "en.json");
  const relativeFolder = path.relative(frontendRoot, folder);
  let englishEntries;
  try {
    const english = JSON.parse(fs.readFileSync(enPath, "utf8"));
    englishEntries = getFlattenedEntries(english);
    deepMerge(globalEnBundle, english, path.relative(frontendRoot, enPath));
  } catch (err) {
    findings.push(
      `Failed to parse English locale JSON: ${path.relative(frontendRoot, enPath)} (${err.message})`,
    );
    continue;
  }

  const pluralStems = new Set(
    [...englishEntries.keys()].flatMap((key) => {
      const parts = pluralParts(key);
      return parts ? [parts.stem] : [];
    }),
  );

  for (const language of supportedLanguageCodes) {
    const localePath = path.join(folder, `${language}.json`);
    let localeEntries;
    try {
      localeEntries = getFlattenedEntries(
        JSON.parse(fs.readFileSync(localePath, "utf8")),
      );
    } catch (err) {
      findings.push(
        `Failed to parse ${language} locale JSON: ${path.relative(frontendRoot, localePath)} (${err.message})`,
      );
      continue;
    }

    for (const [key, englishValue] of englishEntries) {
      const englishPlural = pluralParts(key);
      if (
        language !== "en" &&
        englishPlural &&
        pluralStems.has(englishPlural.stem)
      ) {
        continue;
      }
      if (!localeEntries.has(key)) {
        findings.push(`Missing key in ${language} (${relativeFolder}/${language}.json): "${key}"`);
        continue;
      }
      const localeValue = localeEntries.get(key);
      if (typeof localeValue !== "string" || localeValue.trim() === "") {
        findings.push(`Empty or non-string value in ${language} (${relativeFolder}/${language}.json): "${key}"`);
      } else if (!sameTokens(englishValue, localeValue)) {
        findings.push(`Placeholder, markup, or address mismatch in ${language} (${relativeFolder}/${language}.json): "${key}"`);
      }
    }

    if (language === "en") {
      continue;
    }

    const pluralCategories = new Set(
      new Intl.PluralRules(language).resolvedOptions().pluralCategories,
    );
    for (const stem of pluralStems) {
      const reference =
        englishEntries.get(stem) ?? englishEntries.get(`${stem}_other`);
      for (const category of pluralCategories) {
        const key = `${stem}_${category}`;
        const value = localeEntries.get(key);
        if (typeof value !== "string" || value.trim() === "") {
          findings.push(`Missing plural category ${language} (${relativeFolder}/${language}.json): "${key}"`);
        } else if (!sameTokens(reference, value)) {
          findings.push(`Placeholder, markup, or address mismatch in ${language} (${relativeFolder}/${language}.json): "${key}"`);
        }
      }
    }

    for (const [key, value] of localeEntries) {
      if (typeof value !== "string" || value.trim() === "") {
        findings.push(`Empty or non-string value in ${language} (${relativeFolder}/${language}.json): "${key}"`);
      }
      const parts = pluralParts(key);
      if (parts && pluralStems.has(parts.stem)) {
        if (
          parts.category === "zero" ||
          pluralCategories.has(parts.category)
        ) {
          continue;
        }
      } else if (englishEntries.has(key)) {
        continue;
      }
      findings.push(`Unexpected key in ${language} (${relativeFolder}/${language}.json): "${key}"`);
    }
  }
}

const globalEnKeys = new Set(getFlattenedEntries(globalEnBundle).keys());

function scanFile(filePath) {
  if (NON_USER_FACING_DIRECTORIES.some((directory) => filePath.startsWith(directory))) {
    return;
  }

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
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const match = node.moduleSpecifier.text.match(/\/locales\/([^/]+)\.json$/);
      if (match && match[1] !== "en") {
        addFinding(
          sourceFile,
          node.moduleSpecifier,
          "Static non-English locale import",
          node.moduleSpecifier.text,
        );
      }
    }

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

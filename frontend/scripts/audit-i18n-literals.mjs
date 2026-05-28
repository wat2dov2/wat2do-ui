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
  console.error("Found user-facing frontend literals that should use the locale:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log("No hardcoded JSX/toast user-facing literals found.");

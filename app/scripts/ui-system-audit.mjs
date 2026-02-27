import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'src', 'app');
const TARGET_EXTENSIONS = new Set(['.ts', '.tsx']);

const checks = [
  {
    id: 'random-spacing-values',
    message: 'Arbitrary spacing or radius value detected. Prefer tokenized wrapper primitives.',
    pattern:
      /(?:^|[\s"'`])(p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|space-x|space-y|rounded)-\[[^\]]+\]/g,
  },
  {
    id: 'hover-layout-jump',
    message: 'Hover transform can cause layout/perception jump. Use motion token classes.',
    pattern: /hover:(?:scale|translate|skew|rotate)-/g,
  },
  {
    id: 'hard-shadow-value',
    message: 'Custom shadow value found. Prefer surface elevation tokens.',
    pattern: /shadow-\[[^\]]+\]/g,
  },
  {
    id: 'hard-color-value',
    message: 'Hard-coded color class found. Prefer theme/token variables.',
    pattern: /(?:bg|text|border)-\[#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\]/g,
  },
  {
    id: 'dialog-edge-padding',
    message: 'Dialog with p-0 found; verify content has explicit inner spacing wrapper.',
    pattern: /DialogContent[^>\n]*className="[^"\n]*\bp-0\b[^"\n]*"/g,
  },
];

function walk(currentPath, collector) {
  const entries = fs.readdirSync(currentPath, { withFileTypes: true });
  for (const entry of entries) {
    const resolved = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      walk(resolved, collector);
      continue;
    }
    const extension = path.extname(entry.name);
    if (TARGET_EXTENSIONS.has(extension)) {
      collector.push(resolved);
    }
  }
}

function getLine(source, startIndex) {
  const prefix = source.slice(0, startIndex);
  return prefix.split('\n').length;
}

const files = [];
walk(ROOT, files);

const warnings = [];

for (const filePath of files) {
  const source = fs.readFileSync(filePath, 'utf8');
  for (const check of checks) {
    const matches = source.matchAll(check.pattern);
    for (const match of matches) {
      const index = match.index ?? 0;
      const line = getLine(source, index);
      warnings.push({
        check: check.id,
        message: check.message,
        file: path.relative(process.cwd(), filePath).replaceAll('\\', '/'),
        line,
        sample: match[0].trim(),
      });
    }
  }
}

console.log('UI System Anti-pattern Audit');
console.log(`Scanned files: ${files.length}`);
console.log(`Warnings: ${warnings.length}`);

if (warnings.length === 0) {
  console.log('No warnings found.');
  process.exit(0);
}

for (const warning of warnings.slice(0, 200)) {
  console.log(
    `- [${warning.check}] ${warning.file}:${warning.line} :: ${warning.message}\n  sample: ${warning.sample}`
  );
}

if (warnings.length > 200) {
  console.log(`... truncated ${warnings.length - 200} additional warnings`);
}

process.exitCode = 0;

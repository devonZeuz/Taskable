/* global process, console */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const assetsDir = path.join(projectRoot, 'dist', 'assets');

const jsBudgetKb = Number(process.env.BUNDLE_BUDGET_JS_KB || 760);
const cssBudgetKb = Number(process.env.BUNDLE_BUDGET_CSS_KB || 140);

if (!fs.existsSync(assetsDir)) {
  console.error('dist/assets not found. Run `npm run build` first.');
  process.exit(1);
}

const assetFiles = fs.readdirSync(assetsDir);
const assetMetadata = assetFiles.map((file) => {
  const fullPath = path.join(assetsDir, file);
  const stats = fs.statSync(fullPath);
  return {
    file,
    sizeBytes: stats.size,
    sizeKb: stats.size / 1024,
    mtimeMs: stats.mtimeMs,
  };
});

const newestAssetMtimeMs = assetMetadata.reduce(
  (latest, asset) => Math.max(latest, asset.mtimeMs),
  0
);
const currentBuildWindowMs = 120_000;
const currentBuildAssets = assetMetadata.filter(
  (asset) => newestAssetMtimeMs - asset.mtimeMs <= currentBuildWindowMs
);
const assetsToEvaluate = currentBuildAssets.length > 0 ? currentBuildAssets : assetMetadata;
const jsAssets = assetsToEvaluate.filter((asset) => asset.file.endsWith('.js'));
const cssAssets = assetsToEvaluate.filter((asset) => asset.file.endsWith('.css'));

if (jsAssets.length === 0 && cssAssets.length === 0) {
  console.error('No built assets found in dist/assets.');
  process.exit(1);
}

function getLargestAsset(files) {
  return [...files].sort((a, b) => b.sizeBytes - a.sizeBytes)[0];
}

const largestJs = jsAssets.length > 0 ? getLargestAsset(jsAssets) : null;
const largestCss = cssAssets.length > 0 ? getLargestAsset(cssAssets) : null;

let hasError = false;

if (largestJs) {
  console.log(
    `Largest JS: ${largestJs.file} (${largestJs.sizeKb.toFixed(2)} KB), budget ${jsBudgetKb} KB`
  );
  if (largestJs.sizeKb > jsBudgetKb) {
    console.error('JS bundle size budget exceeded.');
    hasError = true;
  }
}

if (largestCss) {
  console.log(
    `Largest CSS: ${largestCss.file} (${largestCss.sizeKb.toFixed(2)} KB), budget ${cssBudgetKb} KB`
  );
  if (largestCss.sizeKb > cssBudgetKb) {
    console.error('CSS bundle size budget exceeded.');
    hasError = true;
  }
}

if (hasError) {
  process.exit(1);
}

console.log('Bundle size budgets are within limits.');

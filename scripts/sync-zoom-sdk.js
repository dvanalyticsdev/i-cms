const fs = require('fs');
const path = require('path');

const sourceDir = path.join(__dirname, '..', 'node_modules', '@zoom', 'meetingsdk', 'dist');
const targetDir = path.join(__dirname, '..', 'public', 'zoom-sdk', 'dist');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyDirRecursive(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function run() {
  if (!fs.existsSync(sourceDir)) {
    console.warn('[sync-zoom-sdk] Source not found. Skipping copy:', sourceDir);
    console.warn('[sync-zoom-sdk] Run npm install to fetch @zoom/meetingsdk first.');
    return;
  }

  ensureDir(path.dirname(targetDir));

  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }

  copyDirRecursive(sourceDir, targetDir);
  console.log('[sync-zoom-sdk] Synced Zoom SDK dist assets to public/zoom-sdk/dist');
}

run();

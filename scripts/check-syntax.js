#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT_DIR = process.cwd();
const TARGET_DIRS = ['electron', 'src', 'scripts'];
const SOURCE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);
const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'release', 'coverage']);

function collectSourceFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) {
        files.push(...collectSourceFiles(fullPath));
      }
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (SOURCE_EXTENSIONS.has(extension)) {
      files.push(fullPath);
    }
  }

  return files;
}

function runSyntaxCheck(filePath) {
  const result = spawnSync(process.execPath, ['--check', filePath], {
    cwd: ROOT_DIR,
    encoding: 'utf-8'
  });

  return {
    filePath,
    ok: result.status === 0,
    output: `${result.stdout || ''}${result.stderr || ''}`.trim()
  };
}

function main() {
  const candidates = [];

  for (const targetDir of TARGET_DIRS) {
    const absoluteDir = path.join(ROOT_DIR, targetDir);
    if (!fs.existsSync(absoluteDir)) {
      continue;
    }
    candidates.push(...collectSourceFiles(absoluteDir));
  }

  const files = Array.from(new Set(candidates)).sort((a, b) => a.localeCompare(b));

  if (files.length === 0) {
    console.error(`[check] No source files found under: ${TARGET_DIRS.join(', ')}.`);
    process.exit(1);
  }

  const failures = [];

  for (const filePath of files) {
    const result = runSyntaxCheck(filePath);
    if (!result.ok) {
      failures.push(result);
    }
  }

  if (failures.length > 0) {
    console.error(`[check] Syntax check failed (${failures.length}/${files.length}):`);
    for (const failure of failures) {
      const relativePath = path.relative(ROOT_DIR, failure.filePath);
      console.error(`\n- ${relativePath}`);
      if (failure.output) {
        console.error(failure.output);
      }
    }
    process.exit(1);
  }

  console.log(`[check] Syntax check passed (${files.length} files).`);
}

main();

#!/usr/bin/env node
/**
 * Build the Linko inbox.
 *
 * Two steps and no bundler: `tsc` emits plain ES modules, then the static shell
 * and stylesheet are copied next to them. The result is a directory that any
 * static server can host, which is what keeps the preview free of a dependency
 * graph and a dev server.
 */

import { spawnSync } from 'node:child_process';
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..');
const repoRoot = join(packageRoot, '..', '..');
const dist = join(packageRoot, 'dist');

const tsc = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const parent = entry.parentPath ?? entry.path;
    files.push(relative(dist, join(parent, entry.name)));
  }
  return files.sort();
}

async function main() {
  if (!(await exists(tsc))) {
    console.error(`TypeScript was not found at ${tsc}. Run \`pnpm install\` first.`);
    process.exitCode = 1;
    return;
  }

  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  const compiled = spawnSync(process.execPath, [tsc, '-p', join(packageRoot, 'tsconfig.json')], {
    stdio: 'inherit',
    cwd: repoRoot,
  });
  if (compiled.status !== 0) {
    console.error('TypeScript reported errors; the build stopped before copying static files.');
    process.exitCode = compiled.status ?? 1;
    return;
  }

  for (const asset of ['index.html', 'theme.css']) {
    const from = asset === 'theme.css' ? join(packageRoot, 'src', asset) : join(packageRoot, asset);
    await cp(from, join(dist, asset));
  }

  const files = await listFiles(dist);
  console.log(`Built ${files.length} file(s) into ${relative(repoRoot, dist)}:`);
  for (const file of files) console.log(`  ${file}`);
}

await main();

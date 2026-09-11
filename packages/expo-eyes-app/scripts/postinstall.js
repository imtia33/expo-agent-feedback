#!/usr/bin/env node
/**
 * Postinstall script — runs automatically after `npm install`.
 *
 * Builds the app SDK (npx tsc) and copies the dist into the demo app's
 * node_modules so the demo app picks up the latest code without the user
 * having to manually build + copy.
 *
 * This is what makes `npm install && npm start` "just work" for the demo.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const pkgRoot = path.resolve(__dirname, '..');
const demoNodeModules = path.join(pkgRoot, '..', '..', 'examples', 'demo-app', 'node_modules', 'expo-eyes-app');

console.log('[expo-eyes-app] postinstall: building TypeScript...');

try {
  // Build the app SDK
  execSync('npx tsc', { cwd: pkgRoot, stdio: 'inherit' });
  console.log('[expo-eyes-app] build complete');
} catch (e) {
  console.warn('[expo-eyes-app] build failed:', e.message);
  console.warn('[expo-eyes-app] the package may not work correctly without a build');
  process.exit(0); // don't fail install
}

// If the demo app's node_modules has expo-eyes-app (via file: dep), copy dist over
if (fs.existsSync(demoNodeModules)) {
  console.log('[expo-eyes-app] syncing dist to demo-app/node_modules/expo-eyes-app...');
  try {
    if (process.platform === 'win32') {
      execSync(`xcopy /E /I /Y "${path.join(pkgRoot, 'dist')}" "${path.join(demoNodeModules, 'dist')}"`, { stdio: 'inherit', shell: true });
    } else {
      execSync(`cp -r "${path.join(pkgRoot, 'dist')}/." "${path.join(demoNodeModules, 'dist')}/"`, { stdio: 'inherit', shell: true });
    }
    // Also copy package.json so the demo knows the main entry
    fs.copyFileSync(path.join(pkgRoot, 'package.json'), path.join(demoNodeModules, 'package.json'));
    console.log('[expo-eyes-app] sync complete');
  } catch (e) {
    console.warn('[expo-eyes-app] sync failed:', e.message);
  }
}

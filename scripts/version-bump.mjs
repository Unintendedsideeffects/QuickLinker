#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';

function bumpVersion() {
  try {
    // Read package.json to get the new version
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const newVersion = pkg.version;

    // Update manifest.json
    const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
    const minAppVersion = manifest.minAppVersion;
    manifest.version = newVersion;
    writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');

    // Update versions.json
    const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
    versions[newVersion] = minAppVersion;
    writeFileSync('versions.json', JSON.stringify(versions, null, 2) + '\n');

    console.log(`✅ Version bumped to ${newVersion}`);
    console.log(`   - Updated manifest.json`);
    console.log(`   - Updated versions.json`);
  } catch (error) {
    console.error('❌ Error bumping version:', error.message);
    process.exit(1);
  }
}

bumpVersion();

#!/usr/bin/env node
import { readFileSync } from 'fs';

function validateVersions() {
  try {
    const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const versions = JSON.parse(readFileSync('versions.json', 'utf8'));

    const manifestVersion = manifest.version;
    const pkgVersion = pkg.version;

    console.log(`Manifest version: ${manifestVersion}`);
    console.log(`Package.json version: ${pkgVersion}`);

    if (manifestVersion !== pkgVersion) {
      console.error('❌ Version mismatch between manifest.json and package.json!');
      process.exit(1);
    }

    if (!versions[manifestVersion]) {
      console.error(`❌ Version ${manifestVersion} not found in versions.json!`);
      process.exit(1);
    }

    const minAppVersion = manifest.minAppVersion;
    const versionsMinApp = versions[manifestVersion];

    if (minAppVersion !== versionsMinApp) {
      console.error(`❌ minAppVersion mismatch: manifest has ${minAppVersion}, versions.json has ${versionsMinApp}`);
      process.exit(1);
    }

    console.log('✅ All versions are consistent!');
  } catch (error) {
    console.error('❌ Error validating versions:', error.message);
    process.exit(1);
  }
}

validateVersions();

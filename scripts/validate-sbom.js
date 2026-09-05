const fs = require('node:fs');
const path = require('node:path');

function fail(message) {
  console.error(`SBOM validation failed: ${message}`);
  process.exit(1);
}

const target = process.argv[2];
if (!target) fail('missing SBOM file path');

const resolved = path.resolve(process.cwd(), target);
if (!fs.existsSync(resolved)) fail('SBOM file does not exist');

let sbom;
try {
  sbom = JSON.parse(fs.readFileSync(resolved, 'utf8'));
} catch {
  fail('SBOM is not valid JSON');
}

if (!sbom || typeof sbom !== 'object' || Array.isArray(sbom)) fail('SBOM root must be an object');
if (sbom.bomFormat !== 'CycloneDX') fail('bomFormat must be CycloneDX');
if (typeof sbom.specVersion !== 'string' || !sbom.specVersion) fail('specVersion is required');
if (!sbom.metadata || typeof sbom.metadata !== 'object') fail('metadata is required');
if (!sbom.metadata.component || typeof sbom.metadata.component !== 'object') fail('metadata.component is required');

const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
const root = sbom.metadata.component;
if (root.name !== pkg.name) fail('root component name does not match package.json');
if (pkg.version && root.version !== pkg.version) fail('root component version does not match package.json');
if (!Array.isArray(sbom.components)) fail('components must be an array');
if (!Array.isArray(sbom.dependencies)) fail('dependencies must be an array');

const forbiddenKeys = new Set([
  'authorization',
  'cookie',
  'credentials',
  'password',
  'private_key',
  'privatekey',
  'secret',
  'token'
]);

const forbiddenValues = [
  '-----BEGIN PRIVATE KEY-----',
  '-----BEGIN RSA PRIVATE KEY-----',
  '-----BEGIN EC PRIVATE KEY-----'
];

function walk(value) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item);
    return;
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') {
      for (const marker of forbiddenValues) {
        if (value.includes(marker)) fail('forbidden credential material marker found');
      }
    }
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replace(/[-_]/g, '').toLowerCase();
    if (forbiddenKeys.has(key.toLowerCase()) || forbiddenKeys.has(normalized)) {
      fail(`forbidden sensitive key found: ${key}`);
    }
    walk(child);
  }
}

walk(sbom);
console.log(`SBOM_OK root=${root.name}@${root.version || 'unknown'} components=${sbom.components.length}`);

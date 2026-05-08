const fs = require('node:fs');
const path = require('node:path');

const workspaceRoot = path.join(__dirname, '..');
const packageJsonPath = path.join(workspaceRoot, 'package.json');
const versionJsonPath = path.join(workspaceRoot, 'version.json');

function main() {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const versionJson = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));
  const nextVersion = String(versionJson.appVersion || '').trim();
  const githubRepo = String(versionJson.githubRepo || '').trim();
  const publishUrl = githubRepo ? `https://github.com/${githubRepo}/releases/latest/download` : '';
  let updated = false;

  if (nextVersion && packageJson.version !== nextVersion) {
    packageJson.version = nextVersion;
    updated = true;
  }

  const nextPublish = publishUrl
    ? [{ provider: 'generic', url: publishUrl }]
    : [];
  const currentPublish = JSON.stringify(packageJson.build?.publish || []);
  const desiredPublish = JSON.stringify(nextPublish);

  if (currentPublish !== desiredPublish) {
    packageJson.build = packageJson.build || {};
    packageJson.build.publish = nextPublish;
    updated = true;
  }

  if (!updated) {
    return;
  }

  fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
}

main();
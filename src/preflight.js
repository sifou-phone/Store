// Runs before anything touches the database: checks the Node.js version,
// loads an optional .env file and silences the node:sqlite experimental notice.
const fs = require('node:fs');
const path = require('node:path');

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(
    `\n✖ هذا المتجر يتطلب Node.js 22.13 أو أحدث، والإصدار المثبت عندك هو ${process.versions.node}.\n` +
      '  حمّل آخر إصدار LTS من https://nodejs.org ثم أعد تشغيل: npm install && npm start\n' +
      `\n✖ Node.js 22.13+ is required (found ${process.versions.node}). Download it from https://nodejs.org\n`
  );
  process.exit(1);
}

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

const emit = process.emitWarning;
process.emitWarning = function (warning, ...args) {
  const type = typeof args[0] === 'string' ? args[0] : args[0] && args[0].type;
  if (type === 'ExperimentalWarning' && String(warning).includes('SQLite')) return;
  return emit.call(process, warning, ...args);
};

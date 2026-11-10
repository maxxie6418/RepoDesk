// Keep Node alive while Electron's asynchronous installer extracts its archive.
const fs = require('node:fs');
const path = require('node:path');

const electronDir = path.join(__dirname, '..', 'node_modules', 'electron');
if (!fs.existsSync(path.join(electronDir, 'dist', 'electron.exe'))) {
  fs.rmSync(path.join(electronDir, 'path.txt'), { force: true });
}
const timer = setInterval(() => {
  if (fs.existsSync(path.join(electronDir, 'path.txt')) &&
      fs.existsSync(path.join(electronDir, 'dist', 'electron.exe'))) {
    clearInterval(timer);
    clearTimeout(timeout);
  }
}, 500);
const timeout = setTimeout(() => {
  console.error('Electron installation timed out.');
  process.exit(1);
}, 120000);

require(path.join(electronDir, 'install.js'));

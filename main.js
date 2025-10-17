const path = require('path');

const compiledPath = path.join(__dirname, 'dist', 'main.js');

let compiled;
try {
  compiled = require(compiledPath);
} catch (error) {
  console.error(`Daily Link Clipper: failed to load bundle at ${compiledPath}. Run \`npm run build\` and try again.`, error);
  throw error;
}

const pluginExport = compiled && typeof compiled === 'object' && 'default' in compiled ? compiled.default : compiled;

module.exports = pluginExport;
module.exports.default = pluginExport;

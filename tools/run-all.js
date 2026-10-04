/* Runs every suite. Use: node tools/run-all.js                            */

const { spawnSync } = require('child_process');
const path = require('path');

const SUITES = [
  ['js/filter-engine.js + charts consumers', 'test-filter-engine.js'],
  ['google-apps-script/Code.gs', 'test-code-gs.js'],
  ['Code.gs <-> browser table parity', 'test-parity.js'],
  ['end-to-end browser smoke test', 'smoke-test.js']
];

let failed = 0;

SUITES.forEach(([label, file], i) => {
  if (i) console.log('\n' + '='.repeat(72) + '\n');
  console.log('SUITE ' + (i + 1) + '/' + SUITES.length + ': ' + label);
  console.log('='.repeat(72));
  const r = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
});

console.log('\n' + '='.repeat(72));
console.log(failed ? failed + ' of ' + SUITES.length + ' SUITES FAILED' : 'ALL ' + SUITES.length + ' SUITES PASSED');
process.exit(failed ? 1 : 0);

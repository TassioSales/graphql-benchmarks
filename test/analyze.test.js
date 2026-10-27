const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { extractMetric, average, formatNumber, runAnalysis, servers } = require('../analyze');

console.log('Running analyze.js unit tests...');

// 1. Test extractMetric
const sampleWrkOutput = `
Running 10s test @ http://localhost:8000/graphql
  4 threads and 100 connections
  Thread Stats   Avg      Stdev     Max   +/- Stdev
    Latency    15.42ms    4.20ms  45.10ms   78.10%
    Req/Sec     1.62k   240.12     2.10k    72.00%
  64500 requests in 10.02s, 15.20MB read
Requests/sec:   6435.12
Transfer/sec:      1.52MB
`;

const reqSec = extractMetric(sampleWrkOutput, 'Requests/sec');
assert.strictEqual(reqSec, 6435.12, 'Should extract Requests/sec correctly');

const latency = extractMetric(sampleWrkOutput, 'Latency');
assert.strictEqual(latency, 15.42, 'Should extract Latency correctly and strip ms');

// 2. Test average
const avg = average([10, 20, 30]);
assert.strictEqual(avg, 20, 'Average should be 20');
assert.strictEqual(average([]), 0, 'Average of empty array should be 0');

// 3. Test formatNumber
const formatted = formatNumber(22805);
assert.strictEqual(formatted, '22,805.00', 'Should format with commas and two decimals');

// 4. End-to-end test with mock benchmark files
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-test-'));
const mockFiles = [];

for (let i = 0; i < servers.length; i++) {
  for (let run = 1; run <= 3; run++) {
    const filename = path.join(tempDir, `bench1_result${run}_graphql_${servers[i]}.txt`);
    const mockContent = `
    Latency    ${(10 + i * 2).toFixed(2)}ms    1.00ms  20.00ms   80.00%
Requests/sec:   ${(1000 - i * 50).toFixed(2)}
    `;
    fs.writeFileSync(filename, mockContent);
    mockFiles.push(filename);
  }
}

// Run analysis on mock bench 1
const originalCwd = process.cwd();
process.chdir(tempDir);

try {
  runAnalysis(mockFiles);
  assert.ok(fs.existsSync(path.join(tempDir, 'results.md')), 'results.md should be created');
  const resultsContent = fs.readFileSync(path.join(tempDir, 'results.md'), 'utf-8');
  assert.ok(resultsContent.includes('<!-- PERFORMANCE_RESULTS_START -->'), 'Should have start marker');
  assert.ok(resultsContent.includes('| Query | Server | Requests/sec | Latency (ms) | Relative |'), 'Should have table headers');
  assert.ok(resultsContent.includes('[Apollo GraphQL]'), 'Should contain formatted server names');
  console.log('Mock results.md content verified!');
} finally {
  process.chdir(originalCwd);
  // Cleanup tempDir
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('✅ ALL TESTS PASSED!');

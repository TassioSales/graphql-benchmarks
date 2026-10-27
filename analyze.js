#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const formattedServerNames = {
  tailcall: 'Tailcall',
  gqlgen: 'Gqlgen',
  apollo: 'Apollo GraphQL',
  netflixdgs: 'Netflix DGS',
  caliban: 'Caliban',
  async_graphql: 'async-graphql',
  hasura: 'Hasura',
  graphql_jit: 'GraphQL JIT',
};

const servers = [
  'apollo',
  'caliban',
  'netflixdgs',
  'gqlgen',
  'tailcall',
  'async_graphql',
  'hasura',
  'graphql_jit',
];

function extractMetric(content, metric) {
  // Matches lines like:
  // "    Latency    15.42ms    4.20ms  45.10ms   78.10%" -> returns 15.42
  // "Requests/sec:   6435.12" -> returns 6435.12
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    if (line.includes(metric)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        let valStr = parts[1].replace(/ms/g, '').replace(/,/g, '');
        // If metric is "Latency", wrk format is: Latency <avg> <stdev> <max>
        // If metric is "Requests/sec", format is: Requests/sec: <value>
        const val = parseFloat(valStr);
        if (!isNaN(val)) {
          return val;
        }
      }
    }
  }
  return 0;
}

function average(numbers) {
  if (!numbers || numbers.length === 0) return 0;
  const sum = numbers.reduce((acc, curr) => acc + curr, 0);
  return sum / numbers.length;
}

function formatNumber(num) {
  return Number(num).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function plotHistograms(whichBench, reqSecDataPath, latencyDataPath, reqSecHistogramFile, latencyHistogramFile) {
  const gnuplotScript = `
    set term pngcairo size 1280,720 enhanced font "Courier,12"
    set output "${reqSecHistogramFile.replace(/\\/g, '/')}"
    set style data histograms
    set style histogram cluster gap 1
    set style fill solid border -1
    set xtics rotate by -45
    set boxwidth 0.9
    set title "Requests/Sec"
    stats "${reqSecDataPath.replace(/\\/g, '/')}" using 2 nooutput
    set yrange [0:STATS_max*1.2]
    set key outside right top
    plot "${reqSecDataPath.replace(/\\/g, '/')}" using 2:xtic(1) title "Req/Sec"

    set output "${latencyHistogramFile.replace(/\\/g, '/')}"
    set title "Latency (in ms)"
    stats "${latencyDataPath.replace(/\\/g, '/')}" using 2 nooutput
    set yrange [0:STATS_max*1.2]
    plot "${latencyDataPath.replace(/\\/g, '/')}" using 2:xtic(1) title "Latency"
  `;

  try {
    const res = spawnSync('gnuplot', [], {
      input: gnuplotScript,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (res.error) {
      console.warn('Note: gnuplot not found or execution failed, skipping chart generation.');
    }
  } catch (err) {
    console.warn('Note: Error running gnuplot:', err.message);
  }
}

function runAnalysis(args) {
  if (args.length === 0) {
    console.error('Usage: node analyze.js <resultFiles...>');
    process.exit(1);
  }

  const resultFiles = args;
  const firstArg = path.basename(resultFiles[0]);

  let whichBench = 1;
  if (firstArg.startsWith('bench2')) {
    whichBench = 2;
  } else if (firstArg.startsWith('bench3')) {
    whichBench = 3;
  }

  const avgReqSecs = {};
  const avgLatencies = {};

  // Extract metrics and calculate averages for each server (3 runs each)
  servers.forEach((server, idx) => {
    const startIdx = idx * 3;
    const reqSecVals = [];
    const latencyVals = [];

    for (let j = 0; j < 3; j++) {
      const fileIdx = startIdx + j;
      if (fileIdx < resultFiles.length) {
        const filePath = resultFiles[fileIdx];
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf-8');
          reqSecVals.push(extractMetric(content, 'Requests/sec'));
          latencyVals.push(extractMetric(content, 'Latency'));
        }
      }
    }

    avgReqSecs[server] = average(reqSecVals);
    avgLatencies[server] = average(latencyVals);
  });

  // Generate data files for gnuplot
  const tmpDir = os.tmpdir();
  const reqSecData = path.join(tmpDir, 'reqSec.dat');
  const latencyData = path.join(tmpDir, 'latency.dat');

  let reqSecDataContent = 'Server Value\n';
  servers.forEach((server) => {
    reqSecDataContent += `${server} ${avgReqSecs[server]}\n`;
  });
  fs.writeFileSync(reqSecData, reqSecDataContent);

  let latencyDataContent = 'Server Value\n';
  servers.forEach((server) => {
    latencyDataContent += `${server} ${avgLatencies[server]}\n`;
  });
  fs.writeFileSync(latencyData, latencyDataContent);

  const reqSecHistogramFile = `req_sec_histogram${whichBench}.png`;
  const latencyHistogramFile = `latency_histogram${whichBench}.png`;

  // Plot using gnuplot
  plotHistograms(whichBench, reqSecData, latencyData, reqSecHistogramFile, latencyHistogramFile);

  // Move PNGs to assets
  const assetsDir = path.resolve('assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  if (fs.existsSync(reqSecHistogramFile)) {
    fs.renameSync(reqSecHistogramFile, path.join(assetsDir, reqSecHistogramFile));
  }
  if (fs.existsSync(latencyHistogramFile)) {
    fs.renameSync(latencyHistogramFile, path.join(assetsDir, latencyHistogramFile));
  }

  // Sort servers by RPS in descending order
  const sortedServers = [...servers].sort((a, b) => avgReqSecs[b] - avgReqSecs[a]);
  console.log(`Sorted servers: ${sortedServers.join(' ')}`);

  const lastServer = sortedServers[sortedServers.length - 1];
  const lastServerReqSecs = avgReqSecs[lastServer] || 1; // avoid division by 0

  // Start building resultsTable
  let resultsTable = '';
  if (whichBench === 1) {
    resultsTable = '<!-- PERFORMANCE_RESULTS_START -->\n\n| Query | Server | Requests/sec | Latency (ms) | Relative |\n|-------:|--------:|--------------:|--------------:|---------:|\n| 1 | `{ posts { id userId title user { id name email }}}` |';
  } else if (whichBench === 2) {
    resultsTable = '| 2 | `{ posts { title }}` |';
  } else if (whichBench === 3) {
    resultsTable = '| 3 | `{ greet }` |';
  }

  // Build rows with sorted servers
  for (const server of sortedServers) {
    const formattedReqSecs = formatNumber(avgReqSecs[server]);
    const formattedLatencies = formatNumber(avgLatencies[server]);
    const relativePerformance = (avgReqSecs[server] / lastServerReqSecs).toFixed(2);

    resultsTable += `\n|| [${formattedServerNames[server] || server}] | \`${formattedReqSecs}\` | \`${formattedLatencies}\` | \`${relativePerformance}x\` |`;
  }

  if (whichBench === 3) {
    resultsTable += '\n\n<!-- PERFORMANCE_RESULTS_END -->';
  }

  console.log(`resultsTable: ${resultsTable}`);

  const resultsFile = path.resolve('results.md');
  if (whichBench === 1) {
    fs.writeFileSync(resultsFile, resultsTable + '\n');
  } else {
    fs.appendFileSync(resultsFile, '\n' + resultsTable + '\n');
  }

  if (whichBench === 3) {
    const finalResults = fs.readFileSync(resultsFile, 'utf-8').trim();
    const cleanOutput = finalResults
      .replace('<!-- PERFORMANCE_RESULTS_START -->', '')
      .replace('<!-- PERFORMANCE_RESULTS_END -->', '')
      .trim();
    console.log(cleanOutput);

    const readmeFile = path.resolve('README.md');
    if (fs.existsSync(readmeFile)) {
      let readmeContent = fs.readFileSync(readmeFile, 'utf-8');
      const startMarker = '<!-- PERFORMANCE_RESULTS_START -->';
      const endMarker = '<!-- PERFORMANCE_RESULTS_END -->';

      if (readmeContent.includes(startMarker) && readmeContent.includes(endMarker)) {
        const regex = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`, 'g');
        readmeContent = readmeContent.replace(regex, `${startMarker}\n\n${cleanOutput}\n\n${endMarker}`);
        fs.writeFileSync(readmeFile, readmeContent);
      } else {
        fs.appendFileSync(readmeFile, `\n\n${finalResults}\n`);
      }
    }
  }

  // Cleanup result text files
  for (const file of resultFiles) {
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
      } catch (err) {
        // ignore deletion errors
      }
    }
  }
}

if (require.main === module) {
  runAnalysis(process.argv.slice(2));
}

module.exports = {
  extractMetric,
  average,
  formatNumber,
  runAnalysis,
  servers,
  formattedServerNames,
};

#!/usr/bin/env node
import { createTestEnvironment } from './harness.mjs';
import { runTier1 } from './tier1_features.test.mjs';
import { runTier2 } from './tier2_boundaries.test.mjs';
import { runTier3 } from './tier3_pairwise.test.mjs';
import { runTier4 } from './tier4_workloads.test.mjs';

function parseArgs(args) {
  const options = {
    tier: 'all',
    browser: 'auto',
    port: null,
    verbose: false,
    filter: null
  };

  for (const arg of args) {
    if (arg.startsWith('--tier=')) {
      options.tier = arg.split('=')[1].toLowerCase();
    } else if (arg.startsWith('--browser=')) {
      options.browser = arg.split('=')[1].toLowerCase();
    } else if (arg.startsWith('--port=')) {
      options.port = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg.startsWith('--filter=')) {
      options.filter = arg.split('=')[1];
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Pure-Rust WebAssembly WebP Engine - E2E Test Runner

Usage:
  node tests/e2e/runner.mjs [options]

Options:
  --tier=<1|2|3|4|all>         Specify testing tier to execute (default: all)
  --browser=<auto|obscura|chrome-headless-shell>
                               Specify headless browser (default: auto)
                               1st Priority: obscura (D:\\DevEnv\\browsers\\obscura\\)
                               2nd Priority: chrome-headless-shell fallback
  --port=<number>              Remote debugging port (default: auto random)
  --filter=<string>            Filter test cases by name or ID
  --verbose, -v                Enable detailed logging
  --help, -h                   Display this help message
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  console.log('================================================================');
  console.log(' WebAssembly WebP Engine & iOS Metal Pipeline E2E Test Runner');
  console.log('================================================================');
  console.log(` Tier:    ${options.tier}`);
  console.log(` Browser: ${options.browser}`);
  console.log('----------------------------------------------------------------\n');

  const startTime = performance.now();
  let env = null;

  try {
    env = await createTestEnvironment({
      browser: options.browser,
      port: options.port,
      verbose: options.verbose
    });

    console.log(`[OK] Browser online: ${env.client.activeBrowser}`);
    console.log(`[OK] Target initialized: ${env.client.targetId}`);
    console.log(`[OK] Fixtures loaded: ${Object.keys(env.fixtures).length} assets\n`);

    const allResults = [];

    const shouldRunTier = (t) => options.tier === 'all' || options.tier === String(t);

    if (shouldRunTier(1)) {
      console.log('=== Executing Tier 1: Feature Coverage ===');
      const res1 = await runTier1(env);
      allResults.push(...res1);
      printTierSummary(res1);
    }

    if (shouldRunTier(2)) {
      console.log('\n=== Executing Tier 2: Boundary & Corner Cases ===');
      const res2 = await runTier2(env);
      allResults.push(...res2);
      printTierSummary(res2);
    }

    if (shouldRunTier(3)) {
      console.log('\n=== Executing Tier 3: Pairwise Cross-Feature Combinations ===');
      const res3 = await runTier3(env);
      allResults.push(...res3);
      printTierSummary(res3);
    }

    if (shouldRunTier(4)) {
      console.log('\n=== Executing Tier 4: Real-World Application Scenarios ===');
      const res4 = await runTier4(env);
      allResults.push(...res4);
      printTierSummary(res4);
    }

    const totalDuration = ((performance.now() - startTime) / 1000).toFixed(2);
    const passed = allResults.filter(r => r.passed).length;
    const failed = allResults.filter(r => !r.passed).length;
    const total = allResults.length;

    console.log('\n================================================================');
    console.log(` E2E TEST RUN SUMMARY: ${passed}/${total} PASSED (${failed} FAILED)`);
    console.log(` Total Time: ${totalDuration}s`);
    console.log('================================================================');

    if (failed > 0) {
      console.error('\nFAILED TESTS:');
      for (const r of allResults.filter(r => !r.passed)) {
        console.error(`  [FAIL] ${r.id}: ${r.name}`);
        console.error(`         Error: ${r.error}\n`);
      }
      process.exit(1);
    } else {
      console.log('\nALL TESTS PASSED SUCCESSFULLY! [OK]');
      process.exit(0);
    }

  } catch (err) {
    console.error('\n[FATAL ERROR] E2E Runner encountered unhandled exception:');
    console.error(err);
    process.exit(2);
  } finally {
    if (env) {
      await env.close();
    }
  }
}

function printTierSummary(results) {
  for (const r of results) {
    const mark = r.passed ? '✓ PASS' : '✗ FAIL';
    const time = `${r.durationMs.toFixed(1)}ms`;
    console.log(`  ${mark} [${r.id}] ${r.name} (${time})`);
    if (!r.passed) {
      console.log(`         -> ${r.error}`);
    }
  }
  const passed = results.filter(r => r.passed).length;
  console.log(`  Summary: ${passed}/${results.length} passed.`);
}

main();

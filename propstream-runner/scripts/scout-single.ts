// Scout one county for one signal in a completely fresh session.
// Ground-truth tool for verifying bulk-scout results.
//   npx tsx scripts/scout-single.ts <signal> "<search term>"
import { loadConfig } from "../src/config.js";
import { PropStreamRunner } from "../src/runner.js";

const signal = process.argv[2] || "tax_delinquent";
const searchTerm = process.argv[3] || "Cuyahoga County, OH";

const config = loadConfig();
const runner = await PropStreamRunner.create(config);
const results = await (runner as unknown as { propstream: { scoutCounty: (t: string, s: string[]) => Promise<unknown> } }).propstream.scoutCounty(searchTerm, [signal]);
console.log(JSON.stringify({ searchTerm, results }));
await runner.shutdown();

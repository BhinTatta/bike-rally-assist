#!/usr/bin/env node
/**
 * rally - developer CLI for the co-driver engine.
 *
 *   rally corners    <gpx>            analyse a route, print a corner table
 *   rally simulate   <gpx>            ride it and print the calls
 *   rally debug-map  <gpx>            write a standalone Leaflet map
 *   rally gen-sample <out.gpx>        regenerate the sample ghat route
 */

import { parseArgs } from "node:util";
import { cornersCommand } from "./commands/corners.js";
import { simulateCommand } from "./commands/simulate.js";
import { debugMapCommand } from "./commands/debugMap.js";
import { genSampleCommand } from "./commands/genSample.js";
import { bold, COMMON_FLAG_HELP, dim, red } from "./util.js";

const HELP = `${bold("rally")} - rally co-driver developer tools

${bold("Usage")}
  rally corners <route.gpx> [options]
  rally simulate <route.gpx> [options]
  rally debug-map <route.gpx> [options]
  rally gen-sample <out.gpx>

${bold("corners")}      parse a GPX, detect corners, print a table and write corners.json
  --out <file>       output JSON path (default corners.json)
${COMMON_FLAG_HELP}

${bold("simulate")}     replay a ride through the co-driver and print timestamped calls
  --speed <kmh>      constant ride speed (default 40)
  --noise <m>        GPS noise, 1 sigma (default 0)
  --rate <hz>        fix rate (default 1)
  --seed <n>         noise seed (default 1)
  --lateral-g <g>    slow for corners at this cornering force (e.g. 0.4)
  --replay <gpx>     replay a recorded ride GPX instead of simulating
  --out <file>       also write the calls as JSON
${COMMON_FLAG_HELP}

${bold("debug-map")}    write a standalone Leaflet HTML map, corners coloured by grade
  --out <file>       output HTML path (default debug-map.html)
${COMMON_FLAG_HELP}
`;

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      out: { type: "string" },
      speed: { type: "string" },
      noise: { type: "string" },
      rate: { type: "string" },
      seed: { type: "string" },
      "lateral-g": { type: "string" },
      replay: { type: "string" },
      spacing: { type: "string" },
      smooth: { type: "string" },
      span: { type: "string" },
      lead: { type: "string" },
      lag: { type: "string" },
      rally: { type: "boolean" },
      "max-number": { type: "string" },
    },
  });

  const [command, file] = positionals;
  if (values.help === true || command === undefined) {
    console.log(HELP);
    return command === undefined && values.help !== true ? 1 : 0;
  }

  const needsFile = (): string => {
    if (file === undefined) throw new Error(`${command} needs a file argument`);
    return file;
  };

  switch (command) {
    case "corners":
      cornersCommand(needsFile(), values);
      return 0;
    case "simulate":
      simulateCommand(needsFile(), values);
      return 0;
    case "debug-map":
      debugMapCommand(needsFile(), values);
      return 0;
    case "gen-sample":
      genSampleCommand(needsFile());
      return 0;
    default:
      console.error(red(`Unknown command "${command}"`));
      console.log(dim(HELP));
      return 1;
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(red(`rally: ${(error as Error).message}`));
  process.exitCode = 1;
}

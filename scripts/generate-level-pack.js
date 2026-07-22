const fs = require("node:fs");
const path = require("node:path");

global.window = global;
require(path.join(__dirname, "..", "engine.js"));

const { BOARD_SIZE, GOAL_ROW, generateLevel, solveLevel } = global.BlockMoverEngine;
const requestedCount = Number(process.argv[2]);
const LEVEL_COUNT = Number.isInteger(requestedCount) && requestedCount > 0 ? requestedCount : 50;
const levels = [];

for (let number = 1; number <= LEVEL_COUNT; number += 1) {
  const generated = generateLevel(number);
  const verification = solveLevel(generated, { maxNodes: 250000, includePath: false });
  if (!verification.solved) throw new Error(`Level ${number} has no verified solution.`);

  levels.push({
    number,
    seed: generated.seed,
    difficulty: generated.difficulty,
    par: verification.depth,
    blocks: generated.blocks.map((block) => [
      block.axis,
      block.len,
      block.x,
      block.y,
      block.goal ? 1 : 0,
      block.hue,
    ]),
  });

  process.stdout.write(`Verified level ${String(number).padStart(2, "0")} — ${verification.depth} moves\n`);
}

const pack = {
  version: 1,
  boardSize: BOARD_SIZE,
  goalRow: GOAL_ROW,
  blockFormat: ["axis", "length", "x", "y", "goal", "hue"],
  levels,
};

const output = `window.NEON_SHIFT_LEVEL_PACK=${JSON.stringify(pack)};\n`;
const outputPath = path.join(__dirname, "..", "levels.js");
fs.writeFileSync(outputPath, output, "utf8");
process.stdout.write(`Saved ${LEVEL_COUNT} levels to ${outputPath} (${Buffer.byteLength(output)} bytes).\n`);

const BOARD_SIZE = 7;
const GOAL_ROW = 3;

function cloneLevel(level) {
  return {
    ...level,
    blocks: level.blocks.map((block) => ({ ...block })),
  };
}

function positionsFromLevel(level) {
  return level.blocks.map((block) => (block.axis === "h" ? block.x : block.y));
}

function applyPositions(level, positions) {
  const next = cloneLevel(level);
  next.blocks.forEach((block, index) => {
    if (block.axis === "h") block.x = positions[index];
    else block.y = positions[index];
  });
  return next;
}

function stateKey(positions) {
  return positions.join("");
}

function buildGrid(level, positions = positionsFromLevel(level), ignoredIndex = -1) {
  const grid = new Int16Array(BOARD_SIZE * BOARD_SIZE);
  grid.fill(-1);

  level.blocks.forEach((block, index) => {
    if (index === ignoredIndex) return;
    const variable = positions[index];
    const x = block.axis === "h" ? variable : block.x;
    const y = block.axis === "v" ? variable : block.y;
    for (let offset = 0; offset < block.len; offset += 1) {
      const cellX = x + (block.axis === "h" ? offset : 0);
      const cellY = y + (block.axis === "v" ? offset : 0);
      if (cellX >= 0 && cellX < BOARD_SIZE && cellY >= 0 && cellY < BOARD_SIZE) {
        grid[cellY * BOARD_SIZE + cellX] = index;
      }
    }
  });
  return grid;
}

function movementRange(level, positions, blockIndex, occupiedGrid = null) {
  const block = level.blocks[blockIndex];
  const grid = occupiedGrid || buildGrid(level, positions);
  let min = 0;
  let max = BOARD_SIZE - block.len;

  if (block.axis === "h") {
    const row = block.y;
    const current = positions[blockIndex];
    for (let x = current - 1; x >= 0; x -= 1) {
      if (grid[row * BOARD_SIZE + x] !== -1) {
        min = x + 1;
        break;
      }
    }
    for (let x = current + block.len; x < BOARD_SIZE; x += 1) {
      if (grid[row * BOARD_SIZE + x] !== -1) {
        max = x - block.len;
        break;
      }
    }
  } else {
    const column = block.x;
    const current = positions[blockIndex];
    for (let y = current - 1; y >= 0; y -= 1) {
      if (grid[y * BOARD_SIZE + column] !== -1) {
        min = y + 1;
        break;
      }
    }
    for (let y = current + block.len; y < BOARD_SIZE; y += 1) {
      if (grid[y * BOARD_SIZE + column] !== -1) {
        max = y - block.len;
        break;
      }
    }
  }

  return { min, max };
}

function isSolved(level, positions = positionsFromLevel(level)) {
  const goalIndex = level.blocks.findIndex((block) => block.goal);
  return goalIndex >= 0 && positions[goalIndex] === BOARD_SIZE - level.blocks[goalIndex].len;
}

function solveLevel(level, options = {}) {
  const maxNodes = options.maxNodes ?? 50000;
  const includePath = options.includePath ?? true;
  const start = positionsFromLevel(level);
  if (isSolved(level, start)) return { solved: true, depth: 0, path: [], visited: 1 };

  const states = [start];
  const parents = [-1];
  const moves = [null];
  const depths = [0];
  const seen = new Map([[stateKey(start), 0]]);

  for (let cursor = 0; cursor < states.length && states.length < maxNodes; cursor += 1) {
    const positions = states[cursor];
    const nextDepth = depths[cursor] + 1;
    const occupiedGrid = buildGrid(level, positions);

    for (let blockIndex = 0; blockIndex < level.blocks.length; blockIndex += 1) {
      const current = positions[blockIndex];
      const range = movementRange(level, positions, blockIndex, occupiedGrid);
      for (let destination = range.min; destination <= range.max; destination += 1) {
        if (destination === current) continue;
        const next = positions.slice();
        next[blockIndex] = destination;
        const key = stateKey(next);
        if (seen.has(key)) continue;

        const nextIndex = states.length;
        seen.set(key, nextIndex);
        states.push(next);
        parents.push(cursor);
        moves.push({ blockIndex, from: current, to: destination });
        depths.push(nextDepth);

        if (isSolved(level, next)) {
          const path = [];
          if (includePath) {
            let index = nextIndex;
            while (parents[index] !== -1) {
              path.push(moves[index]);
              index = parents[index];
            }
            path.reverse();
          }
          return { solved: true, depth: nextDepth, path, visited: states.length };
        }
        if (states.length >= maxNodes) break;
      }
      if (states.length >= maxNodes) break;
    }
  }

  return { solved: false, depth: Infinity, path: [], visited: states.length };
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return function random() {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function integer(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

function overlaps(a, b) {
  for (let ay = a.y; ay < a.y + (a.axis === "v" ? a.len : 1); ay += 1) {
    for (let ax = a.x; ax < a.x + (a.axis === "h" ? a.len : 1); ax += 1) {
      for (let by = b.y; by < b.y + (b.axis === "v" ? b.len : 1); by += 1) {
        for (let bx = b.x; bx < b.x + (b.axis === "h" ? b.len : 1); bx += 1) {
          if (ax === bx && ay === by) return true;
        }
      }
    }
  }
  return false;
}

function createCandidate(random, blockCount) {
  const goalX = integer(random, 0, 1);
  const goal = { id: "core", axis: "h", len: 2, x: goalX, y: GOAL_ROW, goal: true, hue: 178 };
  const blockerX = integer(random, goalX + 2, BOARD_SIZE - 1);
  const blockerLength = random() < 0.7 ? 2 : 3;
  const blockerMinY = Math.max(0, GOAL_ROW - blockerLength + 1);
  const blockerMaxY = Math.min(GOAL_ROW, BOARD_SIZE - blockerLength);
  const blocker = {
    id: "lock",
    axis: "v",
    len: blockerLength,
    x: blockerX,
    y: integer(random, blockerMinY, blockerMaxY),
    hue: integer(random, 282, 326),
  };
  const blocks = [goal, blocker];

  let placementAttempts = 0;
  while (blocks.length < blockCount && placementAttempts < blockCount * 45) {
    placementAttempts += 1;
    const axis = random() < 0.5 ? "h" : "v";
    const len = random() < 0.78 ? 2 : 3;
    const block = {
      id: `b${blocks.length}`,
      axis,
      len,
      x: integer(random, 0, axis === "h" ? BOARD_SIZE - len : BOARD_SIZE - 1),
      y: integer(random, 0, axis === "v" ? BOARD_SIZE - len : BOARD_SIZE - 1),
      hue: integer(random, 194, 265),
    };
    if (!blocks.some((existing) => overlaps(existing, block))) blocks.push(block);
  }

  if (blocks.length < blockCount) return null;
  return { size: BOARD_SIZE, blocks };
}

const FALLBACK_LEVELS = [
  [
    { id: "core", axis: "h", len: 2, x: 0, y: 3, goal: true, hue: 178 },
    { id: "lock", axis: "v", len: 2, x: 2, y: 2, hue: 306 },
    { id: "b2", axis: "h", len: 3, x: 0, y: 0, hue: 220 },
    { id: "b3", axis: "v", len: 2, x: 6, y: 0, hue: 248 },
    { id: "b4", axis: "h", len: 3, x: 1, y: 5, hue: 204 },
    { id: "b5", axis: "v", len: 2, x: 0, y: 5, hue: 235 },
    { id: "b6", axis: "h", len: 2, x: 4, y: 6, hue: 255 },
  ],
  [
    { id: "core", axis: "h", len: 2, x: 0, y: 3, goal: true, hue: 178 },
    { id: "lock", axis: "v", len: 3, x: 2, y: 1, hue: 306 },
    { id: "b2", axis: "h", len: 3, x: 0, y: 4, hue: 220 },
    { id: "b3", axis: "v", len: 3, x: 6, y: 0, hue: 248 },
    { id: "b4", axis: "h", len: 2, x: 3, y: 5, hue: 204 },
    { id: "b5", axis: "v", len: 2, x: 0, y: 5, hue: 235 },
  ],
];

function fallbackLevel(levelNumber) {
  const source = FALLBACK_LEVELS[(levelNumber - 1) % FALLBACK_LEVELS.length];
  return {
    size: BOARD_SIZE,
    number: levelNumber,
    seed: levelNumber,
    difficulty: levelNumber < 4 ? "РАЗМИНКА" : "ИМПУЛЬС",
    blocks: source.map((block) => ({ ...block })),
  };
}

function generateLevel(levelNumber = 1, customSeed = 0) {
  const normalizedLevel = Math.max(1, Math.floor(levelNumber));
  const seed = (normalizedLevel * 0x9e3779b1 + customSeed * 0x85ebca6b + 0x7c0decaf) >>> 0;
  const random = mulberry32(seed);
  const tier = Math.min(2, Math.floor((normalizedLevel - 1) / 5));
  const blockCount = 9 + tier * 2 + integer(random, 0, 1);
  const depthStep = tier === 2 ? Math.min(1, (normalizedLevel - 1) % 5) : Math.min(2, (normalizedLevel - 1) % 5);
  const targetDepth = [2, 4, 6][tier] + depthStep;
  const attempts = [30, 40, 30][tier];
  let best = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidate = createCandidate(random, blockCount);
    if (!candidate) continue;
    const result = solveLevel(candidate, { maxNodes: tier === 2 ? 25000 : 20000, includePath: false });
    if (!result.solved || result.depth < 2) continue;

    if (!best || result.depth > best.solution.depth) best = { candidate, solution: result };
    if (result.depth >= targetDepth) break;
  }

  if (!best) return fallbackLevel(normalizedLevel);
  const difficulty = best.solution.depth <= 3 ? "РАЗМИНКА" : best.solution.depth <= 6 ? "ИМПУЛЬС" : "СИНГУЛЯРНОСТЬ";
  return {
    ...best.candidate,
    number: normalizedLevel,
    seed,
    difficulty,
    par: best.solution.depth,
  };
}

window.BlockMoverEngine = {
  BOARD_SIZE,
  GOAL_ROW,
  applyPositions,
  buildGrid,
  cloneLevel,
  generateLevel,
  isSolved,
  movementRange,
  positionsFromLevel,
  solveLevel,
};

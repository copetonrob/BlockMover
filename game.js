(() => {
  "use strict";

  const {
    BOARD_SIZE,
    GOAL_ROW,
    applyPositions,
    isSolved,
    movementRange,
    positionsFromLevel,
    solveLevel,
  } = window.BlockMoverEngine;

  const canvas = document.querySelector("#gameCanvas");
  const context = canvas.getContext("2d");
  const boardFrame = document.querySelector("#boardFrame");
  const loadingLayer = document.querySelector("#loadingLayer");
  const levelValue = document.querySelector("#levelValue");
  const movesValue = document.querySelector("#movesValue");
  const difficultyValue = document.querySelector("#difficultyValue");
  const seedValue = document.querySelector("#seedValue");
  const bestValue = document.querySelector("#bestValue");
  const parValue = document.querySelector("#parValue");
  const undoButton = document.querySelector("#undoButton");
  const restartButton = document.querySelector("#restartButton");
  const hintButton = document.querySelector("#hintButton");
  const skipButton = document.querySelector("#skipButton");
  const soundButton = document.querySelector("#soundButton");
  const nextButton = document.querySelector("#nextButton");
  const victoryDialog = document.querySelector("#victoryDialog");
  const victoryMoves = document.querySelector("#victoryMoves");
  const victoryPar = document.querySelector("#victoryPar");
  const toast = document.querySelector("#toast");

  const storage = {
    get(key, fallback) {
      try {
        const value = localStorage.getItem(`neon-shift:${key}`);
        return value === null ? fallback : JSON.parse(value);
      } catch (_) {
        return fallback;
      }
    },
    set(key, value) {
      try { localStorage.setItem(`neon-shift:${key}`, JSON.stringify(value)); } catch (_) { /* private mode */ }
    },
  };

  const levelPack = window.NEON_SHIFT_LEVEL_PACK;
  if (!levelPack || levelPack.boardSize !== BOARD_SIZE || levelPack.goalRow !== GOAL_ROW || !levelPack.levels?.length) {
    throw new Error("Neon Shift level pack is missing or incompatible.");
  }

  const TOTAL_LEVELS = levelPack.levels.length;
  const savedProgress = storage.get("progress", null);
  const legacyLevel = Number(storage.get("level", 1)) || 1;
  const savedLevel = savedProgress?.packVersion === levelPack.version ? Number(savedProgress.currentLevel) : legacyLevel;
  const initialLevel = Math.min(TOTAL_LEVELS, Math.max(1, savedLevel || 1));

  const state = {
    level: null,
    levelNumber: initialLevel,
    highestCompleted: savedProgress?.packVersion === levelPack.version ? Number(savedProgress.highestCompleted) || 0 : 0,
    positions: [],
    initialPositions: [],
    history: [],
    moveCount: 0,
    selected: -1,
    dragging: null,
    hint: null,
    won: false,
    loading: false,
    generationToken: 0,
    particles: [],
    muted: storage.get("muted", false),
    audio: null,
  };

  let geometry = { width: 1, height: 1, board: 1, cell: 1, x: 0, y: 0 };
  let toastTimer = 0;

  function padded(value) {
    return String(value).padStart(2, "0");
  }

  function followingLevel(levelNumber = state.levelNumber) {
    return levelNumber >= TOTAL_LEVELS ? 1 : levelNumber + 1;
  }

  function saveProgress(currentLevel = state.levelNumber) {
    storage.set("progress", {
      packVersion: levelPack.version,
      currentLevel,
      highestCompleted: state.highestCompleted,
    });
    storage.set("level", currentLevel);
  }

  function levelFromPack(levelNumber) {
    const source = levelPack.levels[levelNumber - 1];
    return {
      size: levelPack.boardSize,
      number: source.number,
      seed: source.seed,
      difficulty: source.difficulty,
      par: source.par,
      blocks: source.blocks.map(([axis, len, x, y, goal, hue], index) => ({
        id: goal ? "core" : `b${index}`,
        axis,
        len,
        x,
        y,
        goal: Boolean(goal),
        hue,
      })),
    };
  }

  function currentBest() {
    if (!state.level) return null;
    return storage.get(`best:${state.level.seed}`, null);
  }

  function refreshHud() {
    levelValue.textContent = `${padded(state.levelNumber)}/${TOTAL_LEVELS}`;
    movesValue.textContent = padded(state.moveCount);
    difficultyValue.textContent = state.level?.difficulty || "—";
    seedValue.textContent = state.level ? `SEED // ${state.level.seed.toString(16).toUpperCase().slice(-6).padStart(6, "0")}` : "SEED // ------";
    parValue.textContent = state.level?.par ? padded(state.level.par) : "—";
    const best = currentBest();
    bestValue.textContent = best ? `${padded(best)} ХОД.` : "—";
    undoButton.disabled = !state.history.length || state.loading || state.won;
    restartButton.disabled = state.loading || !state.level;
    hintButton.disabled = state.loading || !state.level || state.won;
    skipButton.disabled = state.loading;
  }

  function showToast(message, duration = 2200) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), duration);
  }

  function setLoading(isLoading) {
    state.loading = isLoading;
    loadingLayer.classList.toggle("is-visible", isLoading);
    refreshHud();
  }

  function loadLevel(levelNumber) {
    const token = ++state.generationToken;
    state.levelNumber = Math.min(TOTAL_LEVELS, Math.max(1, Math.floor(levelNumber)));
    state.dragging = null;
    state.selected = -1;
    state.hint = null;
    state.won = false;
    victoryDialog.hidden = true;
    setLoading(true);
    levelValue.textContent = `${padded(state.levelNumber)}/${TOTAL_LEVELS}`;
    nextButton.innerHTML = state.levelNumber === TOTAL_LEVELS
      ? "НАЧАТЬ НОВЫЙ ЦИКЛ <span>→</span>"
      : "СЛЕДУЮЩИЙ СЕКТОР <span>→</span>";

    window.setTimeout(() => {
      if (token !== state.generationToken) return;
      const level = levelFromPack(state.levelNumber);
      if (token !== state.generationToken) return;
      state.level = level;
      state.positions = positionsFromLevel(level);
      state.initialPositions = state.positions.slice();
      state.history = [];
      state.moveCount = 0;
      state.particles = [];
      saveProgress(state.levelNumber);
      setLoading(false);
      refreshHud();
      playSound("load");
    }, 80);
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const inset = Math.max(8, width * 0.016);
    const board = Math.min(width, height) - inset * 2;
    geometry = { width, height, board, cell: board / BOARD_SIZE, x: (width - board) / 2, y: (height - board) / 2 };
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function drawBoard(time) {
    const { x, y, board, cell } = geometry;
    context.clearRect(0, 0, geometry.width, geometry.height);

    const backdrop = context.createRadialGradient(x + board * .5, y + board * .42, 0, x + board * .5, y + board * .5, board * .72);
    backdrop.addColorStop(0, "#101634");
    backdrop.addColorStop(1, "#080b20");
    context.fillStyle = backdrop;
    context.fillRect(x, y, board, board);

    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let column = 0; column < BOARD_SIZE; column += 1) {
        context.fillStyle = (row + column) % 2 ? "rgba(93,108,174,.017)" : "rgba(104,119,190,.034)";
        context.fillRect(x + column * cell + 1, y + row * cell + 1, cell - 2, cell - 2);
      }
    }

    context.lineWidth = 1;
    for (let index = 0; index <= BOARD_SIZE; index += 1) {
      const position = Math.round(index * cell) + .5;
      context.strokeStyle = index === 0 || index === BOARD_SIZE ? "rgba(120,139,204,.2)" : "rgba(103,119,179,.09)";
      context.beginPath(); context.moveTo(x + position, y); context.lineTo(x + position, y + board); context.stroke();
      context.beginPath(); context.moveTo(x, y + position); context.lineTo(x + board, y + position); context.stroke();
    }

    const portalY = y + cell * GOAL_ROW;
    const pulse = .48 + Math.sin(time / 340) * .14;
    const portalGlow = context.createLinearGradient(x + board - cell * 1.2, 0, x + board, 0);
    portalGlow.addColorStop(0, "rgba(101,255,226,0)");
    portalGlow.addColorStop(1, `rgba(101,255,226,${.08 + pulse * .05})`);
    context.fillStyle = portalGlow;
    context.fillRect(x + board - cell * 1.25, portalY, cell * 1.25, cell);
    context.strokeStyle = `rgba(101,255,226,${pulse})`;
    context.shadowColor = "#65ffe2";
    context.shadowBlur = 11;
    context.beginPath(); context.moveTo(x + board - 1, portalY + 7); context.lineTo(x + board - 1, portalY + cell - 7); context.stroke();
    context.shadowBlur = 0;

    if (!state.level) return;
    state.level.blocks.forEach((block, index) => drawBlock(block, index, time));
    drawParticles();
  }

  function blockVariable(index) {
    return state.dragging?.index === index ? state.dragging.visual : state.positions[index];
  }

  function blockRect(block, index, extraInset = 0) {
    const variable = blockVariable(index);
    const gridX = block.axis === "h" ? variable : block.x;
    const gridY = block.axis === "v" ? variable : block.y;
    const gap = Math.max(5, geometry.cell * .065) + extraInset;
    return {
      x: geometry.x + gridX * geometry.cell + gap,
      y: geometry.y + gridY * geometry.cell + gap,
      width: (block.axis === "h" ? block.len : 1) * geometry.cell - gap * 2,
      height: (block.axis === "v" ? block.len : 1) * geometry.cell - gap * 2,
    };
  }

  function drawBlock(block, index, time) {
    const rect = blockRect(block, index);
    const goal = Boolean(block.goal);
    const hue = goal ? 173 : block.hue;
    const isSelected = state.selected === index || state.dragging?.index === index;
    const isHint = state.hint?.blockIndex === index;
    const hintPulse = isHint ? .5 + Math.sin(time / 150) * .5 : 0;

    context.save();
    context.shadowColor = goal ? "rgba(52,255,224,.7)" : `hsla(${hue}, 88%, 64%, .38)`;
    context.shadowBlur = goal ? 20 : isSelected || isHint ? 18 : 10;
    context.shadowOffsetY = 4;
    roundedRect(context, rect.x, rect.y, rect.width, rect.height, Math.max(7, geometry.cell * .09));
    const gradient = context.createLinearGradient(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height);
    if (goal) {
      gradient.addColorStop(0, "#21cfc5"); gradient.addColorStop(.48, "#54f8df"); gradient.addColorStop(1, "#178e9d");
    } else {
      gradient.addColorStop(0, `hsl(${hue}, 54%, 44%)`); gradient.addColorStop(.5, `hsl(${hue + 8}, 58%, 35%)`); gradient.addColorStop(1, `hsl(${hue - 7}, 51%, 24%)`);
    }
    context.fillStyle = gradient;
    context.fill();
    context.shadowBlur = 0; context.shadowOffsetY = 0;

    roundedRect(context, rect.x + 2, rect.y + 2, rect.width - 4, rect.height - 4, Math.max(6, geometry.cell * .075));
    context.strokeStyle = goal ? "rgba(218,255,248,.68)" : `hsla(${hue}, 88%, 82%, .29)`;
    context.lineWidth = 1;
    context.stroke();

    const edgeGradient = context.createLinearGradient(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height);
    edgeGradient.addColorStop(0, "rgba(255,255,255,.24)"); edgeGradient.addColorStop(.42, "rgba(255,255,255,0)"); edgeGradient.addColorStop(1, "rgba(3,5,22,.28)");
    roundedRect(context, rect.x + 5, rect.y + 5, rect.width - 10, rect.height - 10, Math.max(4, geometry.cell * .05));
    context.fillStyle = edgeGradient; context.fill();

    if (goal) drawGoalCore(rect, time);
    else drawAxisMark(block, rect);

    if (isSelected || isHint) {
      roundedRect(context, rect.x - 2, rect.y - 2, rect.width + 4, rect.height + 4, Math.max(9, geometry.cell * .11));
      context.strokeStyle = isHint ? `rgba(255,210,255,${.44 + hintPulse * .5})` : "rgba(216,255,249,.72)";
      context.lineWidth = isHint ? 2 : 1;
      context.stroke();
    }
    context.restore();
  }

  function drawGoalCore(rect, time) {
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    const coreWidth = Math.min(rect.width * .37, geometry.cell * .72);
    const pulse = .75 + Math.sin(time / 260) * .14;
    context.fillStyle = "rgba(3,36,43,.64)";
    roundedRect(context, centerX - coreWidth / 2, centerY - geometry.cell * .115, coreWidth, geometry.cell * .23, geometry.cell * .06);
    context.fill();
    context.shadowColor = "#d8fff8"; context.shadowBlur = 9 * pulse;
    context.fillStyle = `rgba(222,255,250,${pulse})`;
    context.fillRect(centerX - coreWidth * .27, centerY - 1, coreWidth * .54, 2);
    context.shadowBlur = 0;
    context.strokeStyle = "rgba(2,47,54,.42)"; context.lineWidth = 1.2;
    const wing = geometry.cell * .13;
    context.beginPath();
    context.moveTo(rect.x + wing, centerY - 4); context.lineTo(rect.x + wing - 5, centerY); context.lineTo(rect.x + wing, centerY + 4);
    context.moveTo(rect.x + rect.width - wing, centerY - 4); context.lineTo(rect.x + rect.width - wing + 5, centerY); context.lineTo(rect.x + rect.width - wing, centerY + 4);
    context.stroke();
  }

  function drawAxisMark(block, rect) {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const length = Math.min(block.axis === "h" ? rect.width : rect.height, geometry.cell * .72);
    context.strokeStyle = "rgba(226,231,255,.24)";
    context.lineWidth = 1;
    context.beginPath();
    if (block.axis === "h") {
      context.moveTo(cx - length / 2, cy); context.lineTo(cx + length / 2, cy);
      context.moveTo(cx - length / 2, cy); context.lineTo(cx - length / 2 + 4, cy - 3);
      context.moveTo(cx - length / 2, cy); context.lineTo(cx - length / 2 + 4, cy + 3);
      context.moveTo(cx + length / 2, cy); context.lineTo(cx + length / 2 - 4, cy - 3);
      context.moveTo(cx + length / 2, cy); context.lineTo(cx + length / 2 - 4, cy + 3);
    } else {
      context.moveTo(cx, cy - length / 2); context.lineTo(cx, cy + length / 2);
      context.moveTo(cx, cy - length / 2); context.lineTo(cx - 3, cy - length / 2 + 4);
      context.moveTo(cx, cy - length / 2); context.lineTo(cx + 3, cy - length / 2 + 4);
      context.moveTo(cx, cy + length / 2); context.lineTo(cx - 3, cy + length / 2 - 4);
      context.moveTo(cx, cy + length / 2); context.lineTo(cx + 3, cy + length / 2 - 4);
    }
    context.stroke();
  }

  function drawParticles() {
    state.particles.forEach((particle) => {
      context.globalAlpha = Math.max(0, particle.life);
      context.fillStyle = particle.color;
      context.shadowColor = particle.color; context.shadowBlur = 7;
      context.fillRect(particle.x, particle.y, particle.size, particle.size);
      particle.x += particle.vx; particle.y += particle.vy; particle.vy += .018; particle.life -= .012;
    });
    context.globalAlpha = 1; context.shadowBlur = 0;
    state.particles = state.particles.filter((particle) => particle.life > 0);
  }

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function hitTest(point) {
    if (!state.level) return -1;
    for (let index = state.level.blocks.length - 1; index >= 0; index -= 1) {
      const rect = blockRect(state.level.blocks[index], index, -3);
      if (point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height) return index;
    }
    return -1;
  }

  function onPointerDown(event) {
    if (state.loading || state.won || !state.level) return;
    const point = canvasPoint(event);
    const index = hitTest(point);
    if (index < 0) { state.selected = -1; return; }
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    const block = state.level.blocks[index];
    state.selected = index;
    state.hint = null;
    state.dragging = {
      index,
      pointerId: event.pointerId,
      startPointer: block.axis === "h" ? point.x : point.y,
      start: state.positions[index],
      visual: state.positions[index],
      range: movementRange(state.level, state.positions, index),
    };
    playSound("pick");
  }

  function onPointerMove(event) {
    if (!state.dragging || event.pointerId !== state.dragging.pointerId) return;
    event.preventDefault();
    const point = canvasPoint(event);
    const block = state.level.blocks[state.dragging.index];
    const coordinate = block.axis === "h" ? point.x : point.y;
    const delta = (coordinate - state.dragging.startPointer) / geometry.cell;
    state.dragging.visual = Math.max(state.dragging.range.min, Math.min(state.dragging.range.max, state.dragging.start + delta));
  }

  function onPointerUp(event) {
    if (!state.dragging || event.pointerId !== state.dragging.pointerId) return;
    const dragging = state.dragging;
    state.dragging = null;
    const destination = Math.max(dragging.range.min, Math.min(dragging.range.max, Math.round(dragging.visual)));
    if (destination !== dragging.start) commitMove(dragging.index, destination);
    else playSound("drop");
  }

  function commitMove(blockIndex, destination) {
    if (state.won || !state.level || destination === state.positions[blockIndex]) return;
    const range = movementRange(state.level, state.positions, blockIndex);
    const safeDestination = Math.max(range.min, Math.min(range.max, destination));
    if (safeDestination === state.positions[blockIndex]) return;
    state.history.push(state.positions.slice());
    state.positions[blockIndex] = safeDestination;
    state.moveCount += 1;
    state.selected = blockIndex;
    state.hint = null;
    refreshHud();
    playSound("move");
    if (isSolved(state.level, state.positions)) completeLevel();
  }

  function undoMove() {
    if (!state.history.length || state.won) return;
    state.positions = state.history.pop();
    state.moveCount = Math.max(0, state.moveCount - 1);
    state.hint = null;
    refreshHud();
    playSound("undo");
  }

  function restartLevel() {
    if (!state.level || state.loading) return;
    state.positions = state.initialPositions.slice();
    state.history = [];
    state.moveCount = 0;
    state.selected = -1;
    state.hint = null;
    state.won = false;
    victoryDialog.hidden = true;
    refreshHud();
    playSound("load");
    showToast("СЕКТОР ВОССТАНОВЛЕН");
  }

  function requestHint() {
    if (state.loading || state.won || !state.level) return;
    hintButton.disabled = true;
    showToast("АНАЛИЗИРУЮ МАРШРУТ...", 1200);
    window.setTimeout(() => {
      const current = applyPositions(state.level, state.positions);
      const solution = solveLevel(current, { maxNodes: 100000, includePath: true });
      if (solution.solved && solution.path.length) {
        const move = solution.path[0];
        state.hint = { ...move, expires: performance.now() + 5000 };
        state.selected = move.blockIndex;
        const block = state.level.blocks[move.blockIndex];
        const direction = block.axis === "h" ? (move.to > move.from ? "вправо" : "влево") : (move.to > move.from ? "вниз" : "вверх");
        showToast(`ИМПУЛЬС: СДВИНЬ ${block.goal ? "ЯДРО" : "ПОДСВЕЧЕННЫЙ БЛОК"} ${direction.toUpperCase()}` , 4200);
        playSound("hint");
      } else {
        showToast("МАРШРУТ НЕ НАЙДЕН — ОТМЕНИ НЕСКОЛЬКО ХОДОВ", 3200);
      }
      refreshHud();
    }, 70);
  }

  function completeLevel() {
    state.won = true;
    const best = currentBest();
    if (!best || state.moveCount < best) storage.set(`best:${state.level.seed}`, state.moveCount);
    state.highestCompleted = Math.max(state.highestCompleted, state.levelNumber);
    saveProgress(followingLevel());
    refreshHud();
    createVictoryParticles();
    playSound("win");
    window.setTimeout(() => {
      victoryMoves.textContent = state.moveCount;
      victoryPar.textContent = state.level.par || "—";
      victoryDialog.hidden = false;
      nextButton.focus();
    }, 650);
  }

  function createVictoryParticles() {
    const originX = geometry.x + geometry.board;
    const originY = geometry.y + geometry.cell * 2.5;
    for (let index = 0; index < 58; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = .5 + Math.random() * 2.8;
      state.particles.push({
        x: originX, y: originY, vx: Math.cos(angle) * speed - .45, vy: Math.sin(angle) * speed,
        life: .6 + Math.random() * .4, size: 1 + Math.random() * 3,
        color: Math.random() > .35 ? "#65ffe2" : "#b273ff",
      });
    }
  }

  function onKeyDown(event) {
    if (state.loading || state.won || state.selected < 0 || !state.level) return;
    const block = state.level.blocks[state.selected];
    const directions = block.axis === "h" ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 };
    if (!(event.key in directions)) return;
    event.preventDefault();
    const destination = state.positions[state.selected] + directions[event.key];
    const range = movementRange(state.level, state.positions, state.selected);
    if (destination >= range.min && destination <= range.max) commitMove(state.selected, destination);
    else playSound("error");
  }

  function ensureAudio() {
    if (state.muted) return null;
    if (!state.audio) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return null;
      state.audio = new AudioContext();
    }
    if (state.audio.state === "suspended") state.audio.resume();
    return state.audio;
  }

  function playSound(kind) {
    const audio = ensureAudio();
    if (!audio) return;
    const sounds = {
      pick: [280, .035, .025], drop: [180, .025, .02], move: [210, .065, .035], undo: [150, .08, .03],
      hint: [620, .16, .045], load: [340, .1, .025], error: [95, .08, .03], win: [520, .42, .055],
    };
    const [frequency, duration, volume] = sounds[kind] || sounds.move;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = kind === "win" || kind === "hint" ? "sine" : "triangle";
    oscillator.frequency.setValueAtTime(frequency, audio.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * (kind === "undo" ? .6 : 1.6), audio.currentTime + duration);
    gain.gain.setValueAtTime(volume, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(); oscillator.stop(audio.currentTime + duration);
    if (kind === "win") window.setTimeout(() => playSound("hint"), 120);
  }

  function toggleSound() {
    state.muted = !state.muted;
    storage.set("muted", state.muted);
    soundButton.classList.toggle("is-muted", state.muted);
    soundButton.setAttribute("aria-label", state.muted ? "Включить звук" : "Выключить звук");
    if (!state.muted) playSound("hint");
  }

  function animationLoop(time) {
    if (state.hint && time > state.hint.expires) state.hint = null;
    drawBoard(time);
    window.requestAnimationFrame(animationLoop);
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("keydown", onKeyDown);
  undoButton.addEventListener("click", undoMove);
  restartButton.addEventListener("click", restartLevel);
  hintButton.addEventListener("click", requestHint);
  skipButton.addEventListener("click", () => loadLevel(followingLevel()));
  soundButton.addEventListener("click", toggleSound);
  nextButton.addEventListener("click", () => loadLevel(followingLevel()));
  document.addEventListener("visibilitychange", () => { if (document.hidden && state.dragging) state.dragging = null; });
  new ResizeObserver(resizeCanvas).observe(boardFrame);

  soundButton.classList.toggle("is-muted", state.muted);
  soundButton.setAttribute("aria-label", state.muted ? "Включить звук" : "Выключить звук");
  resizeCanvas();
  refreshHud();
  loadLevel(state.levelNumber);
  window.requestAnimationFrame(animationLoop);
})();

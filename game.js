(function () {
  'use strict';

  const { BOARD_SIZE, EMPTY, BLACK, WHITE, checkWin, getBestMove } = window.GomokuAI;

  const STAR_POINTS = [
    [3, 3],
    [3, 11],
    [7, 7],
    [11, 3],
    [11, 11],
  ];

  const DIFFICULTY_INFO = {
    easy: {
      label: 'Easy',
      desc: '初心者向け。時々うっかり見逃すので気軽に楽しめます。',
    },
    normal: {
      label: 'Normal',
      desc: '基本の攻防をこなす標準的な強さです。',
    },
    hard: {
      label: 'Hard',
      desc: '数手先を読む本格AI。油断すると四三や活四で攻められます。',
    },
  };

  // DOM 要素
  const canvas = document.getElementById('board-canvas');
  const ctx = canvas.getContext('2d');
  const statusTextEl = document.getElementById('status-text');
  const turnStoneEl = document.getElementById('turn-stone');
  const moveCountEl = document.getElementById('move-count');
  const thinkingBarEl = document.getElementById('thinking-bar');
  const difficultyGroup = document.getElementById('difficulty-group');
  const difficultyDescEl = document.getElementById('difficulty-desc');
  const colorGroup = document.getElementById('color-group');
  const newGameBtn = document.getElementById('new-game-btn');
  const undoBtn = document.getElementById('undo-btn');
  const soundToggleBtn = document.getElementById('sound-toggle');
  const soundIconEl = document.getElementById('sound-icon');
  const scoreWinEl = document.getElementById('score-win');
  const scoreLossEl = document.getElementById('score-loss');
  const scoreDrawEl = document.getElementById('score-draw');
  const resultOverlay = document.getElementById('result-overlay');
  const resultBadgeEl = document.getElementById('result-badge');
  const resultTitleEl = document.getElementById('result-title');
  const resultDetailEl = document.getElementById('result-detail');
  const overlayRematchBtn = document.getElementById('overlay-rematch-btn');
  const overlayCloseBtn = document.getElementById('overlay-close-btn');

  // ゲーム状態
  let board = createEmptyBoard();
  let history = []; // [{ r, c, player }]
  let userColor = BLACK;
  let aiColor = WHITE;
  let currentTurn = BLACK;
  let difficulty = 'normal';
  let gameOver = false;
  let isAiThinking = false;
  let winningLine = null;
  let hoverPos = null; // { r, c } | null
  let soundEnabled = true;
  let aiTimerId = null;

  const scores = { win: 0, loss: 0, draw: 0 };

  // 描画メトリクス（論理ピクセル）
  let boardPixelSize = 640;
  let margin = 36;
  let cellSize = (boardPixelSize - margin * 2) / (BOARD_SIZE - 1);
  let woodCanvas = null;

  // Web Audio
  let audioCtx = null;

  function createEmptyBoard() {
    return Array.from({ length: BOARD_SIZE }, () => new Array(BOARD_SIZE).fill(EMPTY));
  }

  function ensureAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  /**
   * 碁石を打つ「パチッ」という効果音を合成
   */
  function playStoneSound(isBlack) {
    if (!soundEnabled) return;
    const ac = ensureAudioContext();
    if (!ac) return;

    const now = ac.currentTime;

    // 1. 短いアタックノイズ（石が盤に触れる音）
    const bufferSize = Math.floor(ac.sampleRate * 0.035);
    const noiseBuffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const env = Math.exp(-i / (bufferSize * 0.16));
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const noise = ac.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = ac.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(isBlack ? 1350 : 1650, now);
    filter.Q.setValueAtTime(1.8, now);

    const noiseGain = ac.createGain();
    noiseGain.gain.setValueAtTime(0.45, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ac.destination);
    noise.start(now);

    // 2. 木盤の共鳴トーン
    const osc = ac.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isBlack ? 210 : 245, now);
    osc.frequency.exponentialRampToValueAtTime(95, now + 0.075);

    const oscGain = ac.createGain();
    oscGain.gain.setValueAtTime(0.24, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);

    osc.connect(oscGain);
    oscGain.connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  }

  /**
   * 決着時の控えめなチャイム音
   */
  function playResultSound(type) {
    if (!soundEnabled) return;
    const ac = ensureAudioContext();
    if (!ac) return;

    const now = ac.currentTime;
    const notes =
      type === 'win'
        ? [523.25, 659.25, 783.99] // C5 E5 G5
        : type === 'loss'
          ? [392.0, 329.63, 261.63] // G4 E4 C4
          : [440.0, 440.0];

    notes.forEach((freq, idx) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sine';
      const t = now + idx * 0.11;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.12, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(t);
      osc.stop(t + 0.36);
    });
  }

  /**
   * 木目調の囲碁盤背景をオフスクリーンCanvasに生成（キャッシュ）
   */
  function buildWoodTexture(size) {
    const off = document.createElement('canvas');
    off.width = size;
    off.height = size;
    const octx = off.getContext('2d');

    // ベースの木色グラデーション（榧材風）
    const baseGrad = octx.createLinearGradient(0, 0, size, size);
    baseGrad.addColorStop(0, '#e3ba76');
    baseGrad.addColorStop(0.5, '#d6a65c');
    baseGrad.addColorStop(1, '#c8954c');
    octx.fillStyle = baseGrad;
    octx.fillRect(0, 0, size, size);

    // 繊細な木目ライン（決定論的な疑似乱数で安定した模様）
    let seed = 4219;
    function rand() {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    }

    for (let i = 0; i < 120; i++) {
      const y = (i / 120) * size + (rand() - 0.5) * 6;
      const alpha = 0.025 + rand() * 0.045;
      octx.strokeStyle = rand() > 0.35 ? `rgba(110, 65, 20, ${alpha})` : `rgba(255, 232, 185, ${alpha * 0.7})`;
      octx.lineWidth = 0.7 + rand() * 1.8;
      octx.beginPath();
      const waveAmp = 1.5 + rand() * 4;
      const waveFreq = 0.006 + rand() * 0.01;
      const phase = rand() * Math.PI * 2;
      for (let x = 0; x <= size; x += 16) {
        const dy = Math.sin(x * waveFreq + phase) * waveAmp;
        if (x === 0) octx.moveTo(x, y + dy);
        else octx.lineTo(x, y + dy);
      }
      octx.stroke();
    }

    // わずかな周辺減光（盤面の立体感）
    const vignette = octx.createRadialGradient(
      size * 0.5,
      size * 0.5,
      size * 0.32,
      size * 0.5,
      size * 0.5,
      size * 0.72
    );
    vignette.addColorStop(0, 'rgba(255, 255, 255, 0.05)');
    vignette.addColorStop(1, 'rgba(65, 35, 8, 0.16)');
    octx.fillStyle = vignette;
    octx.fillRect(0, 0, size, size);

    return off;
  }

  /**
   * Canvas サイズと高DPIスケーリングを調整
   */
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const cssSize = Math.max(260, Math.round(rect.width));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(cssSize * dpr);
    canvas.height = Math.round(cssSize * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    boardPixelSize = cssSize;
    margin = Math.round(cssSize * 0.062);
    cellSize = (boardPixelSize - margin * 2) / (BOARD_SIZE - 1);
    woodCanvas = buildWoodTexture(boardPixelSize);

    drawBoard();
  }

  function gridToPixel(r, c) {
    return {
      x: margin + c * cellSize,
      y: margin + r * cellSize,
    };
  }

  /**
   * 盤面全体の描画
   */
  function drawBoard() {
    if (!woodCanvas) return;

    // 1. 木目背景
    ctx.drawImage(woodCanvas, 0, 0, boardPixelSize, boardPixelSize);

    // 2. 座標ラベル（控えめ）
    const fontSize = Math.max(9, Math.round(cellSize * 0.28));
    ctx.fillStyle = 'rgba(72, 44, 16, 0.65)';
    ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < BOARD_SIZE; i++) {
      const colLabel = String.fromCharCode(65 + i); // A..O
      const rowLabel = String(BOARD_SIZE - i); // 15..1
      const px = margin + i * cellSize;
      const py = margin + i * cellSize;
      ctx.fillText(colLabel, px, margin * 0.42);
      ctx.fillText(rowLabel, margin * 0.42, py);
    }

    // 3. 格子線
    ctx.strokeStyle = 'rgba(42, 26, 10, 0.82)';
    for (let i = 0; i < BOARD_SIZE; i++) {
      const pos = Math.round(margin + i * cellSize) + 0.5;
      const isEdge = i === 0 || i === BOARD_SIZE - 1;
      ctx.lineWidth = isEdge ? 1.8 : 1;

      // 横線
      ctx.beginPath();
      ctx.moveTo(margin, pos);
      ctx.lineTo(boardPixelSize - margin, pos);
      ctx.stroke();

      // 縦線
      ctx.beginPath();
      ctx.moveTo(pos, margin);
      ctx.lineTo(pos, boardPixelSize - margin);
      ctx.stroke();
    }

    // 4. 星（ホシ）
    const starRadius = Math.max(2.6, cellSize * 0.095);
    ctx.fillStyle = '#241608';
    for (const [r, c] of STAR_POINTS) {
      const { x, y } = gridToPixel(r, c);
      ctx.beginPath();
      ctx.arc(x, y, starRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // 5. ホバー時のプレビュー石（プレイヤーの手番のみ）
    if (
      hoverPos &&
      !gameOver &&
      !isAiThinking &&
      currentTurn === userColor &&
      board[hoverPos.r][hoverPos.c] === EMPTY
    ) {
      drawStone(hoverPos.r, hoverPos.c, userColor, 0.42);
    }

    // 6. 盤上の石
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c] !== EMPTY) {
          drawStone(r, c, board[r][c], 1);
        }
      }
    }

    // 7. 直前の手マーカー
    if (history.length > 0 && !winningLine) {
      const last = history[history.length - 1];
      const { x, y } = gridToPixel(last.r, last.c);
      const markerR = Math.max(3, cellSize * 0.13);
      ctx.beginPath();
      ctx.arc(x, y, markerR, 0, Math.PI * 2);
      ctx.fillStyle = last.player === BLACK ? '#e8b95c' : '#c9493b';
      ctx.fill();
    }

    // 8. 勝利ラインの強調
    if (winningLine && winningLine.length >= 5) {
      const first = gridToPixel(winningLine[0][0], winningLine[0][1]);
      const last = gridToPixel(
        winningLine[winningLine.length - 1][0],
        winningLine[winningLine.length - 1][1]
      );

      // 勝利ラインを結ぶ光の線
      ctx.save();
      ctx.strokeStyle = 'rgba(244, 197, 83, 0.85)';
      ctx.lineWidth = Math.max(4, cellSize * 0.14);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      ctx.lineTo(last.x, last.y);
      ctx.stroke();

      // 各石にハイライトリング
      const ringRadius = cellSize * 0.46;
      ctx.strokeStyle = '#ffdf78';
      ctx.lineWidth = Math.max(2.4, cellSize * 0.08);
      for (const [r, c] of winningLine) {
        const { x, y } = gridToPixel(r, c);
        ctx.beginPath();
        ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /**
   * リアルな碁石を描画
   */
  function drawStone(r, c, player, alpha) {
    const { x, y } = gridToPixel(r, c);
    const radius = cellSize * 0.44;

    ctx.save();
    ctx.globalAlpha = alpha;

    // ドロップシャドウ（本石のみ）
    if (alpha >= 0.99) {
      ctx.beginPath();
      ctx.arc(x + radius * 0.1, y + radius * 0.13, radius * 0.98, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(20, 12, 4, 0.38)';
      ctx.fill();
    }

    // 石本体グラデーション
    const grad = ctx.createRadialGradient(
      x - radius * 0.32,
      y - radius * 0.34,
      radius * 0.08,
      x,
      y,
      radius
    );

    if (player === BLACK) {
      grad.addColorStop(0, '#5a5a5a');
      grad.addColorStop(0.28, '#282828');
      grad.addColorStop(0.75, '#121212');
      grad.addColorStop(1, '#050505');
    } else {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.55, '#f4efe6');
      grad.addColorStop(0.88, '#dcd3c4');
      grad.addColorStop(1, '#bfb5a4');
    }

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // 輪郭の微妙な縁取り
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = player === BLACK ? 'rgba(0, 0, 0, 0.6)' : 'rgba(130, 118, 98, 0.45)';
    ctx.stroke();

    ctx.restore();
  }

  /**
   * ポインタ位置から最も近い交点 (r, c) を取得
   */
  function getGridPosFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const c = Math.round((x - margin) / cellSize);
    const r = Math.round((y - margin) / cellSize);

    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) {
      return null;
    }

    // 交点からの距離が近すぎないクリックは無視
    const center = gridToPixel(r, c);
    const dist = Math.hypot(x - center.x, y - center.y);
    if (dist > cellSize * 0.48) {
      return null;
    }

    return { r, c };
  }

  /**
   * 石を置く共通処理
   */
  function placeStone(r, c, player) {
    if (board[r][c] !== EMPTY || gameOver) return false;

    board[r][c] = player;
    history.push({ r, c, player });
    playStoneSound(player === BLACK);

    const win = checkWin(board, r, c, player);
    if (win) {
      winningLine = win;
      gameOver = true;
      handleGameEnd(player);
      drawBoard();
      updateUI();
      return true;
    }

    // 引き分け判定（盤面が満杯）
    if (history.length >= BOARD_SIZE * BOARD_SIZE) {
      gameOver = true;
      handleGameEnd(EMPTY);
      drawBoard();
      updateUI();
      return true;
    }

    currentTurn = player === BLACK ? WHITE : BLACK;
    drawBoard();
    updateUI();
    return true;
  }

  /**
   * 決着処理
   */
  function handleGameEnd(winner) {
    let badgeText = '';
    let badgeClass = '';
    let titleText = '';
    let soundType = 'draw';

    if (winner === userColor) {
      scores.win++;
      badgeText = '勝利';
      badgeClass = 'win';
      titleText = 'あなたの勝ちです！';
      soundType = 'win';
    } else if (winner === aiColor) {
      scores.loss++;
      badgeText = '敗北';
      badgeClass = 'loss';
      titleText = 'PCの勝ちです';
      soundType = 'loss';
    } else {
      scores.draw++;
      badgeText = '引き分け';
      badgeClass = 'draw';
      titleText = '引き分けです';
      soundType = 'draw';
    }

    playResultSound(soundType);

    resultBadgeEl.textContent = badgeText;
    resultBadgeEl.className = `result-badge ${badgeClass}`;
    resultTitleEl.textContent = titleText;
    resultDetailEl.textContent = `手数: ${history.length}手 · 難易度: ${DIFFICULTY_INFO[difficulty].label}`;

    // 勝利ラインを少し見せてからオーバーレイを表示
    setTimeout(() => {
      if (gameOver) {
        resultOverlay.classList.remove('hidden');
      }
    }, 420);
  }

  /**
   * PC（AI）の手番を実行
   */
  function triggerAiTurn() {
    if (gameOver || currentTurn !== aiColor) return;

    isAiThinking = true;
    updateUI();

    const delay = difficulty === 'hard' ? 240 : 280;
    aiTimerId = setTimeout(() => {
      aiTimerId = null;
      if (gameOver || currentTurn !== aiColor) {
        isAiThinking = false;
        updateUI();
        return;
      }

      const [r, c] = getBestMove(board, aiColor, difficulty);
      isAiThinking = false;
      placeStone(r, c, aiColor);
    }, delay);
  }

  /**
   * 新しい対局を開始
   */
  function startNewGame() {
    if (aiTimerId !== null) {
      clearTimeout(aiTimerId);
      aiTimerId = null;
    }

    board = createEmptyBoard();
    history = [];
    currentTurn = BLACK;
    gameOver = false;
    isAiThinking = false;
    winningLine = null;
    hoverPos = null;
    resultOverlay.classList.add('hidden');

    drawBoard();
    updateUI();

    // ユーザーが後手（白）なら、PC（黒）が初手を打つ
    if (currentTurn === aiColor) {
      triggerAiTurn();
    }
  }

  /**
   * 待った（Undo）
   */
  function undoMove() {
    if (isAiThinking || history.length === 0) return;

    // ユーザーが後手（白）で、まだPCの初手1手しか打たれていない場合は戻せない
    if (userColor === WHITE && history.length <= 1) return;

    resultOverlay.classList.add('hidden');
    gameOver = false;
    winningLine = null;

    // 最後に打ったのがAIなら2手戻し、プレイヤーなら1手戻す
    const last = history[history.length - 1];
    const popCount = last.player === aiColor && history.length >= 2 ? 2 : 1;

    for (let i = 0; i < popCount; i++) {
      const move = history.pop();
      if (move) {
        board[move.r][move.c] = EMPTY;
      }
    }

    currentTurn = userColor;
    drawBoard();
    updateUI();
  }

  /**
   * UI 表示の同期
   */
  function updateUI() {
    moveCountEl.textContent = String(history.length);
    scoreWinEl.textContent = String(scores.win);
    scoreLossEl.textContent = String(scores.loss);
    scoreDrawEl.textContent = String(scores.draw);

    // 思考中バー
    thinkingBarEl.classList.toggle('hidden', !isAiThinking);
    canvas.classList.toggle('disabled', gameOver || isAiThinking || currentTurn !== userColor);

    // 待ったボタンの有効状態
    const canUndo =
      !isAiThinking &&
      history.length > 0 &&
      !(userColor === WHITE && history.length <= 1);
    undoBtn.disabled = !canUndo;

    // ステータス表示
    if (gameOver) {
      if (winningLine) {
        const winner = board[winningLine[0][0]][winningLine[0][1]];
        turnStoneEl.className = `stone-dot ${winner === BLACK ? 'black' : 'white'}`;
        statusTextEl.textContent = winner === userColor ? 'あなたの勝利！' : 'PCの勝利';
      } else {
        turnStoneEl.className = 'stone-dot black';
        statusTextEl.textContent = '引き分け';
      }
    } else {
      const colorName = currentTurn === BLACK ? '黒' : '白';
      turnStoneEl.className = `stone-dot ${currentTurn === BLACK ? 'black' : 'white'}`;
      if (currentTurn === userColor) {
        statusTextEl.textContent = `あなたの手番（${colorName}）`;
      } else {
        statusTextEl.textContent = `PCの手番（${colorName}）`;
      }
    }
  }

  // ===== イベントリスナー =====

  canvas.addEventListener('pointermove', (e) => {
    if (gameOver || isAiThinking || currentTurn !== userColor) {
      if (hoverPos) {
        hoverPos = null;
        drawBoard();
      }
      return;
    }

    const pos = getGridPosFromEvent(e);
    const changed =
      (pos === null && hoverPos !== null) ||
      (pos !== null && (hoverPos === null || pos.r !== hoverPos.r || pos.c !== hoverPos.c));

    if (changed) {
      hoverPos = pos;
      drawBoard();
    }
  });

  canvas.addEventListener('pointerleave', () => {
    if (hoverPos) {
      hoverPos = null;
      drawBoard();
    }
  });

  canvas.addEventListener('click', (e) => {
    if (gameOver || isAiThinking || currentTurn !== userColor) return;
    const pos = getGridPosFromEvent(e);
    if (!pos) return;
    if (board[pos.r][pos.c] !== EMPTY) return;

    hoverPos = null;
    const placed = placeStone(pos.r, pos.c, userColor);
    if (placed && !gameOver) {
      triggerAiTurn();
    }
  });

  // 難易度切り替え
  difficultyGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    const nextDiff = btn.dataset.difficulty;
    if (!nextDiff || nextDiff === difficulty) return;

    difficulty = nextDiff;
    difficultyGroup.querySelectorAll('.seg-btn').forEach((el) => {
      el.classList.toggle('active', el.dataset.difficulty === difficulty);
    });
    difficultyDescEl.textContent = DIFFICULTY_INFO[difficulty].desc;
    startNewGame();
  });

  // 手番（先手/後手）切り替え
  colorGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    const nextColor = Number(btn.dataset.color);
    if (nextColor === userColor) return;

    userColor = nextColor;
    aiColor = userColor === BLACK ? WHITE : BLACK;
    colorGroup.querySelectorAll('.seg-btn').forEach((el) => {
      el.classList.toggle('active', Number(el.dataset.color) === userColor);
    });
    startNewGame();
  });

  newGameBtn.addEventListener('click', startNewGame);
  undoBtn.addEventListener('click', undoMove);

  overlayRematchBtn.addEventListener('click', startNewGame);
  overlayCloseBtn.addEventListener('click', () => {
    resultOverlay.classList.add('hidden');
  });

  soundToggleBtn.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    soundIconEl.textContent = soundEnabled ? '🔊' : '🔇';
  });

  window.addEventListener('resize', resizeCanvas);

  // 初期化
  resizeCanvas();
  startNewGame();
})();

(function (global) {
  'use strict';

  const BOARD_SIZE = 15;
  const EMPTY = 0;
  const BLACK = 1;
  const WHITE = 2;

  const DIRECTIONS = [
    [0, 1],   // 横
    [1, 0],   // 縦
    [1, 1],   // 右斜め下
    [1, -1],  // 左斜め下
  ];

  // パターン評価スコア
  const SCORE = {
    FIVE: 100000000,
    OPEN_FOUR: 2000000,
    FOUR: 150000,
    OPEN_THREE: 80000,
    THREE: 4000,
    OPEN_TWO: 1200,
    TWO: 120,
    ONE: 15,
  };

  function inBounds(r, c) {
    return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
  }

  function opponentOf(player) {
    return player === BLACK ? WHITE : BLACK;
  }

  /**
   * (row, col) に player が置いたことで5連以上が完成したか判定。
   * 勝利した場合は勝利ラインの座標配列 [[r,c], ...] を返す。なければ null。
   */
  function checkWin(board, row, col, player) {
    for (let d = 0; d < DIRECTIONS.length; d++) {
      const [dr, dc] = DIRECTIONS[d];
      const line = [[row, col]];

      let r = row + dr;
      let c = col + dc;
      while (inBounds(r, c) && board[r][c] === player) {
        line.push([r, c]);
        r += dr;
        c += dc;
      }

      r = row - dr;
      c = col - dc;
      while (inBounds(r, c) && board[r][c] === player) {
        line.unshift([r, c]);
        r -= dr;
        c -= dc;
      }

      if (line.length >= 5) {
        return line;
      }
    }
    return null;
  }

  /**
   * (row, col) に player が石を置いたと仮定した場合の局所スコア（4方向合算）
   */
  function evaluatePoint(board, row, col, player) {
    let total = 0;
    let openThreeCount = 0;
    let fourCount = 0;

    for (let d = 0; d < DIRECTIONS.length; d++) {
      const [dr, dc] = DIRECTIONS[d];
      const lineScore = evaluateDirection(board, row, col, dr, dc, player);
      total += lineScore.score;
      if (lineScore.isOpenThree) openThreeCount++;
      if (lineScore.isFour) fourCount++;
    }

    // 複合手ボーナス（四四、四三、三三）
    if (fourCount >= 2) {
      total += SCORE.OPEN_FOUR;
    } else if (fourCount >= 1 && openThreeCount >= 1) {
      total += SCORE.OPEN_FOUR * 0.9;
    } else if (openThreeCount >= 2) {
      total += SCORE.FOUR * 2;
    }

    // 中央に近いほどわずかに優遇
    const centerDist = Math.abs(row - 7) + Math.abs(col - 7);
    total += (14 - centerDist) * 2;

    return total;
  }

  /**
   * 1方向における (row, col) を中心とした局所パターン評価（飛び三・飛び四も考慮）
   */
  function evaluateDirection(board, row, col, dr, dc, player) {
    // 中心の前後4マス（計9マス）を抽出して解析
    let count = 1;
    let openLeft = false;
    let openRight = false;

    // 右（正方向）
    let r = row + dr;
    let c = col + dc;
    let rightGapCount = 0;
    while (inBounds(r, c) && board[r][c] === player) {
      count++;
      r += dr;
      c += dc;
    }
    if (inBounds(r, c) && board[r][c] === EMPTY) {
      openRight = true;
      // 1マス空き先の同色石（飛びパターン）
      let r2 = r + dr;
      let c2 = c + dc;
      while (inBounds(r2, c2) && board[r2][c2] === player) {
        rightGapCount++;
        r2 += dr;
        c2 += dc;
      }
    }

    // 左（負方向）
    r = row - dr;
    c = col - dc;
    let leftGapCount = 0;
    while (inBounds(r, c) && board[r][c] === player) {
      count++;
      r -= dr;
      c -= dc;
    }
    if (inBounds(r, c) && board[r][c] === EMPTY) {
      openLeft = true;
      let r2 = r - dr;
      let c2 = c - dc;
      while (inBounds(r2, c2) && board[r2][c2] === player) {
        leftGapCount++;
        r2 -= dr;
        c2 -= dc;
      }
    }

    const openEnds = (openLeft ? 1 : 0) + (openRight ? 1 : 0);
    let score = 0;
    let isFour = false;
    let isOpenThree = false;

    if (count >= 5) {
      score = SCORE.FIVE;
    } else if (count === 4) {
      if (openEnds === 2) {
        score = SCORE.OPEN_FOUR;
        isFour = true;
      } else if (openEnds === 1) {
        score = SCORE.FOUR;
        isFour = true;
      }
    } else if (count === 3) {
      if (openEnds === 2) {
        score = SCORE.OPEN_THREE;
        isOpenThree = true;
      } else if (openEnds === 1) {
        score = SCORE.THREE;
      }
      // 飛び四チェック（OOO_O など）
      if (rightGapCount >= 1 || leftGapCount >= 1) {
        score = Math.max(score, SCORE.FOUR * 0.92);
        isFour = true;
      }
    } else if (count === 2) {
      if (openEnds === 2) {
        score = SCORE.OPEN_TWO;
      } else if (openEnds === 1) {
        score = SCORE.TWO;
      }
      // 飛び四（OO_OO）や飛び三（_OO_O_）
      const maxGap = Math.max(rightGapCount, leftGapCount);
      if (maxGap >= 2) {
        score = Math.max(score, SCORE.FOUR * 0.9);
        isFour = true;
      } else if (maxGap === 1 && openEnds === 2) {
        score = Math.max(score, SCORE.OPEN_THREE * 0.85);
        isOpenThree = true;
      } else if (maxGap === 1 && openEnds === 1) {
        score = Math.max(score, SCORE.THREE * 0.85);
      }
    } else if (count === 1) {
      const maxGap = Math.max(rightGapCount, leftGapCount);
      if (maxGap >= 3) {
        score = SCORE.FOUR * 0.88;
        isFour = true;
      } else if (maxGap === 2 && openEnds === 2) {
        score = SCORE.OPEN_THREE * 0.8;
        isOpenThree = true;
      } else if (maxGap === 1 && openEnds === 2) {
        score = SCORE.OPEN_TWO * 0.7;
      } else if (openEnds === 2) {
        score = SCORE.ONE;
      }
    }

    return { score, isFour, isOpenThree };
  }

  /**
   * 盤面上の既存の石の周辺（半径 radius）にある空きマスを候補手として生成
   */
  function getCandidateMoves(board, radius) {
    const candidates = [];
    const seen = new Uint8Array(BOARD_SIZE * BOARD_SIZE);
    let hasStone = false;

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c] !== EMPTY) {
          hasStone = true;
          const rMin = Math.max(0, r - radius);
          const rMax = Math.min(BOARD_SIZE - 1, r + radius);
          const cMin = Math.max(0, c - radius);
          const cMax = Math.min(BOARD_SIZE - 1, c + radius);
          for (let nr = rMin; nr <= rMax; nr++) {
            for (let nc = cMin; nc <= cMax; nc++) {
              const idx = nr * BOARD_SIZE + nc;
              if (board[nr][nc] === EMPTY && !seen[idx]) {
                seen[idx] = 1;
                candidates.push([nr, nc]);
              }
            }
          }
        }
      }
    }

    if (!hasStone) {
      return [[7, 7]];
    }
    return candidates;
  }

  /**
   * 盤面全体の静的評価（aiPlayer 視点）。turnPlayer はこれから打つ手番。
   */
  function evaluateBoard(board, aiPlayer, turnPlayer) {
    const opp = opponentOf(aiPlayer);
    const aiInfo = scoreAllLines(board, aiPlayer);
    const oppInfo = scoreAllLines(board, opp);

    const turnIsAi = turnPlayer === aiPlayer;
    const turnInfo = turnIsAi ? aiInfo : oppInfo;
    const waitInfo = turnIsAi ? oppInfo : aiInfo;
    const sign = turnIsAi ? 1 : -1;

    // すでに5連がある
    if (aiInfo.fives > 0) return SCORE.FIVE;
    if (oppInfo.fives > 0) return -SCORE.FIVE;

    // これから打つ側に四（活四・眠四・飛び四）があれば次の一手で勝ち
    if (turnInfo.openFours > 0 || turnInfo.fours > 0) {
      return sign * (SCORE.FIVE * 0.85);
    }

    // 待ち側に活四または四が2つ以上あれば防御不能
    if (waitInfo.openFours > 0 || waitInfo.fours >= 2) {
      return -sign * (SCORE.FIVE * 0.75);
    }

    // 待ち側に四がなく、手番側に活三があれば次に活四を作れるため大優勢
    let tacticalBonus = 0;
    if (waitInfo.fours === 0 && turnInfo.openThrees > 0) {
      tacticalBonus += sign * (SCORE.OPEN_FOUR * 0.6);
    }
    // 待ち側に活三が2つ以上あり、手番側に四も活三もなければ非常に危険
    if (waitInfo.openThrees >= 2 && turnInfo.openThrees === 0) {
      tacticalBonus -= sign * (SCORE.OPEN_FOUR * 0.45);
    }

    const aiWeight = turnIsAi ? 1.15 : 1.0;
    const oppWeight = turnIsAi ? 1.0 : 1.15;

    return aiInfo.score * aiWeight - oppInfo.score * oppWeight + tacticalBonus;
  }

  /**
   * 盤面の全ライン（横・縦・斜め2方向）を走査して player のパターン合計スコアと脅威数を返す
   */
  function scoreAllLines(board, player) {
    const info = { score: 0, fives: 0, openFours: 0, fours: 0, openThrees: 0 };

    // 横ライン
    for (let r = 0; r < BOARD_SIZE; r++) {
      scoreLine(board, r, 0, 0, 1, BOARD_SIZE, player, info);
    }
    // 縦ライン
    for (let c = 0; c < BOARD_SIZE; c++) {
      scoreLine(board, 0, c, 1, 0, BOARD_SIZE, player, info);
    }
    // 右斜め下（上辺と左辺から）
    for (let c = 0; c <= BOARD_SIZE - 5; c++) {
      scoreLine(board, 0, c, 1, 1, BOARD_SIZE - c, player, info);
    }
    for (let r = 1; r <= BOARD_SIZE - 5; r++) {
      scoreLine(board, r, 0, 1, 1, BOARD_SIZE - r, player, info);
    }
    // 左斜め下（上辺と右辺から）
    for (let c = 4; c < BOARD_SIZE; c++) {
      scoreLine(board, 0, c, 1, -1, c + 1, player, info);
    }
    for (let r = 1; r <= BOARD_SIZE - 5; r++) {
      scoreLine(board, r, BOARD_SIZE - 1, 1, -1, BOARD_SIZE - r, player, info);
    }

    return info;
  }

  /**
   * 1本のライン上の連続石・空きを高速スキャンしてスコアと脅威数を加算
   */
  function scoreLine(board, startR, startC, dr, dc, length, player, info) {
    let i = 0;

    while (i < length) {
      const r = startR + i * dr;
      const c = startC + i * dc;
      if (board[r][c] !== player) {
        i++;
        continue;
      }

      // 連続する player の石の開始
      const startIdx = i;
      while (i < length && board[startR + i * dr][startC + i * dc] === player) {
        i++;
      }
      const count = i - startIdx;

      const leftOpen =
        startIdx > 0 &&
        board[startR + (startIdx - 1) * dr][startC + (startIdx - 1) * dc] === EMPTY;
      const rightOpen =
        i < length &&
        board[startR + i * dr][startC + i * dc] === EMPTY;
      const openEnds = (leftOpen ? 1 : 0) + (rightOpen ? 1 : 0);

      if (count >= 5) {
        info.score += SCORE.FIVE;
        info.fives++;
      } else if (count === 4) {
        if (openEnds === 2) {
          info.score += SCORE.OPEN_FOUR;
          info.openFours++;
        } else if (openEnds === 1) {
          info.score += SCORE.FOUR;
          info.fours++;
        }
      } else if (count === 3) {
        if (openEnds === 2) {
          info.score += SCORE.OPEN_THREE;
          info.openThrees++;
        } else if (openEnds === 1) {
          info.score += SCORE.THREE;
        }
      } else if (count === 2) {
        if (openEnds === 2) info.score += SCORE.OPEN_TWO;
        else if (openEnds === 1) info.score += SCORE.TWO;
      } else if (count === 1 && openEnds === 2) {
        info.score += SCORE.ONE;
      }

      // 1マス空きで繋がる飛び四・飛び三（右方向のみチェックして二重計上を防止）
      if (rightOpen && i + 1 < length) {
        const nextR = startR + (i + 1) * dr;
        const nextC = startC + (i + 1) * dc;
        if (board[nextR][nextC] === player) {
          let j = i + 1;
          while (j < length && board[startR + j * dr][startC + j * dc] === player) {
            j++;
          }
          const nextCount = j - (i + 1);
          const combined = count + nextCount;
          const farRightOpen =
            j < length && board[startR + j * dr][startC + j * dc] === EMPTY;

          if (combined >= 4) {
            info.score += SCORE.FOUR * 0.85;
            info.fours++;
          } else if (combined === 3 && leftOpen && farRightOpen) {
            info.score += SCORE.OPEN_THREE * 0.75;
            info.openThrees++;
          }
        }
      }
    }
  }

  /**
   * 候補手を局所スコアでソートし上位 maxMoves 件を返す
   */
  function getOrderedMoves(board, player, radius, maxMoves) {
    const opp = opponentOf(player);
    const raw = getCandidateMoves(board, radius);
    const scored = new Array(raw.length);

    for (let i = 0; i < raw.length; i++) {
      const [r, c] = raw[i];
      const attack = evaluatePoint(board, r, c, player);
      const defend = evaluatePoint(board, r, c, opp);
      // 攻撃と防御の両方を高く評価
      const priority = Math.max(attack, defend * 0.95) + (attack + defend) * 0.15;
      scored[i] = { r, c, priority, attack, defend };
    }

    scored.sort((a, b) => b.priority - a.priority);
    if (maxMoves && scored.length > maxMoves) {
      return scored.slice(0, maxMoves);
    }
    return scored;
  }

  /**
   * Easy モード：初心者向け。ランダム性が高く、時々脅威を見逃す。
   */
  function chooseMoveEasy(board, aiPlayer) {
    const opp = opponentOf(aiPlayer);
    const candidates = getOrderedMoves(board, aiPlayer, 2, 20);
    if (candidates.length === 0) return [7, 7];

    // 即勝ちは 75% の確率で打つ
    if (candidates[0].attack >= SCORE.FIVE && Math.random() < 0.75) {
      return [candidates[0].r, candidates[0].c];
    }

    // 相手の4連止めは 60% の確率で防ぐ
    const urgentDefend = candidates.find((m) => m.defend >= SCORE.FIVE);
    if (urgentDefend && Math.random() < 0.6) {
      return [urgentDefend.r, urgentDefend.c];
    }

    // 上位8手程度からランダム寄り（ソフトマックス風の重み）で選択
    const poolSize = Math.min(8, candidates.length);
    const pool = candidates.slice(0, poolSize);
    const idx = Math.floor(Math.pow(Math.random(), 1.4) * pool.length);
    return [pool[idx].r, pool[idx].c];
  }

  /**
   * Normal モード：1手読みの攻防評価。即勝ち・4連止め・活三対応を堅実に行う。
   */
  function chooseMoveNormal(board, aiPlayer) {
    const candidates = getOrderedMoves(board, aiPlayer, 2, 24);
    if (candidates.length === 0) return [7, 7];

    // 即勝ち
    for (const m of candidates) {
      if (m.attack >= SCORE.FIVE) return [m.r, m.c];
    }
    // 相手の即勝ち阻止
    for (const m of candidates) {
      if (m.defend >= SCORE.FIVE) return [m.r, m.c];
    }
    // 自分の活四
    for (const m of candidates) {
      if (m.attack >= SCORE.OPEN_FOUR) return [m.r, m.c];
    }
    // 相手の活四阻止
    for (const m of candidates) {
      if (m.defend >= SCORE.OPEN_FOUR) return [m.r, m.c];
    }

    // 攻撃 + 防御*1.05 で再スコアリングし、僅差の上位から選択
    let bestScore = -Infinity;
    const scored = candidates.map((m) => {
      const s = m.attack + m.defend * 1.05;
      if (s > bestScore) bestScore = s;
      return { r: m.r, c: m.c, score: s };
    });

    const threshold = bestScore * 0.85;
    const topMoves = scored.filter((m) => m.score >= threshold);
    const chosen = topMoves[Math.floor(Math.random() * topMoves.length)];
    return [chosen.r, chosen.c];
  }

  /**
   * Hard モード：Alpha-Beta 探索（深さ4）+ ムーブオーダリング + 時間制限ガード
   */
  function chooseMoveHard(board, aiPlayer) {
    const opp = opponentOf(aiPlayer);
    const candidates = getOrderedMoves(board, aiPlayer, 2, 18);
    if (candidates.length === 0) return [7, 7];
    if (candidates.length === 1) return [candidates[0].r, candidates[0].c];

    // 1. 即勝ち
    for (const m of candidates) {
      if (m.attack >= SCORE.FIVE) return [m.r, m.c];
    }
    // 2. 相手の即勝ち阻止（最優先）
    const mustDefend = candidates.filter((m) => m.defend >= SCORE.FIVE);
    if (mustDefend.length === 1) {
      return [mustDefend[0].r, mustDefend[0].c];
    }
    // 3. 自分に活四があるなら即座に打つ（相手に即勝ちがない場合）
    if (mustDefend.length === 0) {
      for (const m of candidates) {
        if (m.attack >= SCORE.OPEN_FOUR) return [m.r, m.c];
      }
    }

    const searchMoves = mustDefend.length > 0 ? mustDefend : candidates.slice(0, 14);
    const startTime = Date.now();
    const TIME_LIMIT_MS = 1100;
    const MAX_DEPTH = 4;
    let timeExceeded = false;

    function alphaBeta(depth, alpha, beta, currentPlayer, lastR, lastC, lastPlayer) {
      if (Date.now() - startTime > TIME_LIMIT_MS) {
        timeExceeded = true;
        return evaluateBoard(board, aiPlayer, currentPlayer);
      }

      if (lastR !== -1 && checkWin(board, lastR, lastC, lastPlayer)) {
        // 早く勝つほど高評価、遅く負けるほどマシ
        return lastPlayer === aiPlayer
          ? SCORE.FIVE + depth * 10000
          : -SCORE.FIVE - depth * 10000;
      }

      if (depth === 0) {
        return evaluateBoard(board, aiPlayer, currentPlayer);
      }

      const moves = getOrderedMoves(board, currentPlayer, 2, depth >= 3 ? 12 : 10);
      if (moves.length === 0) {
        return 0;
      }

      const isMaximizing = currentPlayer === aiPlayer;
      const nextPlayer = opponentOf(currentPlayer);

      if (isMaximizing) {
        let value = -Infinity;
        for (let i = 0; i < moves.length; i++) {
          const { r, c } = moves[i];
          board[r][c] = currentPlayer;
          const score = alphaBeta(depth - 1, alpha, beta, nextPlayer, r, c, currentPlayer);
          board[r][c] = EMPTY;

          if (score > value) value = score;
          if (value > alpha) alpha = value;
          if (alpha >= beta || timeExceeded) break;
        }
        return value;
      } else {
        let value = Infinity;
        for (let i = 0; i < moves.length; i++) {
          const { r, c } = moves[i];
          board[r][c] = currentPlayer;
          const score = alphaBeta(depth - 1, alpha, beta, nextPlayer, r, c, currentPlayer);
          board[r][c] = EMPTY;

          if (score < value) value = score;
          if (value < beta) beta = value;
          if (alpha >= beta || timeExceeded) break;
        }
        return value;
      }
    }

    let bestMove = [searchMoves[0].r, searchMoves[0].c];
    let bestScore = -Infinity;
    let alpha = -Infinity;
    const beta = Infinity;

    for (let i = 0; i < searchMoves.length; i++) {
      const { r, c } = searchMoves[i];
      board[r][c] = aiPlayer;
      const score = alphaBeta(MAX_DEPTH - 1, alpha, beta, opp, r, c, aiPlayer);
      board[r][c] = EMPTY;

      if (score > bestScore) {
        bestScore = score;
        bestMove = [r, c];
      }
      if (score > alpha) {
        alpha = score;
      }
      if (bestScore >= SCORE.FIVE || timeExceeded) {
        break;
      }
    }

    return bestMove;
  }

  /**
   * 外部呼び出し用：指定難易度でAIの次の手 [row, col] を返す
   */
  function getBestMove(board, aiPlayer, difficulty) {
    // 盤面が空なら天元(7,7)に打つ
    let stoneCount = 0;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c] !== EMPTY) stoneCount++;
      }
    }
    if (stoneCount === 0) {
      return [7, 7];
    }

    if (difficulty === 'easy') {
      return chooseMoveEasy(board, aiPlayer);
    }
    if (difficulty === 'hard') {
      return chooseMoveHard(board, aiPlayer);
    }
    return chooseMoveNormal(board, aiPlayer);
  }

  const GomokuAI = {
    BOARD_SIZE,
    EMPTY,
    BLACK,
    WHITE,
    checkWin,
    getBestMove,
    evaluatePoint,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GomokuAI;
  } else {
    global.GomokuAI = GomokuAI;
  }
})(typeof window !== 'undefined' ? window : globalThis);

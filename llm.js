(function (global) {
  'use strict';

  const { BOARD_SIZE, EMPTY, BLACK, WHITE } = global.GomokuAI;

  const DEFAULT_MODELS = {
    gemini: 'gemini-flash-lite-latest',
    claude: 'claude-sonnet-4-5',
  };

  const PRESET_MODELS = {
    gemini: [],
    claude: [],
  };

  /**
   * 座標変換: (r, c) <-> "A15".."O1"
   * c=0 -> A, c=14 -> O
   * r=0 -> 15, r=14 -> 1
   */
  function toCoord(r, c) {
    const colChar = String.fromCharCode(65 + c);
    const rowNum = BOARD_SIZE - r;
    return `${colChar}${rowNum}`;
  }

  function parseCoord(coordStr) {
    if (typeof coordStr !== 'string') return null;
    const m = coordStr.trim().toUpperCase().match(/^([A-O])\s*(\d{1,2})$/);
    if (!m) return null;
    const c = m[1].charCodeAt(0) - 65;
    const rowNum = parseInt(m[2], 10);
    const r = BOARD_SIZE - rowNum;
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return null;
    return [r, c];
  }

  /**
   * 盤面をLLMが読みやすいテキスト表現に変換
   */
  function formatBoardForPrompt(board) {
    const header = '   ' + Array.from({ length: BOARD_SIZE }, (_, i) => String.fromCharCode(65 + i)).join(' ');
    const lines = [header];
    for (let r = 0; r < BOARD_SIZE; r++) {
      const rowNum = String(BOARD_SIZE - r).padStart(2, ' ');
      const cells = board[r]
        .map((v) => (v === BLACK ? 'X' : v === WHITE ? 'O' : '.'))
        .join(' ');
      lines.push(`${rowNum} ${cells}`);
    }
    return lines.join('\n');
  }

  /**
   * 既存の石の座標リストを作成（LLMの誤認を減らすため補助情報として渡す）
   */
  function formatMoveHistory(history) {
    if (!history || history.length === 0) return 'なし（初手）';
    return history
      .map((m, i) => `${i + 1}.${m.player === BLACK ? '黒' : '白'}:${toCoord(m.r, m.c)}`)
      .join(', ');
  }

  /**
   * プロンプト構築
   */
  function buildPrompt(board, aiColor, history, retryNotice) {
    const mySymbol = aiColor === BLACK ? 'X（黒）' : 'O（白）';
    const oppSymbol = aiColor === BLACK ? 'O（白）' : 'X（黒）';

    let text = [
      'あなたは15×15の囲碁盤で行う五目並べ（Gomoku）の強いAIプレイヤーです。',
      `あなたの石は ${mySymbol}、相手の石は ${oppSymbol} です。`,
      '縦・横・斜めのいずれかに自分の石を5つ並べると勝利です。',
      '',
      '【現在の盤面】（. は空きマス、X は黒、O は白）',
      formatBoardForPrompt(board),
      '',
      `【これまでの棋譜】`,
      formatMoveHistory(history),
      '',
      '【思考の優先順位】',
      '1. 自分が5連を完成できる手があれば最優先で打つ。',
      '2. 相手の4連（次で5連になる手）があれば必ず阻止する。',
      '3. 自分の活四・四三・活三を作る、または相手の活三を防ぐ。',
      '4. 必ず空きマス（.）の中から選ぶこと。すでに石がある座標は絶対に選ばないこと。',
      '',
      '【出力形式】',
      '必ず次のJSONオブジェクトのみを返してください（マークダウンのコードブロックや前置きは不要です）：',
      '{"coord": "H8", "reason": "25文字以内の簡潔な日本語コメント"}',
    ].join('\n');

    if (retryNotice) {
      text += `\n\n【重要】前回の回答は無効でした（${retryNotice}）。必ず盤面の「.」（空きマス）の座標を選んでください。`;
    }

    return text;
  }

  /**
   * レスポンステキストから JSON を抽出してパース
   */
  function extractJson(text) {
    if (!text) return null;
    const trimmed = text.trim();
    try {
      return JSON.parse(trimmed);
    } catch (_) {
      // ```json ... ``` や前後にテキストが混じった場合のフォールバック抽出
      const match = trimmed.match(/\{[\s\S]*?\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch (__) {
          return null;
        }
      }
      return null;
    }
  }

  /**
   * Gemini API 呼び出し
   */
  async function callGemini(apiKey, model, prompt) {
    const modelName = (model || DEFAULT_MODELS.gemini).trim();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey.trim(),
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!res.ok) {
      let msg = `Gemini API エラー (${res.status})`;
      try {
        const errJson = await res.json();
        if (errJson && errJson.error && errJson.error.message) {
          msg = `Gemini API エラー: ${errJson.error.message}`;
        }
      } catch (_) {}
      throw new Error(msg);
    }

    const data = await res.json();
    const text =
      data &&
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text;

    if (!text) {
      throw new Error('Gemini API から有効な応答が返されませんでした。');
    }
    return text;
  }

  /**
   * Claude API (Anthropic) 呼び出し
   * anthropic-dangerous-direct-browser-access ヘッダによりブラウザから直接CORS通信可能
   */
  async function callClaude(apiKey, model, prompt) {
    const modelName = (model || DEFAULT_MODELS.claude).trim();
    const url = 'https://api.anthropic.com/v1/messages';

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey.trim(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: modelName,
        max_tokens: 256,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      let msg = `Claude API エラー (${res.status})`;
      try {
        const errJson = await res.json();
        if (errJson && errJson.error && errJson.error.message) {
          msg = `Claude API エラー: ${errJson.error.message}`;
        }
      } catch (_) {}
      throw new Error(msg);
    }

    const data = await res.json();
    const textBlock =
      data && Array.isArray(data.content)
        ? data.content.find((b) => b.type === 'text')
        : null;

    if (!textBlock || !textBlock.text) {
      throw new Error('Claude API から有効な応答が返されませんでした。');
    }
    return textBlock.text;
  }

  /**
   * LLM を使って次の手を取得する（不正な座標を返した場合は1回リトライ）
   * @returns {Promise<{ r: number, c: number, reason: string }>}
   */
  async function getLlmMove({ board, aiColor, history, provider, apiKey, model }) {
    if (!apiKey || !apiKey.trim()) {
      throw new Error('APIキーが入力されていません。サイドパネルでAPIキーを設定してください。');
    }

    // 初手（盤面が完全に空）の場合はAPIを節約せず実際に聞くか天元に打つか選べるが、
    // AIモードの体験として初手もLLMに打たせる
    let retryNotice = '';

    for (let attempt = 0; attempt < 2; attempt++) {
      const prompt = buildPrompt(board, aiColor, history, retryNotice);
      const rawText =
        provider === 'claude'
          ? await callClaude(apiKey, model, prompt)
          : await callGemini(apiKey, model, prompt);

      const parsed = extractJson(rawText);
      if (!parsed || !parsed.coord) {
        retryNotice = 'JSON形式の coord が読み取れませんでした';
        continue;
      }

      const pos = parseCoord(parsed.coord);
      if (!pos) {
        retryNotice = `座標 "${parsed.coord}" は盤面の範囲外（A1〜O15）です`;
        continue;
      }

      const [r, c] = pos;
      if (board[r][c] !== EMPTY) {
        retryNotice = `座標 ${parsed.coord} には既に石が置かれています`;
        continue;
      }

      return {
        r,
        c,
        reason: typeof parsed.reason === 'string' ? parsed.reason.trim() : '',
      };
    }

    throw new Error('AIが有効な空きマスを選択できませんでした。');
  }

  /**
   * 公式APIから利用可能なモデル一覧を動的に取得する
   * @returns {Promise<Array<{ id: string, label: string, tag: string }>>}
   */
  async function fetchAvailableModels(provider, apiKey) {
    if (!apiKey || !apiKey.trim()) {
      throw new Error('モデル一覧をAPIから取得するには、先にAPIキーを入力してください。');
    }

    const presetMap = new Map(
      (PRESET_MODELS[provider] || []).map((m) => [m.id, m])
    );

    if (provider === 'claude') {
      const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
        method: 'GET',
        headers: {
          'x-api-key': apiKey.trim(),
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
      });

      if (!res.ok) {
        let msg = `Claude モデル取得エラー (${res.status})`;
        try {
          const errJson = await res.json();
          if (errJson && errJson.error && errJson.error.message) {
            msg = `Claude モデル取得エラー: ${errJson.error.message}`;
          }
        } catch (_) {}
        throw new Error(msg);
      }

      const data = await res.json();
      const list = Array.isArray(data && data.data) ? data.data : [];
      return list
        .filter((item) => item && item.id)
        .map((item) => {
          const preset = presetMap.get(item.id);
          return {
            id: item.id,
            label: item.display_name || (preset && preset.label) || item.id,
            tag: (preset && preset.tag) || 'API取得',
          };
        });
    }

    // Gemini API
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100', {
      method: 'GET',
      headers: {
        'x-goog-api-key': apiKey.trim(),
      },
    });

    if (!res.ok) {
      let msg = `Gemini モデル取得エラー (${res.status})`;
      try {
        const errJson = await res.json();
        if (errJson && errJson.error && errJson.error.message) {
          msg = `Gemini モデル取得エラー: ${errJson.error.message}`;
        }
      } catch (_) {}
      throw new Error(msg);
    }

    const data = await res.json();
    const list = Array.isArray(data && data.models) ? data.models : [];
    return list
      .filter((item) => {
        if (!item || !item.name) return false;
        const methods = Array.isArray(item.supportedGenerationMethods)
          ? item.supportedGenerationMethods
          : [];
        return methods.includes('generateContent');
      })
      .map((item) => {
        const id = item.name.replace(/^models\//, '');
        const preset = presetMap.get(id);
        return {
          id,
          label: item.displayName || (preset && preset.label) || id,
          tag: (preset && preset.tag) || 'API取得',
        };
      })
      .sort((a, b) => {
        // プリセットにある推奨モデルを先頭に
        const aPreset = presetMap.has(a.id) ? 0 : 1;
        const bPreset = presetMap.has(b.id) ? 0 : 1;
        if (aPreset !== bPreset) return aPreset - bPreset;
        return b.id.localeCompare(a.id);
      });
  }

  const GomokuLLM = {
    DEFAULT_MODELS,
    PRESET_MODELS,
    toCoord,
    parseCoord,
    getLlmMove,
    fetchAvailableModels,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GomokuLLM;
  } else {
    global.GomokuLLM = GomokuLLM;
  }
})(typeof window !== 'undefined' ? window : globalThis);

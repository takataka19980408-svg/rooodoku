(() => {
  const textInput = document.getElementById('text-input');
  const charCount = document.getElementById('char-count');
  const clearBtn = document.getElementById('clear-btn');
  const voiceSelect = document.getElementById('voice-select');
  const rateRange = document.getElementById('rate-range');
  const pitchRange = document.getElementById('pitch-range');
  const volumeRange = document.getElementById('volume-range');
  const rateValue = document.getElementById('rate-value');
  const pitchValue = document.getElementById('pitch-value');
  const volumeValue = document.getElementById('volume-value');
  const playBtn = document.getElementById('play-btn');
  const pauseBtn = document.getElementById('pause-btn');
  const stopBtn = document.getElementById('stop-btn');
  const statusEl = document.getElementById('status');
  const unsupportedEl = document.getElementById('unsupported');
  const historyCard = document.getElementById('history-card');
  const historyList = document.getElementById('history-list');
  const historyClearBtn = document.getElementById('history-clear-btn');
  const copyBtn = document.getElementById('copy-btn');
  const pasteBtn = document.getElementById('paste-btn');
  const shareBtn = document.getElementById('share-btn');
  const exportBtn = document.getElementById('export-btn');
  const importBtn = document.getElementById('import-btn');
  const importFile = document.getElementById('import-file');
  const installBtn = document.getElementById('install-btn');
  const autoReceiveToggle = document.getElementById('auto-receive-toggle');
  const claudeStatus = document.getElementById('claude-status');
  const noJapaneseVoiceEl = document.getElementById('no-japanese-voice');
  const presetBtns = document.querySelectorAll('.preset-btn');
  const refreshVoicesBtn = document.getElementById('refresh-voices-btn');
  const aiVoiceToggle = document.getElementById('ai-voice-toggle');
  const aiVoiceSettings = document.getElementById('ai-voice-settings');
  const elevenApiKeyInput = document.getElementById('eleven-api-key');
  const elevenVoiceSelect = document.getElementById('eleven-voice-select');
  const elevenDeleteVoiceBtn = document.getElementById('eleven-delete-voice-btn');
  const elevenVoiceNameInput = document.getElementById('eleven-voice-name');
  const elevenVoiceFileInput = document.getElementById('eleven-voice-file');
  const elevenCloneBtn = document.getElementById('eleven-clone-btn');
  const elevenExistingNameInput = document.getElementById('eleven-existing-name');
  const elevenExistingIdInput = document.getElementById('eleven-existing-id');
  const elevenAddExistingBtn = document.getElementById('eleven-add-existing-btn');
  const elevenStatus = document.getElementById('eleven-status');

  if (!('speechSynthesis' in window)) {
    document.querySelector('.card').hidden = true;
    unsupportedEl.hidden = false;
    return;
  }

  const synth = window.speechSynthesis;
  const HISTORY_KEY = 'rooodoku-history';
  const MAX_HISTORY = 10;
  let voices = [];
  let isPaused = false;
  let chunks = [];
  let chunkIndex = 0;
  let stoppedManually = false;
  let keepAliveTimer = null;
  const MAX_CHUNK_LEN = 180;
  const KEEP_ALIVE_MS = 10000;

  // ElevenLabs AIクローン音声
  const ELEVEN_KEY_STORAGE = 'rooodoku-elevenlabs-key';
  const ELEVEN_VOICES_STORAGE = 'rooodoku-elevenlabs-voices';
  const ELEVEN_SELECTED_VOICE_STORAGE = 'rooodoku-elevenlabs-selected-voice';
  const TTS_MODE_STORAGE = 'rooodoku-tts-mode';
  const ELEVEN_MAX_CHUNK_LEN = 800;
  let ttsMode = localStorage.getItem(TTS_MODE_STORAGE) === 'elevenlabs' ? 'elevenlabs' : 'device';
  let currentAudio = null;
  let audioChunks = [];
  let audioChunkIndex = 0;
  let audioStoppedManually = false;

  function loadVoices() {
    const allVoices = synth.getVoices();
    if (!allVoices.length) return;

    // 日本語の声だけに絞る(見つからない端末では全件を出す)
    const japaneseVoices = allVoices.filter((v) => v.lang.toLowerCase().startsWith('ja'));
    voices = japaneseVoices.length ? japaneseVoices : allVoices;
    noJapaneseVoiceEl.hidden = japaneseVoices.length > 0;

    const savedVoiceURI = localStorage.getItem('rooodoku-voice');
    voiceSelect.innerHTML = '';

    const sorted = [...voices].sort((a, b) => a.name.localeCompare(b.name));

    sorted.forEach((voice) => {
      const option = document.createElement('option');
      option.value = voice.voiceURI;
      option.textContent = `${voice.name} (${voice.lang})`;
      voiceSelect.appendChild(option);
    });

    if (savedVoiceURI && sorted.some((v) => v.voiceURI === savedVoiceURI)) {
      voiceSelect.value = savedVoiceURI;
    }
  }

  loadVoices();
  if (typeof synth.onvoiceschanged !== 'undefined') {
    synth.onvoiceschanged = loadVoices;
  }
  // SafariはgetVoices()が初回すぐには埋まらないことがあるので、少し粘って再取得する
  [300, 800, 1500, 3000].forEach((delay) => setTimeout(loadVoices, delay));

  function updateCharCount() {
    charCount.textContent = `${textInput.value.length} 文字`;
  }

  function setStatus(message) {
    statusEl.textContent = message;
  }

  function setButtonsState({ playing, paused }) {
    playBtn.disabled = playing && !paused;
    pauseBtn.disabled = !playing;
    stopBtn.disabled = !playing;
    pauseBtn.textContent = paused ? '⏵ 再開' : '⏸ 一時停止';
  }

  function getSelectedVoice() {
    return voices.find((v) => v.voiceURI === voiceSelect.value) || null;
  }

  // Chrome/Edge silently cut off SpeechSynthesisUtterance after ~15s on a
  // long utterance (chromium bug 679437). Splitting into short chunks and
  // periodically nudging pause/resume works around it so long text reads
  // to the end in one playback.
  function splitIntoChunks(text, maxLen = MAX_CHUNK_LEN) {
    const sentences = text.match(/[^。.!?！？\n]+[。.!?！？\n]?/g) || [text];
    const result = [];
    let current = '';
    sentences.forEach((sentence) => {
      if (current && (current + sentence).length > maxLen) {
        result.push(current);
        current = sentence;
      } else {
        current += sentence;
      }
      while (current.length > maxLen) {
        result.push(current.slice(0, maxLen));
        current = current.slice(maxLen);
      }
    });
    if (current) result.push(current);
    return result;
  }

  function startKeepAlive() {
    stopKeepAlive();
    keepAliveTimer = setInterval(() => {
      if (synth.speaking && !synth.paused) {
        synth.pause();
        synth.resume();
      }
    }, KEEP_ALIVE_MS);
  }

  function stopKeepAlive() {
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
  }

  function speakChunk() {
    if (chunkIndex >= chunks.length) {
      stopKeepAlive();
      isPaused = false;
      setStatus('読み上げが完了しました');
      setButtonsState({ playing: false, paused: false });
      return;
    }

    const utterance = new SpeechSynthesisUtterance(chunks[chunkIndex]);
    const voice = getSelectedVoice();
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    utterance.rate = parseFloat(rateRange.value);
    utterance.pitch = parseFloat(pitchRange.value);
    utterance.volume = parseFloat(volumeRange.value);

    utterance.onstart = () => {
      isPaused = false;
      setStatus(`読み上げ中… (${chunkIndex + 1}/${chunks.length})`);
      setButtonsState({ playing: true, paused: false });
    };
    utterance.onend = () => {
      if (stoppedManually) return;
      chunkIndex += 1;
      speakChunk();
    };
    utterance.onerror = (event) => {
      if (event.error === 'canceled' || event.error === 'interrupted') return;
      stopKeepAlive();
      isPaused = false;
      setStatus(`エラーが発生しました: ${event.error}`);
      setButtonsState({ playing: false, paused: false });
    };

    synth.speak(utterance);
  }

  function speakWithDevice(text) {
    stoppedManually = false;
    synth.cancel();
    chunks = splitIntoChunks(text);
    chunkIndex = 0;
    startKeepAlive();
    speakChunk();
  }

  // --- ElevenLabs AIクローン音声 ---
  async function elevenLabsRequest(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
      let message = `エラー(${response.status})`;
      try {
        const err = await response.json();
        const detail = err.detail;
        message += `: ${(detail && (detail.message || detail)) || JSON.stringify(err)}`;
      } catch {
        // レスポンスがJSONでない場合はそのまま
      }
      throw new Error(message);
    }
    return response;
  }

  async function elevenLabsTTS(text, voiceId, apiKey) {
    const response = await elevenLabsRequest(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });
    return response.blob();
  }

  async function elevenLabsCloneVoice(name, file, apiKey) {
    const formData = new FormData();
    formData.append('name', name);
    formData.append('files', file);
    const response = await elevenLabsRequest('https://api.elevenlabs.io/v1/voices/add', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: formData,
    });
    const data = await response.json();
    return data.voice_id;
  }

  function playAudioChunks() {
    if (audioChunkIndex >= audioChunks.length) {
      setStatus('読み上げが完了しました');
      setButtonsState({ playing: false, paused: false });
      return;
    }

    const apiKey = elevenApiKeyInput.value.trim();
    const voiceId = elevenVoiceSelect.value;
    setStatus(`AI音声を生成中…(${audioChunkIndex + 1}/${audioChunks.length})`);

    elevenLabsTTS(audioChunks[audioChunkIndex], voiceId, apiKey)
      .then((blob) => {
        if (audioStoppedManually) return;
        const url = URL.createObjectURL(blob);
        currentAudio = new Audio(url);
        currentAudio.onplay = () => {
          setStatus(`読み上げ中(AI音声)…(${audioChunkIndex + 1}/${audioChunks.length})`);
          setButtonsState({ playing: true, paused: false });
        };
        currentAudio.onended = () => {
          URL.revokeObjectURL(url);
          if (audioStoppedManually) return;
          audioChunkIndex += 1;
          playAudioChunks();
        };
        currentAudio.onerror = () => {
          setStatus('AI音声の再生に失敗しました');
          setButtonsState({ playing: false, paused: false });
        };
        currentAudio.play();
      })
      .catch((err) => {
        setStatus(err.message || 'AI音声の生成に失敗しました');
        setButtonsState({ playing: false, paused: false });
      });
  }

  function speakWithElevenLabs(text) {
    audioStoppedManually = false;
    audioChunks = splitIntoChunks(text, ELEVEN_MAX_CHUNK_LEN);
    audioChunkIndex = 0;
    playAudioChunks();
  }

  function speak(text) {
    if (ttsMode === 'elevenlabs') {
      speakWithElevenLabs(text);
    } else {
      speakWithDevice(text);
    }
  }

  function handlePlay() {
    const text = textInput.value.trim();
    if (!text) {
      setStatus('読み上げるテキストを入力してください');
      return;
    }

    if (ttsMode === 'elevenlabs') {
      if (currentAudio && currentAudio.paused && audioChunks.length) {
        currentAudio.play();
        setStatus('読み上げ中(AI音声)…');
        setButtonsState({ playing: true, paused: false });
        return;
      }
      if (!elevenApiKeyInput.value.trim()) {
        setStatus('ElevenLabsのAPIキーを入力してください');
        return;
      }
      if (!elevenVoiceSelect.value) {
        setStatus('使う声を選択(またはクローンを作成)してください');
        return;
      }
      speak(text);
      saveHistory(text);
      return;
    }

    if (synth.paused) {
      synth.resume();
      isPaused = false;
      setStatus('読み上げ中…');
      setButtonsState({ playing: true, paused: false });
      return;
    }
    speak(text);
    saveHistory(text);
  }

  function handlePauseResume() {
    if (ttsMode === 'elevenlabs') {
      if (!currentAudio) return;
      if (currentAudio.paused) {
        currentAudio.play();
        setStatus('読み上げ中(AI音声)…');
        setButtonsState({ playing: true, paused: false });
      } else {
        currentAudio.pause();
        setStatus('一時停止中');
        setButtonsState({ playing: true, paused: true });
      }
      return;
    }

    if (!synth.speaking) return;
    if (isPaused) {
      synth.resume();
      isPaused = false;
      setStatus('読み上げ中…');
      setButtonsState({ playing: true, paused: false });
    } else {
      synth.pause();
      isPaused = true;
      setStatus('一時停止中');
      setButtonsState({ playing: true, paused: true });
    }
  }

  function handleStop() {
    if (ttsMode === 'elevenlabs') {
      audioStoppedManually = true;
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        currentAudio = null;
      }
      setStatus('停止しました');
      setButtonsState({ playing: false, paused: false });
      return;
    }

    stoppedManually = true;
    synth.cancel();
    stopKeepAlive();
    isPaused = false;
    setStatus('停止しました');
    setButtonsState({ playing: false, paused: false });
  }

  function loadHistory() {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    } catch {
      return [];
    }
  }

  function saveHistory(text) {
    let history = loadHistory().filter((item) => item !== text);
    history.unshift(text);
    history = history.slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    renderHistory();
  }

  function renderHistory() {
    const history = loadHistory();
    historyCard.hidden = history.length === 0;
    historyList.innerHTML = '';
    history.forEach((text) => {
      const li = document.createElement('li');
      li.className = 'history-item';

      const span = document.createElement('span');
      span.className = 'history-text';
      span.textContent = text;
      span.title = 'クリックして読み込む';
      span.addEventListener('click', () => {
        textInput.value = text;
        updateCharCount();
        textInput.focus();
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.textContent = '✕';
      delBtn.title = '削除';
      delBtn.addEventListener('click', () => {
        const remaining = loadHistory().filter((item) => item !== text);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(remaining));
        renderHistory();
      });

      li.appendChild(span);
      li.appendChild(delBtn);
      historyList.appendChild(li);
    });
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(textInput.value);
      setStatus('クリップボードにコピーしました');
    } catch {
      setStatus('コピーに失敗しました');
    }
  }

  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText();
      textInput.value = text;
      updateCharCount();
      setStatus('クリップボードから貼り付けました');
    } catch {
      setStatus('貼り付けに失敗しました(ブラウザの権限をご確認ください)');
    }
  }

  async function handleShare() {
    try {
      await navigator.share({ text: textInput.value, title: '読み上げくん' });
    } catch {
      // ユーザーによるキャンセルなどは無視
    }
  }

  function handleExport() {
    const blob = new Blob([textInput.value], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `yomiage-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus('テキストファイルを保存しました');
  }

  function handleImportChange() {
    const file = importFile.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      textInput.value = String(reader.result);
      updateCharCount();
      setStatus(`「${file.name}」を読み込みました`);
    };
    reader.onerror = () => setStatus('ファイルの読み込みに失敗しました');
    reader.readAsText(file);
    importFile.value = '';
  }

  function loadElevenVoiceList() {
    let list = [];
    try {
      list = JSON.parse(localStorage.getItem(ELEVEN_VOICES_STORAGE)) || [];
    } catch {
      list = [];
    }
    return list;
  }

  function renderElevenVoices() {
    const list = loadElevenVoiceList();
    elevenVoiceSelect.innerHTML = '';
    if (!list.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'まだ登録されていません';
      elevenVoiceSelect.appendChild(opt);
      return;
    }
    list.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = v.name;
      elevenVoiceSelect.appendChild(opt);
    });
    const saved = localStorage.getItem(ELEVEN_SELECTED_VOICE_STORAGE);
    if (saved && list.some((v) => v.id === saved)) {
      elevenVoiceSelect.value = saved;
    }
  }

  function saveElevenVoice(id, name) {
    const list = loadElevenVoiceList().filter((v) => v.id !== id);
    list.push({ id, name });
    localStorage.setItem(ELEVEN_VOICES_STORAGE, JSON.stringify(list));
    renderElevenVoices();
    elevenVoiceSelect.value = id;
    localStorage.setItem(ELEVEN_SELECTED_VOICE_STORAGE, id);
  }

  if (navigator.share) {
    shareBtn.hidden = false;
    shareBtn.addEventListener('click', handleShare);
  }
  copyBtn.addEventListener('click', handleCopy);
  pasteBtn.addEventListener('click', handlePaste);
  exportBtn.addEventListener('click', handleExport);
  importBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', handleImportChange);

  const savedElevenKey = localStorage.getItem(ELEVEN_KEY_STORAGE);
  if (savedElevenKey) elevenApiKeyInput.value = savedElevenKey;
  renderElevenVoices();
  aiVoiceToggle.checked = ttsMode === 'elevenlabs';
  aiVoiceSettings.hidden = !aiVoiceToggle.checked;

  aiVoiceToggle.addEventListener('change', () => {
    ttsMode = aiVoiceToggle.checked ? 'elevenlabs' : 'device';
    localStorage.setItem(TTS_MODE_STORAGE, ttsMode);
    aiVoiceSettings.hidden = !aiVoiceToggle.checked;
  });

  elevenApiKeyInput.addEventListener('change', () => {
    localStorage.setItem(ELEVEN_KEY_STORAGE, elevenApiKeyInput.value.trim());
  });

  elevenVoiceSelect.addEventListener('change', () => {
    localStorage.setItem(ELEVEN_SELECTED_VOICE_STORAGE, elevenVoiceSelect.value);
  });

  elevenDeleteVoiceBtn.addEventListener('click', () => {
    const id = elevenVoiceSelect.value;
    if (!id) return;
    const list = loadElevenVoiceList().filter((v) => v.id !== id);
    localStorage.setItem(ELEVEN_VOICES_STORAGE, JSON.stringify(list));
    renderElevenVoices();
    elevenStatus.textContent = '削除しました';
  });

  elevenCloneBtn.addEventListener('click', async () => {
    const apiKey = elevenApiKeyInput.value.trim();
    const name = elevenVoiceNameInput.value.trim();
    const file = elevenVoiceFileInput.files[0];
    if (!apiKey) {
      elevenStatus.textContent = 'APIキーを入力してください';
      return;
    }
    if (!name) {
      elevenStatus.textContent = '声の名前を入力してください';
      return;
    }
    if (!file) {
      elevenStatus.textContent = '音声サンプルのファイルを選択してください';
      return;
    }
    elevenCloneBtn.disabled = true;
    elevenStatus.textContent = 'クローンを作成中…(サンプルの長さによっては数十秒かかります)';
    try {
      const voiceId = await elevenLabsCloneVoice(name, file, apiKey);
      saveElevenVoice(voiceId, name);
      elevenStatus.textContent = `クローン「${name}」を作成しました`;
      elevenVoiceNameInput.value = '';
      elevenVoiceFileInput.value = '';
    } catch (err) {
      elevenStatus.textContent = err.message || 'クローンの作成に失敗しました';
    } finally {
      elevenCloneBtn.disabled = false;
    }
  });

  elevenAddExistingBtn.addEventListener('click', () => {
    const id = elevenExistingIdInput.value.trim();
    const name = elevenExistingNameInput.value.trim() || 'マイボイス';
    if (!id) {
      elevenStatus.textContent = 'Voice IDを入力してください';
      return;
    }
    saveElevenVoice(id, name);
    elevenExistingIdInput.value = '';
    elevenExistingNameInput.value = '';
    elevenStatus.textContent = `「${name}」を登録しました`;
  });

  let deferredInstallPrompt = null;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installBtn.hidden = false;
  });
  installBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    installBtn.hidden = true;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
  });
  window.addEventListener('appinstalled', () => {
    installBtn.hidden = true;
  });

  textInput.addEventListener('input', updateCharCount);
  clearBtn.addEventListener('click', () => {
    textInput.value = '';
    updateCharCount();
    textInput.focus();
  });

  rateRange.addEventListener('input', () => {
    rateValue.textContent = parseFloat(rateRange.value).toFixed(1);
  });
  pitchRange.addEventListener('input', () => {
    pitchValue.textContent = parseFloat(pitchRange.value).toFixed(1);
  });
  volumeRange.addEventListener('input', () => {
    volumeValue.textContent = `${Math.round(parseFloat(volumeRange.value) * 100)}%`;
  });

  voiceSelect.addEventListener('change', () => {
    localStorage.setItem('rooodoku-voice', voiceSelect.value);
  });

  refreshVoicesBtn.addEventListener('click', () => {
    loadVoices();
    setStatus(`声を再取得しました(${voiceSelect.options.length}件)`);
  });

  presetBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      rateRange.value = btn.dataset.rate;
      pitchRange.value = btn.dataset.pitch;
      rateRange.dispatchEvent(new Event('input'));
      pitchRange.dispatchEvent(new Event('input'));
      presetBtns.forEach((b) => b.classList.toggle('active', b === btn));
    });
  });

  playBtn.addEventListener('click', handlePlay);
  pauseBtn.addEventListener('click', handlePauseResume);
  stopBtn.addEventListener('click', handleStop);
  historyClearBtn.addEventListener('click', () => {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
  });

  window.addEventListener('beforeunload', () => synth.cancel());

  // Claude message polling: Claude pushes text into queue.json in the repo;
  // the app checks it periodically and (optionally) reads it aloud right away.
  const LAST_MSG_KEY = 'rooodoku-last-msg-id';
  const AUTO_RECEIVE_KEY = 'rooodoku-auto-receive';
  const POLL_INTERVAL_MS = 8000;

  const savedAutoReceive = localStorage.getItem(AUTO_RECEIVE_KEY);
  if (savedAutoReceive !== null) {
    autoReceiveToggle.checked = savedAutoReceive === 'true';
  }
  autoReceiveToggle.addEventListener('change', () => {
    localStorage.setItem(AUTO_RECEIVE_KEY, String(autoReceiveToggle.checked));
  });

  async function checkForClaudeMessage() {
    let data;
    try {
      const response = await fetch(`queue.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) return;
      data = await response.json();
    } catch {
      return;
    }

    const lastId = parseInt(localStorage.getItem(LAST_MSG_KEY) || '0', 10);
    if (!data || !data.id || data.id <= lastId || !data.text) return;

    localStorage.setItem(LAST_MSG_KEY, String(data.id));
    textInput.value = data.text;
    updateCharCount();
    claudeStatus.textContent = `Claudeからメッセージが届きました(${new Date().toLocaleTimeString('ja-JP')})`;
    claudeStatus.classList.add('has-message');

    if (autoReceiveToggle.checked) {
      speak(data.text);
      saveHistory(data.text);
    }
  }

  setInterval(checkForClaudeMessage, POLL_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForClaudeMessage();
  });
  checkForClaudeMessage();

  updateCharCount();
  renderHistory();
  setButtonsState({ playing: false, paused: false });
})();

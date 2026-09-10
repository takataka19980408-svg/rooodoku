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
  const recordBtn = document.getElementById('record-btn');
  const recordedAudioEl = document.getElementById('recorded-audio');
  const downloadRecordingBtn = document.getElementById('download-recording-btn');
  const statusEl = document.getElementById('status');
  const unsupportedEl = document.getElementById('unsupported');
  const historyCard = document.getElementById('history-card');
  const historyList = document.getElementById('history-list');
  const historyClearBtn = document.getElementById('history-clear-btn');
  const copyBtn = document.getElementById('copy-btn');
  const quickCopyBtn = document.getElementById('quick-copy-btn');
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
  let mediaRecorder = null;
  let recordedChunks = [];
  let micStream = null;
  let isRecordingSession = false;
  const MAX_CHUNK_LEN = 180;
  const KEEP_ALIVE_MS = 10000;

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

  function stopRecordingIfActive() {
    if (isRecordingSession && mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
  }

  function speakChunk() {
    if (chunkIndex >= chunks.length) {
      stopKeepAlive();
      isPaused = false;
      setStatus('読み上げが完了しました');
      setButtonsState({ playing: false, paused: false });
      stopRecordingIfActive();
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

  function speak(text) {
    stoppedManually = false;
    synth.cancel();
    chunks = splitIntoChunks(text);
    chunkIndex = 0;
    startKeepAlive();
    speakChunk();
  }

  function handlePlay() {
    const text = textInput.value.trim();
    if (!text) {
      setStatus('読み上げるテキストを入力してください');
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
    stoppedManually = true;
    synth.cancel();
    stopKeepAlive();
    isPaused = false;
    setStatus('停止しました');
    setButtonsState({ playing: false, paused: false });
    stopRecordingIfActive();
  }

  async function handleRecordAndSpeak() {
    if (isRecordingSession) return;

    const text = textInput.value.trim();
    if (!text) {
      setStatus('読み上げるテキストを入力してください');
      return;
    }

    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setStatus('マイクへのアクセスが許可されませんでした');
      return;
    }

    recordedChunks = [];
    recordedAudioEl.hidden = true;
    downloadRecordingBtn.hidden = true;

    mediaRecorder = new MediaRecorder(micStream);
    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) recordedChunks.push(event.data);
    });
    mediaRecorder.addEventListener('stop', () => {
      micStream.getTracks().forEach((track) => track.stop());
      isRecordingSession = false;
      recordBtn.classList.remove('recording');
      recordBtn.textContent = '🎙️ 録音して読み上げ';

      if (!recordedChunks.length) return;
      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      const url = URL.createObjectURL(blob);
      recordedAudioEl.src = url;
      recordedAudioEl.hidden = false;
      downloadRecordingBtn.hidden = false;
      downloadRecordingBtn.onclick = () => {
        const ext = (mediaRecorder.mimeType || '').includes('mp4') ? 'm4a' : 'webm';
        const a = document.createElement('a');
        a.href = url;
        a.download = `yomiage-rokuon-${Date.now()}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      };
    });

    mediaRecorder.start();
    isRecordingSession = true;
    recordBtn.classList.add('recording');
    recordBtn.textContent = '⏺ 録音中…';
    setStatus('録音しながら読み上げます');
    speak(text);
    saveHistory(text);
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

      const copyItemBtn = document.createElement('button');
      copyItemBtn.type = 'button';
      copyItemBtn.textContent = '📋';
      copyItemBtn.title = 'コピー';
      copyItemBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        copyTextToClipboard(text);
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
      li.appendChild(copyItemBtn);
      li.appendChild(delBtn);
      historyList.appendChild(li);
    });
  }

  async function copyTextToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('クリップボードにコピーしました');
    } catch {
      setStatus('コピーに失敗しました');
    }
  }

  function handleCopy() {
    return copyTextToClipboard(textInput.value);
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

  if (navigator.share) {
    shareBtn.hidden = false;
    shareBtn.addEventListener('click', handleShare);
  }
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    document.getElementById('record-row').hidden = true;
  }
  copyBtn.addEventListener('click', handleCopy);
  quickCopyBtn.addEventListener('click', handleCopy);
  pasteBtn.addEventListener('click', handlePaste);
  exportBtn.addEventListener('click', handleExport);
  importBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', handleImportChange);

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
  recordBtn.addEventListener('click', handleRecordAndSpeak);
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

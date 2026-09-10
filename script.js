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

  function loadVoices() {
    voices = synth.getVoices();
    if (!voices.length) return;

    const savedVoiceURI = localStorage.getItem('rooodoku-voice');
    voiceSelect.innerHTML = '';

    const sorted = [...voices].sort((a, b) => {
      const aJa = a.lang.startsWith('ja') ? 0 : 1;
      const bJa = b.lang.startsWith('ja') ? 0 : 1;
      if (aJa !== bJa) return aJa - bJa;
      return a.name.localeCompare(b.name);
    });

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

  function speak(text) {
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
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
      setStatus('読み上げ中…');
      setButtonsState({ playing: true, paused: false });
    };
    utterance.onend = () => {
      isPaused = false;
      setStatus('読み上げが完了しました');
      setButtonsState({ playing: false, paused: false });
    };
    utterance.onerror = (event) => {
      if (event.error === 'canceled' || event.error === 'interrupted') return;
      isPaused = false;
      setStatus(`エラーが発生しました: ${event.error}`);
      setButtonsState({ playing: false, paused: false });
    };

    synth.speak(utterance);
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
    synth.cancel();
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

  playBtn.addEventListener('click', handlePlay);
  pauseBtn.addEventListener('click', handlePauseResume);
  stopBtn.addEventListener('click', handleStop);
  historyClearBtn.addEventListener('click', () => {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
  });

  window.addEventListener('beforeunload', () => synth.cancel());

  updateCharCount();
  renderHistory();
  setButtonsState({ playing: false, paused: false });
})();

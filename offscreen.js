/* Offscreen document: owns everything that needs a DOM —
   - alarm/reminder sounds (WebAudio, generated, no asset files)
   - Text-to-speech through the Web Speech API (fallback voice engine)
   It replies to messages addressed to {target:"offscreen"} from the worker. */
(function () {
  "use strict";

  let audioCtx = null;

  function ctx() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audioCtx = null; }
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  function tone(freq, start, dur, type, vol, filterFreq) {
    const c = ctx(); if (!c) return;
    const t0 = c.currentTime + start;
    const osc = c.createOscillator();
    const osc2 = c.createOscillator();
    const gain = c.createGain();
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = filterFreq || 5200;
    osc.type = type; osc2.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc2.frequency.setValueAtTime(freq * 2.001, t0); // subtle shimmer harmonic
    const g2 = c.createGain(); g2.gain.value = 0.25;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.015);
    gain.gain.setTargetAtTime(0.0001, t0 + dur * 0.55, dur / 4);
    osc.connect(gain); osc2.connect(g2); g2.connect(gain);
    gain.connect(lp).connect(c.destination);
    osc.start(t0); osc2.start(t0);
    osc.stop(t0 + dur + 0.4); osc2.stop(t0 + dur + 0.4);
  }

  function playSound(name, volume) {
    const v = Math.min(1, Math.max(0, (volume == null ? 80 : volume) / 100));
    const d = 0.16; // short, punchy note length
    switch (name) {
      case "soft":
        tone(659.25, 0, d * 2.2, "sine", v * 0.5);
        tone(880, d * 1.4, d * 2.4, "sine", v * 0.4);
        break;
      case "bell":
        tone(1318, 0, d * 2, "triangle", v * 0.75);
        tone(1760, d * 0.7, d * 2.2, "triangle", v * 0.5);
        break;
      case "glass":
        tone(1567.98, 0, d * 3, "sine", v * 0.55);
        tone(2093, d * 0.6, d * 3, "sine", v * 0.4);
        break;
      case "gentle":
        tone(392, 0, d * 3, "sine", v * 0.5);
        tone(523.25, d * 1.2, d * 3.2, "sine", v * 0.5);
        break;
      case "digital":
        tone(880, 0, d, "triangle", v * 0.55, 2800);
        tone(1174.66, d * 0.7, d, "triangle", v * 0.55, 2800);
        tone(1567.98, d * 1.4, d * 1.4, "triangle", v * 0.5, 2800);
        break;
      case "cascade":
        tone(1318, 0, d * 1.2, "sine", v * 0.55);
        tone(1046.5, d * 0.6, d * 1.2, "sine", v * 0.5);
        tone(783.99, d * 1.2, d * 1.6, "sine", v * 0.5);
        break;
      case "sunrise":
        // warm slow sunrise — soft major triad blooming upward
        tone(261.63, 0, d * 3.4, "sine", v * 0.5);          // C4
        tone(329.63, d * 1.0, d * 3.4, "sine", v * 0.5);    // E4
        tone(392.0, d * 2.0, d * 3.6, "sine", v * 0.55);    // G4
        break;
      case "melody":
        // tiny music-box phrase — cheerful and polished
        tone(659.25, 0, d * 1.4, "triangle", v * 0.55);      // E5
        tone(783.99, d * 0.8, d * 1.4, "triangle", v * 0.55);// G5
        tone(1046.5, d * 1.6, d * 2.4, "triangle", v * 0.5); // C6
        tone(783.99, d * 2.8, d * 2.0, "triangle", v * 0.45);// G5
        break;
      case "pop":
        // bright friendly double-pop
        tone(660, 0, d * 0.9, "sine", v * 0.65, 3600);
        tone(990, d * 0.7, d * 1.2, "sine", v * 0.6, 3600);
        break;
      case "zen":
        // calm singing-bowl hum — low and soothing
        tone(220.0, 0, d * 4.2, "sine", v * 0.5);           // A3
        tone(330.0, d * 0.5, d * 4.2, "sine", v * 0.35);    // E4
        break;
      case "sparkle":
        // quick pentatonic shimmer — light and engaging
        tone(1046.5, 0, d * 0.9, "sine", v * 0.45);
        tone(1174.66, d * 0.45, d * 0.9, "sine", v * 0.45);
        tone(1318.5, d * 0.9, d * 0.9, "sine", v * 0.45);
        tone(1567.98, d * 1.35, d * 1.6, "sine", v * 0.4);
        break;
      case "alarm":
        for (let i = 0; i < 3; i++) tone(i % 2 ? 740 : 988, i * d * 0.9, d * 0.85, "square", v * 0.42, 3000);
        break;
      default:
        // Energetic rising chime — quick, exciting, not long
        tone(523.25, 0, d * 1.4, "sine", v * 0.6);          // C5
        tone(659.25, d * 0.5, d * 1.4, "sine", v * 0.6);    // E5
        tone(783.99, d * 1.0, d * 1.8, "sine", v * 0.7);    // G5
        tone(1046.5, d * 1.6, d * 2.2, "sine", v * 0.45);   // C6
    }
  }

  const LANGS = { en: ["en"], ne: ["ne"], hi: ["hi", "en-IN", "en"] };
  const FEMALE_HINTS = ["female", "zira", "samantha", "victoria", "karen", "moira", "tessa", "fiona", "veena", "aditi", "ava", "susan", "kate", "emily", "serena", "heera", "lekha", "aria", "jenny", "hazel", "allison", "ariaonline", "eva", "paulina", "amelie", "denise", "joanna", "kimberly", "salli", "amy", "raveena", "priya", "kalpana", "neerja", "susan", "zhiyu", "huihui", "yaoyao"];
  const MALE_HINTS = ["male", "david", "daniel", "mark", "alex", "fred", "thomas", "rishi", "ravi", "hemant", "george", "james", "roger", "guy", "ryan", "davis", "christopher", "brian", "neil", "arthur", "arun", "madhur", "valluvar", "jian", "kangkang", "yunyang"];

  function voices() {
    try { return window.speechSynthesis.getVoices() || []; } catch (e) { return []; }
  }

  function pickVoice(language, gender) {
    const vs = voices();
    const prefs = LANGS[language] || [language, "en"];
    for (const p of prefs) {
      const match = vs.filter((v) => v.lang && v.lang.toLowerCase().startsWith(p.toLowerCase()));
      if (!match.length) continue;
      const hinted = gender === "female"
        ? match.filter((v) => FEMALE_HINTS.some((h) => v.name.toLowerCase().includes(h)))
        : gender === "male"
          ? match.filter((v) => MALE_HINTS.some((h) => v.name.toLowerCase().includes(h)) && !FEMALE_HINTS.some((h) => v.name.toLowerCase().includes(h)))
          : match;
      if (hinted.length) {
        hinted.sort((a, b) => voiceScore(b, gender) - voiceScore(a, gender));
        return hinted[0];
      }
      // If a specific gender was requested but isn't available in this language,
      // do NOT silently fall back to the opposite-gender voice. Try any language.
      if (gender && gender !== "default") {
        const crossLang = vs.filter((v) => gender === "female"
          ? FEMALE_HINTS.some((h) => v.name.toLowerCase().includes(h))
          : MALE_HINTS.some((h) => v.name.toLowerCase().includes(h)) && !FEMALE_HINTS.some((h) => v.name.toLowerCase().includes(h)));
        if (crossLang.length) {
          crossLang.sort((a, b) => voiceScore(b, gender) - voiceScore(a, gender));
          return crossLang[0];
        }
        return null;
      }
      match.sort((a, b) => voiceScore(b, gender) - voiceScore(a, gender));
      return match[0];
    }
    if (gender && gender !== "default") {
      const crossLang = vs.filter((v) => gender === "female"
        ? FEMALE_HINTS.some((h) => v.name.toLowerCase().includes(h))
        : MALE_HINTS.some((h) => v.name.toLowerCase().includes(h)) && !FEMALE_HINTS.some((h) => v.name.toLowerCase().includes(h)));
      if (crossLang.length) return crossLang[0];
    }
    return null;
  }

  function voiceScore(v, gender) {
    const n = (v.name || "").toLowerCase();
    let s = 0;
    if (n.includes("natural")) s += 6;
    if (n.includes("neural")) s += 5;
    if (n.includes("enhanced") || n.includes("premium")) s += 4;
    if (n.includes("google")) s += 3;
    if (n.includes("online") || !v.localService) s += 1;
    if (gender === "male") {
      if (n.includes("male")) s += 4;
      if (n.includes("david") || n.includes("george") || n.includes("ravi") || n.includes("rishi") || n.includes("hemant")) s += 2;
    }
    if (gender === "female") {
      if (n.includes("female")) s += 4;
      if (n.includes("aria") || n.includes("jenny") || n.includes("zira") || n.includes("samantha")) s += 2;
    }
    return s;
  }

  const SPEEDS = { slow: 0.8, normal: 1, fast: 1.25 };

  /* Normalization + pacing live in shared.js (WR.*); thin wrappers here. */
  function normalizeSpeechText(text) {
    try {
      if (typeof WR !== "undefined" && WR.normalizeSpeechText) return WR.normalizeSpeechText(text);
    } catch (e) {}
    return String(text == null ? "" : text).trim();
  }

  function utteranceLang(language, voice) {
    if (voice && voice.lang) return voice.lang;
    try {
      if (typeof WR !== "undefined" && WR.ttsLang) return WR.ttsLang(language) || "en-US";
    } catch (e) {}
    if (!language || language === "en") return "en-US"; // clear, natural English pronunciation
    return language;
  }

  function speak(text, voice) {
    try {
      const spoken = normalizeSpeechText(text);
      if (!spoken) return { ok: false, error: "empty text" };
      window.speechSynthesis.cancel();
      if (!voices().length && window.speechSynthesis.onvoiceschanged !== null) {
        // voices list not hydrated yet — give the browser a tick, then speak
        try { window.speechSynthesis.getVoices(); } catch (e) {}
      }
      const u = new SpeechSynthesisUtterance(spoken);
      let v = pickVoice(voice.language || "en", voice.gender || "default")
        || pickVoice("en", voice.gender || "default"); // fallback: English voice
      // Do NOT fall back to a random default when a specific gender was requested;
      // setting it anyway would ignore the user's male/female choice.
      if (!v && (!voice.gender || voice.gender === "default")) v = voices()[0] || null;
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = utteranceLang(voice.language, null);
      const gender = voice.gender || "default";
      let optRate = 0.86, optPitch = 1.0;
      try {
        if (typeof WR !== "undefined" && WR.voiceRate) {
          optRate = WR.voiceRate(voice.speed, gender);
          optPitch = WR.voicePitch(gender);
        } else {
          optRate = voice.speed === "slow" ? 0.68 : voice.speed === "fast" ? 1.06 : 0.86;
          optPitch = gender === "male" ? 0.82 : 1.0;
        }
      } catch (e) {}
      u.rate = optRate;
      try { u.pitch = optPitch; } catch (e) {}
      u.volume = Math.min(1, Math.max(0, (voice.volume == null ? 80 : voice.volume) / 100));
      window.speechSynthesis.speak(u);
      return { ok: true, voice: v ? v.name : "system-default" };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  function listVoices() {
    const vs = voices().map((v) => ({ name: v.name, lang: v.lang, local: v.localService }));
    return { ok: true, count: vs.length, voices: vs.slice(0, 60) };
  }

  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = () => voices();
    voices();
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.target !== "offscreen") return false;
    try {
      if (msg.action === "playSound") { playSound(msg.name, msg.volume); sendResponse({ ok: true }); }
      else if (msg.action === "speak") { sendResponse(speak(msg.text, msg.voice || {})); }
      else if (msg.action === "stopSpeech") { try { window.speechSynthesis.cancel(); } catch (e) {} sendResponse({ ok: true }); }
      else if (msg.action === "listVoices") { sendResponse(listVoices()); }
      else sendResponse({ ok: false, error: "unknown action" });
    } catch (e) { sendResponse({ ok: false, error: String(e) }); }
    return true;
  });
})();

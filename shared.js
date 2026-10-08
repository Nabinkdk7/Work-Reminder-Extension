/* Shared helpers used by the background worker, offscreen document and popup.
   Loaded via importScripts() in the service worker and via <script> tags elsewhere. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.WR = Object.assign(root.WR || {}, api);
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const CATEGORIES = [
    { id: "work", label: "Work", desc: "Get things done", color: "#f5b942", icon: "briefcase" },
    { id: "break", label: "Breaks", desc: "Rest & recharge", color: "#3fae7f", icon: "coffee" },
    { id: "meeting", label: "Meetings", desc: "Stay connected", color: "#8b7cf6", icon: "calendar" },
    { id: "personal", label: "Personal", desc: "Health & habits", color: "#4fb3ec", icon: "droplet" },
    { id: "custom", label: "Custom", desc: "Anything else", color: "#94a3b8", icon: "star" },
  ];
  const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

  const DEFAULT_SETTINGS = {
    enabled: true,
    voiceEnabled: true,
    notificationsEnabled: true,
    hourFormat: 12,
    defaultSnooze: 5,
    theme: "dark",
    voice: { gender: "default", language: "en", speed: "normal", volume: 80 },
    sound: { name: "default", volume: 80 },
  };

  const DEFAULT_OFFICE = {
    start: "10:00",
    end: "18:00",
    lunchStart: "13:00",
    lunchEnd: "14:00",
    days: [1, 2, 3, 4, 5], // 0=Sun .. 6=Sat
  };

  function uid() {
    return "r_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  /* "HH:MM" (24h) -> minutes since midnight */
  function toMinutes(hhmm) {
    const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || "");
    if (!m) return 0;
    return Math.min(23, +m[1]) * 60 + Math.min(59, +m[2]);
  }

  function fromMinutes(mins) { return pad(Math.floor(mins / 60)) + ":" + pad(mins % 60); }

  function todayKey(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function formatTime(hhmm, hourFormat) {
    const mins = toMinutes(hhmm);
    let h = Math.floor(mins / 60), m = mins % 60;
    if (hourFormat === 24) return pad(h) + ":" + pad(m);
    const ap = h >= 12 ? "PM" : "AM";
    h = h % 12; if (h === 0) h = 12;
    return h + ":" + pad(m) + " " + ap;
  }

  function daysFor(rem) {
    if (rem.repeat === "daily") return [0, 1, 2, 3, 4, 5, 6];
    if (rem.repeat === "weekdays") return [1, 2, 3, 4, 5];
    if (rem.repeat === "weekly" || rem.repeat === "custom") return rem.days && rem.days.length ? rem.days : [new Date().getDay()];
    return null; // once
  }

  function isActiveDay(rem, date) {
    const days = daysFor(rem);
    if (days) return days.includes(date.getDay());
    return true; // once: always eligible on its day
  }

  /* Next fire Date for a reminder after `from`. Null if none (e.g. completed once). */
  function nextOccurrence(rem, from) {
    from = from || new Date();
    if (!rem || rem.enabled === false) return null;
    const mins = toMinutes(rem.time);
    if (rem.repeat === "once") {
      if (rem.completed) return null;
      const d = new Date(from);
      d.setHours(0, 0, 0, 0);
      d.setMinutes(mins);
      if (d.getTime() <= from.getTime()) {
        // if the time today already passed and it never fired, treat as due now-ish
        return d.getTime() <= from.getTime() && !rem.lastFiredAt ? new Date(from.getTime() + 1000) : null;
      }
      return d;
    }
    for (let i = 0; i < 8; i++) {
      const d = new Date(from);
      d.setDate(d.getDate() + i);
      d.setHours(0, 0, 0, 0);
      d.setMinutes(mins);
      if (d.getTime() <= from.getTime()) continue;
      if (daysFor(rem).includes(d.getDay())) {
        if (rem.lastCompletedDate === todayKey(d)) continue;
        return d;
      }
    }
    return null;
  }

  /* Status of a reminder occurrence today. */
  function todayStatus(rem, now) {
    now = now || new Date();
    if (rem.enabled === false) return "off";
    const key = todayKey(now);
    if (rem.lastCompletedDate === key || (rem.repeat === "once" && rem.completed)) return "done";
    if (!isActiveDay(rem, now)) return "off";
    const mins = toMinutes(rem.time);
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const diff = mins - nowMins;
    if (diff >= 0 && diff <= 5) return "now";
    if (diff > 5) return "upcoming";
    if (diff > -15) return "now";
    return "missed";
  }

  function sortByTime(a, b) { return toMinutes(a.time) - toMinutes(b.time); }

  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  /* ---- voice helpers (single source of truth for both speech engines) ---- */

  /* Natural, comfortable speaking rates per voice type.
     Female voices read faster to the ear (and higher pitch adds to the rushed
     feel), so they get a gentler pace. Male pacing is unchanged. */
  const VOICE_RATES = {
    male:    { slow: 0.72, normal: 0.92, fast: 1.12 },
    female:  { slow: 0.62, normal: 0.80, fast: 0.98 },
    default: { slow: 0.68, normal: 0.86, fast: 1.06 },
  };
  function voiceRate(speed, gender) {
    const table = VOICE_RATES[gender] || VOICE_RATES.default;
    return table[speed] || table.normal;
  }
  /* Pitch: deep/clear male, natural (not chipmunk) female. */
  function voicePitch(gender) {
    if (gender === "male") return 0.82;
    if (gender === "female") return 1.0;
    return 1.0;
  }
  function ttsLang(lang) {
    if (!lang || lang === "system") return undefined;
    if (lang === "en") return "en-US"; // consistent, clear US-English pronunciation
    return lang;
  }

  /* Normalize text before speaking so English is pronounced clearly and naturally.
     Only the spoken copy is changed — the stored reminder text is untouched. */
  function normalizeSpeechText(text) {
    let t = String(text == null ? "" : text);
    t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, ""); // emojis -> silence (engines spell them out)
    t = t.replace(/\s+/g, " ").trim();                        // collapse whitespace/newlines
    t = t.replace(/&/g, " and ");                              // "&" is often skipped or mumbled
    t = t.replace(/\s+/g, " ").trim();
    t = t.replace(/([.!?])([A-Za-z])/g, "$1 $2");              // "Hello.World" -> "Hello. World" (natural pauses)
    t = t.replace(/\s+([,.!?;:])/g, "$1");                     // "word ." -> "word."
    if (t && !/[.!?…]$/.test(t)) t += ".";                     // terminal punctuation -> natural falling intonation
    return t;
  }

  return {
    CATEGORIES, CATEGORY_MAP, DEFAULT_SETTINGS, DEFAULT_OFFICE,
    uid, pad, toMinutes, fromMinutes, todayKey, formatTime,
    daysFor, isActiveDay, nextOccurrence, todayStatus, sortByTime, WEEKDAYS,
    voiceRate, voicePitch, ttsLang, normalizeSpeechText,
  };
});

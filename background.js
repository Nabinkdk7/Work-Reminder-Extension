/* Work Reminder background service worker.
   - owns reminders/settings in chrome.storage.local
   - schedules chrome.alarms for every enabled reminder (persist across popup close)
   - fires notification + sound + voice on trigger
   - handles snooze / done / dismiss from notification buttons
   - rebuilds alarms on install/startup (browser restart, extension restart) */

importScripts("shared.js");

const WR = self.WR;

/* ---------------- storage ---------------- */

function parse(items) {
  return {
    reminders: Array.isArray(items.reminders) ? items.reminders : [],
    settings: Object.assign({}, WR.DEFAULT_SETTINGS, items.settings || {}),
    office: Object.assign({}, WR.DEFAULT_OFFICE, items.office || {}),
    seeded: !!items.seeded,
    seedVersion: items.seedVersion || 0,
    pendingUpdate: items.pendingUpdate || null,
    updateNotifiedVersion: items.updateNotifiedVersion || null,
    installedNotifiedFor: items.installedNotifiedFor || null,
    updateCheckedAt: items.updateCheckedAt || 0,
  };
}

function readState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["reminders", "settings", "office", "seeded", "seedVersion", "pendingUpdate", "updateNotifiedVersion", "installedNotifiedFor", "updateCheckedAt"], (items) => resolve(parse(items || {})));
  });
}

function writeState(patch) {
  return new Promise((resolve) => chrome.storage.local.set(patch, resolve));
}

/* ---------------- offscreen / voice / sound ---------------- */

let creatingOffscreen = null;
async function ensureOffscreen() {
  if (!chrome.offscreen) return false;
  try {
    const has = await chrome.offscreen.hasDocument();
    if (has) return true;
  } catch (e) { /* fall through to create */ }
  if (creatingOffscreen) { try { await creatingOffscreen; return true; } catch (e) { return false; } }
  creatingOffscreen = chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["AUDIO_PLAYBACK"],
    justification: "Play reminder sounds and speak reminders with text-to-speech.",
  });
  try { await creatingOffscreen; return true; } catch (e) { return false; } finally { creatingOffscreen = null; }
}

function offscreenMessage(msg) {
  return new Promise(async (resolve) => {
    if (!(await ensureOffscreen())) return resolve({ ok: false });
    chrome.runtime.sendMessage(Object.assign({ target: "offscreen" }, msg), (resp) => {
      if (chrome.runtime.lastError) return resolve({ ok: false });
      resolve(resp || { ok: false });
    });
  });
}

const FEMALE_NAME = ["female", "zira", "samantha", "victoria", "karen", "moira", "tessa", "fiona", "veena", "aditi", "ava", "susan", "kate", "emily", "serena", "heera", "lekha", "aria", "jenny", "hazel", "allison", "eva", "paulina", "amelie", "denise", "joanna", "kimberly", "salli", "amy", "raveena", "priya", "kalpana", "neerja", "zhiyu", "huihui", "yaoyao"];
const MALE_NAME = ["male", "david", "daniel", "mark", "alex", "fred", "thomas", "rishi", "ravi", "hemant", "george", "james", "roger", "guy", "ryan", "davis", "christopher", "brian", "neil", "arthur", "arun", "madhur", "valluvar", "jian", "kangkang", "yunyang"];

function isVoiceGender(v, gender) {
  if (v.gender === gender) return true;
  if (v.gender && v.gender !== "default") return false;
  const n = (v.voiceName || "").toLowerCase();
  if (gender === "female") return FEMALE_NAME.some((h) => n.indexOf(h) >= 0);
  if (gender === "male") return MALE_NAME.some((h) => n.indexOf(h) >= 0) && n.indexOf("female") < 0;
  return true;
}

function pickTtsVoice(cfg) {
  return new Promise((resolve) => {
    try {
      chrome.tts.getVoices((voices) => {
        if (chrome.runtime.lastError || !Array.isArray(voices) || !voices.length) return resolve(null);
        const lang = (cfg && cfg.language && cfg.language !== "system") ? cfg.language : "en";
        const want = (v) => v.lang && v.lang.toLowerCase().startsWith(lang.toLowerCase());
        let pool = voices.filter(want);
        if (!pool.length) pool = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith("en"));
        if (!pool.length) pool = voices;
        const gender = cfg && cfg.gender;
        let hinted = pool;
        if (gender && gender !== "default") {
          hinted = pool.filter((v) => isVoiceGender(v, gender));
          if (!hinted.length) hinted = voices.filter((v) => isVoiceGender(v, gender)); // any lang as last try
          if (!hinted.length) return resolve(null); // don't pick the opposite gender
        }
        const ttsGender = cfg && cfg.gender;
        hinted.sort((a, b) => {
          const na = (a.voiceName || "").toLowerCase(), nb = (b.voiceName || "").toLowerCase();
          const score = (n) =>
            (n.includes("google") ? 4 : 0) +
            (n.includes("natural") ? 5 : 0) +
            (n.includes("enhanced") ? 3 : 0) +
            (ttsGender === "male" ? (n.includes("male") ? 4 : 0) + (/david|george|ravi|rishi|hemant|guy|james|fred/.test(n) ? 2 : 0) : 0) +
            (ttsGender === "female" ? (n.includes("female") ? 4 : 0) + (/aria|jenny|zira|samantha|ava|susan|amy/.test(n) ? 2 : 0) : 0);
          return score(nb) - score(na);
        });
        resolve(hinted[0] ? hinted[0].voiceName : null);
      });
    } catch (e) { resolve(null); }
  });
}

/* Normalize text before speaking so English is pronounced clearly and naturally.
   Only the spoken copy is changed — the stored reminder text is untouched.
   (Single source of truth lives in shared.js as WR.normalizeSpeechText.) */
function normalizeSpeechText(text) {
  return WR.normalizeSpeechText(text);
}

function ttsLang(lang) {
  return WR.ttsLang(lang);
}

function speak(text, voiceCfg) {
  // Primary: chrome.tts with an explicitly chosen voice (honors gender + smooth Google voices).
  // Fallback: Web Speech API in the offscreen document (also gender-aware).
  return new Promise(async (resolve) => {
    const spoken = normalizeSpeechText(text);
    if (!spoken) return resolve({ ok: false, error: "empty text" });
    if (chrome.tts && typeof chrome.tts.speak === "function") {
      const gender = (voiceCfg && voiceCfg.gender) || "default";
      const opts = {
        rate: WR.voiceRate(voiceCfg && voiceCfg.speed, gender),
        pitch: WR.voicePitch(gender),
        volume: Math.min(1, Math.max(0, (voiceCfg && voiceCfg.volume != null ? voiceCfg.volume : 80) / 100)),
        enqueue: false,
      };
      if (voiceCfg && voiceCfg.language && voiceCfg.language !== "system") opts.lang = ttsLang(voiceCfg.language);
      const voiceName = await pickTtsVoice(voiceCfg);
      if (voiceName) opts.voiceName = voiceName;
      else if (voiceCfg && voiceCfg.gender === "male") opts.gender = "male";
      else if (voiceCfg && voiceCfg.gender === "female") opts.gender = "female";
      const ttsResult = await new Promise((res) => {
        chrome.tts.speak(spoken, opts, () => {
          if (chrome.runtime.lastError) return res({ ok: false });
          res({ ok: true, engine: "chrome.tts", voiceName: voiceName || "default" });
        });
      });
      if (ttsResult.ok) return resolve(ttsResult);
    }
    const res = await offscreenMessage({ action: "speak", text: spoken, voice: voiceCfg || {} });
    resolve(res || { ok: false });
  });
}

function playSound(name, volume) {
  return offscreenMessage({ action: "playSound", name, volume });
}

/* ---------------- update checker ---------------- */

const UPDATE_OWNER = "Nabinkdk7";
const UPDATE_REPO = "Work-Reminder-Extension";
const UPDATE_URL = "https://raw.githubusercontent.com/" + UPDATE_OWNER + "/" + UPDATE_REPO + "/main/updates.json";
const REPO_URL = "https://github.com/" + UPDATE_OWNER + "/" + UPDATE_REPO;
const UPDATE_CHECK_ALARM = "wr-update-check";
const UPDATE_CHECK_MINUTES = 720; // automatic check every 12 hours

function compareVersions(a, b) {
  const pa = String(a || "0").split(".").map((x) => parseInt(x, 10) || 0);
  const pb = String(b || "0").split(".").map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

async function ensureUpdateCheck() {
  try {
    const all = await chrome.alarms.getAll();
    if (!all.some((a) => a.name === UPDATE_CHECK_ALARM)) {
      await chrome.alarms.create(UPDATE_CHECK_ALARM, { periodInMinutes: UPDATE_CHECK_MINUTES });
    }
  } catch (e) {}
}

function notifyUpdateAvailable(info) {
  const id = "wr-update-available";
  try {
    const p = chrome.notifications.create(id, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Work Reminder update available",
      message: "Version " + info.version + " is ready." + (info.notes ? " " + info.notes : ""),
      priority: 1,
      buttons: [{ title: "Download update" }, { title: "Later" }],
    });
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (e) {}
  return id;
}

function notifyUpdateInstalled(version) {
  try {
    const p = chrome.notifications.create("wr-update-installed", {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Work Reminder updated",
      message: "Successfully updated to version " + version + ".",
      priority: 1,
    });
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (e) {}
}

/* Check GitHub for a newer release. Notifies ONLY when an update is
   available (once per version) — never when already up to date. */
async function checkForUpdates(manual) {
  const current = chrome.runtime.getManifest().version;
  let remote = null;
  try {
    const res = await fetch(UPDATE_URL, { cache: "no-store" });
    if (!res || !res.ok) throw new Error("bad response");
    remote = await res.json();
  } catch (e) {
    return { ok: false, error: "unreachable", current };
  }
  if (!remote || typeof remote.version !== "string") {
    return { ok: false, error: "invalid", current };
  }
  const result = {
    ok: true,
    current,
    latest: remote.version,
    notes: remote.notes || "",
    url: remote.url || REPO_URL,
    update: compareVersions(current, remote.version) < 0,
    checkedAt: Date.now(),
  };
  const state = await readState();
  if (result.update) {
    const alreadyNotified = state.updateNotifiedVersion === remote.version;
    await writeState({
      pendingUpdate: { version: remote.version, notes: result.notes, url: result.url },
      updateNotifiedVersion: remote.version,
      updateCheckedAt: result.checkedAt,
    });
    if (!alreadyNotified) notifyUpdateAvailable({ version: remote.version, notes: result.notes });
    ACTIVE.set("wr-update-available", "__update__:" + result.url);
  } else {
    await writeState({ updateCheckedAt: result.checkedAt });
    // Up to date (or ahead): clear any stale pending update silently.
    if (state.pendingUpdate && compareVersions(current, state.pendingUpdate.version) >= 0) {
      await writeState({ pendingUpdate: null });
    }
  }
  return result;
}

/* After a restart, detect a just-installed update and confirm it once. */
async function checkInstalledUpdate() {
  try {
    const current = chrome.runtime.getManifest().version;
    const state = await readState();
    if (state.pendingUpdate && compareVersions(current, state.pendingUpdate.version) >= 0) {
      if (state.installedNotifiedFor !== current) {
        notifyUpdateInstalled(current);
        await writeState({ pendingUpdate: null, installedNotifiedFor: current });
      } else {
        await writeState({ pendingUpdate: null });
      }
    }
  } catch (e) {}
}

/* ---------------- scheduling ---------------- */

const ALARM_PREFIX = "wr-rem-";

async function scheduleReminder(rem) {
  await chrome.alarms.clear(ALARM_PREFIX + rem.id);
  if (rem.enabled === false) return;
  const next = WR.nextOccurrence(rem, new Date());
  if (!next) return;
  try {
    await chrome.alarms.create(ALARM_PREFIX + rem.id, { when: next.getTime() });
  } catch (e) { /* alarm time invalid — skip */ }
}

async function rebuildAlarms() {
  const { reminders, settings } = await readState();
  await chrome.alarms.clearAll();
  await ensureTick();
  await ensureUpdateCheck();
  if (!settings.enabled) return;
  for (const r of reminders) await scheduleReminder(r);
}

/* ---------------- firing ---------------- */

const ACTIVE = new Map(); // notificationId -> reminderId

async function fireReminder(rem) {
  const { settings, reminders } = await readState();
  if (!settings.enabled) return;
  rem.lastFiredAt = Date.now();
  const idx = reminders.findIndex((r) => r.id === rem.id);
  if (idx >= 0) reminders[idx] = rem;
  await writeState({ reminders });

  if (settings.notificationsEnabled && rem.notificationEnabled !== false) {
    const id = "notif-" + rem.id + "-" + Date.now();
    ACTIVE.set(id, rem.id);
    try {
      await chrome.notifications.create(id, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "Work Reminder — " + rem.title,
        message: rem.message || "",
        priority: 2,
        requireInteraction: true,
        buttons: [
          { title: "Done" },
          { title: "Snooze " + (settings.defaultSnooze || 5) + " min" },
        ],
      });
    } catch (e) { /* notifications unavailable */ }
  }

  if (rem.sound && rem.sound !== "none") await playSound(rem.sound, settings.sound.volume);

  const voiceOn = settings.voiceEnabled && rem.voiceEnabled !== false;
  if (voiceOn) {
    // Speak the exact text saved in the reminder's message field (fallback: title).
    const text = (rem.message && rem.message.trim()) ? rem.message.trim() : rem.title;
    await speak(text, settings.voice);
  }

  // One-time reminders disable themselves after firing.
  if (rem.repeat === "once") {
    rem.enabled = false;
    if (idx >= 0) reminders[idx] = rem;
    await writeState({ reminders });
  } else {
    await scheduleReminder(rem);
  }
}

async function markCompleted(remId) {
  const { reminders } = await readState();
  const rem = reminders.find((r) => r.id === remId);
  if (!rem) return;
  rem.lastCompletedDate = WR.todayKey();
  if (rem.repeat === "once") { rem.completed = true; rem.enabled = false; }
  const idx = reminders.indexOf(rem);
  reminders[idx] = rem;
  await writeState({ reminders });
  await chrome.alarms.clear(ALARM_PREFIX + rem.id);
  if (rem.repeat !== "once") await scheduleReminder(rem);
}

async function snoozeReminder(remId, minutes) {
  const { reminders } = await readState();
  const rem = reminders.find((r) => r.id === remId);
  if (!rem) return;
  await chrome.alarms.clear(ALARM_PREFIX + rem.id);
  await chrome.alarms.create(ALARM_PREFIX + rem.id, { when: Date.now() + minutes * 60000 });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name) return;
  if (alarm.name === "wr-tick") return tickCheck();
  if (alarm.name === UPDATE_CHECK_ALARM) return checkForUpdates(false);
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  const id = alarm.name.slice(ALARM_PREFIX.length);
  const { reminders } = await readState();
  const rem = reminders.find((r) => r.id === id);
  if (!rem || rem.enabled === false) return;
  await fireReminder(rem);
});

/* Safety-net tick (every minute): fire any reminder whose time arrived but
   which never fired (alarm lost, worker restarted late, missed edge case). */
const TICK = "wr-tick";
async function ensureTick() {
  try {
    const all = await chrome.alarms.getAll();
    if (!all.some((a) => a.name === TICK)) {
      await chrome.alarms.create(TICK, { periodInMinutes: 1 });
    }
  } catch (e) {}
}

async function tickCheck() {
  const { reminders, settings } = await readState();
  if (!settings.enabled) return;
  const now = new Date();
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  let existing = [];
  try { existing = await chrome.alarms.getAll(); } catch (e) {}
  const haveAlarm = new Set(existing.map((a) => a.name));
  for (const rem of reminders) {
    try {
      if (rem.enabled === false) continue;
      if (!WR.isActiveDay(rem, now)) continue;
      if (rem.lastCompletedDate === WR.todayKey(now)) continue;
      if (rem.repeat === "once" && (rem.completed || rem.enabled === false)) continue;
      const firedToday = rem.lastFiredAt && rem.lastFiredAt >= startOfDay.getTime();
      if (firedToday && rem.repeat !== "once") continue;
      if (rem.repeat === "once" && (rem.lastFiredAt || rem.completed)) continue;
      const due = new Date(now);
      due.setHours(0, 0, 0, 0);
      due.setMinutes(WR.toMinutes(rem.time));
      const diff = now.getTime() - due.getTime();
      // due within the last 10 minutes and not yet fired today -> fire it
      if (diff >= 0 && diff < 10 * 60 * 1000 && !firedToday) {
        await fireReminder(rem);
        continue;
      }
      // self-heal: re-create the alarm if it went missing (sleep, timezone shift, cleared alarms)
      if (diff < 0 && !haveAlarm.has(ALARM_PREFIX + rem.id)) {
        await scheduleReminder(rem);
      }
    } catch (e) { /* never let one reminder break the tick */ }
  }
}

function openUpdateUrl(url) {
  try {
    const p = chrome.tabs.create({ url: url || REPO_URL });
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (e) {}
}

chrome.notifications.onButtonClicked.addListener(async (notifId, btn) => {
  const remId = ACTIVE.get(notifId);
  try { await chrome.notifications.clear(notifId); } catch (e) {}
  ACTIVE.delete(notifId);
  if (!remId) return;
  if (typeof remId === "string" && remId.indexOf("__update__:") === 0) {
    if (btn === 0) openUpdateUrl(remId.slice("__update__:".length));
    return;
  }
  const { settings } = await readState();
  if (btn === 0) await markCompleted(remId);
  else if (btn === 1) await snoozeReminder(remId, settings.defaultSnooze || 5);
});

chrome.notifications.onClosed.addListener((notifId) => ACTIVE.delete(notifId));

chrome.notifications.onClicked.addListener(async (notifId) => {
  const target = ACTIVE.get(notifId);
  try { await chrome.notifications.clear(notifId); } catch (e) {}
  ACTIVE.delete(notifId);
  if (typeof target === "string" && target.indexOf("__update__:") === 0) {
    openUpdateUrl(target.slice("__update__:".length));
  }
});

/* ---------------- default schedule ---------------- */

function defaultReminders() {
  const mk = (time, title, category, message) => ({
    id: WR.uid(), title, message, time,
    repeat: "daily", days: [0, 1, 2, 3, 4, 5, 6], category,
    voiceEnabled: true, notificationEnabled: true, sound: "default",
    enabled: true, completed: false, lastCompletedDate: null, lastFiredAt: null,
    createdAt: Date.now(), updatedAt: Date.now(),
  });
  return [
    mk("08:10", "Check In — Rigo App", "work", "Please remember to check in on the Rigo App."),
    mk("09:30", "Snack Break", "break", "It's time for a snack break."),
    mk("11:55", "Return Cup", "personal", "Please don't forget to take your cup to the kitchen floor."),
    mk("12:00", "Lunch Time — Stop Tracking", "break", "It's lunchtime. Please remember to stop the time tracking in ClickUp."),
    mk("17:00", "Check Out — Rigo App", "work", "Please remember to check out on the Rigo App. Your office hours for today are now over."),
  ];
}

const SEED_VERSION = 2;
// Title|time pairs of the previous (v1) default set — used to detect untouched installs.
const V1_DEFAULT_KEYS = new Set([
  "Start Work|10:00",
  "Return Cup|11:55",
  "Lunch Break|13:00",
  "Continue Development|14:00",
  "Drink Water|16:30",
  "Review Tasks|17:30",
  "Finish Work|18:00",
]);

async function seedIfNeeded() {
  const state = await readState();
  if (!state.seeded) {
    await writeState({ reminders: defaultReminders(), seeded: true, seedVersion: SEED_VERSION });
    return;
  }
  if ((state.seedVersion || 1) < SEED_VERSION) {
    // One-time upgrade to the new default set.
    const current = state.reminders || [];
    const untouched = current.length > 0 && current.every((r) => V1_DEFAULT_KEYS.has(r.title + "|" + r.time));
    if (untouched || current.length === 0) {
      // User never customized: replace wholesale with the new defaults.
      await writeState({ reminders: defaultReminders(), seedVersion: SEED_VERSION });
    } else {
      // User has custom reminders: only add any missing new defaults (matched by time).
      const haveTimes = new Set(current.map((r) => r.time));
      const missing = defaultReminders().filter((r) => !haveTimes.has(r.time));
      if (missing.length) await writeState({ reminders: current.concat(missing), seedVersion: SEED_VERSION });
      else await writeState({ seedVersion: SEED_VERSION });
    }
    return;
  }
  {
    // migrate: ensure every reminder has the full field set
    let changed = false;
    const reminders = state.reminders.map((r) => {
      const base = {
        voiceEnabled: true, notificationEnabled: true, sound: "default",
        enabled: true, completed: false, lastCompletedDate: null, lastFiredAt: null,
        repeat: "daily", days: [0, 1, 2, 3, 4, 5, 6], category: "work",
        createdAt: Date.now(), updatedAt: Date.now(),
      };
      const merged = Object.assign(base, r);
      if (JSON.stringify(merged) !== JSON.stringify(r)) changed = true;
      return merged;
    });
    if (changed) await writeState({ reminders });
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await seedIfNeeded();
  await rebuildAlarms();
});

chrome.runtime.onStartup.addListener(async () => {
  await seedIfNeeded();
  await rebuildAlarms();
});

// Service worker wake-ups: keep alarms fresh.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg || msg.target !== "background") return;
    const fullState = await readState();
    const { reminders, settings, office } = fullState;
    switch (msg.action) {
      case "getState": {
        const upd = fullState.pendingUpdate && compareVersions(chrome.runtime.getManifest().version, fullState.pendingUpdate.version) < 0
          ? fullState.pendingUpdate : null;
        sendResponse({
          reminders, settings, office,
          currentVersion: chrome.runtime.getManifest().version,
          repoUrl: REPO_URL,
          pendingUpdate: upd,
          updateCheckedAt: fullState.updateCheckedAt || 0,
        });
        break;
      }
      case "checkUpdate": {
        const res = await checkForUpdates(true);
        sendResponse(res);
        break;
      }
      case "rebuild":
        await rebuildAlarms();
        sendResponse({ ok: true });
        break;
      case "complete":
        await markCompleted(msg.id); sendResponse({ ok: true }); break;
      case "snooze":
        await snoozeReminder(msg.id, msg.minutes || settings.defaultSnooze || 5); sendResponse({ ok: true }); break;
      case "toggle": {
        const r = reminders.find((x) => x.id === msg.id);
        if (r) { r.enabled = !!msg.enabled; r.updatedAt = Date.now(); await writeState({ reminders }); await scheduleReminder(r); }
        sendResponse({ ok: true }); break;
      }
      case "delete": {
        await writeState({ reminders: reminders.filter((x) => x.id !== msg.id) });
        await chrome.alarms.clear(ALARM_PREFIX + msg.id);
        sendResponse({ ok: true }); break;
      }
      case "save": {
        let rem = msg.reminder;
        if (!rem.id) {
          rem.id = WR.uid(); rem.createdAt = Date.now();
          rem.completed = false; rem.lastCompletedDate = null; rem.lastFiredAt = null;
          reminders.push(rem);
        } else {
          const i = reminders.findIndex((x) => x.id === rem.id);
          if (i >= 0) reminders[i] = rem; else reminders.push(rem);
        }
        rem.updatedAt = Date.now();
        await writeState({ reminders });
        await scheduleReminder(rem);
        sendResponse({ ok: true, id: rem.id }); break;
      }
      case "saveSettings":
        await writeState({ settings: Object.assign({}, settings, msg.settings) });
        await rebuildAlarms();
        sendResponse({ ok: true }); break;
      case "saveOffice":
        await writeState({ office: Object.assign({}, office, msg.office) });
        sendResponse({ ok: true }); break;
      case "testVoice": {
        const cfg = Object.assign({}, settings.voice, msg.voice || {});
        const res = await speak(msg.text || "Please return your cup to the kitchen.", cfg);
        sendResponse(res); break;
      }
      case "testSound":
        await playSound(msg.name || settings.sound.name, settings.sound.volume);
        sendResponse({ ok: true }); break;
      case "stopVoice":
        try { chrome.tts.stop(); } catch (e) {}
        await offscreenMessage({ action: "stopSpeech" });
        sendResponse({ ok: true }); break;
      case "triggerNow": {
        const r = reminders.find((x) => x.id === msg.id);
        if (r) await fireReminder(r);
        sendResponse({ ok: true }); break;
      }
      case "addMany": {
        const existing = new Set(reminders.map((r) => r.title + "|" + r.time));
        const added = [];
        for (const r of msg.reminders || []) {
          const key = r.title + "|" + r.time;
          if (existing.has(key)) continue;
          r.id = WR.uid(); r.createdAt = Date.now(); r.updatedAt = Date.now();
          r.enabled = true; r.completed = false; r.lastCompletedDate = null; r.lastFiredAt = null;
          reminders.push(r); added.push(r);
        }
        await writeState({ reminders });
        for (const r of added) await scheduleReminder(r);
        sendResponse({ ok: true, added: added.length }); break;
      }
      default:
        sendResponse({ ok: false });
    }
  })();
  return true;
});

// Also make sure the tick alarm exists on every worker wake-up.
// Worker boot: seed/migrate defaults, then (re)arm every alarm (covers missed onInstalled/onStartup),
// then detect a just-installed update and confirm it once.
seedIfNeeded().then(() => rebuildAlarms()).then(() => checkInstalledUpdate()).catch(() => ensureTick());
ensureTick();

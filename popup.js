(function () {
  "use strict";
  const WR = window.WR;
  const $ = (id) => document.getElementById(id);
  const catIcon = { work: "💼", break: "☕", meeting: "📅", personal: "💧", custom: "⭐" };

  let state = { reminders: [], settings: WR.DEFAULT_SETTINGS, office: WR.DEFAULT_OFFICE };
  let categoryFilter = null;

  function send(action, payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(Object.assign({ target: "background", action }, payload || {}), (resp) => {
        if (chrome.runtime.lastError) return resolve(null);
        resolve(resp);
      });
    });
  }

  async function refresh() {
    const s = await send("getState");
    if (s) state = s;
    applyTheme();
    renderAll();
  }

  function applyTheme() {
    let t = state.settings.theme;
    if (t === "system") t = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    document.body.dataset.theme = t;
  }

  /* ---------- rendering ---------- */

  const DEV_URL = "https://nabinkhadka.com";

  function openExternal(url) {
    try {
      const p = chrome.tabs.create({ url });
      if (p && typeof p.catch === "function") p.catch(() => window.open(url, "_blank"));
    } catch (e) {
      window.open(url, "_blank");
    }
  }

  function renderAll() {
    renderNext(); renderCategories(); renderToday($("todayList")); renderSchedulePage(); renderReminderList(); renderSettings(); renderOffice(); renderUpdate();
  }

  function upcomingSorted() {
    const now = new Date();
    return state.reminders
      .filter((r) => r.enabled !== false)
      .map((r) => ({ r, next: WR.nextOccurrence(r, now) }))
      .filter((x) => x.next)
      .sort((a, b) => a.next - b.next);
  }

  function renderNext() {
    const up = upcomingSorted();
    if (!up.length) {
      $("nextTime").textContent = "--:--";
      $("nextTitle").textContent = "No upcoming reminders";
      $("nextMessage").textContent = "Add one from the Reminders tab.";
      $("nextFlags").textContent = "";
      return;
    }
    const { r, next } = up[0];
    $("nextTime").textContent = WR.formatTime(r.time, state.settings.hourFormat);
    $("nextTitle").textContent = r.title;
    $("nextMessage").textContent = r.message || "";
    $("nextWhen").textContent = WR.todayKey(next) === WR.todayKey() ? "🕐 Today" : "📆 " + next.toLocaleDateString();
    const cat = WR.CATEGORY_MAP[r.category] || WR.CATEGORY_MAP.custom;
    $("nextDot").style.background = cat.color;
    const flags = [];
    if (state.settings.notificationsEnabled && r.notificationEnabled !== false) flags.push("🔔 Notification");
    if (state.settings.voiceEnabled && r.voiceEnabled !== false) flags.push("🔊 Voice");
    $("nextFlags").textContent = flags.join("  •  ") || "🔕 Silent";
  }

  function renderCategories() {
    const grid = $("catGrid");
    grid.innerHTML = "";
    const up = upcomingSorted();
    for (const cat of WR.CATEGORIES.filter((c) => c.id !== "custom")) {
      const mine = state.reminders.filter((r) => (r.category || "custom") === cat.id && r.enabled !== false);
      const nextIn = up.find((x) => (x.r.category || "custom") === cat.id);
      const el = document.createElement("div");
      el.className = "cat-card";
      el.style.background = `linear-gradient(135deg, ${cat.color}, ${cat.color}cc)`;
      el.innerHTML = `<div class="ic">${catIcon[cat.id] || "⭐"}</div><h4>${cat.label}</h4><p>${cat.desc}</p>
        <div class="meta"><span>Next: ${nextIn ? WR.formatTime(nextIn.r.time, state.settings.hourFormat) : "—"}</span><span class="count">${mine.length} ›</span></div>`;
      el.addEventListener("click", () => { categoryFilter = cat.id; switchView("reminders"); renderReminderList(); });
      grid.appendChild(el);
    }
  }

  function todayReminders() {
    const now = new Date();
    return state.reminders
      .filter((r) => r.enabled !== false && WR.isActiveDay(r, now))
      .sort((a, b) => WR.toMinutes(a.time) - WR.toMinutes(b.time));
  }

  function renderToday(listEl) {
    if (!listEl) return;
    const items = todayReminders();
    listEl.innerHTML = "";
    if (!items.length) { listEl.innerHTML = "<li><span class='grow muted'>No reminders today.</span></li>"; return; }
    for (const r of items) {
      const st = WR.todayStatus(r);
      const cat = WR.CATEGORY_MAP[r.category] || WR.CATEGORY_MAP.custom;
      const li = document.createElement("li");
      const chkClass = st === "done" ? "chk done" : st === "now" ? "chk now" : "chk";
      li.innerHTML = `<span class="${chkClass}">${st === "done" ? "✓" : ""}</span>
        <span class="dot" style="background:${cat.color}"></span>
        <span class="t">${WR.formatTime(r.time, state.settings.hourFormat)}</span>
        <span class="grow">${escapeHtml(r.title)}</span>
        ${st === "done" ? '<span class="badge done">Done</span>' : ""}
        ${st === "now" ? '<span class="badge now">Now</span>' : ""}
        ${st === "missed" ? '<span class="badge missed">Missed</span>' : ""}`;
      li.style.cursor = "pointer";
      li.querySelector(".chk").addEventListener("click", (e) => {
        e.stopPropagation();
        if (WR.todayStatus(r) !== "done") send("complete", { id: r.id }).then(refresh);
      });
      li.addEventListener("click", () => openReminderDetail(r));
      listEl.appendChild(li);
    }
    const done = items.filter((r) => WR.todayStatus(r) === "done").length;
    $("todayCount").textContent = done + "/" + items.length + " ›";
  }

  function renderReminderList() {
    const box = $("reminderList");
    box.innerHTML = "";
    let list = [...state.reminders].sort((a, b) => WR.toMinutes(a.time) - WR.toMinutes(b.time));
    if (categoryFilter) list = list.filter((r) => r.category === categoryFilter);
    if (!list.length) { box.innerHTML = "<p class='muted'>No reminders. Click + Add to create one.</p>"; return; }
    for (const r of list) {
      const cat = WR.CATEGORY_MAP[r.category] || WR.CATEGORY_MAP.custom;
      const el = document.createElement("div");
      el.className = "rem-card";
      el.innerHTML = `<div class="time">${WR.formatTime(r.time, state.settings.hourFormat)}</div>
        <div class="info"><b>${escapeHtml(r.title)}</b><p>${repeatLabel(r)} • ${cat.label}${r.voiceEnabled !== false ? " • 🔊" : ""}</p></div>
        <button class="mini-btn" data-act="edit">✏️</button>
        <button class="mini-btn" data-act="del">🗑️</button>
        <label class="switch"><input type="checkbox" ${r.enabled !== false ? "checked" : ""}><span class="slider"></span></label>`;
      el.querySelector('[data-act="edit"]').addEventListener("click", () => openForm(r));
      el.querySelector('[data-act="del"]').addEventListener("click", async () => {
        if (confirm("Delete \"" + r.title + "\"?")) { await send("delete", { id: r.id }); refresh(); }
      });
      el.querySelector("input").addEventListener("change", async (e) => { await send("toggle", { id: r.id, enabled: e.target.checked }); refresh(); });
      el.querySelector(".info").style.cursor = "pointer";
      el.querySelector(".info").addEventListener("click", () => openReminderDetail(r));
      box.appendChild(el);
    }
    if (categoryFilter) {
      const clear = document.createElement("button");
      clear.className = "btn"; clear.textContent = "Show all";
      clear.addEventListener("click", () => { categoryFilter = null; renderReminderList(); });
      box.prepend(clear);
    }
  }

  function openReminderDetail(r) {
    // Open the edit form as the detail view; the schedule list has a Done toggle.
    openForm(r);
  }

  function renderSchedulePage() {
    const o = state.office;
    $("officeHours").textContent = WR.formatTime(o.start, state.settings.hourFormat) + " – " + WR.formatTime(o.end, state.settings.hourFormat);
    $("officeLunch").textContent = WR.formatTime(o.lunchStart, state.settings.hourFormat) + " – " + WR.formatTime(o.lunchEnd, state.settings.hourFormat);
    $("officeDays").textContent = o.days.map((d) => WR.WEEKDAYS[d].slice(0, 3)).join(", ") || "None";
    renderToday($("scheduleToday"));
  }

  function renderSettings() {
    const s = state.settings;
    $("setHourFormat").value = String(s.hourFormat);
    $("setSnooze").value = String(s.defaultSnooze);
    $("setTheme").value = s.theme;
    $("setNotif").checked = !!s.notificationsEnabled;
    $("setSound").value = s.sound.name;
    $("setSoundVol").value = s.sound.volume;
    $("setVoice").checked = !!s.voiceEnabled;
    $("setLang").value = s.voice.language;
    $("setGender").value = s.voice.gender;
    $("setSpeed").value = s.voice.speed;
    $("setVoiceVol").value = s.voice.volume;
    $("voiceToggle").textContent = s.voiceEnabled ? "🔊" : "🔇";
  }

  function renderOffice() {
    const o = state.office;
    $("offStart").value = o.start; $("offEnd").value = o.end;
    $("offLunchStart").value = o.lunchStart; $("offLunchEnd").value = o.lunchEnd;
    buildDayChips($("offDays"), o.days, () => {});
  }

  /* ---------- updates ---------- */

  function renderUpdate() {
    const current = state.currentVersion || (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || "—";
    $("updCurrent").textContent = "v" + current;
    $("updChecked").textContent = state.updateCheckedAt
      ? new Date(state.updateCheckedAt).toLocaleString()
      : "Never";
    const p = state.pendingUpdate;
    if (p && p.version) {
      $("updPanel").classList.remove("hidden");
      $("updLatest").textContent = "v" + p.version;
      $("updNotes").textContent = p.notes || "";
      if (!$("updStatus").dataset.keep) $("updStatus").textContent = "A newer version is available below.";
    } else {
      $("updPanel").classList.add("hidden");
    }
    // Hide the folder picker where the File System Access API is unavailable.
    try {
      if (typeof window.showDirectoryPicker !== "function" && $("updFolderBtn")) {
        $("updFolderBtn").style.display = "none";
      }
    } catch (e) {}
  }

  let checkingUpdate = false;
  async function onCheckUpdate() {
    if (checkingUpdate) return;
    checkingUpdate = true;
    $("updCheckBtn").disabled = true;
    $("updStatus").textContent = "Checking GitHub for updates…";
    try {
      const res = await send("checkUpdate", {});
      if (!res) {
        $("updStatus").textContent = "Could not reach the update server. Check your connection and try again.";
      } else if (!res.ok) {
        $("updStatus").textContent = "Could not reach the update server. Check your connection and try again.";
      } else if (res.update) {
        state.pendingUpdate = { version: res.latest, notes: res.notes, url: res.url };
        state.updateCheckedAt = res.checkedAt;
        $("updStatus").dataset.keep = "1";
        $("updStatus").textContent = "Update v" + res.latest + " available — a notification was also shown.";
        renderUpdate();
      } else {
        // Up to date: inline confirmation only, never a notification.
        state.pendingUpdate = null;
        state.updateCheckedAt = res.checkedAt;
        delete $("updStatus").dataset.keep;
        $("updStatus").textContent = "You're up to date (v" + res.current + ").";
        renderUpdate();
      }
    } catch (e) {
      $("updStatus").textContent = "Could not reach the update server. Check your connection and try again.";
    }
    $("updCheckBtn").disabled = false;
    checkingUpdate = false;
  }

  async function onVerifyFolder() {
    const statusEl = $("updFolderStatus");
    try {
      if (typeof window.showDirectoryPicker !== "function") {
        statusEl.textContent = "Folder picker isn't available in this browser. Compare versions manually instead.";
        return;
      }
      statusEl.textContent = "Select your extension folder…";
      const dir = await window.showDirectoryPicker({ mode: "read" });
      let manifestText = null;
      for await (const entry of dir.values()) {
        if (entry.kind === "file" && entry.name.toLowerCase() === "manifest.json") {
          manifestText = await (await entry.getFile()).text();
          break;
        }
      }
      if (!manifestText) {
        statusEl.textContent = "That folder doesn't look like the extension (no manifest.json found).";
        return;
      }
      const mf = JSON.parse(manifestText);
      if (mf.name !== "Work Reminder") {
        statusEl.textContent = "That folder is a different extension (" + (mf.name || "unknown") + ").";
        return;
      }
      const folderVer = mf.version || "?";
      const current = state.currentVersion || "";
      statusEl.textContent = "Folder \"" + dir.name + "\" holds Work Reminder v" + folderVer +
        (current && folderVer === current ? " — matches this install." : " (this install runs v" + current + "). Reload the extension after replacing its files.");
    } catch (e) {
      if (e && e.name === "AbortError") { statusEl.textContent = ""; return; }
      statusEl.textContent = "Could not read that folder. Make sure you selected the extracted extension folder.";
    }
  }

  /* ---------- day chips ---------- */
  const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
  function buildDayChips(container, selected, onChange) {
    container.innerHTML = "";
    for (let d = 0; d < 7; d++) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip" + (selected.includes(d) ? " on" : "");
      b.textContent = DAY_LETTERS[d]; b.title = WR.WEEKDAYS[d];
      b.addEventListener("click", () => {
        const i = selected.indexOf(d);
        if (i >= 0) selected.splice(i, 1); else selected.push(d);
        b.classList.toggle("on");
        onChange(selected);
      });
      container.appendChild(b);
    }
  }

  function repeatLabel(r) {
    if (r.repeat === "once") return "Once";
    if (r.repeat === "daily") return "Every day";
    if (r.repeat === "weekdays") return "Weekdays";
    return "Custom days";
  }

  /* ---------- navigation ---------- */
  function switchView(name) {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
  }
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => { categoryFilter = null; switchView(t.dataset.view); }));
  $("settingsBtn").addEventListener("click", () => switchView("settings"));
  $("voiceToggle").addEventListener("click", async () => {
    state.settings.voiceEnabled = !state.settings.voiceEnabled;
    await send("saveSettings", { settings: state.settings });
    renderSettings();
  });

  /* ---------- form ---------- */
  let formDays = [];
  function openForm(r) {
    $("modal").classList.remove("hidden");
    $("modalTitle").textContent = r ? "Edit Reminder" : "Add Reminder";
    $("fId").value = r ? r.id : "";
    $("fTime").value = r ? r.time : "11:55";
    $("fTitle").value = r ? r.title : "";
    $("fMessage").value = r ? r.message || "" : "";
    $("fCategory").value = r ? r.category : "work";
    $("fRepeat").value = r ? r.repeat : "daily";
    $("fSound").value = r && r.sound ? r.sound : "default";
    $("fVoice").checked = r ? r.voiceEnabled !== false : true;
    $("fNotif").checked = r ? r.notificationEnabled !== false : true;
    formDays = r && r.days ? [...r.days] : [1, 2, 3, 4, 5];
    buildDayChips($("fDays"), formDays, () => {});
    toggleDaysRow();
  }
  function toggleDaysRow() {
    $("fDaysWrap").style.display = $("fRepeat").value === "custom" ? "flex" : "none";
  }
  $("fRepeat").addEventListener("change", toggleDaysRow);
  $("fCancel").addEventListener("click", () => $("modal").classList.add("hidden"));
  $("fSave").addEventListener("click", async () => {
    const title = $("fTitle").value.trim();
    if (!title) { alert("Title is required"); return; }
    const existing = state.reminders.find((r) => r.id === $("fId").value) || {};
    const reminder = Object.assign({}, existing, {
      title,
      message: $("fMessage").value.trim(),
      time: $("fTime").value || "09:00",
      category: $("fCategory").value,
      repeat: $("fRepeat").value,
      days: $("fRepeat").value === "custom" ? formDays : $("fRepeat").value === "weekdays" ? [1, 2, 3, 4, 5] : $("fRepeat").value === "daily" ? [0, 1, 2, 3, 4, 5, 6] : existing.days,
      sound: $("fSound").value,
      voiceEnabled: $("fVoice").checked,
      notificationEnabled: $("fNotif").checked,
      enabled: existing.enabled !== undefined ? existing.enabled : true,
    });
    await send("save", { reminder });
    $("modal").classList.add("hidden");
    refresh();
  });
  $("addReminderBtn").addEventListener("click", () => openForm(null));

  /* ---------- settings save ---------- */
  function bindSettingSave() {
    const save = async () => {
      state.settings.hourFormat = +$("setHourFormat").value;
      state.settings.defaultSnooze = +$("setSnooze").value;
      state.settings.theme = $("setTheme").value;
      state.settings.notificationsEnabled = $("setNotif").checked;
      state.settings.sound.name = $("setSound").value;
      state.settings.sound.volume = +$("setSoundVol").value;
      state.settings.voiceEnabled = $("setVoice").checked;
      state.settings.voice.language = $("setLang").value;
      state.settings.voice.gender = $("setGender").value;
      state.settings.voice.speed = $("setSpeed").value;
      state.settings.voice.volume = +$("setVoiceVol").value;
      await send("saveSettings", { settings: state.settings });
      applyTheme(); renderNext(); renderToday($("todayList")); renderSettings();
    };
    $("view-settings").addEventListener("change", save);
    $("view-settings").addEventListener("input", (e) => { if (e.target.type === "range") save(); });
  }
  bindSettingSave();

  $("testVoiceBtn").addEventListener("click", () => {
    const up = upcomingSorted();
    const text = up.length && (up[0].r.message || "").trim()
      ? up[0].r.message.trim()
      : "Please return your cup to the kitchen.";
    send("testVoice", { text });
  });
  $("testSoundBtn").addEventListener("click", () => send("testSound", {}));

  /* ---------- updates + about ---------- */
  $("updCheckBtn").addEventListener("click", onCheckUpdate);
  $("updDownloadBtn").addEventListener("click", () => {
    const url = (state.pendingUpdate && state.pendingUpdate.url) || state.repoUrl;
    if (url) openExternal(url);
  });
  $("updFolderBtn").addEventListener("click", onVerifyFolder);
  $("repoLink").addEventListener("click", (e) => {
    e.preventDefault();
    if (state.repoUrl) openExternal(state.repoUrl);
  });
  $("devLink").addEventListener("click", (e) => { e.preventDefault(); openExternal(DEV_URL); });

  /* ---------- office ---------- */
  $("saveOfficeBtn").addEventListener("click", async () => {
    const sel = [];
    $("offDays").querySelectorAll(".chip").forEach((c, d) => { if (c.classList.contains("on")) sel.push(d); });
    await send("saveOffice", { office: { start: $("offStart").value, end: $("offEnd").value, lunchStart: $("offLunchStart").value, lunchEnd: $("offLunchEnd").value, days: sel } });
    refresh(); alert("Office hours saved.");
  });

  /* ---------- smart schedule ---------- */
  $("suggestBtn").addEventListener("click", () => {
    const o = state.office;
    const add = (time, title, category, message) => ({
      title, message, time, category, repeat: "weekdays", days: o.days,
      voiceEnabled: true, notificationEnabled: true, sound: "default",
      enabled: true, repeat2: undefined,
    });
    const suggestions = [
      add(o.start, "Start Work", "work", "Start work. Have a productive day!"),
      add(WR.fromMinutes(WR.toMinutes(o.start) + 30), "Check Emails", "work", "Check your emails and plan the day."),
      add(WR.fromMinutes(WR.toMinutes(o.start) + 120), "Take a Break", "break", "Take a short break. Rest your eyes."),
      add(o.lunchStart, "Lunch Break", "break", "Time for lunch. Take a proper break!"),
      add(o.lunchEnd, "Continue Work", "work", "Back to work. Focus time!"),
      add(WR.fromMinutes((WR.toMinutes(o.lunchEnd) + WR.toMinutes(o.end)) / 2 | 0), "Drink Water", "personal", "Drink a glass of water."),
      add(WR.fromMinutes(WR.toMinutes(o.end) - 30), "Review Tasks", "work", "Review your tasks before wrapping up."),
      add(o.end, "Finish Work", "work", "Finish work. Great job today!"),
    ];
    const list = $("suggestList");
    list.innerHTML = "";
    for (const s of suggestions) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="t">${WR.formatTime(s.time, state.settings.hourFormat)}</span><span class="grow">${s.title}</span>`;
      list.appendChild(li);
    }
    $("suggestAdd").onclick = async () => {
      const clean = suggestions.map((s) => { const { repeat2, ...rest } = s; return rest; });
      const res = await send("addMany", { reminders: clean });
      $("suggestModal").classList.add("hidden");
      alert(`Added ${res && res.added != null ? res.added : 0} new reminders.`);
      refresh();
    };
    $("suggestCustomize").onclick = () => { $("suggestModal").classList.add("hidden"); switchView("reminders"); };
    $("suggestCancel").onclick = () => $("suggestModal").classList.add("hidden");
    $("suggestModal").classList.remove("hidden");
  });

  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  refresh();
  setInterval(refresh, 30000);
})();

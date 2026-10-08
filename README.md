# Work Reminder

A premium personal workday reminder, alarm, schedule and voice notification browser extension (Manifest V3).

Dev by [Nabin Khadka](https://nabinkhadka.com) · [GitHub Repository](https://github.com/Nabinkdk7/Work-Reminder-Extension)

## Features

- **Dashboard** inspired by the reference design: next reminder card, colorful category cards (Work, Breaks, Meetings, Personal), Today's Schedule with Done/Now/Missed/Upcoming statuses.
- **Real alarm engine** — `chrome.alarms` + background service worker; reminders fire even when the popup is closed, and alarms are rebuilt on install/startup (browser & extension restart safe).
- **Notifications** via `chrome.notifications` with **Done** and **Snooze** buttons.
- **Actual alarm sounds** (Default Chime, Sunrise, Melody, Pop, Zen, Sparkle, Glass, Gentle, Digital, Cascade, Soft, Bell, Alarm) generated with WebAudio in an offscreen document — no asset files needed.
- **Real voice reminders** — `chrome.tts` first, Web Speech API fallback; male/female/system voice, English/Nepali/Hindi, slow/normal/fast speed, volume, and a **Test Voice** button.
- **Snooze** (5/10/15/custom via default snooze setting), repeating reminders (once/daily/weekdays/custom days), enable/disable, edit, delete.
- **Office hours** settings + **Create Workday Schedule** suggestions (always user-confirmed).
- **Settings**: 12/24h format, default snooze, theme (dark/light/system), notification sound & volume, voice options, office schedule. Everything persists in `chrome.storage.local`.

## Install (from ZIP)

1. Download the repository ZIP: **Code → Download ZIP** (or grab a specific release ZIP from the [releases page](https://github.com/Nabinkdk7/Work-Reminder-Extension/releases)).
2. Extract the ZIP anywhere (e.g. `Documents\WorkReminder`).
3. Open `chrome://extensions` in Chrome/Edge/Brave.
4. Enable **Developer mode** (top right).
5. Click **Load unpacked** and select the extracted folder (the one containing `manifest.json`).
6. Pin **Work Reminder** to the toolbar and open it — the default workday schedule is created automatically.

## Updating

The extension checks GitHub for new versions automatically every 12 hours, or on demand via
**Settings → Updates → Check for Updates**.

- If an update is available you get a **notification** (once per version) plus an update panel in Settings with a **Download Update** button and step-by-step install guide.
- No notification is shown when you are already up to date.
- After you install the new files and press **Reload** on `chrome://extensions`, the extension confirms with a *"Successfully updated"* notification.
- Browsers don't allow an unpacked extension to overwrite its own files, so updating is: download ZIP → extract over the extension folder → Reload. Your reminders and settings are preserved in `chrome.storage`.

## Test end-to-end

1. Open the popup → default schedule is seeded; every reminder can be edited/deleted.
2. Create a reminder for a minute or two from now (e.g. title `Return Cup`, message `Please return your cup to the kitchen.`).
3. Close the popup (and even other windows) — when the time hits, you get:
   - a browser notification,
   - the selected alarm sound,
   - speech of the message via voice settings.
4. Use the notification's **Done** / **Snooze** buttons, or the Schedule tab's check toggle.

## Architecture

| File | Role |
| ---- | ---- |
| `background.js` | Service worker: storage, alarm scheduling, firing, notifications, messages, update checker |
| `offscreen.js` | Offscreen doc: WebAudio sounds + Web Speech API voice (fallback) |
| `shared.js` | Shared time/schedule helpers, defaults, categories, voice pacing (popup, worker, offscreen) |
| `popup.html/css/js` | Dashboard UI: Home / Reminders / Schedule / Settings |
| `manifest.json` | MV3 manifest (storage, alarms, notifications, offscreen, tts) |
| `updates.json` | Release metadata polled by the in-extension update checker |

## For maintainers — publishing a new version

1. Bump `"version"` in `manifest.json` (e.g. `1.2.0`).
2. Update `updates.json`: same version, short `notes`, keep `url` pointing at the branch ZIP (or a tag ZIP).
3. Commit and push to `main`.
4. (Optional) publish a matching GitHub Release/tag (`v1.2.0`) with the ZIP attached.
5. Installed copies will detect the new version within 12 hours (or immediately via Check for Updates).

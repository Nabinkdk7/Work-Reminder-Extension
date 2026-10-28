# Work Reminder

A premium personal workday reminder, alarm, schedule and voice notification browser extension for Chrome, Edge and Brave (Manifest V3).

Dev by [Nabin Khadka](https://nabinkhadka.com) · [GitHub Repository](https://github.com/Nabinkdk7/Work-Reminder-Extension)

## What's inside

- **`work-reminder-v1.8.0.zip`** — the complete, ready-to-install extension.
- **`README.md`** — this guide.

## Download

- **Latest version:** open [`work-reminder-v1.8.0.zip`](https://github.com/Nabinkdk7/Work-Reminder-Extension/blob/main/work-reminder-v1.8.0.zip) and click **Download**.
- Do **not** use the green **Code → Download ZIP** button: that downloads the repository (the extension ZIP plus this README), not the extension folder.
- The extension checks this repository automatically and shows a notification plus a one-click download in **Settings → Updates** when a newer ZIP is published.

## Install

1. Download and extract `work-reminder-v1.8.0.zip` to a permanent folder (e.g. `Documents\WorkReminder`). Keep this folder — the browser loads the extension from it.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the extracted folder (the one containing `manifest.json`).
5. Pin **Work Reminder** to the toolbar and open it — your default workday schedule is created automatically.

## Features

- **Liquid-glass dashboard** — frosted panels, soft aurora glows and cyan→violet gradients on a deep navy canvas, with a next-reminder hero card and a live countdown.
- **Quick Reminder** — a one-off nudge in 5/10/15/30/60 minutes without touching the schedule.
- **Do Not Disturb** — pause every reminder, sound and voice for 30 minutes, 1 hour or until tomorrow, with a live banner.
- **Backup & Restore** — export all reminders and settings to JSON and restore them on another computer or after reinstalling.
- **Time & Focus** — a live local clock with timezone, screen time today, a workday countdown to the end of your office hours, and a persistent stopwatch with lap times.
- **Real alarm engine** — `chrome.alarms` plus a background service worker; reminders fire even when the popup is closed. Alarms are reconciled on install, startup and every worker wake-up, while active snoozes, Done state and pending one-offs survive Chrome recycling the worker.
- **Notifications** — `chrome.notifications` with **Done** and **Snooze** buttons that keep working after a worker restart. A laptop waking from sleep never replays a stale daily alarm.
- **Polished sounds** — 13 WebAudio-generated alarm sounds (Default Chime, Sunrise, Melody, Pop, Zen, Sparkle, Glass, Gentle, Digital, Cascade, Soft, Bell, Alarm) through a peak limiter, with a sub-octave body and warm harmonics. No audio asset files needed.
- **Real voice reminders** — `chrome.tts` first with a Web Speech API fallback; male/female/system voice, English/Nepali/Hindi, slow/normal/fast speed, volume and a **Test Voice** button.
- **Smart scheduling** — once, daily, weekdays or custom days; 5/10/15-minute or custom snooze; enable/disable, duplicate, search, edit and delete.
- **Office hours** plus a one-click **Create Workday Schedule** generator (always asks before adding anything).
- **Toolbar clock** — the logo fills the toolbar icon edge-to-edge and Chrome's native badge shows the live local time, updated every minute, 12/24-hour aware and toggleable.
- **Settings** — 12/24-hour format, default snooze, dark/light/system theme, toolbar clock, notification sound and volume, voice options and office schedule. Everything persists in `chrome.storage.local`.

## Updating

The extension checks GitHub automatically every 12 hours, or on demand via **Settings → Updates → Check for Updates**.

- You get a notification only when a newer version is available — never when you are already up to date.
- The update panel includes a **Download Update** button and a step-by-step guide.
- To update: download the new `work-reminder-vX.Y.Z.zip`, extract it **over your existing extension folder**, then press **Reload** on `chrome://extensions`. Your reminders and settings are preserved.
- Browsers do not let an unpacked extension overwrite its own files, so this one manual Reload is expected.

## Support

Found a bug or want a feature? Open an issue on the [**GitHub Repository**](https://github.com/Nabinkdk7/Work-Reminder-Extension) or visit [nabinkhadka.com](https://nabinkhadka.com).

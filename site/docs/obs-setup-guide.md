# OBS Setup Guide: NWTT Graphics Studio + OBS Studio + Restream

This guide covers Phase 1 of NWTT livestream production. Each broadcaster runs **OBS Studio** on their own computer, loads graphics exported from **NWTT Graphics Studio** as **Image sources**, and streams to **Restream**, which sends the broadcast on to **YouTube** and **X**.

Graphics are static PNG files. Nothing in Graphics Studio streams, publishes or connects to OBS or Restream: you export a file, and OBS shows it. New broadcaster? Start with [Broadcaster Onboarding](broadcaster-onboarding.md).

> Never put stream keys, passwords or Restream logins in a graphic, a project file, a shared folder or a chat. This guide never needs one.

## 1. Install OBS Studio

1. Download OBS Studio from the official site, https://obsproject.com (Windows, macOS or Linux). Install the current stable release.
2. On first launch, the Auto-Configuration Wizard opens. Choose **Optimize for streaming**, then set the values in section 2 yourself (skip the bandwidth test if it suggests a different resolution).
3. macOS: when asked, allow OBS **Screen Recording**, **Camera** and **Microphone** access in System Settings → Privacy & Security, then restart OBS.

## 2. Configure the canvas and stream quality

**Settings → Video**

| Setting | Value |
|---|---|
| Base (Canvas) Resolution | **1920x1080** |
| Output (Scaled) Resolution | **1920x1080** |
| Common FPS Values | **30** |

**Settings → Output** (Output Mode: Advanced → Streaming tab)

| Setting | Recommended value |
|---|---|
| Video encoder | Hardware if available (NVIDIA NVENC, AMD, Apple VT), otherwise x264 |
| Rate control | CBR |
| Bitrate | 4500–6000 Kbps (lower it if your upload speed is under ~10 Mbps) |
| Keyframe interval | 2 s |
| Audio bitrate | 160 Kbps, 48 kHz (Settings → Audio → Sample Rate) |

Every NWTT graphic is exported at exactly 1920×1080, so with this canvas a graphic fills the frame with no scaling and no blur.

## 3. Export graphics from Graphics Studio for OBS

1. Open the graphic in Graphics Studio and fill in its **Fields** tab. Replace every `[bracketed]` placeholder and set the **As of** time from the official source.
2. Click **Export**, then choose a **Destination**:
   - **OBS Studio — Overlay (1920×1080 transparent PNG)**: lower thirds, straps, the source line, the LIVE bug, the wildfire fact panel. Transparent areas show whatever is below it in the scene.
   - **OBS Studio — Full-screen graphic or map (1920×1080 opaque PNG)**: Starting Soon, Technical Difficulties, Ending, breaking news cards, evacuation lists and every map graphic.
3. Click **Render and verify**. The dialog decodes the file and shows its real size and whether it has transparent pixels. Look for the green **OBS-ready** tag. A yellow warning means something needs attention (for example an "overlay" that is opaque, or one that covers most of the frame).
4. Click **Download**, or **Save to folder…** (Chrome and Edge) to save straight into your graphics folder.

If the graphic still has sample content, placeholders or an empty time field, the Studio asks you to confirm before it exports. Only export it anyway for rehearsal.

### File names

File names never contain a date or time, so a new export replaces the old file and OBS picks it up (see section 7):

```
<Project name>_1920x1080_obs-overlay.png   transparent overlay
<Project name>_1920x1080_obs-full.png      full-screen graphic or map
```

Spaces and punctuation in the project name become `_`. Projects made from a template start with the template's name, so every broadcaster gets the same file names:

| Graphic | Template | File name |
|---|---|---|
| Starting Soon | NWTT Starting Soon | `NWTT_Starting_Soon_1920x1080_obs-full.png` |
| Technical Difficulties | NWTT Technical Difficulties | `NWTT_Technical_Difficulties_1920x1080_obs-full.png` |
| Broadcast Ending | NWTT Broadcast Ending | `NWTT_Broadcast_Ending_1920x1080_obs-full.png` |
| Breaking News card | Breaking news | `Breaking_news_1920x1080_obs-full.png` |
| Breaking News strap | Breaking news strap | `Breaking_news_strap_1920x1080_obs-overlay.png` |
| Wildfire map | Wildfire incident | `Wildfire_incident_1920x1080_obs-full.png` |
| Wildfire fact panel | NWTT Wildfire Fact Panel | `NWTT_Wildfire_Fact_Panel_1920x1080_obs-overlay.png` |
| Severe weather map | Severe weather outlook | `Severe_weather_outlook_1920x1080_obs-full.png` |
| Hurricane map | Hurricane tracking | `Hurricane_tracking_1920x1080_obs-full.png` |
| Live incident update | NWTT Live Incident Update | `NWTT_Live_Incident_Update_1920x1080_obs-overlay.png` |
| Evacuation list | NWTT Evacuation Orders and Warnings | `NWTT_Evacuation_Orders_and_Warnings_1920x1080_obs-full.png` |
| Correspondent banner | Reporter ID banner | `Reporter_ID_banner_1920x1080_obs-overlay.png` |
| Host nameplate | Anchor nameplate | `Anchor_nameplate_1920x1080_obs-overlay.png` |
| Briefing speaker | Interview identification | `Interview_identification_1920x1080_obs-overlay.png` |
| Source line | NWTT Source Attribution | `NWTT_Source_Attribution_1920x1080_obs-overlay.png` |
| LIVE bug | LIVE indicator | `LIVE_indicator_1920x1080_obs-overlay.png` |

Need two versions of the same graphic (for example two correspondents)? Rename the project first (`Reporter ID banner - West`), so each gets its own file.

## 4. Add graphics to OBS

**Transparent overlay**

1. Select the scene. Under **Sources**, click **+** → **Image** → *Create new* → name it after the graphic (for example `Source line`).
2. **Browse** to the `_obs-overlay.png` file. Leave "Unload image when not showing" off.
3. Keep overlays at the **top** of the Sources list: the top source is drawn in front.

**Full-screen graphic or map**

1. **+** → **Image** → pick the `_obs-full.png` file.
2. Move it to the **bottom** of the Sources list, so overlays and cameras sit on top of it.

Both kinds already fill the 1920×1080 canvas. If one was resized by accident, right-click it → **Transform → Reset Transform**.

**The Sentinel live map**

The Sentinel live tracker (https://app.nationalwildfiretrackingteam.org) is the live, interactive map for NWTT coverage. In Phase 1 it is captured from a browser window:

1. Open the tracker in its own browser window and size it to fill a 1920×1080 display, or make it full screen (F11). Close panels you don't want on air.
2. In OBS: **+** → **Window Capture** (Windows) or **macOS Screen Capture** → *Window* (macOS) → pick that browser window.
3. Right-click the source → **Transform → Fit to screen**. Crop browser chrome with Alt+drag (Option+drag on macOS) if needed.
4. Put it at the bottom of the scene, under the overlays.

Only capture the production tracker at the address above. A local development copy without data keys shows **demo hotspots with recent timestamps**, which must never go on air. Check that the layers on screen are the ones you intend to show, and name the source of what viewers see with the source-line overlay.

You can also export a map graphic from Graphics Studio (Map Studio, NWS Alert Graphics, Week-Ahead Hazards, Incident pages) as a full-screen PNG. That's a frozen snapshot with its own "valid" or "data as of" time.

## 5. Recommended scene collection

Create one scene collection for NWTT coverage: **Scene Collection → New** → `NWTT Coverage`. Then add these scenes in this order (the two-digit prefix keeps them sorted and matches the Studio's kit table). In each list, sources run **from the bottom of the Sources list to the top**.

### 00 — Starting Soon
- Image: `NWTT_Starting_Soon_…_obs-full.png`
- Optional: Media source for music (only music you have the rights to)

### 01 — Breaking News
- Image: `Breaking_news_…_obs-full.png` (or skip it and use the host camera full frame)
- Video Capture Device: host camera (if not using the card)
- Image: `Breaking_news_strap_…_obs-overlay.png`
- Image: `NWTT_Source_Attribution_…_obs-overlay.png`
- Image: `LIVE_indicator_…_obs-overlay.png`

### 02 — Wildfire Coverage
- Window Capture: Sentinel live tracker, or Image: `Wildfire_incident_…_obs-full.png`
- Image: `NWTT_Wildfire_Fact_Panel_…_obs-overlay.png`
- Image: `NWTT_Live_Incident_Update_…_obs-overlay.png` (hidden until needed: click its eye icon)
- Image: `NWTT_Source_Attribution_…_obs-overlay.png`

### 03 — Severe Weather
- Image: `Severe_weather_outlook_…_obs-full.png` (or a warning map), or Window Capture: Sentinel
- Image: `Breaking_news_strap_…_obs-overlay.png` (optional)
- Image: `NWTT_Source_Attribution_…_obs-overlay.png`

### 04 — Hurricane Coverage
- Image: `Hurricane_tracking_…_obs-full.png`
- Image: `NWTT_Source_Attribution_…_obs-overlay.png`
- Image: `LIVE_indicator_…_obs-overlay.png` (optional)

### 05 — Full-Screen Map
- Window Capture: Sentinel live tracker, or Image: any map exported as `_obs-full.png`
- Image: `NWTT_Evacuation_Orders_and_Warnings_…_obs-full.png` (hidden until needed)
- Image: `NWTT_Source_Attribution_…_obs-overlay.png`

### 06 — Host + Map
- Window Capture: Sentinel live tracker (full frame)
- Video Capture Device: host camera, scaled down as picture-in-picture (bottom-left, above the lower-third zone, about 480×270)
- Image: `Anchor_nameplate_…_obs-overlay.png`
- Image: `NWTT_Live_Incident_Update_…_obs-overlay.png` (hidden until needed)
- Image: `NWTT_Source_Attribution_…_obs-overlay.png`

Only show one lower-band graphic at a time (nameplate **or** incident update), because they use the same part of the frame.

### 07 — Correspondent
- Window Capture or Video Capture: the correspondent's call/feed, fit to screen
- Image: `Reporter_ID_banner_…_obs-overlay.png`
- Image: `LIVE_indicator_…_obs-overlay.png`

### 08 — Official Briefing
- Window/Media capture: the agency's official briefing feed, fit to screen
- Image: `Interview_identification_…_obs-overlay.png` (speaker name and title, as given by the agency)
- Image: `NWTT_Source_Attribution_…_obs-overlay.png` (for example `SOURCE: CAL FIRE LIVE BRIEFING`)
- Image: `LIVE_indicator_…_obs-overlay.png`

Don't cover the agency's own captions, sign-language interpreter or on-screen phone numbers. Hide the lower third if it overlaps them.

### 09 — Technical Standby
- Image: `NWTT_Technical_Difficulties_…_obs-full.png`

### 10 — Ending Coverage
- Image: `NWTT_Broadcast_Ending_…_obs-full.png`

**Tips.** Turn on **Studio Mode** to line up the next scene in Preview before sending it to Program. Lock sources you don't want moved (padlock icon). Mute the desktop audio of browser captures unless you need that sound.

**Why no ready-made scene collection file?** OBS scene collection files store each image's full path on the computer that made them (for example `C:\Users\…\NWTT Graphics\…`), so they don't move cleanly between Windows and macOS machines, and we can't verify an imported collection against OBS from the Studio. Build the collection once by hand, following this section (about 20 minutes). After that, a new export with the same file name updates every scene that uses it.

## 6. Organizing graphics on disk

Use one folder per computer for everything OBS loads, for example `Documents/NWTT Graphics/`:

```
NWTT Graphics/
  overlays/      all *_obs-overlay.png files
  fullscreen/    all *_obs-full.png files
  projects/      editable project files (*.nsgs.json) for sharing
```

Point every OBS Image source at a file in this folder. Never point OBS at your Downloads folder, which gets cleaned up.

## 7. Updating a graphic during a broadcast

1. Edit the project in Graphics Studio (for example new containment figure and **As of** time).
2. Export with the **same destination**, so it gets the same file name.
3. Save it over the existing file:
   - **Chrome / Edge:** click **Save to folder…**, pick the existing file in `NWTT Graphics/…` and confirm *Replace*. After the first save, the dialog offers **Overwrite <file>** for the rest of the session.
   - **Other browsers:** turn on "Ask where to save each file before downloading" in the browser's settings, then **Download** and choose to replace the file. Without that setting, the browser saves `… (1).png` and OBS keeps showing the old version.
4. OBS reloads the Image source within about a second. Check it in Preview (Studio Mode) before it is on Program.

If you change a graphic that is on air, the change appears live. For anything more than a figure or time, hide the source first, update it, check it, then show it again.

## 8. Connect OBS to Restream

1. In Restream (https://restream.io), sign in with the NWTT account details you were given and confirm that the **YouTube** and **X** channels are added and switched on. Channel setup is done by the NWTT account owner, not in Graphics Studio.
2. In OBS: **Settings → Stream** → Service: **Restream.io**.
3. Choose **Connect Account (recommended)** and sign in, **or** choose *Use Stream Key*, pick the nearest server and paste the key from Restream's dashboard.
4. Click **Apply**. Treat the stream key like a password: never show it on screen, screenshot it or paste it into chat. If it is exposed, reset it in Restream.

## 9. Test the YouTube and X outputs

Do this before every first broadcast on a new computer, and after changing any setting:

1. In Restream, set the stream title to something clearly marked as a test (for example `NWTT TEST — not live coverage`). Where the destination allows, use a private or unlisted setting. X broadcasts are public, so keep the test short or use a test account if NWTT has one.
2. In OBS, switch to **00 — Starting Soon**, click **Start Streaming** and check that the status bar shows no dropped frames (green square, steady bitrate).
3. In Restream, check that every channel shows as **live** and the preview shows your Starting Soon graphic.
4. Open the YouTube stream and the X post on another device. Check that the picture is sharp, the full 16:9 frame is visible, overlays are in the right place, and audio is present and in sync.
5. Walk through every scene 00–10 once. Check that no overlay covers anything important (captions, interpreters, map legends).
6. **Stop Streaming**, then delete or make private the test videos/posts on each platform.

## 10. Broadcast safety checklist

- Every number, zone, time and name on air comes from an **official source**, and the source is shown (fact panel, incident update or the NWTT Source Attribution overlay).
- No `[bracketed]` placeholders or SAMPLE badges are on air. The Studio's export warns about them; don't export "anyway" for a live graphic.
- Incident and evacuation graphics carry an **As of** time. Update it whenever the figures change.
- Social posts (Bluesky, Mastodon) in Incident Detection are **unverified** and are never put on a graphic automatically. Don't air them unless an official source confirms them.
- Keep overlays to the edges of the frame. The Studio warns when an overlay covers more than about 45% of the frame.
- Sample content in templates is clearly marked and must be replaced before broadcast.
- No API keys, stream keys or passwords in graphics, project files or scene names.

# Broadcaster Onboarding

A checklist for a new NWTT broadcaster setting up a computer to produce livestreams with **NWTT Graphics Studio**, **OBS Studio** and **Restream**. Allow about an hour, including a test stream. The full OBS reference is the [OBS Setup Guide](obs-setup-guide.md).

## What you need

- A Windows, macOS or Linux computer that can run OBS (a dedicated or recent GPU helps), a wired internet connection with at least 10 Mbps upload, a webcam/camera and a microphone.
- **Google Chrome** or **Microsoft Edge** (recommended). Graphics Studio works in other browsers, but only Chrome and Edge can save over an existing file in one click (needed to update graphics on air).
- From the NWTT production lead: the Graphics Studio address, the Restream sign-in (or access to the NWTT Restream workspace), and the current NWTT project files (`*.nsgs.json`), if any. **Credentials are shared privately, never in project files, graphics or public channels.**

## Step 1: Open Graphics Studio

1. Open the NWTT Graphics Studio address in Chrome or Edge: https://snazzy-gumdrop-5718eb.netlify.app (unless the production lead gives you another one). Bookmark it.
2. Check the sidebar shows **NWTT**. Branding comes from the site's shared settings, so every broadcaster's templates start identical. If you change **Brand Settings**, those changes stay on your computer only; leave them alone unless the production lead asks.
3. Know where your work lives: projects, templates and uploaded images are stored **in this browser on this computer only**. They are not shared with other broadcasters, and clearing the browser's site data deletes them. Keep copies of important projects as project files (Step 4).

## Step 2: Create your graphics folder

Create one folder that OBS will read from, for example `Documents/NWTT Graphics/`, with three subfolders:

```
NWTT Graphics/
  overlays/      transparent overlays (*_obs-overlay.png)
  fullscreen/    full-screen graphics and maps (*_obs-full.png)
  projects/      editable project files (*.nsgs.json)
```

## Step 3: Make the standard NWTT graphics

1. In Graphics Studio, go to **Broadcast Graphics**. The **NWTT broadcast kit** table at the top lists the 11 standard graphics, the OBS scene each belongs to, and which Export destination to use.
2. For each graphic you'll use, click its template button. This creates an editable project.
3. Open the **Fields** tab and fill in every value. Text in `[square brackets]` is a placeholder, and the **As of** time must come from the official source. Remove any **SAMPLE CONTENT** badge only after replacing the sample content.
4. **Export** → pick **OBS Studio — Overlay** or **OBS Studio — Full-screen graphic or map**, as the kit table says → **Render and verify** → check for the green **OBS-ready** tag → **Save to folder…** into `overlays/` or `fullscreen/`.

The three holding cards (**Starting Soon**, **Technical Difficulties**, **Broadcast Ending**) have no placeholders except the coverage title on Starting Soon, so make those first.

## Step 4: Share and receive editable projects

Graphics Studio has no shared server in Phase 1. Broadcasters exchange **project files**, which contain the full editable design and any images it uses:

- **Send:** Saved Projects → the project's **Export file** button (or Export Center → **Editable project file**). This saves `<Project name>.nsgs.json`. Share it through NWTT's usual file-sharing channel.
- **Receive:** Saved Projects → **Import project file…** → pick the `.nsgs.json` file. The project keeps its name, so its OBS file names match everyone else's. If you already have a project with that name, the import is named `… (imported)`: delete or rename your old one and rename the import back before exporting for OBS.
- Project files never contain stream keys or passwords. Don't add them.
- Map graphics re-render from their saved map settings on your computer. Live data layers keep the snapshot time they were saved with until you refresh them (⟳ in Map Studio).

## Step 5: Install and configure OBS

Follow [OBS Setup Guide](obs-setup-guide.md) sections 1–2: install OBS, then set the canvas to **1920×1080 at 30 FPS** with the recommended stream settings.

## Step 6: Build the NWTT scene collection

Follow section 5 of the OBS Setup Guide: create the `NWTT Coverage` scene collection with scenes **00 — Starting Soon** through **10 — Ending Coverage**, pointing each Image source at your `NWTT Graphics` folder. For the live map, capture the Sentinel tracker window (https://app.nationalwildfiretrackingteam.org) as described there.

## Step 7: Connect Restream and run a test

Follow sections 8–9 of the OBS Setup Guide: connect OBS to Restream, run a short, clearly labeled test stream, check YouTube and X, walk through every scene, then remove the test videos/posts.

## Step 8: Before every broadcast

- [ ] Starting Soon, Technical Difficulties and Ending exports are in `fullscreen/` and show in scenes 00, 09 and 10.
- [ ] Coverage graphics (fact panel, incident update, evacuation list, maps) carry current figures from an official source, the right **As of** time and a source line.
- [ ] No placeholders or SAMPLE badges (the Studio's export warns you).
- [ ] Sentinel is open at the production address, showing the layers you intend to air.
- [ ] Studio Mode is on, so you preview each change before it goes live.
- [ ] OBS shows no dropped frames on a short test, and Restream shows all channels connected.

## Getting help

- The **OBS Setup Guide** is always available in Graphics Studio's sidebar (**Live production → OBS Setup Guide**).
- For accounts, Restream channels or credentials, contact the NWTT production lead. Graphics Studio has no accounts or roles in Phase 1.

# Live Graphics in OBS (Browser Source)

Phase 2 lets a producer control the graphics an OBS computer shows, from anywhere. The producer works in **Live Broadcast Control** in Graphics Studio. Each broadcaster adds one **Browser Source** to OBS, and it shows whatever the producer has taken live, with no files to copy.

OBS still does scene switching and streaming, and Restream still does distribution. Graphics Studio only decides which approved graphic appears in that Browser Source. The PNG workflow from the [OBS Setup Guide](obs-setup-guide.md) remains the emergency fallback.

> Live Broadcast Control needs the NWTT shared cloud. If the sidebar says the cloud is not configured or unreachable, use the PNG workflow.

## How it works

| State | What it means | Who sees it |
|---|---|---|
| **Draft** | A graphic being edited in Graphics Studio. Editing never changes the output. | Editors |
| **Preview** | Rendered at 1920×1080 and waiting for review. | Session members only, never the audience |
| **Live** | A producer clicked **Take Live** or **Update Live** and confirmed. | Every OBS output of the session |

- What airs is exactly the image that was previewed: Graphics Studio renders it once, and Take Live publishes those same pixels.
- Only the session's **controller** can change what is live. Control moves only by **Transfer control**, or an administrator override, which is recorded in the audit log.
- Each change gets a sequence number. Outputs ignore anything older than what they already show, and they fetch the current state again after every reconnect.

## Roles

| Role | In Live Broadcast Control |
|---|---|
| Administrator | Everything, including taking over control (audited) and managing members |
| Producer | Create and run sessions, approve graphics, Preview, Take Live, Update Live, Clear Graphic, roll back, create OBS outputs |
| Graphics Editor | Send **approved** shared graphics to the preview of sessions they belong to. Cannot publish. |
| Broadcaster | See assigned sessions, create and watch the session's OBS outputs. Cannot change what is live. |
| Viewer | Watch sessions they are assigned to. No changes. |

The database enforces these roles. Hiding a button is never the only protection.

## Set up the OBS output

1. **Create a broadcast session.** A producer opens **Live Broadcast Control → New broadcast session**, enters a title (and incident name, if any), picks the broadcast type, assigns the broadcaster, and clicks **Create session**.
2. **Get OBS output access.** In the session, under **OBS outputs**, the producer or the assigned broadcaster enters a label (for example `Kyle — OBS laptop`), picks how long it lasts (4–72 hours, renewable) and clicks **Create OBS output**. Copy the URL. **This is the only time the full URL is shown.** Send it to the broadcaster privately, never in a public channel.
3. **Open OBS Studio** on the broadcasting computer, with the canvas at 1920×1080 and 30 FPS (OBS Setup Guide, section 2).
4. **Add a Browser Source.** In the scene, Sources → **+** → **Browser** → *Create new* → name it `NWTT Live Graphics`.
5. **Enter the output URL** in the URL field. It looks like `https://<studio address>/broadcast/output/<session id>#t=<64 characters>`.
6. **Set Width 1920 and Height 1080.** Leave "Custom CSS" as it is. Turn on **Shutdown source when not visible** only if you want the output to stop when the scene is hidden; it reconnects when shown again. Turn on **Refresh browser when scene becomes active** if you like; it does no harm.
7. **Check transparency.** Put the Browser Source at the **top** of the scene's source list. With nothing live, the source is fully transparent and the camera or map below shows through. The page never shows any text or controls.
8. **Test Take Live.** In the session, the producer picks a graphic → **Preview** → checks it → **Take Live** → confirms. It should appear in OBS within about a second (fade in). In the console, the output row should change to **showing current state**.
9. **Test Update Live.** Preview a different graphic → **Update Live** → confirm. OBS swaps to it (fade, or a cut if "Immediate cut" was chosen).
10. **Test Clear Graphic.** **Clear Graphic** → confirm. OBS goes transparent again.
11. **Test a network interruption.** On the OBS computer, unplug the network or turn off Wi-Fi for 30 seconds, then reconnect:
    - A holding card (for example Technical Difficulties) stays up during the outage.
    - A time-sensitive graphic (incident, evacuation, warning) is hidden if contact is lost for longer than its limit (1, 5 or 15 minutes, set at preview time). That stops outdated information from staying on air as if it were current.
    - After reconnecting, the output fetches the current state by itself within a few seconds.
12. **Test from a separate computer.** Repeat steps 8–10 with the producer on a different computer and network from the broadcaster (for example the producer at home and the broadcaster at the studio). The console's output health shows what the OBS computer actually rendered, not just what was published.

## During a broadcast

- **Preview first, always.** Check names, numbers, the source line and the "as of" time in the Preview panel before **Take Live**.
- **Time-sensitive graphics expire.** Incident, evacuation, severe-weather and breaking-news graphics get a default expiry of 1 hour (adjustable from 15 minutes to 24 hours) and a lost-contact limit of 5 minutes. When a graphic expires, every output hides it and the console shows **EXPIRED**. Publish an updated graphic or clear it.
- **Read the status lights.** The connection badge in the session header shows whether the console is getting real-time updates and how old its information is. Each output row shows **showing current state**, **updating…**, **connection unstable**, **not connected** or **render error**, as reported by the output itself.
- **Hand over control explicitly.** **Control and session → Transfer control** gives control to another producer. Both consoles update within a second.
- **Roll back** from **On-air history** to put a previously live graphic back, unless it has expired.
- **End session** clears the output, **revokes every OBS output URL** for that session and blocks any further publishing. Use it when the broadcast is over.

## Incidents

From an Incident page (Incident Detection), **Live fact panel** creates a Wildfire Fact Panel filled from **agency records only** (NIFC, CAL FIRE, NWS, Cal OES, FEMA IPAWS):
- Each value names its source, and the "as of" time is the agency record's own update time.
- Social media posts are never used.
- FEMA IPAWS evacuation messages are labelled as coming from a **delayed archive**, not a real-time feed.
- Check every value against the agency before sending it to preview.
- Incident feeds never change a live graphic automatically.

Producers can also click **Start broadcast session** on an incident page to create a session linked to that incident.

## Security

- **Treat the output URL like a password.** It can only *show* the session's current live graphic. It cannot publish, clear, preview or read anything else, but anyone who has it can watch that graphic.
- **The token is in the `#t=…` part of the URL**, which browsers never send to web servers or in Referer headers. Don't paste the URL into chat, screenshots or scene-collection exports you share.
- **It expires** (4–72 hours, renewable with **Renew 12 h**) and stops working when the session ends.
- **If a URL leaks:** open the session → **OBS outputs** → **Revoke** on that row. The output stops showing graphics within seconds and the URL never works again. Create a new output for the broadcaster and replace the URL in OBS (Browser Source → Properties → URL).
- **Never** paste Restream stream keys, passwords or Supabase keys into Graphics Studio. Graphics Studio never needs them.

## Fallback

- If Graphics Studio or the cloud is unavailable, OBS outputs keep the last approved graphic only while that's safe: holding cards stay up, while time-sensitive graphics are hidden at their expiry or lost-contact limit.
- **Live Broadcast Control → Download fallback holding cards (PNG)** saves Starting Soon, Technical Difficulties and Ending as `_obs-full.png` files. Keep them in scenes 00, 09 and 10 as Image sources (OBS Setup Guide, section 5), so a broadcaster always has safe full-screen cards without the cloud.
- The Phase 1 PNG export (Export → OBS Studio) keeps working with no sign-in.

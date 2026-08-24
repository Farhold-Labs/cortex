# Cortex Feature Backlog

Future feature ideas and enhancements for consideration.

---

## Completed

| Feature | Version | Date |
|---------|---------|------|
| App Rename & Nomenclature Overhaul | v2.0.0 | Jan 2026 |
| Crawl Bar: Pause + Drag Interaction | v2.0.3 | Jan 2026 |
| Privacy Hardening Phase 1: Data Minimization | v2.17.0 | Feb 2026 |
| Privacy Hardening Phase 2: Encrypted Metadata | v2.18.0–v2.22.0 | Feb 2026 |
| Privacy Hardening Phase 3: Social Graph Protection | v2.24.0 | Feb 2026 |
| Privacy Hardening Phase 4: Encrypted Crew Membership | v2.24.0 | Feb 2026 |
| Privacy Hardening Phase 5: Plausible Deniability | v2.27.0–v2.28.0 | Feb 2026 |
| Privacy Policy | v2.28.1 | Feb 2026 |
| Holiday Theme System | v2.20.0 | Feb 2026 |
| Public Portal | v2.55.0 | Jul 2026 |
| Instance Configuration & Notification Defaults | v2.65.0 - v2.66.0 | Aug 2026 |
| Account Invitations | v2.67.0 | Aug 2026 |
| Responsive Layout Pass (portrait tablets, narrow desktop header, composer) | v2.67.1 - v2.67.3 | Aug 2026 |
| Public Event Pages with Guest RSVP | v2.68.0 - v2.69.2 | Aug 2026 |
| Event Reminders (guest emails, escalating in-app, crawl-bar sweep) | v2.70.0 - v2.71.0 | Aug 2026 |
| Event Cards in Waves | v2.72.0 | Aug 2026 |

---

## Pending

### Add to Google Calendar from public event pages

The public event pages offer an `.ics` download, but no one-click **Add to Google Calendar** link — the in-app event modal has had one for a while.

The work is small because the hard part already exists:

- `buildGoogleCalendarUrl(ev)` (`server/server.js`) already builds the URL.
- It is currently attached in **one** place only: the authenticated `GET /api/events/:id`.
- Expose it from `publicEvent()` — the shaper used by every `/api/public/events/*` response — so the public pages receive it too.
- Add the button beside *"+ Add to calendar"* in `PublicEventsView.jsx`.

Note the URL must respect the `?date=` occurrence of a repeating event, the way the `.ics` route already does; otherwise every occurrence of a weekly event would add the series anchor to someone's calendar.

---

*"We have done the impossible, and that makes us mighty."*

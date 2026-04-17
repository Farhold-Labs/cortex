# Cortex - Outstanding Features & Future Roadmap

**Last Updated:** April 2026
**Current Version:** v2.47.2

This document tracks planned but not-yet-implemented features. For completed features, see [CHANGELOG.md](CHANGELOG.md).

---

## Completed Features (v1.5.0 - v2.47.2)

| Feature | Version |
|---------|---------|
| Message Reactions, Search, Typing Indicators, Desktop Notifications | v1.5.0 |
| PWA Support, Read Receipts | v1.6.0 |
| Contact Requests, Group Invitations, User Blocking, GIF Search | v1.7.0 |
| Profile Images, Bio, Image Upload, Rich Media Embeds, SQLite, Push Notifications | v1.8.0 |
| Threading Improvements, Mobile Gestures, Report System, API Docs | v1.9.0 |
| Pings Architecture, Focus View, Threading | v1.10.0 |
| Notification System, Wave List Badges | v1.11.0 |
| CSS Variable Themes | v1.12.0 |
| Federation (Server-to-Server, HTTP Signatures, Federated Users, Message Queue) | v1.13.0 |
| Email Service, Password Reset, TOTP/Email MFA, Activity Log, Encryption at Rest | v1.14.0 |
| Alert Pings, Web Crawl Feature | v1.15.0 |
| Ping Sharing, Social Previews, Public Ping View | v1.17.0 |
| Compact UI, @ Mention Autocomplete, PWA App Badge | v1.17.x |
| Session Management, Token Revocation, Data Export, Account Deletion, HSTS | v1.18.0 |
| Role-Based Access Control (Admin / Moderator / User) | v1.20.0 |
| Cortex Rebrand (Nomenclature Overhaul) | v2.0.0 |
| End-to-End Encryption (ECDH P-384 + AES-256-GCM), Bot System | v2.1.0 |
| Wave Categories, Pinned Waves, Drag-and-Drop Organization | v2.2.0 |
| Voice Calling (WebSocket → LiveKit) | v2.3.0–v2.5.0 |
| Architecture Refactoring, Dockable Call Window | v2.6.0–v2.6.1 |
| Voice/Video Messages, Screen Sharing in Calls | v2.7.0 |
| Random Video Feed (Discover Tab) | v2.8.0 |
| Profile Waves for Video Posting | v2.9.0 |
| Low-Bandwidth Mode | v2.10.0 |
| Custom Theme System (Editor, Gallery, Sharing) | v2.11.0 |
| S3-Compatible Object Storage | v2.13.0 |
| Jellyfin/Emby Media Server Integration | v2.14.0 |
| Plex Media Server Integration (OAuth, HLS Transcoding) | v2.15.0 |
| Outgoing Webhooks (Discord, Slack, Teams) | v2.15.5 |
| Mobile App Support (Expo Push, Deep Linking) | v2.16.0 |
| Privacy Hardening Phase 1: Data Minimization | v2.17.0 |
| Encrypted Contact Lists | v2.18.0 |
| Holiday Theme System | v2.20.0 |
| Encrypted Wave Participation | v2.21.0 |
| Encrypted Push Subscriptions | v2.22.0 |
| Collapsible Messages | v2.23.0 |
| Encrypted Crew Membership | v2.24.0 |
| UI Personality: Firefly Easter Eggs | v2.25.0 |
| Federation Theming: The Verse | v2.26.0 |
| Plausible Deniability — Ghost Protocol | v2.27.0 |
| Running Dark — Federation Cover Traffic | v2.28.0 |
| Privacy Policy | v2.28.1 |
| Session Expiry Monitoring & Renewal (JWT expiry detection, renewal modal, countdown timer) | v2.29.0 |
| Electron Desktop App (Windows/Linux native wrapper, auto-updater scaffolding) | v2.30.0 |
| Capacitor Mobile Apps (Android + iOS, FCM/APNs push, haptics) | v2.31.0 |
| Notification Preference System (per-type levels, per-user push throttle, suppress while focused) | v2.32.0 |
| General File Attachment Support (PDF, docs, ZIPs; download cards, drag-and-drop) | v2.33.0 |
| Electron Right-Click Context Menus (copy/paste, spell check, image actions) | v2.33.1 |
| Tabbed Waves (multi-wave tabs, background open, unread badges on tabs) | v2.35.0 |
| Collapsible Wave List Sidebar (Ctrl+B toggle, smooth animation) | v2.35.0 |
| macOS Electron Build Target (DMG/ZIP, hardened runtime, entitlements) | v2.35.0 |
| Wave Topics (creator-set topic displayed in header and wave list) | v2.36.0 |
| Pending Sent Crew Invitations (view and cancel outgoing invitations) | v2.36.0 |
| Reaction Notifications (in-app and push when someone reacts to your ping) | v2.41.0 |
| Scroll-to-Ping Navigation (notification and search clicks navigate to older messages) | v2.41.0 |
| Auto-Focus Message Composer (desktop auto-focus on wave open/thread open/reply) | v2.42.0 |
| Nomenclature Cleanup (droplet → ping, ripple/burst → thread across all layers) | v2.42.0 |
| Wave Posting Tokens (self-service per-wave API keys for bots and scripts) | v2.43.0 |
| Wave Members Visible to All Participants (not gated by wave creator) | v2.43.0 |
| Session Duration Preference (persists across logouts, pre-fills on next login) | v2.44.0–v2.45.2 |
| Electron Bundled Full App (local React bundle via app:// protocol, CORS bridging) | v2.45.0 |
| Android Release Signing (key.properties + signingConfig, no manual jarsigner) | v2.45.0 |
| Session UX: Proportional Warning Window, Silent Auto-Renewal, Grace Period Re-auth | v2.46.0 |
| New Auth Endpoints: POST /api/auth/renew (silent), POST /api/auth/reauth (grace period) | v2.46.0 |
| Calendar (events, recurring, RSVP, reminders, iCal/Google Calendar export, webcal feed) | v2.47.0 |
| People Nav Consolidation (Contacts + Crews merged into single People nav item) | v2.47.0 |
| Bot Post Notifications (createPingNotifications now called for bot/posting token posts) | v2.47.1 |
| Bot Owner Notifications, Posting Tokens Admin Panel, Electron Media URL Fix | v2.47.2 |

---

## Outstanding Features

### 1. Export Wave as PDF/HTML
**Complexity:** Medium

Export entire waves for archival or sharing.

- Export wave with all pings, attachments, and media
- Formatted HTML or PDF output preserving threading structure
- Include participant metadata
- `GET /api/waves/:id/export?format=pdf|html`

---

### 2. Advanced Search Filters
**Complexity:** Medium

Enhanced search with advanced filters and boolean operators.

- Boolean operators: AND, OR, NOT
- Exact phrase matching with quotes
- Filter by: author, date range, wave privacy level, has:media, has:reactions
- Sort by: relevance, date, author
- Saved search queries

---

### 3. End-to-End Encryption for Federation
**Complexity:** High

Extend E2EE to federated messages between servers.

- Key exchange between federated users across different servers
- Secure key distribution via federation protocol
- Handle key rotation for multi-server participants
- **Current status:** Local E2EE works (v2.1.0), federated waves send ciphertext but keys are not exchanged between servers

---

## Future Considerations

### Advanced API & Integrations
- OAuth Provider: Third-party app authentication
- GraphQL API: Alternative to REST

### Advanced Moderation
- AI Content Filtering: Automatic spam/harassment detection
- Auto-moderation Rules: Regex filters, word blacklists
- Appeal System: Users can appeal moderation decisions

### Federation Enhancements
- Server Discovery: Automatic discovery of federation partners
- Public Directory: Opt-in public server listing
- Relay Servers: Message delivery through intermediaries

### TTRPG (Table Top Role Playing Games)
Full-featured TTRPG support for running campaigns directly in Cortex.

**Dice Rolling:**
- Inline dice notation (e.g., `/roll 2d20+5`, `/roll 4d6kh3`)
- Support for all standard dice (d4, d6, d8, d10, d12, d20, d100)
- Advantage/disadvantage, keep highest/lowest
- Dice roll history and statistics
- Secret GM rolls

**Interactive Maps:**
- Upload and share battle maps
- Token placement and movement
- Fog of war / line of sight
- Grid overlay (square/hex)
- Real-time synchronized movement for all players

**Character Database:**
- Character sheet storage and management
- Support for multiple game systems
- Track HP, stats, inventory, abilities
- Share character sheets with party members

**Rules Database:**
- Built-in rules for open source RPG systems (D&D 5e SRD, Pathfinder, Fate Core, Dungeon World, etc.)
- Searchable rules reference
- Homebrew rules support

---

## Priority Matrix

| Feature | Priority | Complexity | User Impact |
|---------|----------|------------|-------------|
| Export Wave | Low | Medium | Low |
| Advanced Search | Low | Medium | Medium |
| E2E for Federation | Medium | High | High |
| OAuth Provider | Low | Medium | Medium |
| TTRPG System | Low | Very High | High |

---

*This document will be updated as features are implemented and new requests come in.*

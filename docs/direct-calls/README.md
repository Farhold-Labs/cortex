# Direct calls: ring a contact

Decided 2026-11-22. **Phase 1 built in v2.145.0**; phases 2 and 3 not built.

## Why

A video call today is a room in a wave. Someone starts it, and anyone in the wave can join. Nothing tells the others it has started: there is no ring, no push, and in a private wave not even a banner. People expect what a phone does: you call someone, it rings, they answer or decline.

So Cortex gets a second kind of call, alongside the wave calls, which stay as they are (the v2.144 layout). A **direct call** rings one person and lives outside waves.

## Decisions

| Question | Decision |
|----------|----------|
| Who can ring whom | **Contacts only.** You may ring someone only when each of you has the other as a contact. Blocks apply both ways. No one can ring a stranger. |
| How far the ring reaches | **A real phone-style ring.** With the app open: a full-screen incoming call with a ringtone, ANSWER and DECLINE. With it closed: on Android, a call notification that rings and lights the lock screen like a phone call. Web push elsewhere. |
| What is kept | **A call history, no wave.** Who, when, how long, and whether it was answered, missed or declined. Only the two people see it. Nothing is posted into any wave. |
| Wave calls | **Also announced.** When a call starts in a wave you are in: a "Call in progress, JOIN" banner in the wave and a mark on its row in the list, plus a quiet push (no ring). |

## How a call goes

```
caller taps CALL ──► server checks contacts + blocks ──► call row: ringing
                                                          │
            ┌──────────── incoming_call over WebSocket ◄──┤ to every session of the callee
            │             + native push (ring) / web push │
            ▼                                             │
   callee ANSWERS on one device ──► answered ─────────────┼──► both join LiveKit room call-<id>
   callee DECLINES ──► declined                           │    other devices stop ringing
   no answer in 45 s ──► missed (missed-call notice)      │
   caller hangs up first ──► cancelled (ringing stops)    │
   callee already in a call ──► busy                      │
   either hangs up after answering ──► ended (duration)   ▼
```

- **The server holds the call's state** (`direct_calls`: caller, callee, kind audio/video, state, rang_at, answered_at, ended_at). It is the only judge of who may join: the LiveKit token for `call-<id>` is issued only to the two people, and only while the call is ringing or answered.
- **One answer wins.** The callee's phone, browser and desktop all ring; answering on one sends `call_answered_elsewhere` to the rest.
- **Ringing stops for everyone** when the call is answered, declined, cancelled or times out. A ring that reaches a device late (a slow push) checks the state first and shows a missed call instead.
- **An audio call can turn on video** and the reverse, as in a wave call.
- **The call screen** is the v2.144 stage (the other person fills the screen, you are the preview) with: mute, camera, **flip camera** (front/back, phones only), speaker, hang up.

## Building it, in phases

### Phase 1: ringing in the app and by push (server deploy only)
- **Built in v2.145.0.** `direct_calls` table and the state machine above, with tests: contacts-only, blocks both ways, only the two people get a token, timeout, busy, one answer wins, a cancelled call can't be answered.
- CALL and VIDEO CALL on a contact (and on a person's profile).
- The incoming call screen with a ringtone, ANSWER and DECLINE, over every page of the app.
- Push for an incoming call: web push, and the existing native push for the Android app as an ordinary notification ("Mal is calling"). Tapping it opens the call.
- Missed-call notice. Call history under Contacts.
- Flip camera in the call screen.
- Wave calls announced: banner in the wave, mark in the list, quiet push.

### Phase 2: the Android lock-screen ring (needs a new APK)
- **Built in v2.146.0.** Only an app that registers with `call-ring` gets the data message, so older APKs keep the phase 1 notification. DECLINE from the ring uses a per-call token (`decline-from-ring`). Not yet tried on a phone at the time of the release.
- A high-priority FCM data message for an incoming call, handled by a small native service in the app (alongside `CortexOrientation`), which posts an Android **call-style notification** with a full-screen screen, ringtone and vibration, ANSWER and DECLINE. It rings with the screen off and over the lock screen.
- ANSWER opens the app straight into the call; DECLINE tells the server without opening the app.
- Needs the `USE_FULL_SCREEN_INTENT` permission. Since Android 14, Google Play lets only calling and alarm apps use it, and asks apps to declare it. Cortex placing calls qualifies, but the declaration has to be made.
- Only farhold's app has native push (it is built for farhold), so on PMP the ring reaches a closed app as a web push.

### Phase 3: iPhone
CallKit and VoIP pushes need the App Store app, which doesn't exist yet. Until then an iPhone gets the in-app ring and web push (Safari 16.4+, added to the home screen).

## Not in this
- **Calling people on other servers.** Contacts on other servers can't be rung yet; it needs signed call messages between servers and a LiveKit project both can use.
- **Group direct calls.** A call to several people is a wave call.
- **Calls end-to-end encrypted against LiveKit.** Voice channels already do this (v2.119.0) and direct calls should follow, but not in phase 1.

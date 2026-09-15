# Git-history secret audit

First performed 2026-09-15. Closes the last open item from the
[v2.86.0 review](CODE-REVIEW-2026-09-09.md), whose §8 recorded that no
Git-history secret audit had ever been done.

**Verdict: no live credential has ever been committed to this repository.**

This is the one class of problem a later release cannot fix. A bug ships a
patch; a key in public history is public from the moment it is pushed, and stays
public in every clone and fork regardless of what the current tree says.

## Coverage

| | |
|---|---|
| Commits | 1,667 |
| Local branches | 64 |
| Remote-tracking refs | 107 |
| Tags | 160 |
| Origin heads missing locally | **0** — every branch on the remote was scanned |
| Added lines examined | ~216,000 |
| Unreachable objects | 44, including 14 dangling blobs |

Every *added* line on every ref was examined, so a secret committed and later
removed is still caught — deleting a file in a subsequent commit does not remove
it from history.

## Method

Two passes, because one is not enough for this project.

**Pass 1 — known credential formats.** PEM private-key blocks, service-account
JSON, `AKIA…`, `ghp_…`, `xox[baprs]-…`, `re_…`, `SG.…`, `AIza…`, Stripe keys,
npm tokens, and Cortex's own `fh_bot_` / `cx_bot_` / `bot_` keys.

**Pass 2 — bare env-style assignments with high-entropy values.** This is the
pass that matters here. Cortex's real exposure is GIPHY, Klipy, Finnhub and
OpenWeatherMap keys, which are plain alphanumeric strings with no prefix at all.
Pass 1 cannot see them. A scanner that only knew famous formats would have
reported "all clear" while being blind to every key this project actually uses.

Both passes discard placeholders, and values that are only lowercase words
joined by hyphens (`certificate-password`, `your-store-password`) are treated as
documentation rather than credentials.

Output is redacted by construction: findings name the pattern, commit and path,
and mask the value. A finding is something to go and rotate, not something to
paste into a chat log or a CI transcript.

## Findings

### 1. A VAPID keypair in the README — committed, not live

`README.md`, commit `273dd6473` (2025-12-11), "Add VAPID key generation
documentation to README". Example output of `web-push generate-vapid-keys` was
pasted under "This outputs something like:" — a real generated keypair, at the
correct lengths for P-256 (87-character public, 43-character private).

**Not a live key.** The committed public key was compared by hash against the
`VAPID_PUBLIC_KEY` in use on all three environments — dev, farhold and PMP — and
matches none of them. It was generated for the documentation and discarded. It
is also no longer present in the README at HEAD.

**No rotation required.** This matters, because rotating VAPID keys invalidates
every existing push subscription, so a reflexive "rotate everything" would have
silently broken push for every user to fix a non-problem.

Recorded in `tools/secret-scan-baseline.txt`.

### 2. A copy of a live `.env` in an unreachable object — never committed

Dangling blob `71ed1d941`, 9,304 bytes, 45 assignments: a copy of the **dev
box's real `server/.env`**, including live values for `VAPID_PRIVATE_KEY`,
`LIVEKIT_API_SECRET`, `EMAIL_ENCRYPTION_KEY`, `WAVE_PARTICIPATION_KEY`,
`SMTP_PASS` and several provider keys. Its VAPID hashes match the dev box's
current keys exactly.

This is the near-miss `.gitignore` already describes: *"a stray `.env.bak-*`
copy was staged once while working on v2.80.0 and contained 26 live secrets."*

**It was never committed.** The blob is not inside any commit — reachable or
unreachable. It was staged with `git add`, then unstaged, leaving a loose object
in the local store. Git transfers only objects reachable from commits, so **it
was never pushed and GitHub never received it.**

Exposure is therefore limited to the dev box's own `.git/objects`, on a machine
that already holds the same secrets in `server/.env` by necessity. The marginal
risk is close to zero, but the object is worth removing:

```
git gc --prune=now      # local only; discards unreachable objects
```

**No rotation required.**

### 3. Placeholders (not findings)

`certificate-password`, `your-store-password`, `your-key-password`,
`"current-password"` in docs, and invented fixture passwords in
`tests/wave-roles.test.cjs` and `tests/ws-heartbeat.test.cjs`. The scanner's
placeholder rules were extended to recognise this shape rather than baselining
them — baselining a false positive teaches the next reader that a noisy line was
once judged a real secret and accepted.

## Keeping it true

A one-off audit is true on the day it runs. The scan therefore ships as
`tools/secret-scan.py` and runs as a CI job on every pull request:

```bash
python3 tools/secret-scan.py              # scan; exit 1 on anything new
python3 tools/secret-scan.py --dangling   # also inspect unreachable objects (local only)
python3 tools/secret-scan.py --update-baseline
```

CI checks out with `fetch-depth: 0`, because the default shallow clone would
pass by not fetching the commits where a leak would live — a green tick meaning
"I did not look".

`--dangling` is deliberately not used in CI: unreachable objects are a
local-clone artefact and never travel.

**Never add a line to `tools/secret-scan-baseline.txt` without first
establishing that the value is not live**, the way the VAPID keypair above was
checked against all three environments. A baseline is a record of things
verified harmless, and it stops being useful the moment it becomes a place to
put things that were merely inconvenient.

## What this audit does not cover

- **Secrets never matching a credential shape.** A password that looks like an
  ordinary English phrase, or a key pasted into prose rather than an assignment,
  can pass both passes.
- **Anything already leaked elsewhere** — a key in a screenshot, a chat message,
  an issue comment, or a CI log. This audit reads git history only.
- **GitHub's own unreachable-object store.** Force-pushed commits can remain
  reachable by SHA on GitHub even after they leave the branch. Nothing in this
  repository's history required a force-push rewrite, so nothing was expected
  there, but it was not independently verified.

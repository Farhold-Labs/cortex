#!/usr/bin/env python3
"""Scan git history for committed credentials.

    python3 tools/secret-scan.py              # scan, report, exit 1 on new findings
    python3 tools/secret-scan.py --dangling   # also scan unreachable objects
    python3 tools/secret-scan.py --update-baseline

The v2.86.0 security review noted that no git-history secret audit had ever been
performed. This is that audit, kept as a tool rather than a one-off, because
"we checked once in September" stops being true the moment someone pastes a key
into a commit.

TWO PASSES, because one is not enough for this project:

  1. Known credential FORMATS — AKIA…, ghp_…, re_…, PEM blocks, service-account
     JSON. Catches anything with a recognisable shape.

  2. Bare env-style assignments with high-entropy values. This project's real
     exposure is GIPHY, Klipy, Finnhub and OpenWeatherMap keys, which are plain
     alphanumeric strings with no prefix at all — pass 1 cannot see them, and a
     scanner that only knows famous formats would have reported "all clear"
     while missing every key Cortex actually uses.

Output is redacted by construction: findings name the pattern, commit and path,
and mask the value. A finding is something to go and rotate, not something to
paste into a chat log or a CI transcript.

Accepted findings live in tools/secret-scan-baseline.txt as pattern:path:hash
so the gate stays quiet about what has already been judged, and speaks up about
anything new. Never add a line to that file without establishing that the value
is not live.
"""
import argparse
import collections
import hashlib
import math
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASELINE = ROOT / "tools" / "secret-scan-baseline.txt"

FORMAT_PATTERNS = [
    ("private_key_block",    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("service_account_json", re.compile(r'"type"\s*:\s*"service_account"')),
    ("aws_access_key",       re.compile(r"AKIA[0-9A-Z]{16}")),
    ("github_pat",           re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}")),
    ("github_fine_pat",      re.compile(r"github_pat_[A-Za-z0-9_]{30,}")),
    ("slack_token",          re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}")),
    ("resend_key",           re.compile(r"re_[A-Za-z0-9]{8,}_[A-Za-z0-9]{10,}")),
    ("sendgrid_key",         re.compile(r"SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}")),
    ("google_api_key",       re.compile(r"AIza[0-9A-Za-z_-]{35}")),
    ("stripe_key",           re.compile(r"[sr]k_(?:live|test)_[A-Za-z0-9]{16,}")),
    ("npm_token",            re.compile(r"npm_[A-Za-z0-9]{36}")),
    ("cortex_bot_key",       re.compile(r"(?:fh_bot_|cx_bot_|bot_)[A-Za-z0-9]{24,}")),
]

# Pass 2: NAME=value where the name smells like a credential and the value is
# dense enough to be one.
ASSIGN = re.compile(
    r"^\s*(?:export\s+)?([A-Z][A-Z0-9_]{2,40}(?:KEY|SECRET|TOKEN|PASSWORD|PASS|SALT|DSN|CREDENTIAL))"
    r"\s*[:=]\s*[\"']?([A-Za-z0-9+/=_\-\.]{16,})[\"']?\s*$"
)

PLACEHOLDER = re.compile(
    r"(?i)(your|example|placeholder|change[_-]?me|xxx+|dummy|sample|fake|test[_-]?only|redacted|"
    r"insert|replace|here|abcdef|123456|generate|localhost|\.\.\.|s3cr3t|my[_-]secret)"
)

# A value that is nothing but lowercase english words joined by hyphens —
# `certificate-password`, `your-store-password` — is documentation, not a
# credential. Real keys are dense and mixed-case. This belongs in the detector
# rather than the baseline: baselining a false positive teaches the next reader
# that a known-noisy line was once judged a real secret and accepted.
WORDY_PLACEHOLDER = re.compile(r"^[a-z]+(?:-[a-z]+)+$")


def entropy(s: str) -> float:
    if not s:
        return 0.0
    counts = collections.Counter(s)
    n = len(s)
    return -sum((c / n) * math.log2(c / n) for c in counts.values())


def fingerprint(pattern: str, path: str, value: str) -> str:
    return f"{pattern}:{path}:{hashlib.sha256(value.encode()).hexdigest()[:16]}"


def load_baseline() -> set:
    if not BASELINE.exists():
        return set()
    out = set()
    for line in BASELINE.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            out.add(line)
    return out


def scan_history():
    """Yield findings from every added line on every ref."""
    proc = subprocess.Popen(
        ["git", "-C", str(ROOT), "log", "--all", "-p", "--no-color",
         "--format=%H%x00%ad%x00%s", "--date=short"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        text=True, errors="replace", bufsize=1,
    )
    commit = date = subject = path = ""
    seen = set()
    for raw in proc.stdout:
        line = raw.rstrip("\n")
        if line.count("\x00") == 2 and re.match(r"^[0-9a-f]{40}\x00", line):
            commit, date, subject = line.split("\x00")
            continue
        if line.startswith("+++ b/"):
            path = line[6:]
            continue
        if not line.startswith("+") or line.startswith("+++"):
            continue
        body = line[1:]

        for name, rx in FORMAT_PATTERNS:
            m = rx.search(body)
            if m and not PLACEHOLDER.search(body):
                value = m.group(0)
                fp = fingerprint(name, path, value)
                if fp not in seen:
                    seen.add(fp)
                    yield (name, commit[:9], date, path, value, subject[:60], fp)
                break
        else:
            m = ASSIGN.match(body)
            if not m:
                continue
            var, value = m.group(1), m.group(2)
            if PLACEHOLDER.search(value) or PLACEHOLDER.search(body):
                continue
            if WORDY_PLACEHOLDER.match(value):
                continue
            if entropy(value) < 3.2 or len(set(value)) < 10:
                continue
            fp = fingerprint(var, path, value)
            if fp not in seen:
                seen.add(fp)
                yield (var, commit[:9], date, path, value, subject[:60], fp)
    proc.wait()


def scan_dangling():
    """Unreachable objects: where an amended or unstaged mistake goes to hide.

    These were never pushed if they are not inside a commit, but they sit in
    .git/objects in the clear, so they are worth knowing about.
    """
    listing = subprocess.run(
        ["git", "-C", str(ROOT), "fsck", "--unreachable", "--dangling", "--no-progress"],
        capture_output=True, text=True,
    ).stdout
    for entry in listing.splitlines():
        parts = entry.split()
        if len(parts) != 3 or parts[1] != "blob":
            continue
        sha = parts[2]
        content = subprocess.run(
            ["git", "-C", str(ROOT), "cat-file", "blob", sha],
            capture_output=True, text=True, errors="replace",
        ).stdout
        for body in content.splitlines():
            for name, rx in FORMAT_PATTERNS:
                m = rx.search(body)
                if m and not PLACEHOLDER.search(body):
                    yield (name, sha[:9], "dangling", "<unreachable blob>", m.group(0), "never committed", None)
                    break
            else:
                m = ASSIGN.match(body)
                if (m and not PLACEHOLDER.search(m.group(2))
                        and not WORDY_PLACEHOLDER.match(m.group(2))
                        and entropy(m.group(2)) >= 3.2):
                    yield (m.group(1), sha[:9], "dangling", "<unreachable blob>", m.group(2), "never committed", None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dangling", action="store_true", help="also scan unreachable objects (local only)")
    ap.add_argument("--update-baseline", action="store_true", help="record current findings as accepted")
    args = ap.parse_args()

    baseline = load_baseline()
    findings = list(scan_history())
    new = [f for f in findings if f[6] not in baseline]

    print(f"scanned all refs; {len(findings)} finding(s), {len(baseline)} baselined, {len(new)} new")

    if args.update_baseline:
        lines = ["# Accepted secret-scan findings. pattern:path:sha256-prefix",
                 "# Only add a line here once you have established the value is NOT live.", ""]
        lines += sorted(f[6] for f in findings if f[6])
        BASELINE.write_text("\n".join(lines) + "\n")
        print(f"baseline written with {len(findings)} entr(ies)")
        return 0

    for name, commit, date, path, value, subject, _fp in new:
        masked = value[:4] + f"…[{len(value)} chars]"
        print(f"\n  NEW  {name}  {commit}  {date}\n       path={path}\n       value={masked}\n       commit: {subject}")

    if args.dangling:
        dangling = list(scan_dangling())
        blobs = {d[1] for d in dangling}
        print(f"\ndangling objects: {len(dangling)} credential line(s) in {len(blobs)} unreachable blob(s)")
        for sha in sorted(blobs):
            print(f"  blob {sha} — never committed, so never pushed; prune with `git gc --prune=now`")

    if new:
        print("\nFAIL: new credential-shaped values found in history.")
        print("Rotate anything live, then baseline it only if it is provably not.")
        return 1
    print("\nOK: no new findings.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

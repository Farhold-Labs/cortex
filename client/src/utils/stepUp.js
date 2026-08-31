// Step-up re-authentication (v2.75.0).
//
// Sessions now last months, so "holds a valid session" is much weaker evidence
// of "is the account owner" than it used to be. Sensitive actions ask for the
// password again, in the moment.
//
// The proof is held in memory only. Persisting it would defeat the point: the
// whole idea is that it does not survive walking away from the machine.

let stepUpToken = null;
let expiresAt = 0;
let prompt = null;      // set by the modal host
let pending = null;     // single-flight, same reasoning as token refresh

export function setStepUpPrompt(fn) {
  prompt = fn;
}

export function getStepUpToken() {
  if (!stepUpToken || Date.now() >= expiresAt) return null;
  return stepUpToken;
}

export function storeStepUpToken(token, minutes) {
  stepUpToken = token;
  // Expire locally slightly early so we prompt rather than send a token the
  // server is about to reject.
  expiresAt = Date.now() + Math.max(0, (minutes || 15) * 60 * 1000 - 5000);
}

export function clearStepUp() {
  stepUpToken = null;
  expiresAt = 0;
}

// Ask the user for their password and exchange it for a step-up token.
// Resolves null if they cancel. Concurrent callers share one prompt.
export function requestStepUp(reason) {
  const existing = getStepUpToken();
  if (existing) return Promise.resolve(existing);
  if (pending) return pending;
  if (!prompt) return Promise.resolve(null);

  pending = prompt(reason)
    .then((token) => token || null)
    .finally(() => { pending = null; });
  return pending;
}

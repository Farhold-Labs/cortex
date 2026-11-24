/**
 * E2EE Context and Hooks (v1.20.2)
 *
 * Manages end-to-end encryption state and operations.
 * Integrates with AuthContext to provide E2EE after login.
 *
 * Password-based E2EE: Encryption key derived from login password.
 * Session caching: Private key cached with configurable TTL.
 *   - 'session': sessionStorage (cleared when browser closes)
 *   - 'days7'/'days30': localStorage with expiry (persists across restarts)
 */

import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import * as crypto from './crypto.js';
import { emptyKeyRecords, noteKey, acknowledgeKeyChange as ackKeyChange, unacknowledgedChanges, mergeKeyRecords,
  markVerified, unmarkVerified, keyStanding } from './src/utils/keyRecords.js';

// ============ Constants ============
const WAVE_KEY_CACHE_MAX = 100;  // Max cached wave keys

// Session storage keys (cleared when browser closes)
const SESSION_KEY_STORAGE = 'farhold_e2ee_session_key';
const SESSION_DATA_STORAGE = 'farhold_e2ee_session_data';
const SESSION_PUBLIC_KEY = 'farhold_e2ee_public_key';

// Persistent storage keys (localStorage with TTL)
const PERSISTENT_KEY_STORAGE = 'farhold_e2ee_persistent_key';
const PERSISTENT_DATA_STORAGE = 'farhold_e2ee_persistent_data';
const PERSISTENT_PUBLIC_KEY = 'farhold_e2ee_persistent_public';
const PERSISTENT_EXPIRY = 'farhold_e2ee_persistent_expiry';
const PERSISTENT_DURATION = 'farhold_e2ee_persistent_duration';  // remembered duration mode (e.g. 'auto')

// Remember duration options (in milliseconds)
// 'auto' is handled separately — it reads the JWT expiry and matches session length
export const REMEMBER_DURATIONS = {
  session: 0,  // Use sessionStorage (clears when app closes)
  days7: 7 * 24 * 60 * 60 * 1000,
  days30: 30 * 24 * 60 * 60 * 1000,
};

function getJWTRemainingMs(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return Math.max((payload.exp * 1000) - Date.now(), 0);
  } catch {
    return 0;
  }
}

// How long "until my session expires" should actually last (v2.75.0).
//
// This used to read the JWT's exp, which was right when the JWT *was* the
// session. Now the access token lives about an hour and rotates, so reading it
// would re-lock E2EE hourly — turning a feature meant to reduce interruptions
// into a much worse one. The session's real end is the refresh token's expiry,
// which the server sends on login and on every rotation.
function getSessionRemainingMs(token) {
  try {
    const stored = localStorage.getItem('farhold_session_expires')
      || sessionStorage.getItem('farhold_session_expires');
    if (stored) {
      const at = Date.parse(stored);
      if (Number.isFinite(at)) return Math.max(at - Date.now(), 0);
    }
  } catch { /* fall through to the token */ }
  // No session expiry recorded: a legacy long-lived JWT, or a session-only
  // login. In both cases the access token really is the session.
  return getJWTRemainingMs(token);
}

// ============ Context ============
const E2EEContext = createContext(null);

export const useE2EE = () => {
  const context = useContext(E2EEContext);
  if (!context) {
    throw new Error('useE2EE must be used within E2EEProvider');
  }
  return context;
};

// ============ Provider ============
export function E2EEProvider({ children, token, API_URL }) {
  // E2EE State
  const [e2eeStatus, setE2eeStatus] = useState(null);  // null = loading, { enabled: bool }
  const [privateKey, setPrivateKey] = useState(null);  // CryptoKey in memory only
  const [publicKey, setPublicKey] = useState(null);    // CryptoKey
  const [publicKeyBase64, setPublicKeyBase64] = useState(null);  // For API calls
  const [needsPassphrase, setNeedsPassphrase] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState(null);

  // Wave key cache (waveId -> { waveKey: CryptoKey, version: number })
  const waveKeyCacheRef = useRef(new Map());
  // In-flight key work, shared (v2.117.2). Opening an encrypted wave decrypts
  // its 50 pings in parallel, and with a cold cache each one fetched and
  // unwrapped the key itself: farhold's logs showed 50 simultaneous
  // /keys/all requests per open (100–150 on some), queued six at a time over
  // HTTP/1.1. Now concurrent callers wait on the one request.
  const waveKeyInFlightRef = useRef(new Map());     // waveId -> Promise<CryptoKey|null>
  const versionKeyInFlightRef = useRef(new Map());  // `${waveId}:${v}` -> Promise<CryptoKey|null>
  const keyListInFlightRef = useRef(new Map());     // waveId -> Promise<keys[]|null>
  // Bumped whenever cached keys are dropped (sign-out, rotation,
  // invalidation), so work that was already in flight can't write a key back
  // into a cache that has just been cleared.
  const keyGenerationRef = useRef(0);
  const sessionRestoreAttempted = useRef(false);
  // The unlocked key, readable from checkE2EEStatus without re-creating it.
  // The gate that calls checkE2EEStatus unmounts whenever the app leaves its
  // shell for a full-page route (/about, /watch, /broadcast, /recording) and
  // re-checks when it comes back. With the key still in memory, that re-check
  // must not ask for the passphrase again (v2.114.1).
  const privateKeyRef = useRef(null);
  useEffect(() => { privateKeyRef.current = privateKey; }, [privateKey]);

  // Keys seen for other people (v2.143.0): { records, version, ready: Promise }.
  const keyRecordsRef = useRef(null);
  const keyRecordsSaveRef = useRef(Promise.resolve());
  const [keyChanges, setKeyChanges] = useState([]);  // [{ personId, changedAt, verificationLost }]
  // Bumped whenever the record changes, so fingerprint views re-read it (v2.149.0).
  const [keyRecordsTick, setKeyRecordsTick] = useState(0);
  const [myFingerprint, setMyFingerprint] = useState(null);
  // Who this device is, as format-2 seals name people: { userId, nodeName } (v2.149.0).
  const sealIdentityRef = useRef(null);

  useEffect(() => {
    let live = true;
    if (!publicKeyBase64) { setMyFingerprint(null); return undefined; }
    crypto.keyFingerprint(publicKeyBase64).then(fp => { if (live) setMyFingerprint(fp); }).catch(() => {});
    return () => { live = false; };
  }, [publicKeyBase64]);
  const rotationRunRef = useRef(null);
  // Waves this session has asked older key versions for (v2.145.4).
  const historyAskedRef = useRef(new Set());

  // Always-current token. saveToSessionCache reads this so the 'auto' duration
  // computes against the live JWT — the provider mounts on the login screen with
  // token=null, so closing over `token` directly would freeze it at null and
  // silently downgrade every first-login unlock to sessionStorage (cleared on
  // browser close), forcing a re-unlock no matter what session length was chosen.
  const tokenRef = useRef(token);
  useEffect(() => { tokenRef.current = token; }, [token]);

  // ============ Session Cache Helpers ============
  const saveToSessionCache = useCallback(async (privKey, pubKeyBase64, duration = 'auto') => {
    try {
      // Generate a session key and encrypt the private key
      const { key: sessionKey, keyBase64 } = await crypto.generateSessionKey();
      const jwkString = await crypto.exportPrivateKeyForSession(privKey);
      const encryptedData = await crypto.encryptForSession(jwkString, sessionKey);

      // 'auto': match the JWT session lifetime so E2EE stays unlocked as long as the user is logged in
      const durationMs = duration === 'auto'
        ? getSessionRemainingMs(tokenRef.current)
        : (REMEMBER_DURATIONS[duration] ?? 0);

      if (durationMs > 0) {
        // Use localStorage with expiry for persistent storage
        const expiryTime = Date.now() + durationMs;
        localStorage.setItem(PERSISTENT_KEY_STORAGE, keyBase64);
        localStorage.setItem(PERSISTENT_DATA_STORAGE, encryptedData);
        localStorage.setItem(PERSISTENT_PUBLIC_KEY, pubKeyBase64);
        localStorage.setItem(PERSISTENT_EXPIRY, expiryTime.toString());
        localStorage.setItem(PERSISTENT_DURATION, duration);
        // Clear sessionStorage to avoid confusion
        sessionStorage.removeItem(SESSION_KEY_STORAGE);
        sessionStorage.removeItem(SESSION_DATA_STORAGE);
        sessionStorage.removeItem(SESSION_PUBLIC_KEY);
        console.log(`E2EE: Saved to persistent cache (expires in ${duration})`);
      } else {
        // Use sessionStorage (clears when browser closes)
        sessionStorage.setItem(SESSION_KEY_STORAGE, keyBase64);
        sessionStorage.setItem(SESSION_DATA_STORAGE, encryptedData);
        sessionStorage.setItem(SESSION_PUBLIC_KEY, pubKeyBase64);
        // Clear localStorage to avoid confusion
        localStorage.removeItem(PERSISTENT_KEY_STORAGE);
        localStorage.removeItem(PERSISTENT_DATA_STORAGE);
        localStorage.removeItem(PERSISTENT_PUBLIC_KEY);
        localStorage.removeItem(PERSISTENT_EXPIRY);
        localStorage.removeItem(PERSISTENT_DURATION);
        console.log('E2EE: Saved to session cache');
      }
    } catch (err) {
      console.error('E2EE: Failed to save to cache:', err);
    }
  }, []);

  const restoreFromSessionCache = useCallback(async () => {
    try {
      // First, try localStorage (persistent cache with TTL)
      const persistentKeyBase64 = localStorage.getItem(PERSISTENT_KEY_STORAGE);
      const persistentData = localStorage.getItem(PERSISTENT_DATA_STORAGE);
      const persistentPubKey = localStorage.getItem(PERSISTENT_PUBLIC_KEY);
      const persistentExpiry = localStorage.getItem(PERSISTENT_EXPIRY);

      if (persistentKeyBase64 && persistentData && persistentPubKey && persistentExpiry) {
        const expiryTime = parseInt(persistentExpiry, 10);
        if (Date.now() < expiryTime) {
          // Not expired - restore from localStorage
          const sessionKey = await crypto.importSessionKey(persistentKeyBase64);
          const jwkString = await crypto.decryptFromSession(persistentData, sessionKey);
          const privKey = await crypto.importPrivateKeyFromSession(jwkString);
          const pubKey = await crypto.importPublicKey(persistentPubKey);

          console.log('E2EE: Restored from persistent cache');
          return { privateKey: privKey, publicKey: pubKey, publicKeyBase64: persistentPubKey };
        } else {
          // Expired - clear persistent cache
          console.log('E2EE: Persistent cache expired, clearing');
          localStorage.removeItem(PERSISTENT_KEY_STORAGE);
          localStorage.removeItem(PERSISTENT_DATA_STORAGE);
          localStorage.removeItem(PERSISTENT_PUBLIC_KEY);
          localStorage.removeItem(PERSISTENT_EXPIRY);
        }
      }

      // Fall back to sessionStorage
      const sessionKeyBase64 = sessionStorage.getItem(SESSION_KEY_STORAGE);
      const encryptedData = sessionStorage.getItem(SESSION_DATA_STORAGE);
      const pubKeyBase64 = sessionStorage.getItem(SESSION_PUBLIC_KEY);

      if (!sessionKeyBase64 || !encryptedData || !pubKeyBase64) {
        return null;
      }

      // Import session key and decrypt private key
      const sessionKey = await crypto.importSessionKey(sessionKeyBase64);
      const jwkString = await crypto.decryptFromSession(encryptedData, sessionKey);
      const privKey = await crypto.importPrivateKeyFromSession(jwkString);
      const pubKey = await crypto.importPublicKey(pubKeyBase64);

      console.log('E2EE: Restored from session cache');
      return { privateKey: privKey, publicKey: pubKey, publicKeyBase64: pubKeyBase64 };
    } catch (err) {
      console.error('E2EE: Failed to restore from cache:', err);
      clearSessionCache();
      return null;
    }
  }, []);

  const clearSessionCache = useCallback(() => {
    // Clear sessionStorage
    sessionStorage.removeItem(SESSION_KEY_STORAGE);
    sessionStorage.removeItem(SESSION_DATA_STORAGE);
    sessionStorage.removeItem(SESSION_PUBLIC_KEY);
    // Clear localStorage (persistent cache)
    localStorage.removeItem(PERSISTENT_KEY_STORAGE);
    localStorage.removeItem(PERSISTENT_DATA_STORAGE);
    localStorage.removeItem(PERSISTENT_PUBLIC_KEY);
    localStorage.removeItem(PERSISTENT_EXPIRY);
    localStorage.removeItem(PERSISTENT_DURATION);
  }, []);

  // Keep the persistent E2EE cache aligned with the live session when the user
  // chose "Until my session expires" ('auto'). The session slides forward as the
  // user stays active — without this the E2EE cache keeps its original (shorter)
  // expiry and forces a re-unlock while still logged in.
  useEffect(() => {
    if (!token) return;
    if (localStorage.getItem(PERSISTENT_DURATION) !== 'auto') return;
    if (!localStorage.getItem(PERSISTENT_KEY_STORAGE)) return;
    const remaining = getSessionRemainingMs(token);
    if (remaining > 0) {
      localStorage.setItem(PERSISTENT_EXPIRY, (Date.now() + remaining).toString());
    }
  }, [token]);

  // Fetch helper
  const fetchAPI = useCallback(async (path, options = {}) => {
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers
      }
    });
    return res;
  }, [API_URL, token]);

  // ============ E2EE Status Check ============
  const checkE2EEStatus = useCallback(async () => {
    if (!token) return;

    try {
      // First, try to restore from session cache (for page refreshes)
      if (!sessionRestoreAttempted.current) {
        sessionRestoreAttempted.current = true;
        const cached = await restoreFromSessionCache();
        if (cached) {
          setPrivateKey(cached.privateKey);
          setPublicKey(cached.publicKey);
          setPublicKeyBase64(cached.publicKeyBase64);
          setE2eeStatus({ enabled: true });
          setNeedsPassphrase(false);
          setNeedsSetup(false);
          console.log('E2EE: Restored from session cache - no passphrase needed');
          return;
        }
      }

      // Already unlocked in this page's memory: nothing to ask.
      if (privateKeyRef.current) {
        setE2eeStatus(prev => prev || { enabled: true });
        setNeedsPassphrase(false);
        setNeedsSetup(false);
        return;
      }

      const res = await fetchAPI('/e2ee/status');
      if (res.ok) {
        const data = await res.json();
        setE2eeStatus({ enabled: data.e2eeEnabled, keyVersion: data.keyVersion });

        if (data.e2eeEnabled) {
          setNeedsPassphrase(true);
          setNeedsSetup(false);
        } else {
          setNeedsPassphrase(false);
          setNeedsSetup(true);
        }
      } else {
        setE2eeStatus({ enabled: false });
        setNeedsSetup(true);
      }
    } catch (err) {
      console.error('E2EE status check failed:', err);
      setE2eeStatus({ enabled: false, error: err.message });
    }
  }, [token, fetchAPI, restoreFromSessionCache]);

  // ============ E2EE Setup ============
  const setupE2EE = useCallback(async (passphrase, createRecoveryKey = true, rememberDuration = 'auto') => {
    if (!token) throw new Error('Not authenticated');

    try {
      // Generate keys
      const { publicKey: pubKeyBase64, encryptedPrivateKey, salt, keyPair } = await crypto.setupUserE2EE(passphrase);

      // Register with server
      const res = await fetchAPI('/e2ee/keys/register', {
        method: 'POST',
        body: JSON.stringify({
          publicKey: pubKeyBase64,
          encryptedPrivateKey,
          salt
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to register keys');
      }

      // Generate and store recovery key if requested
      let recoveryKey = null;
      if (createRecoveryKey) {
        const recovery = await crypto.createRecoveryBackup(keyPair.privateKey);
        const recoveryRes = await fetchAPI('/e2ee/recovery/setup', {
          method: 'POST',
          body: JSON.stringify({
            encryptedPrivateKey: recovery.encryptedPrivateKey,
            recoverySalt: recovery.recoverySalt
          })
        });

        if (recoveryRes.ok) {
          recoveryKey = recovery.recoveryKey;  // Return to show user
        } else {
          console.warn('Recovery setup failed, but main keys are registered');
        }
      }

      // Store keys in memory
      setPrivateKey(keyPair.privateKey);
      setPublicKey(keyPair.publicKey);
      setPublicKeyBase64(pubKeyBase64);
      setNeedsSetup(false);
      setNeedsPassphrase(false);
      setE2eeStatus({ enabled: true });

      // Save to cache with specified duration
      await saveToSessionCache(keyPair.privateKey, pubKeyBase64, rememberDuration);

      return { success: true, recoveryKey };
    } catch (err) {
      console.error('E2EE setup error:', err);
      throw err;
    }
  }, [token, fetchAPI, saveToSessionCache]);

  // ============ Unlock with Passphrase ============
  const unlockE2EE = useCallback(async (passphrase, rememberDuration = 'auto') => {
    if (!token) throw new Error('Not authenticated');

    setIsUnlocking(true);
    setUnlockError(null);

    try {
      // Fetch encrypted keys from server
      const res = await fetchAPI('/e2ee/keys/me');
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to fetch keys');
      }

      const { encryptedPrivateKey, keyDerivationSalt, publicKey: pubKeyBase64 } = await res.json();

      // Decrypt private key
      const privKey = await crypto.unlockPrivateKey(passphrase, encryptedPrivateKey, keyDerivationSalt);
      const pubKey = await crypto.importPublicKey(pubKeyBase64);

      // Store in memory
      setPrivateKey(privKey);
      setPublicKey(pubKey);
      setPublicKeyBase64(pubKeyBase64);
      setNeedsPassphrase(false);
      setIsUnlocking(false);

      // Save to cache with specified duration
      await saveToSessionCache(privKey, pubKeyBase64, rememberDuration);

      return { success: true };
    } catch (err) {
      console.error('E2EE unlock error:', err);
      setUnlockError(err.message || 'Incorrect passphrase');
      setIsUnlocking(false);
      throw err;
    }
  }, [token, fetchAPI, saveToSessionCache]);

  // ============ Recovery ============
  const recoverWithPassphrase = useCallback(async (recoveryPassphrase) => {
    if (!token) throw new Error('Not authenticated');

    try {
      // Fetch recovery data
      const res = await fetchAPI('/e2ee/recovery');
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'No recovery key configured');
      }

      const { encryptedPrivateKey, recoverySalt, pending } = await res.json();

      // Decrypt with recovery passphrase. A replacement key not yet confirmed is
      // tried too (v2.146.1): the person may hold either, and recovering with
      // the new one is the confirmation.
      let privKey;
      try {
        privKey = await crypto.recoverPrivateKey(recoveryPassphrase, encryptedPrivateKey, recoverySalt);
      } catch (err) {
        if (!pending?.encryptedPrivateKey) throw err;
        privKey = await crypto.recoverPrivateKey(recoveryPassphrase, pending.encryptedPrivateKey, pending.recoverySalt);
        await fetchAPI('/e2ee/recovery/confirm', { method: 'POST' }).catch(() => {});
      }

      // Fetch public key
      const keysRes = await fetchAPI('/e2ee/keys/me');
      const { publicKey: pubKeyBase64 } = await keysRes.json();
      const pubKey = await crypto.importPublicKey(pubKeyBase64);

      // Store in memory
      setPrivateKey(privKey);
      setPublicKey(pubKey);
      setPublicKeyBase64(pubKeyBase64);
      setNeedsPassphrase(false);

      // Save to session cache for page refreshes
      await saveToSessionCache(privKey, pubKeyBase64);

      return { success: true };
    } catch (err) {
      console.error('E2EE recovery error:', err);
      throw err;
    }
  }, [token, fetchAPI, saveToSessionCache]);

  // Regenerate recovery key (requires unlocked E2EE)
  const regenerateRecoveryKey = useCallback(async () => {
    if (!token) throw new Error('Not authenticated');
    if (!privateKey) throw new Error('E2EE not unlocked');

    try {
      // Generate new recovery backup using current private key
      const recovery = await crypto.createRecoveryBackup(privateKey);

      // Store on server
      const res = await fetchAPI('/e2ee/recovery/regenerate', {
        method: 'POST',
        body: JSON.stringify({
          encryptedPrivateKey: recovery.encryptedPrivateKey,
          recoverySalt: recovery.recoverySalt
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to regenerate recovery key');
      }

      // Return the new recovery key to display to user
      return { success: true, recoveryKey: recovery.recoveryKey };
    } catch (err) {
      console.error('E2EE recovery regeneration error:', err);
      throw err;
    }
  }, [token, privateKey, fetchAPI]);

  // Re-encrypt private key with new password (used after password change)
  const reencryptWithPassword = useCallback(async (newPassword) => {
    if (!token) throw new Error('Not authenticated');
    if (!privateKey) throw new Error('E2EE not unlocked');

    try {
      // Re-encrypt the private key with the new password
      const { encryptedPrivateKey, salt } = await crypto.reencryptPrivateKey(privateKey, newPassword);

      // Update on server
      const res = await fetchAPI('/e2ee/keys/update', {
        method: 'POST',
        body: JSON.stringify({
          encryptedPrivateKey,
          salt
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update encryption keys');
      }

      // Update session cache with new encryption
      await saveToSessionCache(privateKey, publicKeyBase64);

      console.log('E2EE: Private key re-encrypted with new password');
      return { success: true };
    } catch (err) {
      console.error('E2EE re-encryption error:', err);
      throw err;
    }
  }, [token, privateKey, publicKeyBase64, fetchAPI, saveToSessionCache]);

  // ============ Wave Key Management ============

  // Request a wave key from other participants (v2.47.3 — redistribution)
  // Called when this user has lost their wave key (e.g. after an E2EE reset).
  // Silent — callers should treat the wave as temporarily unreadable while pending.
  const requestWaveKey = useCallback(async (waveId) => {
    if (!token) return;
    try {
      const res = await fetchAPI(`/waves/${waveId}/key-request`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.warn(`Wave key request failed for ${waveId}:`, err.error);
      } else {
        console.log(`E2EE: Wave key requested for ${waveId}`);
      }
    } catch (err) {
      console.warn('Wave key request error:', err);
    }
  }, [token, fetchAPI]);

  /**
   * Who this device is in a format-2 seal (v2.149.0): its person's id and the
   * server's name. Asked once, and only when a format-2 seal turns up.
   */
  const getSealIdentity = useCallback(() => {
    if (!sealIdentityRef.current) {
      sealIdentityRef.current = (async () => {
        const res = await fetchAPI('/e2ee/status');
        if (!res.ok) throw new Error('E2EE status unavailable');
        const { userId, nodeName } = await res.json();
        if (!userId) throw new Error('E2EE status has no user');
        return { userId, nodeName: nodeName || null };
      })();
      sealIdentityRef.current.catch(() => { sealIdentityRef.current = null; });
    }
    return sealIdentityRef.current;
  }, [fetchAPI]);

  /**
   * Open a wrapped wave key of either format. Format 2 is bound to the wave,
   * the key version and this person (crypto.js); phase 1 has no encrypted
   * copies of other servers' waves, so the wave here is the origin.
   */
  const unwrapWaveKey = useCallback(async (waveId, row, keyVersion) => {
    const [encKeyBase64, nonceBase64] = row.encryptedWaveKey.split(':');
    const senderPubKey = await crypto.importPublicKey(row.senderPublicKey);
    if (row.format !== 2) return crypto.decryptWaveKey(encKeyBase64, nonceBase64, senderPubKey, privateKey);
    const me = await getSealIdentity();
    const context = crypto.waveKeyContext(waveId, keyVersion, crypto.personAddress(me.userId, me.nodeName));
    return crypto.decryptWaveKey(encKeyBase64, nonceBase64, senderPubKey, privateKey, { format: 2, context });
  }, [privateKey, getSealIdentity]);

  const getWaveKey = useCallback(async (waveId) => {
    // Check cache first
    const cached = waveKeyCacheRef.current.get(waveId);
    if (cached) {
      return cached.waveKey;
    }

    if (!privateKey) {
      throw new Error('E2EE not unlocked');
    }

    const pending = waveKeyInFlightRef.current.get(waveId);
    if (pending) return pending;
    const generation = keyGenerationRef.current;
    const work = (async () => {
      try {
        // Fetch from server
        const res = await fetchAPI(`/waves/${waveId}/key`);

        if (!res.ok) {
          if (res.status === 404) {
            // Encrypted wave but no key for this user — trigger redistribution from other participants
            requestWaveKey(waveId);
            return null;  // Temporarily unreadable; wave_key_granted WS event triggers reload
          }
          const err = await res.json();
          throw new Error(err.error || 'Failed to fetch wave key');
        }

        const { encrypted, encryptedWaveKey, senderPublicKey, keyVersion, format } = await res.json();

        if (!encrypted) {
          return null;  // Wave not encrypted
        }

        // The stored key is "encryptedKey:nonce", wrapped by senderPublicKey.
        const waveKey = await unwrapWaveKey(waveId, { encryptedWaveKey, senderPublicKey, format }, keyVersion);

        // Cache it (with LRU eviction) — unless the cache was cleared meanwhile
        if (generation === keyGenerationRef.current) {
          if (waveKeyCacheRef.current.size >= WAVE_KEY_CACHE_MAX) {
            const firstKey = waveKeyCacheRef.current.keys().next().value;
            waveKeyCacheRef.current.delete(firstKey);
          }
          waveKeyCacheRef.current.set(waveId, { waveKey, version: keyVersion });
        }

        return waveKey;
      } catch (err) {
        console.error('Get wave key error:', err);
        throw err;
      }
    })();
    waveKeyInFlightRef.current.set(waveId, work);
    work.finally(() => {
      if (waveKeyInFlightRef.current.get(waveId) === work) waveKeyInFlightRef.current.delete(waveId);
    }).catch(() => {}); // the caller handles the rejection; this chain must not
    return work;
  }, [privateKey, fetchAPI, requestWaveKey, unwrapWaveKey]);

  /**
   * The key for one specific version of a wave's key (v2.117.2).
   *
   * Every ping carries the key version it was encrypted under, so this is the
   * path nearly every decrypt takes. One /keys/all request per wave is shared
   * by everyone waiting on it, and each version is unwrapped once.
   * Resolves null when the server has no such version, and the caller falls
   * back to the current key, as before.
   */
  const getVersionedWaveKey = useCallback((waveId, keyVersion) => {
    const id = `${waveId}:${keyVersion}`;
    const pending = versionKeyInFlightRef.current.get(id);
    if (pending) return pending;
    const generation = keyGenerationRef.current;
    const work = (async () => {
      let list = keyListInFlightRef.current.get(waveId);
      if (!list) {
        list = (async () => {
          const res = await fetchAPI(`/waves/${waveId}/keys/all`);
          return res.ok ? (await res.json()).keys || [] : null;
        })();
        keyListInFlightRef.current.set(waveId, list);
        list.finally(() => {
          if (keyListInFlightRef.current.get(waveId) === list) keyListInFlightRef.current.delete(waveId);
        }).catch(() => {});
      }
      const keys = await list;
      const versionKey = keys?.find(k => k.keyVersion === keyVersion);
      if (!versionKey) return null;
      const waveKey = await unwrapWaveKey(waveId, versionKey, keyVersion);
      if (generation === keyGenerationRef.current) {
        waveKeyCacheRef.current.set(id, { waveKey, version: keyVersion });
      }
      return waveKey;
    })();
    versionKeyInFlightRef.current.set(id, work);
    work.finally(() => {
      if (versionKeyInFlightRef.current.get(id) === work) versionKeyInFlightRef.current.delete(id);
    }).catch(() => {});
    return work;
  }, [fetchAPI, unwrapWaveKey]);

  // ============ Keys seen (v2.143.0) ============

  const loadKeyRecords = useCallback(() => {
    if (!privateKey || !publicKey) return Promise.resolve(null);
    if (keyRecordsRef.current?.ready) return keyRecordsRef.current.ready;
    const state = { records: emptyKeyRecords(), version: 0, ready: null };
    keyRecordsRef.current = state;
    state.ready = (async () => {
      try {
        const res = await fetchAPI('/e2ee/key-records');
        if (res.ok) {
          const data = await res.json();
          state.version = data.version || 0;
          if (data.encryptedData && data.nonce) {
            try {
              state.records = await crypto.decryptKeyRecords(data.encryptedData, data.nonce, privateKey, publicKey);
            } catch {
              // Made under an earlier keypair (an E2EE reset): start again over it.
              state.records = emptyKeyRecords();
            }
          }
        }
      } catch (err) {
        console.warn('E2EE: key records unavailable:', err.message);
      }
      if (keyRecordsRef.current === state) {
        setKeyChanges(unacknowledgedChanges(state.records));
        setKeyRecordsTick(t => t + 1);
      }
      return state;
    })();
    return state.ready;
  }, [privateKey, publicKey, fetchAPI]);

  // Saves one at a time; another device saving meanwhile is merged, not lost.
  const saveKeyRecords = useCallback((state) => {
    const run = keyRecordsSaveRef.current.then(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const { encryptedData, nonce } = await crypto.encryptKeyRecords(state.records, privateKey, publicKey);
        const res = await fetchAPI('/e2ee/key-records', {
          method: 'PUT',
          body: JSON.stringify({ encryptedData, nonce, expectedVersion: state.version }),
        });
        if (res.ok) { state.version = (await res.json()).version; return; }
        if (res.status !== 409) throw new Error(`key records save failed (${res.status})`);
        const theirs = await res.json();
        state.version = theirs.version || 0;
        try {
          state.records = mergeKeyRecords(state.records, await crypto.decryptKeyRecords(theirs.encryptedData, theirs.nonce, privateKey, publicKey));
          setKeyRecordsTick(t => t + 1);
        } catch { /* theirs is unreadable to this key; ours replaces it */ }
      }
    }).catch(err => console.warn('E2EE:', err.message));
    keyRecordsSaveRef.current = run;
    return run;
  }, [privateKey, publicKey, fetchAPI]);

  /**
   * The public key to give someone a wave key with: looked up here, never
   * taken from a request (v2.143.0 [SECURITY]), and compared with the key
   * seen for them before. A changed key is still used (Jared, 2026-11-20)
   * and flagged.
   * @returns {Promise<string|null>} base64 SPKI, or null if they have no key
   */
  const lookUpKey = useCallback(async (userId) => {
    const res = await fetchAPI(`/e2ee/keys/user/${encodeURIComponent(userId)}`);
    if (!res.ok) return null;
    const { publicKey: theirKey } = await res.json();
    if (!theirKey) return null;
    const state = await loadKeyRecords();
    if (state) {
      const { status, records } = noteKey(state.records, userId, theirKey);
      if (status !== 'same') {
        state.records = records;
        setKeyRecordsTick(t => t + 1);
        saveKeyRecords(state);
        if (status === 'changed') {
          console.warn(`E2EE: the key for ${userId} has changed`);
          setKeyChanges(unacknowledgedChanges(records));
        }
      }
    }
    return theirKey;
  }, [fetchAPI, loadKeyRecords, saveKeyRecords]);

  const acknowledgeKeyChange = useCallback(async (personId) => {
    const state = await loadKeyRecords();
    if (!state) return;
    state.records = ackKeyChange(state.records, personId);
    setKeyChanges(unacknowledgedChanges(state.records));
    setKeyRecordsTick(t => t + 1);
    await saveKeyRecords(state);
  }, [loadKeyRecords, saveKeyRecords]);

  // ============ Fingerprints and verification (v2.149.0) ============

  /**
   * Someone's key as people compare it: looked up the same way a wave key is
   * given (lookUpKey), so what is shown is what this device would use.
   * @returns {Promise<{ publicKey, fingerprint, standing }|null>} null if they
   *   have not set up encryption
   */
  const describeKey = useCallback(async (userId) => {
    const publicKey = await lookUpKey(userId);
    if (!publicKey) return null;
    const state = await loadKeyRecords();
    return {
      publicKey,
      fingerprint: await crypto.keyFingerprint(publicKey),
      standing: keyStanding(state?.records, userId, publicKey),
    };
  }, [lookUpKey, loadKeyRecords]);

  /** After comparing fingerprints: this key, and only this key, is theirs. */
  const markKeyVerified = useCallback(async (userId, publicKey) => {
    const state = await loadKeyRecords();
    if (!state) return false;
    const next = markVerified(state.records, userId, publicKey);
    if (next === state.records) return false;
    state.records = next;
    setKeyChanges(unacknowledgedChanges(next));
    setKeyRecordsTick(t => t + 1);
    await saveKeyRecords(state);
    return true;
  }, [loadKeyRecords, saveKeyRecords]);

  const unmarkKeyVerified = useCallback(async (userId) => {
    const state = await loadKeyRecords();
    if (!state) return;
    state.records = unmarkVerified(state.records, userId);
    setKeyRecordsTick(t => t + 1);
    await saveKeyRecords(state);
  }, [loadKeyRecords, saveKeyRecords]);

  /** The standing of the key on record for someone, without a lookup. */
  const keyStandingOf = useCallback((userId) => {
    const records = keyRecordsRef.current?.records;
    return keyStanding(records, userId, records?.people?.[userId]?.key);
  }, []);

  useEffect(() => {
    if (privateKey && publicKey) loadKeyRecords();
  }, [privateKey, publicKey, loadKeyRecords]);

  // Grant a pending wave key request from another participant (v2.47.4).
  // v2.143.0 [SECURITY]: the key comes from lookUpKey(requesterId). The public
  // key carried in the push is ignored: it used to be used as given, so the
  // server could get any wave's key from every online member by sending one.
  /**
   * Someone in a wave asked for keys they lack (v2.47.3). Wraps each version
   * they are missing that this device holds (v2.145.4: older versions too, so
   * a newcomer can read the pings from before they joined; it used to send
   * only the current one).
   */
  const grantWaveKey = useCallback(async (waveId, requestId, requesterId, versions = null) => {
    if (!privateKey || !publicKeyBase64 || !requesterId) return;
    try {
      const requesterPublicKey = await lookUpKey(requesterId);
      if (!requesterPublicKey) {
        console.warn(`E2EE: Cannot grant wave key for ${waveId} — they have no key`);
        return;
      }
      const listRes = await fetchAPI(`/waves/${waveId}/keys/all`);
      if (!listRes.ok) return;
      const mine = ((await listRes.json()).keys || []).map(k => k.keyVersion);
      const wanted = Array.isArray(versions) && versions.length ? mine.filter(v => versions.includes(v)) : mine;
      const keys = [];
      let senderPublicKey = null;
      for (const keyVersion of wanted) {
        const waveKey = await getVersionedWaveKey(waveId, keyVersion);
        if (!waveKey) continue;
        const wrapped = await crypto.addParticipantToWave(waveKey, requesterPublicKey, privateKey, publicKeyBase64);
        senderPublicKey = wrapped.senderPublicKey;
        keys.push({ keyVersion, encryptedWaveKey: `${wrapped.encryptedWaveKey}:${wrapped.nonce}` });
      }
      if (keys.length === 0) {
        console.warn(`E2EE: Cannot grant wave key for ${waveId} — no key available`);
        return;
      }
      const res = await fetchAPI(`/waves/${waveId}/key-grant`, {
        method: 'POST',
        body: JSON.stringify({ requestId, keys, senderPublicKey })
      });
      if (res.ok) {
        console.log(`E2EE: ${keys.length} wave key version(s) granted for request ${requestId}`);
      } else {
        const err = await res.json().catch(() => ({}));
        console.warn('Wave key grant failed:', err.error);
      }
    } catch (err) {
      console.warn('Wave key grant error:', err);
    }
  }, [privateKey, publicKeyBase64, fetchAPI, getVersionedWaveKey, lookUpKey]);

  const createWaveWithEncryption = useCallback(async (participants) => {
    if (!privateKey || !publicKeyBase64) {
      throw new Error('E2EE not unlocked');
    }

    try {
      // Get participant public keys
      const participantKeys = await Promise.all(
        participants.map(async (userId) => ({ userId, publicKey: await lookUpKey(userId) }))
      );

      // Add self
      participantKeys.push({ userId: 'self', publicKey: publicKeyBase64 });

      // Generate and distribute wave key
      const { waveKey, keyDistribution } = await crypto.setupWaveEncryption(
        participantKeys.filter(p => p.publicKey),
        privateKey,
        publicKeyBase64
      );

      // Format for API (combine encryptedKey and nonce)
      const formattedDistribution = keyDistribution
        .filter(k => !k.error)
        .map(({ userId, encryptedWaveKey, nonce, senderPublicKey }) => ({
          userId: userId === 'self' ? null : userId,  // Server will use req.user.userId for self
          encryptedWaveKey: `${encryptedWaveKey}:${nonce}`,
          senderPublicKey
        }));

      return { waveKey, keyDistribution: formattedDistribution };
    } catch (err) {
      console.error('Create encrypted wave error:', err);
      throw err;
    }
  }, [privateKey, publicKeyBase64, lookUpKey]);

  // ============ Encrypt/Decrypt Pings ============
  // Returns the version of the key it actually used (v2.143.0). Callers used
  // to ask the server for the current version separately, which, once keys
  // rotate, labels a ping with a version its ciphertext wasn't made with.
  const encryptPing = useCallback(async (content, waveId) => {
    let waveKey = await getWaveKey(waveId);
    let version = waveKeyCacheRef.current.get(waveId)?.version;
    if (waveKey && !version) {
      // Dropped from the cache in between (a rotation): fetch it again.
      waveKey = await getWaveKey(waveId);
      version = waveKeyCacheRef.current.get(waveId)?.version;
    }
    if (!waveKey || !version) {
      throw new Error('Your encryption key is being redistributed — please try again in a moment');
    }

    const { ciphertext, nonce } = await crypto.encryptPing(content, waveKey);
    return { ciphertext, nonce, keyVersion: version };
  }, [getWaveKey]);

  // `seal` (v2.149.0): { format, authorId } from the ping. Format 2 is bound
  // to the wave and its author, so a ping moved to another wave or credited to
  // someone else does not open.
  const decryptPing = useCallback(async (ciphertext, nonce, waveId, keyVersion = null, seal = null) => {
    // For key rotation: may need to get specific version
    let waveKey;

    if (keyVersion !== null) {
      // Fetch specific version
      const cached = waveKeyCacheRef.current.get(`${waveId}:${keyVersion}`);
      const current = waveKeyCacheRef.current.get(waveId);
      if (cached) {
        waveKey = cached.waveKey;
      } else if (current && current.version === keyVersion) {
        // The ping was encrypted under the current key, which is already here
        waveKey = current.waveKey;
      } else {
        waveKey = await getVersionedWaveKey(waveId, keyVersion);
        // A ping sealed with a version of the key we were never given: we
        // joined after it (v2.145.4). Ask the others for the older versions,
        // once a session per wave; wave_key_granted reloads the wave.
        if (!waveKey && !historyAskedRef.current.has(waveId)) {
          historyAskedRef.current.add(waveId);
          requestWaveKey(waveId);
        }
      }
    }

    // If we still don't have a key (no version match, or keyVersion was null), use getWaveKey.
    // This also handles the 404 case, which triggers redistribution via requestWaveKey.
    if (!waveKey) {
      waveKey = await getWaveKey(waveId);
    }

    if (!waveKey) {
      throw new Error('Wave key not found');
    }

    if (seal?.format === 2) {
      if (!seal.authorId) throw new Error('A format-2 ping needs its author');
      const me = await getSealIdentity();
      const context = crypto.pingContext(waveId, crypto.personAddress(seal.authorId, seal.authorNode || me.nodeName));
      return crypto.decryptPing(ciphertext, nonce, waveKey, { format: 2, context });
    }
    return crypto.decryptPing(ciphertext, nonce, waveKey);
  }, [getWaveKey, getVersionedWaveKey, requestWaveKey, getSealIdentity]);

  // ============ Audio Encryption (v2.3.0) ============

  // Encrypt audio chunk for voice calls
  const encryptAudioChunk = useCallback(async (audioBuffer, waveId) => {
    if (!privateKey) {
      throw new Error('E2EE not unlocked');
    }

    // Get wave key
    const waveKey = await getWaveKey(waveId);
    if (!waveKey) {
      throw new Error('Wave key not found');
    }

    // Generate random nonce (12 bytes for AES-GCM)
    const nonce = window.crypto.getRandomValues(new Uint8Array(12));

    // Encrypt the audio data
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      waveKey,
      audioBuffer
    );

    // Convert to base64 for transmission
    const ciphertextBase64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));
    const nonceBase64 = btoa(String.fromCharCode(...nonce));

    return { ciphertext: ciphertextBase64, nonce: nonceBase64 };
  }, [privateKey, getWaveKey]);

  // Decrypt audio chunk for voice calls
  const decryptAudioChunk = useCallback(async (encryptedData, waveId) => {
    if (!privateKey) {
      throw new Error('E2EE not unlocked');
    }

    // Get wave key
    const waveKey = await getWaveKey(waveId);
    if (!waveKey) {
      throw new Error('Wave key not found');
    }

    // Parse encrypted data
    let ciphertextBase64, nonceBase64;
    if (typeof encryptedData === 'string') {
      // Assume format: "ciphertext:nonce" or just base64 ciphertext
      const parts = encryptedData.split(':');
      if (parts.length === 2) {
        ciphertextBase64 = parts[0];
        nonceBase64 = parts[1];
      } else {
        throw new Error('Invalid encrypted audio format');
      }
    } else if (encryptedData.ciphertext && encryptedData.nonce) {
      // Object format
      ciphertextBase64 = encryptedData.ciphertext;
      nonceBase64 = encryptedData.nonce;
    } else {
      throw new Error('Invalid encrypted audio data');
    }

    // Decode from base64
    const ciphertext = Uint8Array.from(atob(ciphertextBase64), c => c.charCodeAt(0));
    const nonce = Uint8Array.from(atob(nonceBase64), c => c.charCodeAt(0));

    // Decrypt
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce },
      waveKey,
      ciphertext
    );

    return decrypted; // Returns ArrayBuffer
  }, [privateKey, getWaveKey]);

  // ============ Legacy Wave Migration ============

  // Get wave encryption status and progress
  const getWaveEncryptionStatus = useCallback(async (waveId) => {
    try {
      const res = await fetchAPI(`/waves/${waveId}/encryption-status`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to get encryption status');
      }
      return await res.json();
    } catch (err) {
      console.error('Get encryption status error:', err);
      throw err;
    }
  }, [fetchAPI]);

  // Enable encryption for a legacy wave (starts the migration process)
  const enableWaveEncryption = useCallback(async (waveId, participantIds) => {
    if (!privateKey || !publicKeyBase64) {
      throw new Error('E2EE not unlocked');
    }

    try {
      // Get participant public keys
      const participantKeys = await Promise.all(
        participantIds.map(async (userId) => ({ userId, publicKey: await lookUpKey(userId) }))
      );

      // Add self
      participantKeys.push({ userId: 'self', publicKey: publicKeyBase64 });

      // Check if all participants have E2EE
      const participantsWithE2EE = participantKeys.filter(p => p.publicKey);
      const allHaveE2EE = participantsWithE2EE.length === participantKeys.length;

      // Generate and distribute wave key
      const { waveKey, keyDistribution } = await crypto.setupWaveEncryption(
        participantsWithE2EE,
        privateKey,
        publicKeyBase64
      );

      // Format for API
      const formattedDistribution = keyDistribution
        .filter(k => !k.error)
        .map(({ userId, encryptedWaveKey, nonce, senderPublicKey }) => ({
          userId: userId === 'self' ? null : userId,
          encryptedWaveKey: `${encryptedWaveKey}:${nonce}`,
          senderPublicKey
        }));

      // Call encrypt endpoint to enable encryption on the wave
      const res = await fetchAPI(`/waves/${waveId}/encrypt`, {
        method: 'POST',
        body: JSON.stringify({ keyDistribution: formattedDistribution })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to enable encryption');
      }

      // Cache the wave key
      waveKeyCacheRef.current.set(waveId, { waveKey, version: 1 });

      return { success: true, waveKey, allParticipantsHaveE2EE: allHaveE2EE };
    } catch (err) {
      console.error('Enable wave encryption error:', err);
      throw err;
    }
  }, [privateKey, publicKeyBase64, fetchAPI, lookUpKey]);

  // Encrypt a batch of pings from a legacy wave
  const encryptLegacyWaveBatch = useCallback(async (waveId, batchSize = 50) => {
    if (!privateKey) {
      throw new Error('E2EE not unlocked');
    }

    try {
      // Get wave key
      const waveKey = await getWaveKey(waveId);
      if (!waveKey) {
        throw new Error('Wave key not found - enable encryption first');
      }

      // Fetch unencrypted pings
      const res = await fetchAPI(`/waves/${waveId}/unencrypted-pings?limit=${batchSize}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to fetch unencrypted pings');
      }

      const data = await res.json();
      const unencryptedPings = data.pings || data.droplets || [];

      if (unencryptedPings.length === 0) {
        return { success: true, encrypted: 0, hasMore: false, remaining: 0 };
      }

      // Encrypt each ping
      const encryptedPings = await Promise.all(
        unencryptedPings.map(async (ping) => {
          const { ciphertext, nonce } = await crypto.encryptPing(ping.content, waveKey);
          return {
            id: ping.id,
            content: ciphertext,
            nonce
          };
        })
      );

      // Get current key version from cache
      const cached = waveKeyCacheRef.current.get(waveId);
      const keyVersion = cached?.version || 1;

      // Send encrypted pings to server
      const uploadRes = await fetchAPI(`/waves/${waveId}/encrypt-pings`, {
        method: 'POST',
        body: JSON.stringify({
          pings: encryptedPings,
          keyVersion
        })
      });

      if (!uploadRes.ok) {
        const err = await uploadRes.json();
        throw new Error(err.error || 'Failed to upload encrypted pings');
      }

      const result = await uploadRes.json();
      return {
        success: true,
        encrypted: encryptedPings.length,
        hasMore: result.hasMore,
        remaining: result.remaining,
        progress: result.progress,
        encryptionState: result.encryptionState
      };
    } catch (err) {
      console.error('Encrypt legacy batch error:', err);
      throw err;
    }
  }, [privateKey, getWaveKey, fetchAPI]);

  // ============ Key Rotation ============
  // v2.143.0: a new key whenever someone who held the current one has left.
  // Only the wave's owner, admins and moderators may (Jared, 2026-11-20); the
  // server says which waves, and checks the new key reaches exactly the
  // people still in the wave.
  const rotateWaveKey = useCallback(async (waveId) => {
    if (!privateKey || !publicKeyBase64) {
      throw new Error('E2EE not unlocked');
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      const membersRes = await fetchAPI(`/waves/${waveId}/participants/keys`);
      if (!membersRes.ok) throw new Error('Failed to list the people in this wave');
      const { participants = [] } = await membersRes.json();
      const me = participants.find(p => p.publicKey === publicKeyBase64)?.userId;

      // Everyone else's key looked up and checked here, not taken from the list.
      const others = await Promise.all(participants
        .filter(p => p.publicKey && p.userId !== me)
        .map(async (p) => ({ userId: p.userId, publicKey: await lookUpKey(p.userId) })));
      others.push({ userId: 'self', publicKey: publicKeyBase64 });

      const { waveKey, keyDistribution } = await crypto.setupWaveEncryption(
        others.filter(p => p.publicKey),
        privateKey,
        publicKeyBase64
      );
      const formattedDistribution = keyDistribution
        .filter(k => !k.error)
        .map(({ userId, encryptedWaveKey, nonce, senderPublicKey }) => ({
          userId: userId === 'self' ? null : userId,
          encryptedWaveKey: `${encryptedWaveKey}:${nonce}`,
          senderPublicKey
        }));

      const res = await fetchAPI(`/waves/${waveId}/key/rotate`, {
        method: 'POST',
        body: JSON.stringify({ keyDistribution: formattedDistribution })
      });
      if (res.ok) {
        const { newKeyVersion } = await res.json();
        keyGenerationRef.current++;
        waveKeyCacheRef.current.delete(waveId);
        waveKeyInFlightRef.current.delete(waveId);
        keyListInFlightRef.current.delete(waveId);
        waveKeyCacheRef.current.set(waveId, { waveKey, version: newKeyVersion });
        return { success: true, newKeyVersion };
      }
      const err = await res.json().catch(() => ({}));
      if (err.code !== 'KEY_MEMBERS_CHANGED') throw new Error(err.error || 'Failed to rotate wave key');
    }
    throw new Error('The people in this wave kept changing; the key will be renewed later');
  }, [privateKey, publicKeyBase64, fetchAPI, lookUpKey]);

  // Renew every wave this person should, and answer key requests made while
  // this device was away: on unlock, when told, on reconnect, every ten minutes.
  const runPendingRotations = useCallback(() => {
    if (!privateKey || !publicKeyBase64) return Promise.resolve();
    if (rotationRunRef.current) return rotationRunRef.current;
    const run = (async () => {
      try {
        const res = await fetchAPI('/e2ee/rekey-needed');
        if (!res.ok) return;
        const { waves = [] } = await res.json();
        for (const { id } of waves) {
          try {
            await rotateWaveKey(id);
            console.log(`E2EE: renewed the key for wave ${id}`);
          } catch (err) {
            console.warn(`E2EE: could not renew the key for wave ${id}:`, err.message);
          }
        }
      } catch (err) {
        console.warn('E2EE: pending rotations unavailable:', err.message);
      }
      // Key requests made while this device was away (v2.145.5): a request
      // was only pushed to whoever was online at that moment.
      try {
        const res = await fetchAPI('/e2ee/key-requests');
        if (res.ok) {
          const { requests = [] } = await res.json();
          for (const r of requests) await grantWaveKey(r.waveId, r.requestId, r.requesterId, r.versions);
        }
      } catch (err) {
        console.warn('E2EE: pending key requests unavailable:', err.message);
      }
    })().finally(() => { rotationRunRef.current = null; });
    rotationRunRef.current = run;
    return run;
  }, [privateKey, publicKeyBase64, fetchAPI, rotateWaveKey, grantWaveKey]);

  useEffect(() => {
    if (!privateKey || !publicKeyBase64) return undefined;
    runPendingRotations();
    const timer = setInterval(runPendingRotations, 10 * 60 * 1000);
    return () => clearInterval(timer);
  }, [privateKey, publicKeyBase64, runPendingRotations]);

  // ============ Self-Service Key Reset ============
  // Called when the user's E2EE keys can't be unlocked (e.g. after a password reset).
  // Wipes server-side keys so fresh setup runs on next login.
  const resetE2EEKeys = useCallback(async () => {
    if (!token) throw new Error('Not authenticated');

    const res = await fetchAPI('/e2ee/keys/reset', { method: 'POST' });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to reset keys');
    }

    clearSessionCache();
    return await res.json();
  }, [token, fetchAPI, clearSessionCache]);

  // ============ Clear on Logout ============
  const clearE2EE = useCallback(() => {
    historyAskedRef.current.clear();
    setPrivateKey(null);
    setPublicKey(null);
    setPublicKeyBase64(null);
    setE2eeStatus(null);
    setNeedsPassphrase(false);
    setNeedsSetup(false);
    keyGenerationRef.current++;
    waveKeyCacheRef.current.clear();
    waveKeyInFlightRef.current.clear();
    versionKeyInFlightRef.current.clear();
    keyListInFlightRef.current.clear();
    keyRecordsRef.current = null;
    sealIdentityRef.current = null;
    setKeyChanges([]);
    clearSessionCache();
    sessionRestoreAttempted.current = false;
  }, [clearSessionCache]);

  // Signed out, by any route, means the key goes (v2.114.1). Only the gate's
  // own logout button used to call clearE2EE: Settings → LOGOUT, a revoked or
  // expired session all left the unlocked key in memory and the remembered one
  // in localStorage, next to the session key that decrypts it. AuthProvider
  // reads the token synchronously from storage, so a null token on mount is a
  // real sign-out too — which also sweeps keys those older sign-outs left behind.
  useEffect(() => {
    if (!token) clearE2EE();
  }, [token, clearE2EE]);

  // ============ Invalidate wave key cache ============
  const invalidateWaveKey = useCallback((waveId) => {
    keyGenerationRef.current++;
    waveKeyInFlightRef.current.delete(waveId);
    keyListInFlightRef.current.delete(waveId);
    for (const key of [...versionKeyInFlightRef.current.keys()]) {
      if (key.startsWith(`${waveId}:`)) versionKeyInFlightRef.current.delete(key);
    }
    waveKeyCacheRef.current.delete(waveId);
    for (const key of [...waveKeyCacheRef.current.keys()]) {
      if (key.startsWith(`${waveId}:`)) waveKeyCacheRef.current.delete(key);
    }
  }, []);

  // ============ Distribute key to new participant ============
  const distributeKeyToParticipant = useCallback(async (waveId, userId) => {
    if (!privateKey || !publicKeyBase64) {
      throw new Error('E2EE not unlocked');
    }

    // v2.143.0: this passed the cache entry ({ waveKey, version }) as the key
    // and sent an unserialised body, so it never worked; newcomers got the key
    // through a key request instead, which is still the usual way.
    const waveKey = await getWaveKey(waveId);
    if (!waveKey) {
      throw new Error('Wave key not found - reload the wave first');
    }

    try {
      const participantPublicKey = await lookUpKey(userId);
      if (!participantPublicKey) {
        throw new Error('Participant does not have E2EE set up');
      }

      // Encrypt wave key for the new participant
      const { encryptedWaveKey, nonce, senderPublicKey } = await crypto.addParticipantToWave(
        waveKey,
        participantPublicKey,
        privateKey,
        publicKeyBase64
      );

      // Call the distribute endpoint
      const distributeRes = await fetchAPI(`/waves/${waveId}/key/distribute`, {
        method: 'POST',
        body: JSON.stringify({
          userId,
          encryptedWaveKey: `${encryptedWaveKey}:${nonce}`,
          senderPublicKey
        })
      });

      if (!distributeRes.ok) {
        const error = await distributeRes.json().catch(() => ({}));
        throw new Error(error.error || 'Failed to distribute key');
      }

      return true;
    } catch (err) {
      console.error('Distribute key to participant error:', err);
      throw err;
    }
  }, [privateKey, publicKeyBase64, fetchAPI, getWaveKey, lookUpKey]);

  // ============ Encrypted Contacts (v2.18.0) ============

  // Get encrypted contacts from server and decrypt
  const getEncryptedContacts = useCallback(async () => {
    if (!privateKey || !publicKey) {
      throw new Error('E2EE not unlocked');
    }

    try {
      const res = await fetchAPI('/contacts/encrypted');
      if (!res.ok) {
        throw new Error('Failed to fetch encrypted contacts');
      }

      const data = await res.json();

      if (!data.encrypted) {
        return { contacts: null, needsMigration: true };
      }

      // Decrypt the contact list
      const contacts = await crypto.decryptContactList(
        data.encryptedData,
        data.nonce,
        privateKey,
        publicKey
      );

      return {
        contacts,
        version: data.version,
        updatedAt: data.updatedAt,
        needsMigration: false
      };
    } catch (err) {
      console.error('Get encrypted contacts error:', err);
      throw err;
    }
  }, [privateKey, publicKey, fetchAPI]);

  // Encrypt and save contacts to server
  const saveEncryptedContacts = useCallback(async (contacts, expectedVersion = null) => {
    if (!privateKey || !publicKey) {
      throw new Error('E2EE not unlocked');
    }

    try {
      // Encrypt the contact list
      const { encryptedData, nonce } = await crypto.encryptContactList(
        contacts,
        privateKey,
        publicKey
      );

      // Save to server
      const res = await fetchAPI('/contacts/encrypted', {
        method: 'PUT',
        body: JSON.stringify({
          encryptedData,
          nonce,
          expectedVersion
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to save encrypted contacts');
      }

      const data = await res.json();
      return { success: true, version: data.version };
    } catch (err) {
      console.error('Save encrypted contacts error:', err);
      throw err;
    }
  }, [privateKey, publicKey, fetchAPI]);

  // Get migration status for encrypted contacts
  const getContactsMigrationStatus = useCallback(async () => {
    try {
      const res = await fetchAPI('/contacts/encrypted/status');
      if (!res.ok) {
        throw new Error('Failed to get contacts migration status');
      }
      return await res.json();
    } catch (err) {
      console.error('Get contacts migration status error:', err);
      throw err;
    }
  }, [fetchAPI]);

  // Migrate existing plaintext contacts to encrypted storage
  const migrateContactsToEncrypted = useCallback(async () => {
    if (!privateKey || !publicKey) {
      throw new Error('E2EE not unlocked');
    }

    try {
      // Fetch current plaintext contacts
      const res = await fetchAPI('/contacts');
      if (!res.ok) {
        throw new Error('Failed to fetch contacts for migration');
      }

      const plaintextContacts = await res.json();

      if (plaintextContacts.length === 0) {
        // No contacts to migrate, just create empty encrypted storage
        return await saveEncryptedContacts([]);
      }

      // Encrypt and save the contacts
      const result = await saveEncryptedContacts(plaintextContacts);

      console.log(`E2EE: Migrated ${plaintextContacts.length} contacts to encrypted storage`);
      return result;
    } catch (err) {
      console.error('Migrate contacts to encrypted error:', err);
      throw err;
    }
  }, [privateKey, publicKey, fetchAPI, saveEncryptedContacts]);

  // ============ Context Value ============
  const value = {
    // Status
    e2eeStatus,
    isE2EEEnabled: e2eeStatus?.enabled || false,
    isUnlocked: !!privateKey,
    needsPassphrase,
    needsSetup,
    isUnlocking,
    unlockError,

    // Keys (for display/verification only)
    publicKeyBase64,

    // Actions
    checkE2EEStatus,
    setupE2EE,
    unlockE2EE,
    recoverWithPassphrase,
    regenerateRecoveryKey,
    reencryptWithPassword,
    resetE2EEKeys,
    clearE2EE,

    // Wave operations
    getWaveKey,
    requestWaveKey,
    grantWaveKey,
    createWaveWithEncryption,
    invalidateWaveKey,
    rotateWaveKey,
    runPendingRotations,
    distributeKeyToParticipant,

    // Keys seen (v2.143.0)
    lookUpKey,
    keyChanges,
    acknowledgeKeyChange,

    // Fingerprints and verification (v2.149.0)
    myFingerprint,
    describeKey,
    markKeyVerified,
    unmarkKeyVerified,
    keyStandingOf,
    keyRecordsTick,

    // Legacy wave migration
    getWaveEncryptionStatus,
    enableWaveEncryption,
    encryptLegacyWaveBatch,

    // Ping operations
    encryptPing,
    decryptPing,

    // Audio operations (v2.3.0)
    encryptAudioChunk,
    decryptAudioChunk,

    // Encrypted contacts (v2.18.0)
    getEncryptedContacts,
    saveEncryptedContacts,
    getContactsMigrationStatus,
    migrateContactsToEncrypted,

    // Crypto availability check
    isCryptoAvailable: crypto.isCryptoAvailable()
  };

  return (
    <E2EEContext.Provider value={value}>
      {children}
    </E2EEContext.Provider>
  );
}

export default E2EEContext;

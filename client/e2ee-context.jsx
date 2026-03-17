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

// Remember duration options (in milliseconds)
export const REMEMBER_DURATIONS = {
  session: 0,  // Use sessionStorage (current behavior)
  days7: 7 * 24 * 60 * 60 * 1000,   // 7 days
  days30: 30 * 24 * 60 * 60 * 1000, // 30 days
};

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
  const sessionRestoreAttempted = useRef(false);

  // ============ Session Cache Helpers ============
  const saveToSessionCache = useCallback(async (privKey, pubKeyBase64, duration = 'session') => {
    try {
      // Generate a session key and encrypt the private key
      const { key: sessionKey, keyBase64 } = await crypto.generateSessionKey();
      const jwkString = await crypto.exportPrivateKeyForSession(privKey);
      const encryptedData = await crypto.encryptForSession(jwkString, sessionKey);

      const durationMs = REMEMBER_DURATIONS[duration] || 0;

      if (durationMs > 0) {
        // Use localStorage with expiry for persistent storage
        const expiryTime = Date.now() + durationMs;
        localStorage.setItem(PERSISTENT_KEY_STORAGE, keyBase64);
        localStorage.setItem(PERSISTENT_DATA_STORAGE, encryptedData);
        localStorage.setItem(PERSISTENT_PUBLIC_KEY, pubKeyBase64);
        localStorage.setItem(PERSISTENT_EXPIRY, expiryTime.toString());
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
  }, []);

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
  const setupE2EE = useCallback(async (passphrase, createRecoveryKey = true, rememberDuration = 'session') => {
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
  const unlockE2EE = useCallback(async (passphrase, rememberDuration = 'session') => {
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

      const { encryptedPrivateKey, recoverySalt } = await res.json();

      // Decrypt with recovery passphrase
      const privKey = await crypto.recoverPrivateKey(recoveryPassphrase, encryptedPrivateKey, recoverySalt);

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
  const getWaveKey = useCallback(async (waveId) => {
    // Check cache first
    const cached = waveKeyCacheRef.current.get(waveId);
    if (cached) {
      return cached.waveKey;
    }

    if (!privateKey) {
      throw new Error('E2EE not unlocked');
    }

    try {
      // Fetch from server
      const res = await fetchAPI(`/waves/${waveId}/key`);
      if (!res.ok) {
        const err = await res.json();
        if (!err.encrypted) return null;  // Wave not encrypted
        throw new Error(err.error || 'Failed to fetch wave key');
      }

      const { encrypted, encryptedWaveKey, senderPublicKey, keyVersion } = await res.json();

      if (!encrypted) {
        return null;  // Wave not encrypted
      }

      // Parse the encrypted key (format: encryptedKey:nonce)
      const [encKeyBase64, nonceBase64] = encryptedWaveKey.split(':');

      // Import sender's public key
      const senderPubKey = await crypto.importPublicKey(senderPublicKey);

      // Decrypt wave key
      const waveKey = await crypto.decryptWaveKey(encKeyBase64, nonceBase64, senderPubKey, privateKey);

      // Cache it (with LRU eviction)
      if (waveKeyCacheRef.current.size >= WAVE_KEY_CACHE_MAX) {
        const firstKey = waveKeyCacheRef.current.keys().next().value;
        waveKeyCacheRef.current.delete(firstKey);
      }
      waveKeyCacheRef.current.set(waveId, { waveKey, version: keyVersion });

      return waveKey;
    } catch (err) {
      console.error('Get wave key error:', err);
      throw err;
    }
  }, [privateKey, fetchAPI]);

  const createWaveWithEncryption = useCallback(async (participants) => {
    if (!privateKey || !publicKeyBase64) {
      throw new Error('E2EE not unlocked');
    }

    try {
      // Get participant public keys
      const participantKeys = await Promise.all(
        participants.map(async (userId) => {
          const res = await fetchAPI(`/e2ee/keys/user/${userId}`);
          if (res.ok) {
            const { publicKey } = await res.json();
            return { userId, publicKey };
          }
          return { userId, publicKey: null };
        })
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
  }, [privateKey, publicKeyBase64, fetchAPI]);

  // ============ Encrypt/Decrypt Pings ============
  const encryptPing = useCallback(async (content, waveId) => {
    const waveKey = await getWaveKey(waveId);
    if (!waveKey) {
      throw new Error('Wave key not found');
    }

    const { ciphertext, nonce } = await crypto.encryptPing(content, waveKey);
    return { ciphertext, nonce };
  }, [getWaveKey]);

  const decryptPing = useCallback(async (ciphertext, nonce, waveId, keyVersion = null) => {
    // For key rotation: may need to get specific version
    let waveKey;

    if (keyVersion !== null) {
      // Fetch specific version
      const cached = waveKeyCacheRef.current.get(`${waveId}:${keyVersion}`);
      if (cached) {
        waveKey = cached.waveKey;
      } else {
        // Need to fetch old version from server
        const res = await fetchAPI(`/waves/${waveId}/keys/all`);
        if (res.ok) {
          const { keys } = await res.json();
          const versionKey = keys.find(k => k.keyVersion === keyVersion);
          if (versionKey) {
            const [encKeyBase64, nonceBase64] = versionKey.encryptedWaveKey.split(':');
            const senderPubKey = await crypto.importPublicKey(versionKey.senderPublicKey);
            waveKey = await crypto.decryptWaveKey(encKeyBase64, nonceBase64, senderPubKey, privateKey);
            waveKeyCacheRef.current.set(`${waveId}:${keyVersion}`, { waveKey, version: keyVersion });
          }
        }
      }
    } else {
      waveKey = await getWaveKey(waveId);
    }

    if (!waveKey) {
      throw new Error('Wave key not found');
    }

    return crypto.decryptPing(ciphertext, nonce, waveKey);
  }, [getWaveKey, fetchAPI, privateKey]);

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
        participantIds.map(async (userId) => {
          const res = await fetchAPI(`/e2ee/keys/user/${userId}`);
          if (res.ok) {
            const { publicKey } = await res.json();
            return { userId, publicKey };
          }
          return { userId, publicKey: null };
        })
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
  }, [privateKey, publicKeyBase64, fetchAPI]);

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
  const rotateWaveKey = useCallback(async (waveId, remainingParticipantIds) => {
    if (!privateKey || !publicKeyBase64) {
      throw new Error('E2EE not unlocked');
    }

    try {
      // Get public keys for remaining participants
      const participantKeys = await Promise.all(
        remainingParticipantIds.map(async (userId) => {
          const res = await fetchAPI(`/e2ee/keys/user/${userId}`);
          if (res.ok) {
            const { publicKey } = await res.json();
            return { userId, publicKey };
          }
          return { userId, publicKey: null };
        })
      );

      // Add self
      participantKeys.push({ userId: 'self', publicKey: publicKeyBase64 });

      // Generate new wave key and distribute
      const { waveKey, keyDistribution } = await crypto.setupWaveEncryption(
        participantKeys.filter(p => p.publicKey),
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

      // Call rotation endpoint
      const res = await fetchAPI(`/waves/${waveId}/key/rotate`, {
        method: 'POST',
        body: JSON.stringify({ keyDistribution: formattedDistribution })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to rotate wave key');
      }

      const { newKeyVersion } = await res.json();

      // Invalidate cached key so new one is fetched
      waveKeyCacheRef.current.delete(waveId);

      return { success: true, newKeyVersion };
    } catch (err) {
      console.error('Wave key rotation error:', err);
      throw err;
    }
  }, [privateKey, publicKeyBase64, fetchAPI]);

  // ============ Clear on Logout ============
  const clearE2EE = useCallback(() => {
    setPrivateKey(null);
    setPublicKey(null);
    setPublicKeyBase64(null);
    setE2eeStatus(null);
    setNeedsPassphrase(false);
    setNeedsSetup(false);
    waveKeyCacheRef.current.clear();
    clearSessionCache();
    sessionRestoreAttempted.current = false;
  }, [clearSessionCache]);

  // ============ Invalidate wave key cache ============
  const invalidateWaveKey = useCallback((waveId) => {
    waveKeyCacheRef.current.delete(waveId);
  }, []);

  // ============ Distribute key to new participant ============
  const distributeKeyToParticipant = useCallback(async (waveId, userId) => {
    if (!privateKey || !publicKeyBase64) {
      throw new Error('E2EE not unlocked');
    }

    // Get the cached wave key
    const waveKey = waveKeyCacheRef.current.get(waveId);
    if (!waveKey) {
      throw new Error('Wave key not found in cache - reload the wave first');
    }

    try {
      // Get the new participant's public key
      const res = await fetchAPI(`/e2ee/keys/user/${userId}`);
      if (!res.ok) {
        throw new Error('Failed to get participant public key - they may not have E2EE set up');
      }
      const { publicKey: participantPublicKey } = await res.json();
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
        body: {
          userId,
          encryptedWaveKey: `${encryptedWaveKey}:${nonce}`,
          senderPublicKey
        }
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
  }, [privateKey, publicKeyBase64, fetchAPI]);

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
    clearE2EE,

    // Wave operations
    getWaveKey,
    createWaveWithEncryption,
    invalidateWaveKey,
    rotateWaveKey,
    distributeKeyToParticipant,

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

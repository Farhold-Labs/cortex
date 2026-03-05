import React, { useState, useEffect, useRef } from 'react';
import { useE2EE } from '../../../e2ee-context.jsx';
import { useWindowSize } from '../../hooks/useWindowSize.js';
import { SUCCESS, CONFIRM, CONFIRM_DIALOG, EMPTY, UI_LABELS, formatError } from '../../../messages.js';
import { API_URL, canAccess, FONT_SIZES } from '../../config/constants.js';
import { THEMES } from '../../config/themes.js';
import { storage } from '../../utils/storage.js';
import { applyCustomTheme, removeCustomTheme } from '../../hooks/useTheme.js';
import { subscribeToPush, unsubscribeFromPush, forceResetPushState } from '../../utils/pwa.js';
import { Avatar, GlowText, LoadingSpinner } from '../ui/SimpleComponents.jsx';
import { E2EEStatusIndicator } from '../../../e2ee-components.jsx';
import CollapsibleSection from '../ui/CollapsibleSection.jsx';
import MyReportsPanel from '../reports/MyReportsPanel.jsx';

// Admin panel imports
import UserManagementPanel from '../admin/UserManagementPanel.jsx';
import AdminReportsPanel from '../admin/AdminReportsPanel.jsx';
import ActivityLogPanel from '../admin/ActivityLogPanel.jsx';
import CrawlBarAdminPanel from '../admin/CrawlBarAdminPanel.jsx';
import AlertsAdminPanel from '../admin/AlertsAdminPanel.jsx';
import AlertSubscriptionsPanel from '../admin/AlertSubscriptionsPanel.jsx';
import FederationAdminPanel from '../admin/FederationAdminPanel.jsx';
import HandleRequestsList from '../admin/HandleRequestsList.jsx';
import BotsAdminPanel from '../admin/BotsAdminPanel.jsx';
import PrivacyDashboard from '../admin/PrivacyDashboard.jsx';
import ThemeCustomizationModal from '../settings/ThemeCustomizationModal.jsx';
import JellyfinConnectionManager from '../media/JellyfinConnectionManager.jsx';
import PlexConnectionManager from '../media/PlexConnectionManager.jsx';

const ProfileSettings = ({ user, fetchAPI, showToast, onUserUpdate, onLogout, federationRequestsRefresh, onNotifPrefsChange }) => {
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [email, setEmail] = useState(user?.email || '');
  const [avatar, setAvatar] = useState(user?.avatar || '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl || null);
  const [bio, setBio] = useState(user?.bio || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newHandle, setNewHandle] = useState('');
  const [showBlockedMuted, setShowBlockedMuted] = useState(false);
  // Accordion state - only one top-level section open at a time
  const [openSection, setOpenSection] = useState(null); // 'handle' | 'security' | 'display' | 'crawl' | 'notifications' | 'admin' | 'account' | null
  const toggleSection = (section) => setOpenSection(prev => prev === section ? null : section);
  // Accordion state for Security subsections
  const [openSecuritySection, setOpenSecuritySection] = useState(null); // 'password' | 'mfa' | 'e2ee' | 'sessions' | 'blocked' | null
  const toggleSecuritySection = (section) => setOpenSecuritySection(prev => prev === section ? null : section);
  // Accordion state for Admin Panel subsections
  const [openAdminSection, setOpenAdminSection] = useState(null); // 'users' | 'reports' | 'activity' | 'handles' | 'crawl' | 'alerts' | 'subscriptions' | 'federation' | null
  const toggleAdminSection = (section) => setOpenAdminSection(prev => prev === section ? null : section);
  const [notificationPrefs, setNotificationPrefs] = useState(null);
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [mutedUsers, setMutedUsers] = useState([]);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(storage.getPushEnabled());
  const [pushError, setPushError] = useState(null);
  const [crawlBarLocation, setCrawlBarLocation] = useState(user?.preferences?.crawlBar?.locationName || '');
  // MFA state
  const [showMfaSetup, setShowMfaSetup] = useState(false);
  const [mfaStatus, setMfaStatus] = useState(null);
  const [mfaSetupStep, setMfaSetupStep] = useState(null); // 'totp-setup', 'totp-verify', 'email-setup', 'email-verify', 'email-disable'
  const [totpSetupData, setTotpSetupData] = useState(null);
  const [totpVerifyCode, setTotpVerifyCode] = useState('');
  const [emailVerifyCode, setEmailVerifyCode] = useState('');
  const [emailChallengeId, setEmailChallengeId] = useState(null);
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaDisablePassword, setMfaDisablePassword] = useState('');
  const [mfaDisableCode, setMfaDisableCode] = useState('');
  // Session management state (v1.18.0)
  const [showSessions, setShowSessions] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [sessionsEnabled, setSessionsEnabled] = useState(true);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  // Account management state (v1.18.0)
  const [showAccountManagement, setShowAccountManagement] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  // Theme customization modal state (v2.11.0)
  const [showThemeModal, setShowThemeModal] = useState(false);
  const [availableThemes, setAvailableThemes] = useState([]); // User's custom + installed themes
  // E2EE Recovery Key state (v1.19.0)
  const [showE2EERecovery, setShowE2EERecovery] = useState(false);
  const [e2eeRecoveryKey, setE2eeRecoveryKey] = useState(null);
  const [e2eeRecoveryLoading, setE2eeRecoveryLoading] = useState(false);
  const [e2eeRecoveryCopied, setE2eeRecoveryCopied] = useState(false);
  const fileInputRef = useRef(null);
  const { width, isMobile, isTablet, isDesktop } = useWindowSize();
  const e2ee = useE2EE();

  // Load blocked/muted users when section is expanded
  useEffect(() => {
    if (showBlockedMuted) {
      Promise.all([
        fetchAPI('/users/blocked'),
        fetchAPI('/users/muted')
      ]).then(([blockedData, mutedData]) => {
        setBlockedUsers(blockedData.blockedUsers || []);
        setMutedUsers(mutedData.mutedUsers || []);
      }).catch(err => {
        console.error('Failed to load blocked/muted users:', err);
      });
    }
  }, [showBlockedMuted, fetchAPI]);

  // Load notification preferences when section is expanded
  useEffect(() => {
    if (openSection === 'notifications' && !notificationPrefs) {
      fetchAPI('/notifications/preferences')
        .then(data => setNotificationPrefs(data.preferences))
        .catch(err => console.error('Failed to load notification preferences:', err));
    }
  }, [openSection, notificationPrefs, fetchAPI]);

  // Load user's available custom themes (v2.11.0)
  useEffect(() => {
    fetchAPI('/themes')
      .then(data => {
        // Combine own themes and installed themes
        const allCustomThemes = [
          ...(data.ownThemes || []),
          ...(data.installedThemes || []),
        ];
        setAvailableThemes(allCustomThemes);
      })
      .catch(err => console.error('Failed to load custom themes:', err));
  }, [fetchAPI, showThemeModal]); // Refetch when modal closes (in case themes changed)

  // Load MFA status when section is expanded
  useEffect(() => {
    if (openSecuritySection === 'mfa' && !mfaStatus) {
      fetchAPI('/auth/mfa/status')
        .then(data => setMfaStatus(data))
        .catch(err => console.error('Failed to load MFA status:', err));
    }
  }, [openSecuritySection, mfaStatus, fetchAPI]);

  // Load sessions when section is expanded (v1.18.0)
  useEffect(() => {
    if (openSecuritySection === 'sessions') {
      setSessionsLoading(true);
      fetchAPI('/auth/sessions')
        .then(data => {
          setSessions(data.sessions || []);
          setSessionsEnabled(data.enabled !== false);
        })
        .catch(err => {
          console.error('Failed to load sessions:', err);
          setSessionsEnabled(false);
        })
        .finally(() => setSessionsLoading(false));
    }
  }, [openSecuritySection, fetchAPI]);

  // Sync crawl bar location when user preferences change
  useEffect(() => {
    setCrawlBarLocation(user?.preferences?.crawlBar?.locationName || '');
  }, [user?.preferences?.crawlBar?.locationName]);

  // MFA handler functions
  const loadMfaStatus = async () => {
    try {
      const data = await fetchAPI('/auth/mfa/status');
      setMfaStatus(data);
    } catch (err) {
      console.error('Failed to load MFA status:', err);
    }
  };

  const handleStartTotpSetup = async () => {
    setMfaLoading(true);
    try {
      const data = await fetchAPI('/auth/mfa/totp/setup', { method: 'POST' });
      setTotpSetupData(data);
      setMfaSetupStep('totp-verify');
    } catch (err) {
      showToast(err.message || formatError('Failed to start TOTP setup'), 'error');
    }
    setMfaLoading(false);
  };

  const handleVerifyTotp = async () => {
    setMfaLoading(true);
    try {
      const data = await fetchAPI('/auth/mfa/totp/verify', { method: 'POST', body: { code: totpVerifyCode } });
      setRecoveryCodes(data.recoveryCodes);
      setMfaSetupStep(null);
      setTotpSetupData(null);
      setTotpVerifyCode('');
      loadMfaStatus();
      showToast('TOTP enabled successfully!', 'success');
    } catch (err) {
      showToast(err.message || 'Invalid code. Please try again.', 'error');
    }
    setMfaLoading(false);
  };

  const handleDisableTotp = async () => {
    if (!mfaDisablePassword || !mfaDisableCode) {
      showToast('Password and code are required', 'error');
      return;
    }
    setMfaLoading(true);
    try {
      await fetchAPI('/auth/mfa/totp/disable', { method: 'POST', body: { password: mfaDisablePassword, code: mfaDisableCode } });
      setMfaDisablePassword('');
      setMfaDisableCode('');
      loadMfaStatus();
      showToast('TOTP disabled successfully', 'success');
    } catch (err) {
      showToast(err.message || formatError('Failed to disable TOTP'), 'error');
    }
    setMfaLoading(false);
  };

  const handleStartEmailMfa = async () => {
    setMfaLoading(true);
    try {
      const data = await fetchAPI('/auth/mfa/email/enable', { method: 'POST' });
      setEmailChallengeId(data.challengeId);
      setMfaSetupStep('email-verify');
      showToast('Verification code sent to your email', 'success');
    } catch (err) {
      showToast(err.message || formatError('Failed to start email MFA setup'), 'error');
    }
    setMfaLoading(false);
  };

  const handleVerifyEmailMfa = async () => {
    setMfaLoading(true);
    try {
      const data = await fetchAPI('/auth/mfa/email/verify-setup', { method: 'POST', body: { challengeId: emailChallengeId, code: emailVerifyCode } });
      if (data.recoveryCodes) {
        setRecoveryCodes(data.recoveryCodes);
      }
      setMfaSetupStep(null);
      setEmailChallengeId(null);
      setEmailVerifyCode('');
      loadMfaStatus();
      showToast('Email MFA enabled successfully!', 'success');
    } catch (err) {
      showToast(err.message || 'Invalid code. Please try again.', 'error');
    }
    setMfaLoading(false);
  };

  const handleRequestDisableEmailMfa = async () => {
    if (!mfaDisablePassword) {
      showToast('Password is required', 'error');
      return;
    }
    setMfaLoading(true);
    try {
      const data = await fetchAPI('/auth/mfa/email/disable/request', { method: 'POST', body: { password: mfaDisablePassword } });
      setEmailChallengeId(data.challengeId);
      setMfaSetupStep('email-disable');
      setMfaDisablePassword('');
      showToast('Verification code sent to your email', 'success');
    } catch (err) {
      showToast(err.message || formatError('Failed to send verification code'), 'error');
    }
    setMfaLoading(false);
  };

  const handleConfirmDisableEmailMfa = async () => {
    if (!emailVerifyCode || emailVerifyCode.length !== 6) {
      showToast('Please enter the 6-digit code', 'error');
      return;
    }
    setMfaLoading(true);
    try {
      await fetchAPI('/auth/mfa/email/disable', { method: 'POST', body: { challengeId: emailChallengeId, code: emailVerifyCode } });
      setMfaSetupStep(null);
      setEmailChallengeId(null);
      setEmailVerifyCode('');
      loadMfaStatus();
      showToast('Email MFA disabled successfully', 'success');
    } catch (err) {
      showToast(err.message || 'Invalid verification code', 'error');
    }
    setMfaLoading(false);
  };

  const handleRegenerateRecoveryCodes = async () => {
    if (!mfaDisablePassword) {
      showToast('Password is required', 'error');
      return;
    }
    setMfaLoading(true);
    try {
      const body = { password: mfaDisablePassword };
      if (mfaStatus?.totpEnabled) {
        body.mfaMethod = 'totp';
        body.mfaCode = mfaDisableCode;
      }
      const data = await fetchAPI('/auth/mfa/recovery/regenerate', { method: 'POST', body });
      setRecoveryCodes(data.recoveryCodes);
      setMfaDisablePassword('');
      setMfaDisableCode('');
      showToast('Recovery codes regenerated', 'success');
    } catch (err) {
      showToast(err.message || formatError('Failed to regenerate recovery codes'), 'error');
    }
    setMfaLoading(false);
  };

  // Session management handlers (v1.18.0)
  const loadSessions = async () => {
    setSessionsLoading(true);
    try {
      const data = await fetchAPI('/auth/sessions');
      setSessions(data.sessions || []);
      setSessionsEnabled(data.enabled !== false);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    }
    setSessionsLoading(false);
  };

  const handleRevokeSession = async (sessionId) => {
    try {
      await fetchAPI(`/auth/sessions/${sessionId}/revoke`, { method: 'POST' });
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      showToast('Session revoked', 'success');
    } catch (err) {
      showToast(err.message || formatError('Failed to revoke session'), 'error');
    }
  };

  const handleRevokeAllSessions = async () => {
    try {
      const data = await fetchAPI('/auth/sessions/revoke-all', { method: 'POST' });
      showToast(`${data.revoked} session(s) revoked`, 'success');
      loadSessions(); // Refresh the list
    } catch (err) {
      showToast(err.message || formatError('Failed to revoke sessions'), 'error');
    }
  };

  const formatSessionDate = (dateStr) => {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return 'Invalid Date';
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const formatExpirationDate = (dateStr) => {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return 'Unknown';
    const now = new Date();
    const diffMs = date - now;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    // Already expired
    if (diffMs < 0) return 'Expired';

    // Future date - show time remaining
    if (diffMins < 60) return `in ${diffMins}m`;
    if (diffHours < 24) return `in ${diffHours}h`;
    if (diffDays < 7) return `in ${diffDays}d`;

    // Far future - show absolute date
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const parseDeviceInfo = (userAgent) => {
    if (!userAgent || userAgent === 'Unknown') return { device: 'Unknown', browser: '' };

    let browser = '';
    let device = '';

    // Detect browser
    if (userAgent.includes('Firefox')) browser = 'Firefox';
    else if (userAgent.includes('Edg/')) browser = 'Edge';
    else if (userAgent.includes('Chrome')) browser = 'Chrome';
    else if (userAgent.includes('Safari')) browser = 'Safari';
    else browser = 'Browser';

    // Detect device/OS
    if (userAgent.includes('iPhone')) device = 'iPhone';
    else if (userAgent.includes('iPad')) device = 'iPad';
    else if (userAgent.includes('Android')) device = 'Android';
    else if (userAgent.includes('Windows')) device = 'Windows';
    else if (userAgent.includes('Mac')) device = 'Mac';
    else if (userAgent.includes('Linux')) device = 'Linux';
    else device = 'Device';

    return { device, browser };
  };

  // Account management handlers (v1.18.0)
  const handleExportData = async () => {
    setExportLoading(true);
    try {
      const response = await fetch(`${window.API_URL || ''}/api/account/export`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('farhold_token')}`
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Export failed');
      }

      // Get the filename from Content-Disposition header or use default
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `farhold-data-export-${user?.handle || 'user'}-${new Date().toISOString().split('T')[0]}.json`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="(.+)"/);
        if (match) filename = match[1];
      }

      // Download the file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      showToast('Data exported successfully', 'success');
    } catch (err) {
      showToast(err.message || formatError('Failed to export data'), 'error');
    }
    setExportLoading(false);
  };

  const handleDeleteAccount = async () => {
    if (!deletePassword) {
      showToast('Password required to delete account', 'error');
      return;
    }

    setDeleteLoading(true);
    try {
      await fetchAPI('/account/delete', {
        method: 'POST',
        body: { password: deletePassword }
      });

      showToast('Account deleted. Goodbye!', 'success');

      // Clear storage and logout
      setTimeout(() => {
        onLogout();
      }, 1500);
    } catch (err) {
      showToast(err.message || formatError('Failed to delete account'), 'error');
      setDeleteLoading(false);
    }
  };

  const handleUpdateNotificationPrefs = async (updates) => {
    try {
      const data = await fetchAPI('/notifications/preferences', { method: 'PUT', body: updates });
      setNotificationPrefs(data.preferences);
      if (onNotifPrefsChange) onNotifPrefsChange(data.preferences);
      showToast('Notification preferences updated', 'success');
    } catch (err) {
      showToast(err.message || formatError('Failed to update notification preferences'), 'error');
    }
  };

  const handleUnblock = async (userId, name) => {
    try {
      await fetchAPI(`/users/${userId}/block`, { method: 'DELETE' });
      setBlockedUsers(prev => prev.filter(u => u.blockedUserId !== userId));
      showToast(`Unblocked ${name}`, 'success');
    } catch (err) {
      showToast(err.message || formatError('Failed to unblock user'), 'error');
    }
  };

  const handleUnmute = async (userId, name) => {
    try {
      await fetchAPI(`/users/${userId}/mute`, { method: 'DELETE' });
      setMutedUsers(prev => prev.filter(u => u.mutedUserId !== userId));
      showToast(`Unmuted ${name}`, 'success');
    } catch (err) {
      showToast(err.message || formatError('Failed to unmute user'), 'error');
    }
  };

  const handleSaveProfile = async () => {
    try {
      const updated = await fetchAPI('/profile', { method: 'PUT', body: { displayName, email, avatar, bio } });
      showToast(SUCCESS.profileUpdated, 'success');
      onUserUpdate?.(updated);
    } catch (err) {
      showToast(err.message || formatError('Failed to update profile'), 'error');
    }
  };

  const handleAvatarUpload = async (file) => {
    if (!file) return;

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      showToast('Invalid file type. Allowed: jpg, png, gif, webp', 'error');
      return;
    }

    // Validate file size (2MB max)
    if (file.size > 2 * 1024 * 1024) {
      showToast('File too large. Maximum size is 2MB', 'error');
      return;
    }

    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append('avatar', file);

      const response = await fetch(`${API_URL}/profile/avatar`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('farhold_token')}`,
        },
        body: formData,
      });

      // Try to parse as JSON, handle non-JSON responses gracefully
      let data;
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const text = await response.text();
        throw new Error(text || `Server error (${response.status})`);
      }

      if (!response.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      setAvatarUrl(data.avatarUrl);
      onUserUpdate?.({ ...user, avatarUrl: data.avatarUrl });
      showToast('Profile image uploaded', 'success');
    } catch (err) {
      console.error('Avatar upload error:', err);
      showToast(err.message || formatError('Failed to upload image'), 'error');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleRemoveAvatar = async () => {
    try {
      await fetchAPI('/profile/avatar', { method: 'DELETE' });
      setAvatarUrl(null);
      onUserUpdate?.({ ...user, avatarUrl: null });
      showToast('Profile image removed', 'success');
    } catch (err) {
      showToast(err.message || formatError('Failed to remove image'), 'error');
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) return;
    if (newPassword !== confirmPassword) {
      showToast('New passwords do not match', 'error');
      return;
    }
    try {
      await fetchAPI('/profile/password', { method: 'POST', body: { currentPassword, newPassword } });

      // Re-encrypt E2EE private key with new password
      if (e2ee.isUnlocked && e2ee.reencryptWithPassword) {
        try {
          await e2ee.reencryptWithPassword(newPassword);
          showToast('Password and encryption keys updated', 'success');
        } catch (e2eeErr) {
          console.error('E2EE re-encryption failed:', e2eeErr);
          showToast('Password changed, but encryption update failed. You may need to use your recovery key on next login.', 'error');
        }
      } else if (e2ee.isE2EEEnabled) {
        // E2EE is enabled but not unlocked - warn user
        showToast('Password changed. Note: E2EE keys were not updated. Use your recovery key to unlock E2EE.', 'info');
      } else {
        showToast(SUCCESS.passwordChanged, 'success');
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      showToast(err.message || formatError('Failed to change password'), 'error');
    }
  };

  const handleRequestHandleChange = async () => {
    if (!newHandle) return;
    try {
      await fetchAPI('/profile/handle-request', { method: 'POST', body: { newHandle } });
      showToast('Handle change request submitted', 'success');
      setNewHandle('');
    } catch (err) {
      showToast(err.message || formatError('Failed to request handle change'), 'error');
    }
  };

  const handleUpdatePreferences = async (updates) => {
    try {
      const result = await fetchAPI('/profile/preferences', { method: 'PUT', body: updates });
      showToast('Preferences updated', 'success');
      // Update user with new preferences
      onUserUpdate?.({ ...user, preferences: result.preferences });
    } catch (err) {
      showToast(err.message || formatError('Failed to update preferences'), 'error');
    }
  };

  const inputStyle = {
    width: '100%', padding: '10px 12px', boxSizing: 'border-box',
    background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
    color: 'var(--text-primary)', fontSize: '0.9rem', fontFamily: 'inherit',
  };

  return (
    <div style={{ flex: 1, padding: isMobile ? '16px' : '20px', overflowY: 'auto' }}>
      <GlowText color="var(--accent-amber)" size="1.1rem">PROFILE SETTINGS</GlowText>

      {/* Profile Info */}
      <div style={{ marginTop: '24px', padding: '20px', background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))', border: '1px solid var(--border-subtle)' }}>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: '16px' }}>PROFILE</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <Avatar letter={avatar || displayName?.[0] || '?'} color="var(--accent-amber)" size={60} imageUrl={avatarUrl} />
          <div>
            <div style={{ color: 'var(--text-primary)', fontSize: '1.1rem' }}>{displayName || user?.displayName}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>@{user?.handle}</div>
          </div>
        </div>

        {/* Profile Image Upload */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>PROFILE IMAGE</label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
              style={{ display: 'none' }}
              onChange={(e) => handleAvatarUpload(e.target.files[0])}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
              style={{
                padding: isMobile ? '10px 16px' : '8px 14px',
                minHeight: isMobile ? '44px' : 'auto',
                background: 'var(--accent-green)20',
                border: '1px solid var(--accent-green)',
                color: 'var(--accent-green)',
                cursor: uploadingAvatar ? 'wait' : 'pointer',
                fontFamily: 'monospace',
                fontSize: isMobile ? '0.85rem' : '0.8rem',
              }}
            >
              {uploadingAvatar ? 'UPLOADING...' : 'UPLOAD IMAGE'}
            </button>
            {avatarUrl && (
              <button
                onClick={handleRemoveAvatar}
                style={{
                  padding: isMobile ? '10px 16px' : '8px 14px',
                  minHeight: isMobile ? '44px' : 'auto',
                  background: 'transparent',
                  border: '1px solid var(--accent-orange)',
                  color: 'var(--accent-orange)',
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                  fontSize: isMobile ? '0.85rem' : '0.8rem',
                }}
              >
                REMOVE IMAGE
              </button>
            )}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '4px' }}>
            Max 2MB. Formats: jpg, png, gif, webp. Image will be resized to 256×256.
          </div>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>DISPLAY NAME</label>
          <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={inputStyle} />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>EMAIL</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com" style={inputStyle} />
          <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '4px' }}>
            Used for password recovery and email-based MFA.
          </div>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>FALLBACK AVATAR (1-2 characters)</label>
          <input type="text" value={avatar} onChange={(e) => setAvatar(e.target.value.slice(0, 2))} maxLength={2} style={inputStyle} />
          <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '4px' }}>
            Shown when no profile image is set or if it fails to load.
          </div>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>
            BIO <span style={{ color: 'var(--text-muted)' }}>({bio.length}/500)</span>
          </label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, 500))}
            maxLength={500}
            rows={4}
            placeholder="Tell others about yourself..."
            style={{
              ...inputStyle,
              minHeight: '80px',
              resize: 'vertical',
            }}
          />
        </div>

        <button onClick={handleSaveProfile} style={{
          padding: '10px 20px', background: 'var(--accent-amber)20', border: '1px solid var(--accent-amber)',
          color: 'var(--accent-amber)', cursor: 'pointer', fontFamily: 'monospace',
        }}>SAVE PROFILE</button>
      </div>

      {/* Handle Change */}
      <CollapsibleSection title="HANDLE CHANGE" isOpen={openSection === 'handle'} onToggle={() => toggleSection('handle')} isMobile={isMobile}>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '12px' }}>
          Handle changes require admin approval. You can change your handle once every 30 days.
        </div>
        <div style={{ marginBottom: '16px' }}>
          <input type="text" value={newHandle} onChange={(e) => setNewHandle(e.target.value)}
            placeholder="New handle..." style={inputStyle} />
        </div>
        <button onClick={handleRequestHandleChange} disabled={!newHandle} style={{
          padding: '10px 20px',
          background: newHandle ? 'var(--accent-teal)20' : 'transparent',
          border: `1px solid ${newHandle ? 'var(--accent-teal)' : 'var(--border-primary)'}`,
          color: newHandle ? 'var(--accent-teal)' : 'var(--text-muted)',
          cursor: newHandle ? 'pointer' : 'not-allowed', fontFamily: 'monospace',
        }}>REQUEST CHANGE</button>
      </CollapsibleSection>

      {/* Security Section */}
      <CollapsibleSection title="🔒 SECURITY" isOpen={openSection === 'security'} onToggle={() => toggleSection('security')} isMobile={isMobile} accentColor="var(--accent-orange)">
        {/* Change Password Sub-section */}
        <CollapsibleSection title="CHANGE PASSWORD" isOpen={openSecuritySection === 'password'} onToggle={() => toggleSecuritySection('password')} isMobile={isMobile}>
          {/* E2EE Warning: Show when E2EE is enabled but not unlocked */}
          {e2ee.isE2EEEnabled && !e2ee.isUnlocked && (
            <div style={{
              marginBottom: '16px',
              padding: '12px',
              background: 'var(--accent-orange)15',
              border: '1px solid var(--accent-orange)',
              borderRadius: '4px'
            }}>
              <div style={{ color: 'var(--accent-orange)', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '8px' }}>
                ⚠️ E2EE Not Unlocked
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '8px' }}>
                Your end-to-end encryption is not currently unlocked. If you change your password now, your E2EE keys will remain encrypted with your <strong>old password</strong>.
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '8px' }}>
                To update your E2EE keys with your new password, please unlock E2EE first by entering your current password in the E2EE unlock prompt.
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', fontStyle: 'italic' }}>
                If you proceed without unlocking, you will need to use your E2EE recovery key after changing your password.
              </div>
            </div>
          )}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>CURRENT PASSWORD</label>
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>NEW PASSWORD</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Min 8 chars, upper, lower, number" style={inputStyle} />
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>CONFIRM NEW PASSWORD</label>
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password" style={{
                ...inputStyle,
                borderColor: confirmPassword && newPassword !== confirmPassword ? 'var(--accent-orange)' : 'var(--border-subtle)',
              }} />
            {confirmPassword && newPassword !== confirmPassword && (
              <div style={{ color: 'var(--accent-orange)', fontSize: '0.7rem', marginTop: '4px' }}>
                Passwords do not match
              </div>
            )}
          </div>
          <button onClick={handleChangePassword} disabled={!currentPassword || !newPassword || !confirmPassword || newPassword !== confirmPassword} style={{
            padding: '10px 20px',
            background: currentPassword && newPassword && confirmPassword && newPassword === confirmPassword ? 'var(--accent-orange)20' : 'transparent',
            border: `1px solid ${currentPassword && newPassword && confirmPassword && newPassword === confirmPassword ? 'var(--accent-orange)' : 'var(--border-primary)'}`,
            color: currentPassword && newPassword && confirmPassword && newPassword === confirmPassword ? 'var(--accent-orange)' : 'var(--text-muted)',
            cursor: currentPassword && newPassword && confirmPassword && newPassword === confirmPassword ? 'pointer' : 'not-allowed', fontFamily: 'monospace',
          }}>CHANGE PASSWORD</button>
        </CollapsibleSection>

        {/* Two-Factor Authentication Sub-section */}
        <CollapsibleSection title="TWO-FACTOR AUTHENTICATION" isOpen={openSecuritySection === 'mfa'} onToggle={() => toggleSecuritySection('mfa')} isMobile={isMobile}>
          {mfaStatus ? (
              <>
                {/* Recovery Codes Modal/Display */}
                {recoveryCodes && (
                  <div style={{ marginBottom: '20px', padding: '16px', background: 'var(--accent-amber)10', border: '1px solid var(--accent-amber)', borderRadius: '4px' }}>
                    <div style={{ color: 'var(--accent-amber)', fontSize: '0.9rem', fontWeight: 'bold', marginBottom: '12px' }}>
                      ⚠️ Save Your Recovery Codes
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '12px' }}>
                      Store these codes in a safe place. Each code can only be used once. You won't be able to see them again!
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', marginBottom: '12px' }}>
                      {recoveryCodes.map((code, i) => (
                        <div key={i} style={{ padding: '8px', background: 'var(--bg-elevated)', fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--text-primary)', textAlign: 'center' }}>
                          {code}
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(recoveryCodes.join('\n'));
                          showToast('Recovery codes copied to clipboard', 'success');
                        }}
                        style={{ padding: '8px 16px', background: 'var(--accent-teal)20', border: '1px solid var(--accent-teal)', color: 'var(--accent-teal)', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.75rem' }}
                      >
                        COPY CODES
                      </button>
                      <button
                        onClick={() => setRecoveryCodes(null)}
                        style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--border-primary)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.75rem' }}
                      >
                        I'VE SAVED THEM
                      </button>
                    </div>
                  </div>
                )}

                {/* TOTP Setup UI */}
                {mfaSetupStep === 'totp-verify' && totpSetupData && (
                  <div style={{ marginBottom: '20px', padding: '16px', background: 'var(--bg-elevated)', border: '1px solid var(--border-primary)' }}>
                    <div style={{ color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 'bold', marginBottom: '12px' }}>
                      Setup Authenticator App
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '16px' }}>
                      Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
                    </div>
                    <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                      <img src={totpSetupData.qrCodeDataUrl} alt="TOTP QR Code" style={{ maxWidth: '200px', border: '4px solid white' }} />
                    </div>
                    <div style={{ marginBottom: '16px' }}>
                      <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginBottom: '4px' }}>Or enter this key manually:</div>
                      <div style={{ padding: '8px', background: 'var(--bg-base)', fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--accent-amber)', wordBreak: 'break-all' }}>
                        {totpSetupData.secret}
                      </div>
                    </div>
                    <div style={{ marginBottom: '16px' }}>
                      <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>
                        Enter the 6-digit code from your app:
                      </label>
                      <input
                        type="text"
                        value={totpVerifyCode}
                        onChange={(e) => setTotpVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="000000"
                        style={{ ...inputStyle, fontFamily: 'monospace', textAlign: 'center', letterSpacing: '0.3em' }}
                        autoFocus
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={handleVerifyTotp}
                        disabled={totpVerifyCode.length !== 6 || mfaLoading}
                        style={{ padding: '10px 20px', background: totpVerifyCode.length === 6 ? 'var(--accent-green)20' : 'transparent', border: `1px solid ${totpVerifyCode.length === 6 ? 'var(--accent-green)' : 'var(--border-primary)'}`, color: totpVerifyCode.length === 6 ? 'var(--accent-green)' : 'var(--text-muted)', cursor: totpVerifyCode.length === 6 ? 'pointer' : 'not-allowed', fontFamily: 'monospace' }}
                      >
                        {mfaLoading ? 'VERIFYING...' : 'VERIFY & ENABLE'}
                      </button>
                      <button
                        onClick={() => { setMfaSetupStep(null); setTotpSetupData(null); setTotpVerifyCode(''); }}
                        style={{ padding: '10px 20px', background: 'transparent', border: '1px solid var(--border-primary)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'monospace' }}
                      >
                        CANCEL
                      </button>
                    </div>
                  </div>
                )}

                {/* Email MFA Verify UI */}
                {mfaSetupStep === 'email-verify' && (
                  <div style={{ marginBottom: '20px', padding: '16px', background: 'var(--bg-elevated)', border: '1px solid var(--border-primary)' }}>
                    <div style={{ color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 'bold', marginBottom: '12px' }}>
                      Verify Email MFA
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '16px' }}>
                      Enter the 6-digit code we sent to your email address.
                    </div>
                    <div style={{ marginBottom: '16px' }}>
                      <input
                        type="text"
                        value={emailVerifyCode}
                        onChange={(e) => setEmailVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="000000"
                        style={{ ...inputStyle, fontFamily: 'monospace', textAlign: 'center', letterSpacing: '0.3em' }}
                        autoFocus
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={handleVerifyEmailMfa}
                        disabled={emailVerifyCode.length !== 6 || mfaLoading}
                        style={{ padding: '10px 20px', background: emailVerifyCode.length === 6 ? 'var(--accent-green)20' : 'transparent', border: `1px solid ${emailVerifyCode.length === 6 ? 'var(--accent-green)' : 'var(--border-primary)'}`, color: emailVerifyCode.length === 6 ? 'var(--accent-green)' : 'var(--text-muted)', cursor: emailVerifyCode.length === 6 ? 'pointer' : 'not-allowed', fontFamily: 'monospace' }}
                      >
                        {mfaLoading ? 'VERIFYING...' : 'VERIFY & ENABLE'}
                      </button>
                      <button
                        onClick={() => { setMfaSetupStep(null); setEmailChallengeId(null); setEmailVerifyCode(''); }}
                        style={{ padding: '10px 20px', background: 'transparent', border: '1px solid var(--border-primary)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'monospace' }}
                      >
                        CANCEL
                      </button>
                    </div>
                  </div>
                )}

                {/* Email MFA Disable Verify UI */}
                {mfaSetupStep === 'email-disable' && (
                  <div style={{ marginBottom: '20px', padding: '16px', background: 'var(--bg-elevated)', border: '1px solid var(--accent-orange)' }}>
                    <div style={{ color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 'bold', marginBottom: '12px' }}>
                      Confirm Email MFA Disable
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '16px' }}>
                      Enter the 6-digit code we sent to your email to confirm disabling Email MFA.
                    </div>
                    <div style={{ marginBottom: '16px' }}>
                      <input
                        type="text"
                        value={emailVerifyCode}
                        onChange={(e) => setEmailVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="000000"
                        style={{ ...inputStyle, fontFamily: 'monospace', textAlign: 'center', letterSpacing: '0.3em' }}
                        autoFocus
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={handleConfirmDisableEmailMfa}
                        disabled={emailVerifyCode.length !== 6 || mfaLoading}
                        style={{ padding: '10px 20px', background: emailVerifyCode.length === 6 ? 'var(--accent-orange)20' : 'transparent', border: `1px solid ${emailVerifyCode.length === 6 ? 'var(--accent-orange)' : 'var(--border-primary)'}`, color: emailVerifyCode.length === 6 ? 'var(--accent-orange)' : 'var(--text-muted)', cursor: emailVerifyCode.length === 6 ? 'pointer' : 'not-allowed', fontFamily: 'monospace' }}
                      >
                        {mfaLoading ? 'DISABLING...' : 'CONFIRM DISABLE'}
                      </button>
                      <button
                        onClick={() => { setMfaSetupStep(null); setEmailChallengeId(null); setEmailVerifyCode(''); }}
                        style={{ padding: '10px 20px', background: 'transparent', border: '1px solid var(--border-primary)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'monospace' }}
                      >
                        CANCEL
                      </button>
                    </div>
                  </div>
                )}

                {/* MFA Status Display */}
                {!mfaSetupStep && (
                  <>
                    {/* TOTP Section */}
                    <div style={{ marginBottom: '16px', padding: '12px', background: 'var(--bg-elevated)', border: `1px solid ${mfaStatus.totpEnabled ? 'var(--accent-green)' : 'var(--border-subtle)'}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <div style={{ color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                          🔑 Authenticator App (TOTP)
                        </div>
                        <div style={{ color: mfaStatus.totpEnabled ? 'var(--accent-green)' : 'var(--text-muted)', fontSize: '0.75rem' }}>
                          {mfaStatus.totpEnabled ? '✓ ENABLED' : 'NOT SET UP'}
                        </div>
                      </div>
                      {mfaStatus.totpEnabled ? (
                        <div style={{ marginTop: '12px' }}>
                          <div style={{ marginBottom: '8px' }}>
                            <input type="password" value={mfaDisablePassword} onChange={(e) => setMfaDisablePassword(e.target.value)} placeholder="Password" style={{ ...inputStyle, marginBottom: '8px' }} />
                            <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginBottom: '4px' }}>
                              Enter the 6-digit code from your authenticator app:
                            </div>
                            <input type="text" value={mfaDisableCode} onChange={(e) => setMfaDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" style={{ ...inputStyle, fontFamily: 'monospace', letterSpacing: '0.2em' }} />
                          </div>
                          <button onClick={handleDisableTotp} disabled={mfaLoading} style={{ padding: '8px 16px', background: 'var(--accent-orange)20', border: '1px solid var(--accent-orange)', color: 'var(--accent-orange)', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                            {mfaLoading ? 'DISABLING...' : 'DISABLE TOTP'}
                          </button>
                        </div>
                      ) : (
                        <button onClick={handleStartTotpSetup} disabled={mfaLoading} style={{ padding: '8px 16px', background: 'var(--accent-teal)20', border: '1px solid var(--accent-teal)', color: 'var(--accent-teal)', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                          {mfaLoading ? 'LOADING...' : 'SETUP AUTHENTICATOR'}
                        </button>
                      )}
                    </div>

                    {/* Email MFA Section */}
                    <div style={{ marginBottom: '16px', padding: '12px', background: 'var(--bg-elevated)', border: `1px solid ${mfaStatus.emailMfaEnabled ? 'var(--accent-green)' : 'var(--border-subtle)'}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <div style={{ color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                          ✉️ Email Verification
                        </div>
                        <div style={{ color: mfaStatus.emailMfaEnabled ? 'var(--accent-green)' : 'var(--text-muted)', fontSize: '0.75rem' }}>
                          {mfaStatus.emailMfaEnabled ? '✓ ENABLED' : 'NOT SET UP'}
                        </div>
                      </div>
                      {mfaStatus.emailMfaEnabled ? (
                        <div style={{ marginTop: '12px' }}>
                          <input type="password" value={mfaDisablePassword} onChange={(e) => setMfaDisablePassword(e.target.value)} placeholder="Password" style={{ ...inputStyle, marginBottom: '8px' }} />
                          <button onClick={handleRequestDisableEmailMfa} disabled={mfaLoading} style={{ padding: '8px 16px', background: 'var(--accent-orange)20', border: '1px solid var(--accent-orange)', color: 'var(--accent-orange)', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                            {mfaLoading ? 'SENDING CODE...' : 'DISABLE EMAIL MFA'}
                          </button>
                        </div>
                      ) : (
                        <button onClick={handleStartEmailMfa} disabled={mfaLoading || !user?.email} style={{ padding: '8px 16px', background: user?.email ? 'var(--accent-teal)20' : 'transparent', border: `1px solid ${user?.email ? 'var(--accent-teal)' : 'var(--border-primary)'}`, color: user?.email ? 'var(--accent-teal)' : 'var(--text-muted)', cursor: user?.email ? 'pointer' : 'not-allowed', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                          {mfaLoading ? 'LOADING...' : user?.email ? 'SETUP EMAIL MFA' : 'EMAIL REQUIRED'}
                        </button>
                      )}
                    </div>

                    {/* Recovery Codes Section */}
                    {(mfaStatus.totpEnabled || mfaStatus.emailMfaEnabled) && (
                      <div style={{ padding: '12px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <div style={{ color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                            🔐 Recovery Codes
                          </div>
                          <div style={{ color: mfaStatus.hasRecoveryCodes ? 'var(--accent-green)' : 'var(--accent-orange)', fontSize: '0.75rem' }}>
                            {mfaStatus.hasRecoveryCodes ? '✓ AVAILABLE' : '⚠️ NOT SET'}
                          </div>
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '12px' }}>
                          Recovery codes let you access your account if you lose your authentication device.
                        </div>
                        <div style={{ marginTop: '8px' }}>
                          <input type="password" value={mfaDisablePassword} onChange={(e) => setMfaDisablePassword(e.target.value)} placeholder="Password" style={{ ...inputStyle, marginBottom: '8px' }} />
                          {mfaStatus.totpEnabled && (
                            <>
                              <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginBottom: '4px' }}>
                                Enter the 6-digit code from your authenticator app:
                              </div>
                              <input type="text" value={mfaDisableCode} onChange={(e) => setMfaDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" style={{ ...inputStyle, fontFamily: 'monospace', marginBottom: '8px', letterSpacing: '0.2em' }} />
                            </>
                          )}
                          <button onClick={handleRegenerateRecoveryCodes} disabled={mfaLoading} style={{ padding: '8px 16px', background: 'var(--accent-amber)20', border: '1px solid var(--accent-amber)', color: 'var(--accent-amber)', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                            {mfaLoading ? 'GENERATING...' : 'REGENERATE CODES'}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '20px' }}>
              Loading MFA settings...
            </div>
          )}
        </CollapsibleSection>

        {/* E2EE Recovery Key Sub-section */}
        {e2ee.isE2EEEnabled && (
          <CollapsibleSection title="E2EE RECOVERY KEY" isOpen={openSecuritySection === 'e2ee'} onToggle={() => toggleSecuritySection('e2ee')} isMobile={isMobile}>
            <div>
              {/* Display regenerated recovery key */}
              {e2eeRecoveryKey && (
                <div style={{ marginBottom: '20px', padding: '16px', background: 'var(--accent-green)10', border: '2px solid var(--accent-green)', borderRadius: '4px' }}>
                  <div style={{ color: 'var(--accent-green)', fontSize: '0.9rem', fontWeight: 'bold', marginBottom: '12px' }}>
                    🔐 New Recovery Key Generated
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '12px' }}>
                    Save this key in a safe place. You'll need it to recover access if your password changes.
                  </div>
                  <div style={{ padding: '16px', background: 'var(--bg-base)', border: '1px solid var(--accent-green)', borderRadius: '4px', textAlign: 'center', marginBottom: '12px' }}>
                    <div style={{ fontFamily: 'monospace', fontSize: '1.2rem', letterSpacing: '2px', color: 'var(--accent-green)', wordBreak: 'break-all', userSelect: 'all' }}>
                      {e2eeRecoveryKey}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(e2eeRecoveryKey);
                          setE2eeRecoveryCopied(true);
                          setTimeout(() => setE2eeRecoveryCopied(false), 2000);
                        } catch (err) {
                          console.error('Failed to copy:', err);
                        }
                      }}
                      style={{
                        padding: '8px 16px',
                        background: e2eeRecoveryCopied ? 'var(--accent-green)' : 'var(--accent-green)20',
                        border: '1px solid var(--accent-green)',
                        color: e2eeRecoveryCopied ? 'var(--bg-base)' : 'var(--accent-green)',
                        cursor: 'pointer',
                        fontFamily: 'monospace',
                        fontSize: '0.75rem'
                      }}
                    >
                      {e2eeRecoveryCopied ? '✓ COPIED' : 'COPY KEY'}
                    </button>
                    <button
                      onClick={() => setE2eeRecoveryKey(null)}
                      style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--border-primary)', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.75rem' }}
                    >
                      I'VE SAVED IT
                    </button>
                  </div>
                  <div style={{ marginTop: '12px', padding: '8px', background: 'var(--accent-orange)10', border: '1px solid var(--accent-orange)', borderRadius: '4px' }}>
                    <div style={{ color: 'var(--accent-orange)', fontSize: '0.75rem' }}>
                      ⚠️ This key will only be shown once. Your old recovery key is now invalid.
                    </div>
                  </div>
                </div>
              )}

              {/* Main recovery key info */}
              {!e2eeRecoveryKey && (
                <>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '16px' }}>
                    Your recovery key allows you to regain access to your encrypted messages.
                    Your encryption is tied to your login password - if you change your password, the encryption is automatically updated.
                    If you've lost your recovery key, you can generate a new one below.
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                    <span style={{ color: 'var(--accent-green)', fontSize: '0.85rem' }}>
                      🔐 End-to-End Encryption Active
                    </span>
                  </div>

                  <button
                    onClick={async () => {
                      if (!e2ee.isUnlocked) {
                        showToast('Please unlock E2EE first', 'error');
                        return;
                      }
                      setE2eeRecoveryLoading(true);
                      try {
                        const result = await e2ee.regenerateRecoveryKey();
                        if (result.success) {
                          setE2eeRecoveryKey(result.recoveryKey);
                          showToast('New recovery key generated', 'success');
                        }
                      } catch (err) {
                        console.error('Failed to regenerate recovery key:', err);
                        showToast(err.message || formatError('Failed to regenerate recovery key'), 'error');
                      } finally {
                        setE2eeRecoveryLoading(false);
                      }
                    }}
                    disabled={!e2ee.isUnlocked || e2eeRecoveryLoading}
                    style={{
                      padding: '10px 20px',
                      background: e2ee.isUnlocked ? 'var(--accent-teal)20' : 'transparent',
                      border: `1px solid ${e2ee.isUnlocked ? 'var(--accent-teal)' : 'var(--border-primary)'}`,
                      color: e2ee.isUnlocked ? 'var(--accent-teal)' : 'var(--text-muted)',
                      cursor: e2ee.isUnlocked ? 'pointer' : 'not-allowed',
                      fontFamily: 'monospace',
                      fontSize: '0.75rem'
                    }}
                  >
                    {e2eeRecoveryLoading ? 'GENERATING...' : '🔑 REGENERATE RECOVERY KEY'}
                  </button>

                  <div style={{ marginTop: '12px', color: 'var(--text-dim)', fontSize: '0.7rem' }}>
                    Note: Generating a new recovery key will invalidate your previous recovery key.
                  </div>
                </>
              )}
            </div>
          </CollapsibleSection>
        )}

        {/* Active Sessions Sub-section */}
        <CollapsibleSection title="ACTIVE SESSIONS" isOpen={openSecuritySection === 'sessions'} onToggle={() => toggleSecuritySection('sessions')} isMobile={isMobile}>
          {!sessionsEnabled ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '20px' }}>
                Session management is not enabled on this server.
              </div>
            ) : sessionsLoading ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '20px' }}>
                Loading sessions...
              </div>
            ) : (
              <>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '16px' }}>
                  Manage your active login sessions. Revoking a session will log out that device.
                </div>

                {sessions.length > 0 ? (
                  <>
                    {sessions.map(session => {
                      const { device, browser } = parseDeviceInfo(session.deviceInfo);
                      return (
                        <div
                          key={session.id}
                          style={{
                            marginBottom: '12px',
                            padding: '12px',
                            background: session.isCurrent ? 'var(--accent-green)10' : 'var(--bg-elevated)',
                            border: `1px solid ${session.isCurrent ? 'var(--accent-green)' : 'var(--border-subtle)'}`,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                <span style={{ color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                                  {device} {browser && `• ${browser}`}
                                </span>
                                {session.isCurrent && (
                                  <span style={{
                                    padding: '2px 6px',
                                    background: 'var(--accent-green)20',
                                    border: '1px solid var(--accent-green)',
                                    color: 'var(--accent-green)',
                                    fontSize: '0.65rem',
                                    borderRadius: '3px',
                                  }}>
                                    THIS DEVICE
                                  </span>
                                )}
                              </div>
                              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                                {session.ipAddress} • Active {formatSessionDate(session.lastActive)}
                              </div>
                              <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginTop: '2px' }}>
                                Created {formatSessionDate(session.createdAt)}
                              </div>
                              <div style={{ color: 'var(--accent-orange)', fontSize: '0.7rem', marginTop: '2px' }}>
                                Expires {formatExpirationDate(session.expiresAt)}
                              </div>
                            </div>
                            {!session.isCurrent && (
                              <button
                                onClick={() => handleRevokeSession(session.id)}
                                style={{
                                  padding: '6px 12px',
                                  background: 'var(--accent-orange)20',
                                  border: '1px solid var(--accent-orange)',
                                  color: 'var(--accent-orange)',
                                  cursor: 'pointer',
                                  fontFamily: 'monospace',
                                  fontSize: '0.7rem',
                                }}
                              >
                                REVOKE
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {sessions.filter(s => !s.isCurrent).length > 0 && (
                      <button
                        onClick={handleRevokeAllSessions}
                        style={{
                          marginTop: '8px',
                          padding: '10px 20px',
                          background: 'var(--accent-orange)20',
                          border: '1px solid var(--accent-orange)',
                          color: 'var(--accent-orange)',
                          cursor: 'pointer',
                          fontFamily: 'monospace',
                          width: '100%',
                        }}
                      >
                        LOGOUT ALL OTHER DEVICES
                      </button>
                    )}
                  </>
                ) : (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '20px' }}>
                    No active sessions found.
                  </div>
                )}
              </>
            )}
        </CollapsibleSection>

        {/* Blocked & Muted Users Sub-section */}
        <CollapsibleSection title="BLOCKED & MUTED USERS" isOpen={openSecuritySection === 'blocked'} onToggle={() => toggleSecuritySection('blocked')} isMobile={isMobile}>
          {/* Blocked Users */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ color: 'var(--accent-orange)', fontSize: '0.75rem', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>⊘</span> BLOCKED ({blockedUsers.length})
            </div>
            {blockedUsers.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', padding: '12px', background: 'var(--bg-elevated)', border: '1px solid var(--bg-hover)' }}>
                No blocked users. Blocked users cannot send you contact requests, invite you to crews, or have their messages shown to you.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {blockedUsers.map(u => (
                  <div key={u.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    background: 'var(--accent-orange)10',
                    border: '1px solid var(--accent-orange)30',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Avatar letter={u.avatar || u.displayName?.[0] || '?'} color="var(--accent-orange)" size={28} />
                      <div>
                        <div style={{ color: 'var(--text-primary)', fontSize: '0.8rem' }}>{u.displayName}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleUnblock(u.blockedUserId, u.displayName)}
                      style={{
                        padding: isMobile ? '8px 12px' : '6px 10px',
                        minHeight: isMobile ? '40px' : 'auto',
                        background: 'var(--accent-green)20',
                        border: '1px solid var(--accent-green)',
                        color: 'var(--accent-green)',
                        cursor: 'pointer',
                        fontFamily: 'monospace',
                        fontSize: '0.65rem',
                      }}
                    >UNBLOCK</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Muted Users */}
          <div>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>🔇</span> MUTED ({mutedUsers.length})
            </div>
            {mutedUsers.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', padding: '12px', background: 'var(--bg-elevated)', border: '1px solid var(--bg-hover)' }}>
                No muted users. Muted users can still interact with you, but their messages will be hidden from view.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {mutedUsers.map(u => (
                  <div key={u.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Avatar letter={u.avatar || u.displayName?.[0] || '?'} color="var(--text-dim)" size={28} />
                      <div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{u.displayName}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleUnmute(u.mutedUserId, u.displayName)}
                      style={{
                        padding: isMobile ? '8px 12px' : '6px 10px',
                        minHeight: isMobile ? '40px' : 'auto',
                        background: 'var(--accent-green)20',
                        border: '1px solid var(--accent-green)',
                        color: 'var(--accent-green)',
                        cursor: 'pointer',
                        fontFamily: 'monospace',
                        fontSize: '0.65rem',
                      }}
                    >UNMUTE</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CollapsibleSection>

      </CollapsibleSection>

      {/* Display Preferences */}
      <CollapsibleSection title="DISPLAY PREFERENCES" isOpen={openSection === 'display'} onToggle={() => toggleSection('display')} isMobile={isMobile}>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>THEME</label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={user?.preferences?.theme || 'serenity'}
              onChange={(e) => {
                const themeId = e.target.value;
                // Check if it's a custom theme (prefixed with 'custom-')
                const isCustom = themeId.startsWith('custom-');
                const rawThemeId = isCustom ? themeId.replace('custom-', '') : themeId;
                const customTheme = isCustom ? availableThemes.find(t => t.id === rawThemeId) : null;
                if (customTheme) {
                  // Apply custom theme CSS immediately
                  applyCustomTheme(customTheme);
                } else {
                  // Built-in theme - remove custom theme styles and set data-theme
                  removeCustomTheme(themeId);
                }
                // Save preference to server (keep the full themeId with prefix)
                handleUpdatePreferences({ theme: themeId });
              }}
              style={{
                ...inputStyle,
                cursor: 'pointer',
                flex: 1,
                minWidth: '150px',
              }}
            >
              <optgroup label="Built-in Themes">
                {Object.entries(THEMES).map(([key, config]) => (
                  <option key={key} value={key}>{config.name}</option>
                ))}
              </optgroup>
              {availableThemes.length > 0 && (
                <optgroup label="Custom Themes">
                  {availableThemes.map(theme => (
                    <option key={theme.id} value={`custom-${theme.id}`}>{theme.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
            <button
              onClick={() => setShowThemeModal(true)}
              style={{
                padding: isMobile ? '10px 16px' : '8px 16px',
                minHeight: isMobile ? '44px' : 'auto',
                background: 'var(--accent-amber)20',
                border: '1px solid var(--accent-amber)',
                color: 'var(--accent-amber)',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: isMobile ? '0.85rem' : '0.8rem',
                whiteSpace: 'nowrap',
              }}
            >
              CUSTOMIZE
            </button>
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '6px' }}>
            {THEMES[user?.preferences?.theme]?.description ||
             availableThemes.find(t => `custom-${t.id}` === user?.preferences?.theme)?.description ||
             (user?.preferences?.theme?.startsWith('custom-')
               ? 'Custom theme'
               : 'Click "Customize" to create themes or install themes from the gallery')}
          </div>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>FONT SIZE</label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {Object.entries(FONT_SIZES).map(([key, config]) => (
              <button
                key={key}
                onClick={() => handleUpdatePreferences({ fontSize: key })}
                style={{
                  padding: isMobile ? '10px 16px' : '8px 16px',
                  minHeight: isMobile ? '44px' : 'auto',
                  background: (user?.preferences?.fontSize || 'medium') === key ? 'var(--accent-amber)20' : 'transparent',
                  border: `1px solid ${(user?.preferences?.fontSize || 'medium') === key ? 'var(--accent-amber)' : 'var(--border-subtle)'}`,
                  color: (user?.preferences?.fontSize || 'medium') === key ? 'var(--accent-amber)' : 'var(--text-dim)',
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                  fontSize: key === 'small' ? '0.75rem' : key === 'large' ? '1rem' : key === 'xlarge' ? '1.1rem' : '0.85rem',
                }}
              >
                {config.name.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>CRT SCAN LINES</label>
          <button
            onClick={() => handleUpdatePreferences({ scanLines: !(user?.preferences?.scanLines !== false) })}
            style={{
              padding: isMobile ? '10px 16px' : '8px 16px',
              minHeight: isMobile ? '44px' : 'auto',
              background: (user?.preferences?.scanLines !== false) ? 'var(--accent-amber)20' : 'transparent',
              border: `1px solid ${(user?.preferences?.scanLines !== false) ? 'var(--accent-amber)' : 'var(--border-subtle)'}`,
              color: (user?.preferences?.scanLines !== false) ? 'var(--accent-amber)' : 'var(--text-dim)',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: isMobile ? '0.9rem' : '0.85rem',
            }}
          >
            {(user?.preferences?.scanLines !== false) ? '▣ ENABLED' : '▢ DISABLED'}
          </button>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '6px' }}>
            Disable for improved readability
          </div>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>HOLIDAY EFFECTS</label>
          <button
            onClick={() => handleUpdatePreferences({ holidayEffects: !(user?.preferences?.holidayEffects !== false) })}
            style={{
              padding: isMobile ? '10px 16px' : '8px 16px',
              minHeight: isMobile ? '44px' : 'auto',
              background: (user?.preferences?.holidayEffects !== false) ? 'var(--accent-teal)20' : 'transparent',
              border: `1px solid ${(user?.preferences?.holidayEffects !== false) ? 'var(--accent-teal)' : 'var(--border-subtle)'}`,
              color: (user?.preferences?.holidayEffects !== false) ? 'var(--accent-teal)' : 'var(--text-dim)',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: isMobile ? '0.9rem' : '0.85rem',
            }}
          >
            {(user?.preferences?.holidayEffects !== false) ? '🎄 ENABLED' : '🎄 DISABLED'}
          </button>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '6px' }}>
            Seasonal visual effects for holidays
          </div>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>AUTO-FOCUS PINGS</label>
          <button
            onClick={() => handleUpdatePreferences({ autoFocusMessages: !(user?.preferences?.autoFocusMessages === true) })}
            style={{
              padding: isMobile ? '10px 16px' : '8px 16px',
              minHeight: isMobile ? '44px' : 'auto',
              background: (user?.preferences?.autoFocusMessages === true) ? 'var(--accent-teal)20' : 'transparent',
              border: `1px solid ${(user?.preferences?.autoFocusMessages === true) ? 'var(--accent-teal)' : 'var(--border-subtle)'}`,
              color: (user?.preferences?.autoFocusMessages === true) ? 'var(--accent-teal)' : 'var(--text-dim)',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: isMobile ? '0.9rem' : '0.85rem',
            }}
          >
            {(user?.preferences?.autoFocusMessages === true) ? '⤢ ENABLED' : '⤢ DISABLED'}
          </button>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '6px' }}>
            Automatically enter Focus View when clicking pings with replies
          </div>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>AUTO-COLLAPSE LONG MESSAGES</label>
          <button
            onClick={() => handleUpdatePreferences({ autoCollapseMessages: !(user?.preferences?.autoCollapseMessages === true) })}
            style={{
              padding: isMobile ? '10px 16px' : '8px 16px',
              minHeight: isMobile ? '44px' : 'auto',
              background: (user?.preferences?.autoCollapseMessages === true) ? 'var(--accent-teal)20' : 'transparent',
              border: `1px solid ${(user?.preferences?.autoCollapseMessages === true) ? 'var(--accent-teal)' : 'var(--border-subtle)'}`,
              color: (user?.preferences?.autoCollapseMessages === true) ? 'var(--accent-teal)' : 'var(--text-dim)',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: isMobile ? '0.9rem' : '0.85rem',
            }}
          >
            {(user?.preferences?.autoCollapseMessages === true) ? '▼ ENABLED' : '▼ DISABLED'}
          </button>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '6px' }}>
            Automatically minimize messages with 3+ lines or media
          </div>
        </div>


      </CollapsibleSection>

      {/* Crawl Bar Preferences */}
      <CollapsibleSection title="CRAWL BAR" isOpen={openSection === 'crawl'} onToggle={() => toggleSection('crawl')} isMobile={isMobile}>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>ENABLE CRAWL BAR</label>
          <button
            onClick={() => handleUpdatePreferences({ crawlBar: { ...user?.preferences?.crawlBar, enabled: !(user?.preferences?.crawlBar?.enabled !== false) } })}
            style={{
              padding: isMobile ? '10px 16px' : '8px 16px',
              minHeight: isMobile ? '44px' : 'auto',
              background: (user?.preferences?.crawlBar?.enabled !== false) ? 'var(--accent-teal)20' : 'transparent',
              border: `1px solid ${(user?.preferences?.crawlBar?.enabled !== false) ? 'var(--accent-teal)' : 'var(--border-subtle)'}`,
              color: (user?.preferences?.crawlBar?.enabled !== false) ? 'var(--accent-teal)' : 'var(--text-dim)',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: isMobile ? '0.9rem' : '0.85rem',
            }}
          >
            {(user?.preferences?.crawlBar?.enabled !== false) ? '▣ ENABLED' : '▢ DISABLED'}
          </button>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '6px' }}>
            Show scrolling ticker with stocks, weather, and news
          </div>
        </div>

        {(user?.preferences?.crawlBar?.enabled !== false) && (
          <>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>CONTENT</label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => handleUpdatePreferences({ crawlBar: { ...user?.preferences?.crawlBar, showStocks: !(user?.preferences?.crawlBar?.showStocks !== false) } })}
                  style={{
                    padding: isMobile ? '10px 16px' : '8px 16px',
                    minHeight: isMobile ? '44px' : 'auto',
                    background: (user?.preferences?.crawlBar?.showStocks !== false) ? 'var(--accent-green)20' : 'transparent',
                    border: `1px solid ${(user?.preferences?.crawlBar?.showStocks !== false) ? 'var(--accent-green)' : 'var(--border-subtle)'}`,
                    color: (user?.preferences?.crawlBar?.showStocks !== false) ? 'var(--accent-green)' : 'var(--text-dim)',
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                    fontSize: isMobile ? '0.9rem' : '0.85rem',
                  }}
                >
                  📈 STOCKS
                </button>
                <button
                  onClick={() => handleUpdatePreferences({ crawlBar: { ...user?.preferences?.crawlBar, showWeather: !(user?.preferences?.crawlBar?.showWeather !== false) } })}
                  style={{
                    padding: isMobile ? '10px 16px' : '8px 16px',
                    minHeight: isMobile ? '44px' : 'auto',
                    background: (user?.preferences?.crawlBar?.showWeather !== false) ? 'var(--accent-teal)20' : 'transparent',
                    border: `1px solid ${(user?.preferences?.crawlBar?.showWeather !== false) ? 'var(--accent-teal)' : 'var(--border-subtle)'}`,
                    color: (user?.preferences?.crawlBar?.showWeather !== false) ? 'var(--accent-teal)' : 'var(--text-dim)',
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                    fontSize: isMobile ? '0.9rem' : '0.85rem',
                  }}
                >
                  🌡️ WEATHER
                </button>
                <button
                  onClick={() => handleUpdatePreferences({ crawlBar: { ...user?.preferences?.crawlBar, showNews: !(user?.preferences?.crawlBar?.showNews !== false) } })}
                  style={{
                    padding: isMobile ? '10px 16px' : '8px 16px',
                    minHeight: isMobile ? '44px' : 'auto',
                    background: (user?.preferences?.crawlBar?.showNews !== false) ? 'var(--accent-purple)20' : 'transparent',
                    border: `1px solid ${(user?.preferences?.crawlBar?.showNews !== false) ? 'var(--accent-purple)' : 'var(--border-subtle)'}`,
                    color: (user?.preferences?.crawlBar?.showNews !== false) ? 'var(--accent-purple)' : 'var(--text-dim)',
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                    fontSize: isMobile ? '0.9rem' : '0.85rem',
                  }}
                >
                  ◆ NEWS
                </button>
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>SCROLL SPEED</label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {['slow', 'normal', 'fast'].map((speed) => (
                  <button
                    key={speed}
                    onClick={() => handleUpdatePreferences({ crawlBar: { ...user?.preferences?.crawlBar, scrollSpeed: speed } })}
                    style={{
                      padding: isMobile ? '10px 16px' : '8px 16px',
                      minHeight: isMobile ? '44px' : 'auto',
                      background: (user?.preferences?.crawlBar?.scrollSpeed || 'normal') === speed ? 'var(--accent-amber)20' : 'transparent',
                      border: `1px solid ${(user?.preferences?.crawlBar?.scrollSpeed || 'normal') === speed ? 'var(--accent-amber)' : 'var(--border-subtle)'}`,
                      color: (user?.preferences?.crawlBar?.scrollSpeed || 'normal') === speed ? 'var(--accent-amber)' : 'var(--text-dim)',
                      cursor: 'pointer',
                      fontFamily: 'monospace',
                      fontSize: isMobile ? '0.9rem' : '0.85rem',
                    }}
                  >
                    {speed.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>LOCATION OVERRIDE</label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="e.g., New York, NY or Coudersport, US"
                  value={crawlBarLocation}
                  onChange={(e) => setCrawlBarLocation(e.target.value)}
                  style={{
                    flex: 1,
                    padding: isMobile ? '12px' : '10px',
                    minHeight: isMobile ? '44px' : 'auto',
                    background: 'var(--bg-base)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                    fontFamily: 'monospace',
                    fontSize: isMobile ? '0.9rem' : '0.85rem',
                  }}
                />
                <button
                  onClick={() => {
                    handleUpdatePreferences({ crawlBar: { ...user?.preferences?.crawlBar, locationName: crawlBarLocation || null, location: null } });
                  }}
                  disabled={crawlBarLocation === (user?.preferences?.crawlBar?.locationName || '')}
                  style={{
                    padding: isMobile ? '10px 12px' : '8px 12px',
                    minHeight: isMobile ? '44px' : 'auto',
                    background: crawlBarLocation !== (user?.preferences?.crawlBar?.locationName || '') ? 'var(--accent-amber)20' : 'transparent',
                    border: `1px solid ${crawlBarLocation !== (user?.preferences?.crawlBar?.locationName || '') ? 'var(--accent-amber)' : 'var(--border-subtle)'}`,
                    color: crawlBarLocation !== (user?.preferences?.crawlBar?.locationName || '') ? 'var(--accent-amber)' : 'var(--text-muted)',
                    cursor: crawlBarLocation !== (user?.preferences?.crawlBar?.locationName || '') ? 'pointer' : 'default',
                    fontFamily: 'monospace',
                    fontSize: isMobile ? '0.9rem' : '0.85rem',
                  }}
                >
                  SAVE
                </button>
                {(crawlBarLocation || user?.preferences?.crawlBar?.locationName) && (
                  <button
                    onClick={() => {
                      setCrawlBarLocation('');
                      handleUpdatePreferences({ crawlBar: { ...user?.preferences?.crawlBar, locationName: null, location: null } });
                    }}
                    style={{
                      padding: isMobile ? '10px 12px' : '8px 12px',
                      minHeight: isMobile ? '44px' : 'auto',
                      background: 'transparent',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-dim)',
                      cursor: 'pointer',
                      fontFamily: 'monospace',
                      fontSize: isMobile ? '0.9rem' : '0.85rem',
                    }}
                  >
                    CLEAR
                  </button>
                )}
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '6px' }}>
                Enter city name (e.g., "Coudersport, US") then click SAVE
              </div>
            </div>
          </>
        )}
      </CollapsibleSection>

      {/* Video Feed Preferences (v2.8.0) */}
      <CollapsibleSection title="VIDEO FEED" isOpen={openSection === 'videoFeed'} onToggle={() => toggleSection('videoFeed')} isMobile={isMobile}>
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>SHOW MY VIDEOS IN DISCOVER FEED</label>
          <button
            onClick={() => handleUpdatePreferences({ videoFeed: { ...user?.preferences?.videoFeed, showInFeed: !(user?.preferences?.videoFeed?.showInFeed !== false) } })}
            style={{
              padding: isMobile ? '10px 16px' : '8px 16px',
              minHeight: isMobile ? '44px' : 'auto',
              background: (user?.preferences?.videoFeed?.showInFeed !== false) ? 'var(--accent-teal)20' : 'transparent',
              border: `1px solid ${(user?.preferences?.videoFeed?.showInFeed !== false) ? 'var(--accent-teal)' : 'var(--border-subtle)'}`,
              color: (user?.preferences?.videoFeed?.showInFeed !== false) ? 'var(--accent-teal)' : 'var(--text-dim)',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: isMobile ? '0.9rem' : '0.85rem',
            }}
          >
            {(user?.preferences?.videoFeed?.showInFeed !== false) ? '▣ ENABLED' : '▢ DISABLED'}
          </button>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '6px' }}>
            When enabled, your video pings from public waves can appear in other users' feeds
          </div>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>AUTOPLAY VIDEOS</label>
          <button
            onClick={() => handleUpdatePreferences({ videoFeed: { ...user?.preferences?.videoFeed, autoplay: !(user?.preferences?.videoFeed?.autoplay !== false) } })}
            style={{
              padding: isMobile ? '10px 16px' : '8px 16px',
              minHeight: isMobile ? '44px' : 'auto',
              background: (user?.preferences?.videoFeed?.autoplay !== false) ? 'var(--accent-green)20' : 'transparent',
              border: `1px solid ${(user?.preferences?.videoFeed?.autoplay !== false) ? 'var(--accent-green)' : 'var(--border-subtle)'}`,
              color: (user?.preferences?.videoFeed?.autoplay !== false) ? 'var(--accent-green)' : 'var(--text-dim)',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: isMobile ? '0.9rem' : '0.85rem',
            }}
          >
            {(user?.preferences?.videoFeed?.autoplay !== false) ? '▶ ENABLED' : '▶ DISABLED'}
          </button>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '6px' }}>
            Automatically play videos as you scroll through the feed
          </div>
        </div>

        <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', padding: '10px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
          ℹ️ The Discover feed shows video pings from public waves and waves you participate in.
        </div>
      </CollapsibleSection>

      {/* Media Server Integration (v2.14.0 Jellyfin, v2.15.0 Plex) */}
      <CollapsibleSection title="📺 MEDIA SERVERS" isOpen={openSection === 'jellyfin'} onToggle={() => toggleSection('jellyfin')} isMobile={isMobile}>
        <JellyfinConnectionManager
          fetchAPI={fetchAPI}
          showToast={showToast}
          isMobile={isMobile}
        />
        <PlexConnectionManager
          fetchAPI={fetchAPI}
          showToast={showToast}
          isMobile={isMobile}
        />
        <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', padding: '10px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
          ℹ️ Connect your Jellyfin, Emby, or Plex media server to share content in waves.
        </div>
      </CollapsibleSection>

      {/* Notification Preferences */}
      <div style={{ marginTop: '20px', padding: isMobile ? '16px' : '20px', background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))', border: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', fontWeight: 500 }}>NOTIFICATION PREFERENCES</div>
          <button
            onClick={() => toggleSection('notifications')}
            style={{
              padding: isMobile ? '8px 12px' : '6px 10px',
              background: openSection === 'notifications' ? 'var(--accent-amber)20' : 'transparent',
              border: `1px solid ${openSection === 'notifications' ? 'var(--accent-amber)' : 'var(--border-primary)'}`,
              color: openSection === 'notifications' ? 'var(--accent-amber)' : 'var(--text-dim)',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: '0.7rem',
            }}
          >
            {openSection === 'notifications' ? '▼ HIDE' : '▶ SHOW'}
          </button>
        </div>

        {openSection === 'notifications' && notificationPrefs && (
          <div>
            {/* Global Enable */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>
                NOTIFICATIONS
              </label>
              <button
                onClick={() => handleUpdateNotificationPrefs({ enabled: !notificationPrefs.enabled })}
                style={{
                  padding: isMobile ? '10px 16px' : '8px 16px',
                  minHeight: isMobile ? '44px' : 'auto',
                  background: notificationPrefs.enabled ? 'var(--accent-green)20' : 'transparent',
                  border: `1px solid ${notificationPrefs.enabled ? 'var(--accent-green)' : 'var(--border-subtle)'}`,
                  color: notificationPrefs.enabled ? 'var(--accent-green)' : 'var(--text-dim)',
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                  fontSize: isMobile ? '0.9rem' : '0.85rem',
                }}
              >
                {notificationPrefs.enabled ? '🔔 ENABLED' : '🔕 DISABLED'}
              </button>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '6px' }}>
                Master switch for all in-app notifications
              </div>
            </div>

            {notificationPrefs.enabled && (
              <>
                {/* Notification Type Preferences */}
                {[
                  { key: 'directMentions', label: '@MENTIONS', icon: '@', desc: 'When someone @mentions you' },
                  { key: 'replies', label: 'REPLIES', icon: '↩', desc: 'When someone replies to your ping' },
                  { key: 'waveActivity', label: 'WAVE ACTIVITY', icon: '◎', desc: 'New pings in your waves' },
                  { key: 'burstEvents', label: 'BURST EVENTS', icon: '◈', desc: 'When pings are burst to new waves' },
                ].map(({ key, label, icon, desc }) => (
                  <div key={key} style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>
                      {icon} {label}
                    </label>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {[
                        { value: 'always', label: 'Always' },
                        { value: 'app_closed', label: 'App Closed' },
                        { value: 'never', label: 'Never' },
                      ].map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => handleUpdateNotificationPrefs({ [key]: opt.value })}
                          style={{
                            padding: isMobile ? '8px 12px' : '6px 12px',
                            minHeight: isMobile ? '40px' : 'auto',
                            background: notificationPrefs[key] === opt.value ? 'var(--accent-amber)20' : 'transparent',
                            border: `1px solid ${notificationPrefs[key] === opt.value ? 'var(--accent-amber)' : 'var(--border-subtle)'}`,
                            color: notificationPrefs[key] === opt.value ? 'var(--accent-amber)' : 'var(--text-dim)',
                            cursor: 'pointer',
                            fontFamily: 'monospace',
                            fontSize: '0.75rem',
                          }}
                        >
                          {opt.label.toUpperCase()}
                        </button>
                      ))}
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.6rem', marginTop: '4px' }}>
                      {desc}
                    </div>
                  </div>
                ))}

                {/* Suppress While Focused */}
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>
                    SUPPRESS WHILE VIEWING
                  </label>
                  <button
                    onClick={() => handleUpdateNotificationPrefs({ suppressWhileFocused: !notificationPrefs.suppressWhileFocused })}
                    style={{
                      padding: isMobile ? '10px 16px' : '8px 16px',
                      minHeight: isMobile ? '44px' : 'auto',
                      background: notificationPrefs.suppressWhileFocused ? 'var(--accent-amber)20' : 'transparent',
                      border: `1px solid ${notificationPrefs.suppressWhileFocused ? 'var(--accent-amber)' : 'var(--border-subtle)'}`,
                      color: notificationPrefs.suppressWhileFocused ? 'var(--accent-amber)' : 'var(--text-dim)',
                      cursor: 'pointer',
                      fontFamily: 'monospace',
                      fontSize: isMobile ? '0.9rem' : '0.85rem',
                    }}
                  >
                    {notificationPrefs.suppressWhileFocused ? '▣ ENABLED' : '▢ DISABLED'}
                  </button>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '6px' }}>
                    Don't show wave activity notifications when you're viewing that wave
                  </div>
                </div>

                {/* Push Debounce */}
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>
                    PUSH THROTTLE
                  </label>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {[
                      { value: 0, label: 'None' },
                      { value: 1, label: '1 min' },
                      { value: 5, label: '5 min' },
                      { value: 15, label: '15 min' },
                      { value: 30, label: '30 min' },
                    ].map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => handleUpdateNotificationPrefs({ pushDebounceMinutes: opt.value })}
                        style={{
                          padding: isMobile ? '8px 12px' : '6px 12px',
                          minHeight: isMobile ? '40px' : 'auto',
                          background: (notificationPrefs.pushDebounceMinutes ?? 5) === opt.value ? 'var(--accent-amber)20' : 'transparent',
                          border: `1px solid ${(notificationPrefs.pushDebounceMinutes ?? 5) === opt.value ? 'var(--accent-amber)' : 'var(--border-subtle)'}`,
                          color: (notificationPrefs.pushDebounceMinutes ?? 5) === opt.value ? 'var(--accent-amber)' : 'var(--text-dim)',
                          cursor: 'pointer',
                          fontFamily: 'monospace',
                          fontSize: '0.75rem',
                        }}
                      >
                        {opt.label.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.6rem', marginTop: '4px' }}>
                    Minimum time between push notifications — "None" sends every message
                  </div>
                </div>

                {/* Push Notifications */}
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>
                    📲 PUSH NOTIFICATIONS
                  </label>
                  <button
                    onClick={async () => {
                      try {
                        setPushError(null);
                        const token = storage.getToken();
                        if (pushEnabled) {
                          storage.setPushEnabled(false);
                          setPushEnabled(false);
                          await unsubscribeFromPush(token);
                          showToast('Push notifications disabled', 'success');
                        } else {
                          const result = await subscribeToPush(token);
                          if (result.success) {
                            storage.setPushEnabled(true);
                            setPushEnabled(true);
                            showToast('Push notifications enabled', 'success');
                          } else {
                            setPushError(result.reason || 'Failed to enable push notifications');
                          }
                        }
                      } catch (err) {
                        console.error('[Push] Unexpected error:', err);
                        setPushError('Push notification setup failed. Check browser console for details.');
                      }
                    }}
                    style={{
                      padding: isMobile ? '10px 16px' : '8px 16px',
                      minHeight: isMobile ? '44px' : 'auto',
                      background: pushEnabled ? 'var(--accent-green)20' : 'transparent',
                      border: `1px solid ${pushEnabled ? 'var(--accent-green)' : 'var(--border-subtle)'}`,
                      color: pushEnabled ? 'var(--accent-green)' : 'var(--text-dim)',
                      cursor: 'pointer',
                      fontFamily: 'monospace',
                      fontSize: isMobile ? '0.9rem' : '0.85rem',
                    }}
                  >
                    {pushEnabled ? '🔔 ENABLED' : '🔕 DISABLED'}
                  </button>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '6px' }}>
                    Receive notifications when the app is closed or in background
                  </div>
                  {/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.Capacitor && (
                    <div style={{ color: 'var(--accent-orange)', fontSize: '0.65rem', marginTop: '6px', padding: '6px', background: 'var(--accent-orange)10', border: '1px solid var(--accent-orange)30' }}>
                      ⚠️ iOS does not support push notifications for web apps. This is a platform limitation by Apple.
                    </div>
                  )}
                  {pushError && (
                    <div style={{ color: 'var(--accent-orange)', fontSize: '0.75rem', marginTop: '8px', padding: '10px', background: 'var(--accent-orange)10', border: '1px solid var(--accent-orange)40', lineHeight: '1.5', wordBreak: 'break-word', userSelect: 'text' }}>
                      {pushError}
                    </div>
                  )}
                  {/* Reset button for troubleshooting */}
                  <button
                    onClick={async () => {
                      if (confirm(CONFIRM_DIALOG.clearLocalData)) {
                        showToast('Resetting push state...', 'info');
                        storage.setPushEnabled(false);
                        setPushEnabled(false);
                        await forceResetPushState();
                        showToast('Push state reset. Try enabling notifications again.', 'success');
                      }
                    }}
                    style={{
                      marginTop: '8px',
                      padding: '6px 12px',
                      background: 'transparent',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      fontFamily: 'monospace',
                      fontSize: '0.7rem',
                    }}
                  >
                    ↻ Reset Push State
                  </button>
                </div>
              </>
            )}

            <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', padding: '10px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', marginTop: '12px' }}>
              ℹ️ "Always" shows notifications even when viewing the app. "App Closed" only notifies when the app is in background. "Never" disables that notification type.
            </div>
          </div>
        )}

        {openSection === 'notifications' && !notificationPrefs && (
          <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', padding: '20px', textAlign: 'center' }}>
            Loading preferences...
          </div>
        )}
      </div>

      {/* Admin Panel (visible to moderator+) */}
      {canAccess(user, 'moderator') && (
        <CollapsibleSection title="⚙️ ADMIN PANEL" isOpen={openSection === 'admin'} onToggle={() => toggleSection('admin')} isMobile={isMobile} accentColor="var(--accent-amber)" titleColor="var(--accent-amber)">
          {/* MODERATION SECTION - Available to moderator+ */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Moderation
            </div>

            {/* User Management Panel */}
            <UserManagementPanel fetchAPI={fetchAPI} showToast={showToast} isMobile={isMobile} isOpen={openAdminSection === 'users'} onToggle={() => toggleAdminSection('users')} currentUser={user} />

            {/* Admin Reports Dashboard */}
            <AdminReportsPanel fetchAPI={fetchAPI} showToast={showToast} isMobile={isMobile} isOpen={openAdminSection === 'reports'} onToggle={() => toggleAdminSection('reports')} />

            {/* Activity Log Panel */}
            <ActivityLogPanel fetchAPI={fetchAPI} showToast={showToast} isMobile={isMobile} isOpen={openAdminSection === 'activity'} onToggle={() => toggleAdminSection('activity')} />
          </div>

          {/* SYSTEM CONFIGURATION - Admin only */}
          {canAccess(user, 'admin') && (
            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                System Configuration
              </div>

              {/* Handle Requests Panel */}
              <HandleRequestsList fetchAPI={fetchAPI} showToast={showToast} isMobile={isMobile} isOpen={openAdminSection === 'handles'} onToggle={() => toggleAdminSection('handles')} />

              {/* Crawl Bar Admin Panel */}
              <CrawlBarAdminPanel fetchAPI={fetchAPI} showToast={showToast} isMobile={isMobile} isOpen={openAdminSection === 'crawl'} onToggle={() => toggleAdminSection('crawl')} />

              {/* Alerts Admin Panel */}
              <AlertsAdminPanel fetchAPI={fetchAPI} showToast={showToast} isMobile={isMobile} isOpen={openAdminSection === 'alerts'} onToggle={() => toggleAdminSection('alerts')} />

              {/* Alert Subscriptions Panel */}
              <AlertSubscriptionsPanel fetchAPI={fetchAPI} showToast={showToast} isMobile={isMobile} isOpen={openAdminSection === 'subscriptions'} onToggle={() => toggleAdminSection('subscriptions')} />

              {/* Federation Admin Panel */}
              <FederationAdminPanel fetchAPI={fetchAPI} showToast={showToast} isMobile={isMobile} refreshTrigger={federationRequestsRefresh} isOpen={openAdminSection === 'federation'} onToggle={() => toggleAdminSection('federation')} />

              {/* Bots Admin Panel (v2.1.0) */}
              <BotsAdminPanel fetchAPI={fetchAPI} showToast={showToast} isMobile={isMobile} isOpen={openAdminSection === 'bots'} onToggle={() => toggleAdminSection('bots')} />

              {/* Privacy & Encryption Dashboard (v2.21.0) */}
              <PrivacyDashboard fetchAPI={fetchAPI} showToast={showToast} isMobile={isMobile} isOpen={openAdminSection === 'privacy'} onToggle={() => toggleAdminSection('privacy')} />
            </div>
          )}
        </CollapsibleSection>
      )}

      {/* My Reports Section */}
      <div style={{ marginTop: '20px', padding: '20px', background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))', border: '1px solid var(--border-subtle)' }}>
        <MyReportsPanel fetchAPI={fetchAPI} showToast={showToast} isMobile={isMobile} />
      </div>

      {/* Logout Section */}
      <div style={{ marginTop: '20px', padding: '20px', background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))', border: '1px solid var(--border-subtle)' }}>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: '16px' }}>SESSION</div>
        <button
          onClick={onLogout}
          style={{
            padding: isMobile ? '14px 24px' : '12px 24px',
            minHeight: isMobile ? '44px' : 'auto',
            background: 'transparent',
            border: '1px solid var(--accent-orange)',
            color: 'var(--accent-orange)',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: isMobile ? '0.9rem' : '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span>⏻</span> LOGOUT
        </button>
      </div>

      {/* Account Management (v1.18.0) */}
      <div style={{ marginTop: '20px', padding: isMobile ? '16px' : '20px', background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))', border: '1px solid var(--accent-orange)40' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: 'var(--accent-orange)', fontSize: '0.8rem', fontWeight: 500 }}>ACCOUNT MANAGEMENT</div>
          <button
            onClick={() => toggleSection('account')}
            style={{
              padding: isMobile ? '8px 12px' : '6px 10px',
              background: openSection === 'account' ? 'var(--accent-orange)20' : 'transparent',
              border: `1px solid ${openSection === 'account' ? 'var(--accent-orange)' : 'var(--border-primary)'}`,
              color: openSection === 'account' ? 'var(--accent-orange)' : 'var(--text-dim)',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: '0.7rem',
            }}
          >
            {openSection === 'account' ? '▼ HIDE' : '▶ SHOW'}
          </button>
        </div>

        {openSection === 'account' && (
          <div style={{ marginTop: '16px' }}>
            {/* Data Export */}
            <div style={{ marginBottom: '20px', padding: '16px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ color: 'var(--text-primary)', fontSize: '0.85rem', marginBottom: '8px' }}>
                {"📦 " + UI_LABELS.exportData}
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '12px' }}>
                Download a copy of all your personal data including profile, pings, contacts, and settings.
              </div>
              <button
                onClick={handleExportData}
                disabled={exportLoading}
                style={{
                  padding: '10px 20px',
                  background: 'var(--accent-teal)20',
                  border: '1px solid var(--accent-teal)',
                  color: 'var(--accent-teal)',
                  cursor: exportLoading ? 'wait' : 'pointer',
                  fontFamily: 'monospace',
                  fontSize: '0.8rem',
                }}
              >
                {exportLoading ? UI_LABELS.exportingData : UI_LABELS.downloadData}
              </button>
            </div>

            {/* Account Deletion */}
            <div style={{ padding: '16px', background: 'var(--accent-orange)05', border: '1px solid var(--accent-orange)' }}>
              <div style={{ color: 'var(--accent-orange)', fontSize: '0.85rem', marginBottom: '8px' }}>
                {"⚠️ " + UI_LABELS.deleteAccount}
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '12px' }}>
                Permanently delete your account and all associated data. This action cannot be undone.
                Your pings will remain visible as "[Deleted User]" for context in conversations.
              </div>

              {!showDeleteConfirm ? (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  style={{
                    padding: '10px 20px',
                    background: 'transparent',
                    border: '1px solid var(--accent-orange)',
                    color: 'var(--accent-orange)',
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                  }}
                >
                  DELETE MY ACCOUNT
                </button>
              ) : (
                <div style={{ marginTop: '12px' }}>
                  <div style={{ color: 'var(--accent-orange)', fontSize: '0.8rem', marginBottom: '12px', fontWeight: 'bold' }}>
                    Are you sure? Enter your password to confirm:
                  </div>
                  <input
                    type="password"
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    placeholder="Your password"
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      background: 'var(--bg-base)',
                      border: '1px solid var(--accent-orange)',
                      color: 'var(--text-primary)',
                      fontFamily: 'monospace',
                      marginBottom: '12px',
                      boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={handleDeleteAccount}
                      disabled={deleteLoading || !deletePassword}
                      style={{
                        padding: '10px 20px',
                        background: deletePassword ? 'var(--accent-orange)' : 'transparent',
                        border: '1px solid var(--accent-orange)',
                        color: deletePassword ? '#000' : 'var(--accent-orange)',
                        cursor: deleteLoading || !deletePassword ? 'not-allowed' : 'pointer',
                        fontFamily: 'monospace',
                        fontSize: '0.8rem',
                        fontWeight: 'bold',
                      }}
                    >
                      {deleteLoading ? 'DELETING...' : CONFIRM.destructive.toUpperCase()}
                    </button>
                    <button
                      onClick={() => { setShowDeleteConfirm(false); setDeletePassword(''); }}
                      style={{
                        padding: '10px 20px',
                        background: 'transparent',
                        border: '1px solid var(--border-primary)',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        fontFamily: 'monospace',
                        fontSize: '0.8rem',
                      }}
                    >
                      {CONFIRM.cancel.toUpperCase()}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Theme Customization Modal (v2.11.0) */}
      <ThemeCustomizationModal
        isOpen={showThemeModal}
        onClose={() => setShowThemeModal(false)}
        fetchAPI={fetchAPI}
        showToast={showToast}
        user={user}
        isMobile={isMobile}
        onUpdatePreferences={handleUpdatePreferences}
      />
    </div>
  );
};


export default ProfileSettings;

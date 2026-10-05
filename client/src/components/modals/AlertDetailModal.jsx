import React from 'react';
import { plainText } from '../../utils/plainText.js';

const AlertDetailModal = ({ alert, onClose, onDismiss, isMobile }) => {
  if (!alert) return null;

  const priorityConfig = {
    critical: { icon: '🚨', color: 'var(--accent-orange)', label: 'CRITICAL' },
    warning: { icon: '⚠️', color: 'var(--accent-amber)', label: 'WARNING' },
    info: { icon: 'ℹ️', color: 'var(--accent-teal)', label: 'INFO' }
  };

  const categoryLabels = {
    system: 'System',
    announcement: 'Announcement',
    emergency: 'Emergency'
  };

  const cfg = priorityConfig[alert.priority] || priorityConfig.info;
  const categoryLabel = categoryLabels[alert.category] || alert.category;

  // Format dates - ensure we parse as UTC
  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    // Append Z if not present (SQLite may strip it)
    const utcStr = dateStr.endsWith('Z') ? dateStr : dateStr + 'Z';
    const d = new Date(utcStr);
    return d.toLocaleString();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000, display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0, 0, 0, 0.8)', padding: '16px',
    }} onClick={onClose}>
      <div style={{
        background: 'var(--bg-elevated)', border: `1px solid ${cfg.color}`,
        borderRadius: '4px', padding: isMobile ? '16px' : '24px',
        maxWidth: '500px', width: '100%', maxHeight: '80vh', overflow: 'auto',
        boxShadow: `0 0 20px ${cfg.color}40`,
      }} onClick={e => e.stopPropagation()}>
        {/* Priority Badge */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          marginBottom: '16px', padding: '8px 12px',
          background: `${cfg.color}15`, border: `1px solid ${cfg.color}40`,
          borderRadius: '4px',
        }}>
          <span style={{ fontSize: '1.5rem' }}>{cfg.icon}</span>
          <span style={{ color: cfg.color, fontWeight: 600, fontFamily: 'monospace', fontSize: '0.9rem' }}>
            {cfg.label}
          </span>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginLeft: 'auto' }}>
            {categoryLabel}
          </span>
        </div>

        {/* Title */}
        <h2 style={{
          margin: '0 0 16px 0', color: 'var(--text-primary)',
          fontFamily: 'monospace', fontSize: isMobile ? '1.1rem' : '1.25rem',
        }}>
          {plainText(alert.title)}
        </h2>

        {/* Content */}
        <div style={{
          color: 'var(--text-secondary)', marginBottom: '16px',
          lineHeight: '1.6', fontFamily: 'monospace', fontSize: '0.9rem',
          padding: '12px', background: 'var(--bg-surface)', borderRadius: '4px',
        }} dangerouslySetInnerHTML={{ __html: alert.content }} />

        {/* Metadata */}
        <div style={{
          display: 'flex', flexDirection: 'column', gap: '4px',
          marginBottom: '20px', color: 'var(--text-dim)',
          fontFamily: 'monospace', fontSize: '0.75rem',
        }}>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Active: </span>
            {formatDate(alert.startTime)} — {formatDate(alert.endTime)}
          </div>
          {alert.originNode && (
            <div>
              <span style={{ color: 'var(--text-muted)' }}>From: </span>
              <span style={{ color: 'var(--accent-purple)' }}>@{alert.originNode}</span>
            </div>
          )}
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          {onDismiss && (
            <button onClick={() => { onDismiss(alert.id); onClose(); }} style={{
              padding: isMobile ? '10px 16px' : '8px 14px',
              minHeight: isMobile ? '44px' : 'auto',
              background: 'transparent', border: '1px solid var(--border-secondary)',
              color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'monospace',
              fontSize: isMobile ? '0.85rem' : '0.8rem',
            }}>DISMISS</button>
          )}
          <button onClick={onClose} style={{
            padding: isMobile ? '10px 16px' : '8px 14px',
            minHeight: isMobile ? '44px' : 'auto',
            background: `${cfg.color}20`, border: `1px solid ${cfg.color}`,
            color: cfg.color, cursor: 'pointer', fontFamily: 'monospace',
            fontSize: isMobile ? '0.85rem' : '0.8rem',
          }}>CLOSE</button>
        </div>
      </div>
    </div>
  );
};

export default AlertDetailModal;

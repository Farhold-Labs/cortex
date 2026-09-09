import React from 'react';
import { GlowText } from '../ui/SimpleComponents.jsx';
import { CONFIRM } from '../../../messages.js';
import { T } from '../../config/terminology.js';

const DeleteConfirmModal = ({ isOpen, onClose, waveTitle, onConfirm, isMobile }) => {
  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '20px',
    }} onClick={onClose}>
      <div style={{
        width: '100%', maxWidth: '450px',
        background: 'linear-gradient(135deg, var(--bg-base), var(--bg-surface))',
        border: '2px solid var(--accent-orange)80', padding: isMobile ? '20px' : '24px',
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ marginBottom: '20px' }}>
          <GlowText color="var(--accent-orange)" size={isMobile ? '1rem' : '1.1rem'}>Delete {T.Wave}</GlowText>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <div style={{
            color: 'var(--text-primary)',
            fontSize: isMobile ? '0.9rem' : '0.95rem',
            lineHeight: 1.6,
            marginBottom: '12px'
          }}>
            Are you sure you want to delete <span style={{ color: 'var(--accent-amber)', fontWeight: 600 }}>"{waveTitle}"</span>?
          </div>
          <div style={{
            color: 'var(--accent-orange)',
            fontSize: isMobile ? '0.85rem' : '0.9rem',
            lineHeight: 1.5,
            background: 'var(--accent-orange)15',
            padding: '12px',
            border: '1px solid var(--accent-orange)30',
          }}>
            ⚠ This action cannot be undone. All messages will be permanently deleted and all participants will be notified.
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button onClick={onClose} style={{
            padding: isMobile ? '12px 20px' : '10px 20px',
            minHeight: isMobile ? '44px' : 'auto',
            background: 'transparent',
            border: '1px solid var(--border-primary)',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: isMobile ? '0.9rem' : '0.85rem',
          }}>CANCEL</button>
          <button onClick={() => { onConfirm(); onClose(); }} style={{
            padding: isMobile ? '12px 20px' : '10px 20px',
            minHeight: isMobile ? '44px' : 'auto',
            background: 'var(--accent-orange)',
            border: '1px solid var(--accent-orange)',
            color: '#fff',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: isMobile ? '0.9rem' : '0.85rem',
            fontWeight: 600,
          }}>{CONFIRM.delete.toUpperCase()}</button>
        </div>
      </div>
    </div>
  );
};

export default DeleteConfirmModal;

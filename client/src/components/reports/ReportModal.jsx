import React, { useState, useEffect } from 'react';
import { formatError } from '../../../messages.js';
import { GlowText } from '../ui/SimpleComponents.jsx';
import { T } from '../../config/terminology.js';

// Report reasons constant
const REPORT_REASONS = [
  { value: 'spam', label: 'Spam', desc: `Unwanted promotional content or repetitive ${T.pings}` },
  { value: 'harassment', label: 'Harassment', desc: 'Bullying, threats, or targeted abuse' },
  { value: 'inappropriate', label: 'Inappropriate Content', desc: 'Offensive, explicit, or harmful content' },
  { value: 'other', label: 'Other', desc: 'Other violation of community guidelines' },
];

const ReportModal = ({ isOpen, onClose, type, targetId, targetPreview, fetchAPI, showToast, isMobile }) => {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setReason('');
      setDetails('');
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!reason) {
      showToast('Please select a reason for the report', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetchAPI('/reports', {
        method: 'POST',
        body: JSON.stringify({ type, targetId, reason, details: details.trim() }),
      });
      if (res.ok) {
        showToast('Report submitted successfully. Thank you for helping keep Cortex safe.', 'success');
        onClose();
      } else {
        const data = await res.json();
        showToast(data.error || formatError('Failed to submit report'), 'error');
      }
    } catch (err) {
      showToast(formatError('Failed to submit report'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const typeLabels = { message: `${T.Ping}`, ping: `${T.Ping}`, wave: `${T.Wave}`, user: 'User' };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '20px',
    }} onClick={onClose}>
      <div style={{
        width: '100%', maxWidth: '500px',
        background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-base))',
        border: '2px solid var(--accent-orange)80', padding: isMobile ? '20px' : '24px',
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ marginBottom: '20px' }}>
          <GlowText color="var(--accent-orange)" size={isMobile ? '1rem' : '1.1rem'}>Report {typeLabels[type] || 'Content'}</GlowText>
        </div>

        {targetPreview && (
          <div style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            padding: '12px',
            marginBottom: '16px',
            fontSize: isMobile ? '0.85rem' : '0.9rem',
            color: 'var(--text-secondary)',
            maxHeight: '80px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {targetPreview}
          </div>
        )}

        <div style={{ marginBottom: '16px' }}>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: '8px', textTransform: 'uppercase' }}>
            Reason for report
          </div>
          {REPORT_REASONS.map((r) => (
            <label key={r.value} style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              padding: '10px 12px',
              marginBottom: '8px',
              background: reason === r.value ? 'var(--accent-amber)15' : 'var(--bg-surface)',
              border: `1px solid ${reason === r.value ? 'var(--accent-amber)50' : 'var(--border-subtle)'}`,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}>
              <input
                type="radio"
                name="report-reason"
                value={r.value}
                checked={reason === r.value}
                onChange={(e) => setReason(e.target.value)}
                style={{ marginTop: '2px', accentColor: 'var(--accent-amber)' }}
              />
              <div>
                <div style={{ color: 'var(--text-primary)', fontSize: isMobile ? '0.9rem' : '0.95rem' }}>{r.label}</div>
                <div style={{ color: 'var(--text-dim)', fontSize: isMobile ? '0.8rem' : '0.85rem', marginTop: '2px' }}>{r.desc}</div>
              </div>
            </label>
          ))}
        </div>

        <div style={{ marginBottom: '20px' }}>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: '8px', textTransform: 'uppercase' }}>
            Additional details (optional)
          </div>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value.slice(0, 500))}
            placeholder="Provide any additional context..."
            maxLength={500}
            style={{
              width: '100%',
              minHeight: '80px',
              padding: '12px',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)',
              fontFamily: 'monospace',
              fontSize: isMobile ? '0.9rem' : '0.85rem',
              resize: 'vertical',
            }}
          />
          <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', textAlign: 'right', marginTop: '4px' }}>
            {details.length}/500
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button onClick={onClose} disabled={submitting} style={{
            padding: isMobile ? '12px 20px' : '10px 20px',
            minHeight: isMobile ? '44px' : 'auto',
            background: 'transparent',
            border: '1px solid var(--border-primary)',
            color: 'var(--text-dim)',
            cursor: submitting ? 'not-allowed' : 'pointer',
            fontFamily: 'monospace',
            fontSize: isMobile ? '0.9rem' : '0.85rem',
            opacity: submitting ? 0.5 : 1,
          }}>CANCEL</button>
          <button onClick={handleSubmit} disabled={submitting || !reason} style={{
            padding: isMobile ? '12px 20px' : '10px 20px',
            minHeight: isMobile ? '44px' : 'auto',
            background: reason ? 'var(--accent-orange)' : 'var(--border-primary)',
            border: `1px solid ${reason ? 'var(--accent-orange)' : 'var(--border-primary)'}`,
            color: '#fff',
            cursor: (submitting || !reason) ? 'not-allowed' : 'pointer',
            fontFamily: 'monospace',
            fontSize: isMobile ? '0.9rem' : '0.85rem',
            fontWeight: 600,
            opacity: submitting ? 0.7 : 1,
          }}>{submitting ? 'SUBMITTING...' : 'SUBMIT REPORT'}</button>
        </div>
      </div>
    </div>
  );
};

export default ReportModal;

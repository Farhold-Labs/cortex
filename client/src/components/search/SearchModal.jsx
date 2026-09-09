import React, { useState } from 'react';
import { formatError } from '../../../messages.js';
import { T } from '../../config/terminology.js';

const SearchModal = ({ onClose, fetchAPI, showToast, onSelectMessage, isMobile }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = async () => {
    if (searchQuery.trim().length < 2) {
      showToast('Search query must be at least 2 characters', 'error');
      return;
    }

    setSearching(true);
    setHasSearched(true);
    try {
      const data = await fetchAPI(`/search?q=${encodeURIComponent(searchQuery)}`);
      setResults(data.results || []);
    } catch (err) {
      showToast(err.message || formatError('Search failed'), 'error');
    }
    setSearching(false);
  };

  const highlightMatch = (text, query) => {
    if (!query) return text;
    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase()
        ? <span key={i} style={{ background: 'var(--accent-amber)40', color: 'var(--accent-amber)', fontWeight: 'bold' }}>{part}</span>
        : part
    );
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: isMobile ? '20px' : '40px',
      overflowY: 'auto',
    }}>
      <div style={{
        background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
        border: '2px solid var(--accent-teal)',
        padding: isMobile ? '20px' : '24px',
        width: '100%',
        maxWidth: '700px',
        maxHeight: '80vh',
        overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ color: 'var(--accent-teal)', margin: 0, fontSize: isMobile ? '1.2rem' : '1.5rem' }}>SEARCH MESSAGES</h2>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '1.5rem',
            minHeight: isMobile ? '44px' : 'auto', minWidth: isMobile ? '44px' : 'auto',
          }}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder={`Search ${T.pings}...`}
            style={{
              flex: 1,
              padding: isMobile ? '14px' : '12px',
              minHeight: isMobile ? '44px' : 'auto',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)',
              fontSize: isMobile ? '1rem' : '0.9rem',
              fontFamily: 'inherit',
            }}
          />
          <button
            onClick={handleSearch}
            disabled={searching}
            style={{
              padding: isMobile ? '14px 20px' : '12px 24px',
              minHeight: isMobile ? '44px' : 'auto',
              background: 'var(--accent-teal)20',
              border: '1px solid var(--accent-teal)',
              color: 'var(--accent-teal)',
              cursor: searching ? 'wait' : 'pointer',
              fontFamily: 'monospace',
              fontSize: isMobile ? '0.9rem' : '0.85rem',
            }}
          >
            {searching ? 'SEARCHING...' : 'SEARCH'}
          </button>
        </div>

        {hasSearched && (
          <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '16px' }}>
            Found {results.length} result{results.length !== 1 ? 's' : ''}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {results.map(result => (
            <div
              key={result.id}
              onClick={() => onSelectMessage(result)}
              style={{
                padding: isMobile ? '14px' : '12px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--accent-teal)'}
              onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-subtle)'}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.75rem' }}>
                <span style={{ color: 'var(--accent-teal)' }}>{result.waveName}</span>
                <span style={{ color: 'var(--text-dim)' }}>
                  {new Date(result.createdAt).toLocaleString()}
                </span>
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '4px' }}>
                {result.authorName}
              </div>
              {result.snippet ? (
                <div
                  style={{ color: 'var(--text-primary)', fontSize: isMobile ? '0.95rem' : '0.9rem', lineHeight: '1.5' }}
                  dangerouslySetInnerHTML={{ __html: result.snippet }}
                />
              ) : (
                <div style={{ color: 'var(--text-primary)', fontSize: isMobile ? '0.95rem' : '0.9rem', lineHeight: '1.5' }}>
                  {highlightMatch(result.content, searchQuery)}
                </div>
              )}
            </div>
          ))}
        </div>

        {hasSearched && results.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '40px 20px' }}>
            No pings found matching "{searchQuery}"
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchModal;

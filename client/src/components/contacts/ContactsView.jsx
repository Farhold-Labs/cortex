import React, { useState, useEffect } from 'react';
import { SUCCESS, EMPTY, LOADING, CONFIRM_DIALOG, formatError } from '../../../messages.js';
import { askConfirm } from '../../utils/askConfirm.jsx';
import { useWindowSize } from '../../hooks/useWindowSize.js';
import { GlowText, Avatar } from '../ui/SimpleComponents.jsx';
import ContactRequestsPanel from './ContactRequestsPanel.jsx';
import SentRequestsPanel from './SentRequestsPanel.jsx';
import SendContactRequestModal from './SendContactRequestModal.jsx';

const ContactsView = ({
  contacts, fetchAPI, showToast, onContactsChange,
  contactRequests, sentContactRequests, onRequestsChange,
  onShowProfile
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [requestModalUser, setRequestModalUser] = useState(null);
  const { width, isMobile, isTablet, isDesktop } = useWindowSize();

  useEffect(() => {
    if (searchQuery.length < 2) { setSearchResults([]); return; }
    const timeout = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await fetchAPI(`/users/search?q=${encodeURIComponent(searchQuery)}`);
        setSearchResults(results);
      } catch (err) { console.error(err); }
      setSearching(false);
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery, fetchAPI]);

  const handleRemoveContact = async (contact) => {
    if (!(await askConfirm(CONFIRM_DIALOG.removeContact(contact.name || `@${contact.handle}`)))) return;
    const id = contact.id;
    try {
      await fetchAPI(`/contacts/${id}`, { method: 'DELETE' });
      showToast(SUCCESS.contactRemoved, 'success');
      onContactsChange();
    } catch (err) {
      showToast(err.message || formatError('Failed to remove contact'), 'error');
    }
  };

  // Helper to check if we already sent a request to this user
  const hasSentRequestTo = (userId) => sentContactRequests.some(r => r.to_user_id === userId);
  // Helper to check if we received a request from this user
  const hasReceivedRequestFrom = (userId) => contactRequests.some(r => r.from_user_id === userId);

  return (
    <div style={{ flex: 1, padding: isMobile ? '16px' : '20px', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <GlowText color="var(--accent-amber)" size="1.1rem">CONTACTS</GlowText>
        <button onClick={() => setShowSearch(!showSearch)} style={{
          padding: isMobile ? '10px 16px' : '8px 16px',
          minHeight: isMobile ? '44px' : 'auto',
          background: showSearch ? 'var(--accent-teal)20' : 'var(--accent-amber)20',
          border: `1px solid ${showSearch ? 'var(--accent-teal)' : 'var(--accent-amber)50'}`,
          color: showSearch ? 'var(--accent-teal)' : 'var(--accent-amber)', cursor: 'pointer', fontFamily: 'monospace',
        }}>{showSearch ? '✕ CLOSE' : '+ FIND PEOPLE'}</button>
      </div>

      {/* Incoming Contact Requests */}
      <ContactRequestsPanel
        requests={contactRequests}
        fetchAPI={fetchAPI}
        showToast={showToast}
        onRequestsChange={onRequestsChange}
        onContactsChange={onContactsChange}
        isMobile={isMobile}
      />

      {/* Sent Requests (collapsed by default) */}
      <SentRequestsPanel
        requests={sentContactRequests}
        fetchAPI={fetchAPI}
        showToast={showToast}
        onRequestsChange={onRequestsChange}
        isMobile={isMobile}
      />

      {showSearch && (
        <div style={{ marginBottom: '24px', padding: '20px', background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))', border: '1px solid var(--accent-teal)40' }}>
          <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by handle or name..."
            style={{
              width: '100%', padding: '12px', boxSizing: 'border-box', marginBottom: '16px',
              background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontFamily: 'inherit',
            }} />
          {searching && <div style={{ color: 'var(--text-muted)' }}>{LOADING.searching}</div>}
          {!searching && searchQuery.length >= 2 && searchResults.length === 0 && (
            <div style={{ color: 'var(--text-muted)' }}>No users found</div>
          )}
          {searchResults.filter(user => user && user.id && user.displayName).map(user => {
            const sentRequest = hasSentRequestTo(user.id);
            const receivedRequest = hasReceivedRequestFrom(user.id);
            return (
              <div key={user.id} style={{
                padding: '12px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Avatar letter={user.avatar || user.displayName[0]} color="var(--accent-amber)" size={isMobile ? 40 : 36} status={user.status} />
                  <div>
                    <div style={{ color: 'var(--text-primary)' }}>{user.displayName}</div>
                  </div>
                </div>
                {user.isContact ? (
                  <span style={{ color: 'var(--accent-green)', fontSize: '0.75rem' }}>✓ CONTACT</span>
                ) : sentRequest ? (
                  <span style={{ color: 'var(--accent-amber)', fontSize: '0.75rem' }}>REQUEST SENT</span>
                ) : receivedRequest ? (
                  <span style={{ color: 'var(--accent-teal)', fontSize: '0.75rem' }}>RESPOND ABOVE</span>
                ) : (
                  <button onClick={() => setRequestModalUser(user)} style={{
                    padding: isMobile ? '10px 14px' : '6px 12px',
                    minHeight: isMobile ? '44px' : 'auto',
                    background: 'var(--accent-teal)20', border: '1px solid var(--accent-teal)',
                    color: 'var(--accent-teal)', cursor: 'pointer', fontFamily: 'monospace',
                  }}>SEND REQUEST</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {contacts.length === 0 && contactRequests.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '3rem', marginBottom: '16px' }}>◎</div>
          <div>{EMPTY.noContacts}</div>
          <div style={{ fontSize: '0.8rem', marginTop: '8px' }}>Use "Find People" to send contact requests</div>
        </div>
      ) : contacts.length > 0 && (
        <>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: '12px', marginTop: '8px' }}>
            YOUR CONTACTS ({contacts.length})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? '100%' : '280px'}, 1fr))`, gap: '12px' }}>
            {contacts.filter(contact => contact && contact.id && contact.name).map(contact => (
              <div key={contact.id} style={{
                padding: '16px', background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
                border: `1px solid ${contact.isRemote ? 'var(--accent-purple)30' : 'var(--border-subtle)'}`,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                // A grid item never shrinks below its content unless told to:
                // a long name ran the card off a phone. Calls are on the
                // profile a tap opens, not here (v2.145.1).
                minWidth: 0, gap: '8px',
                ...(isMobile ? { padding: '12px' } : {}),
              }}>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '10px' : '12px', minWidth: 0, cursor: onShowProfile ? 'pointer' : 'default', flex: 1 }}
                  onClick={onShowProfile ? () => onShowProfile(contact.id) : undefined}
                  title={onShowProfile ? 'View profile' : undefined}
                >
                  <Avatar
                    letter={contact.avatar || contact.name?.[0] || '?'}
                    color={contact.isRemote ? 'var(--accent-purple)' : 'var(--accent-amber)'}
                    size={44}
                    status={contact.status}
                    imageUrl={contact.avatarUrl}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {contact.name}
                    </div>
                    {contact.isRemote && (
                      <div style={{ color: 'var(--accent-purple)', fontSize: '0.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        @{contact.handle}@{contact.nodeName}
                      </div>
                    )}
                  </div>
                </div>
                <button onClick={() => handleRemoveContact(contact)} style={{
                  padding: isMobile ? '10px' : '6px 10px',
                  minHeight: isMobile ? '44px' : 'auto',
                  background: 'transparent', border: '1px solid var(--accent-orange)50',
                  color: 'var(--accent-orange)', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.7rem', flexShrink: 0,
                }}>✕</button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Send Contact Request Modal */}
      <SendContactRequestModal
        isOpen={!!requestModalUser}
        onClose={() => setRequestModalUser(null)}
        toUser={requestModalUser}
        fetchAPI={fetchAPI}
        showToast={showToast}
        onRequestSent={() => {
          onRequestsChange();
          setSearchResults(prev => prev.map(u =>
            u.id === requestModalUser?.id ? { ...u, requestSent: true } : u
          ));
        }}
        isMobile={isMobile}
      />
    </div>
  );
};

export default ContactsView;

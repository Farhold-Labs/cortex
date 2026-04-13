import React, { useState } from 'react';
import ContactsView from '../components/contacts/ContactsView.jsx';
import GroupsView from '../components/groups/GroupsView.jsx';

const PeopleView = (props) => {
  const [tab, setTab] = useState('contacts');

  const tabStyle = (active) => ({
    flex: 1,
    padding: '10px',
    background: active ? 'var(--accent-amber)15' : 'transparent',
    border: 'none',
    borderBottom: `2px solid ${active ? 'var(--accent-amber)' : 'transparent'}`,
    color: active ? 'var(--accent-amber)' : 'var(--text-dim)',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '0.75rem',
    letterSpacing: '1px',
  });

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        <button style={tabStyle(tab === 'contacts')} onClick={() => setTab('contacts')}>
          ● CONTACTS
          {props.contactRequests?.length > 0 && (
            <span style={{
              marginLeft: '6px', background: 'var(--accent-teal)', color: '#fff',
              fontSize: '0.6rem', padding: '1px 5px', borderRadius: '8px',
            }}>
              {props.contactRequests.length}
            </span>
          )}
        </button>
        <button style={tabStyle(tab === 'crews')} onClick={() => setTab('crews')}>
          ◆ CREWS
          {props.groupInvitations?.length > 0 && (
            <span style={{
              marginLeft: '6px', background: 'var(--accent-amber)', color: '#000',
              fontSize: '0.6rem', padding: '1px 5px', borderRadius: '8px',
            }}>
              {props.groupInvitations.length}
            </span>
          )}
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: tab === 'contacts' ? 'flex' : 'none', flexDirection: 'column' }}>
        <ContactsView
          contacts={props.contacts}
          fetchAPI={props.fetchAPI}
          showToast={props.showToast}
          onContactsChange={props.onContactsChange}
          contactRequests={props.contactRequests}
          sentContactRequests={props.sentContactRequests}
          onRequestsChange={props.onRequestsChange}
          onShowProfile={props.onShowProfile}
        />
      </div>
      <div style={{ flex: 1, minHeight: 0, display: tab === 'crews' ? 'flex' : 'none', flexDirection: 'column' }}>
        <GroupsView
          groups={props.groups}
          fetchAPI={props.fetchAPI}
          showToast={props.showToast}
          onGroupsChange={props.onGroupsChange}
          groupInvitations={props.groupInvitations}
          onInvitationsChange={props.onInvitationsChange}
          contacts={props.contacts}
        />
      </div>
    </div>
  );
};

export default PeopleView;

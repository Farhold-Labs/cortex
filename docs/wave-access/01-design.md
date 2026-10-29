# Wave access, groups and invitations — design

Status: **decided** (2026-10-29), not built yet. Jared's decisions are recorded at the end and folded into the text.

## Why

Jared, 2026-10-29: the permission model is confusing. Starting a conversation
with a few people means creating a crew first, inviting its members, waiting,
and only then creating the wave. Categories sit in the same places as the
permission choices and look like they decide something. Adding people to an
existing wave should just work, and should form a group as it goes, but people
must still be asked before they are put in a conversation. Inside a Community,
waves should be open to the Community unless someone narrows them.

### What exists today (v2.129.0)

| Thing | What it really does |
| --- | --- |
| **Private** wave | Only its participants. Only the creator may add people. |
| **Crew** wave (`group`) | Every member of one crew. The crew must exist first. |
| **Verse-Wide** (`crossServer`) | Participants including people on allied servers. The create dialog switches to it on its own when a remote person is added. |
| **Public** wave | Everyone on the server; in a Community channel (since v2.128.0), everyone who can see the channel. |
| **Crew** | A named, reusable list of people with roles, joined by invitation. A crew admin can also add people directly, bypassing the invitation. |
| **Category** | A personal folder in your own list. Grants nothing to anyone. |
| **Wave roles** (v2.88.0) | owner > admin > moderator, per wave. |
| **Community channel** | Lists waves; since v2.128.0 decides who sees its public waves. |

**Consent gaps found while writing this:**

- Creating a wave with people, or adding someone later, puts them in at once. They are never asked.
- Neither path checks blocks. Someone who blocked you can be added to your wave. Only contact requests and crew invitations check blocks.
- A crew admin adding a member directly skips the crew's own invitation flow.
- A wave in a Community channel accepts participants who are not members of the Community. The participant route checks only the wave.

These are fixed in phase 1 (below) whatever else is decided.

## The model

Every wave has an **audience**, and there are only three kinds:

| Where | Audience | Who is in it |
| --- | --- | --- |
| Outside a Community | **People** (default) | A group of people, each of whom accepted an invitation |
| Outside a Community | **Everyone on this server** | Public, as today (still admin-only to create, per the Communities plan) |
| Inside a Community | **The channel** (default) | Whoever may see the channel, as in v2.128.0 |
| Inside a Community | **Only these** | Named people and/or Community roles, plus the person who narrowed it |

"Verse-Wide" stops being a choice. A wave whose people include someone on
another server is federated; that is a fact about its people, not a setting.

### Outside Communities: groups make themselves

- **Starting a wave:** pick people (or an existing group), type a title, go. No crew to create first.
- **The group is created with the wave**, named after its people: "Mal, Zoe & Wash", or "Mal, Zoe, Wash +3" past four. Anyone in it can rename it.
- **Invitations go out at once.** The creator is in from the start; everyone else is *invited* until they accept.
- **Adding someone later** invites them to the wave's group. The name updates if it was never renamed.
- **A group shared by several waves:** adding someone to one of them asks "This wave only" (the wave splits off into its own group) or "The whole group" (they are invited to every wave of it). The question only appears when the group has more than one wave.
- **Groups are reusable.** People → Groups lists them, and "New wave with this group" starts another conversation with the same people without inviting them again (they already accepted the group).
- **Existing crews become groups.** Same thing, one name. Crew roles carry over as group roles.

### Asking first

An invitation is the only way into someone else's group or wave outside a
Community. Being invited shows:

- who invited you, the wave's title and the group's members;
- **no messages and no files** until you accept;
- **Accept**, **Decline**, or **Decline and block**.

Rules:

- **Blocks are honoured**: you cannot invite someone who blocked you, and the refusal does not say why (as with contact requests).
- **Who may invite**: the wave's owner and admins by default; a group setting lets any member invite.
- **Pending people are shown as invited**, not as members. The inviter can withdraw an invitation.
- **Rate limited**, so invitations are not a spam channel.
- **Encrypted waves**: an inviter's client wraps the wave key for the invitee at invite time, as it does now for participants. The server holds it and releases it only on acceptance. It cannot read it either way.
- **Other servers**: a remote invitee gets a signed federated invitation and answers it from their home server. This is the hardest part and comes last.
- **Optional, per person, off by default:** "Accept invitations from my contacts automatically".

### Inside Communities: open unless narrowed (Discord-like)

Joining a Community is the consent. Inside one there are no per-wave invitations.
Narrowing is a staff tool, as private channels are in Discord: members cannot
make private waves inside a Community. A member who wants a private
conversation starts a People wave outside it, as a Discord DM or group DM.

- **A new wave in a channel is open to the channel** (the v2.128.0 rule).
- **Narrowing it**: in the wave's ⋮ → **Who can see this**, choose people and/or Community roles. Example: an admin makes "Important discussion" visible only to the Moderators role and themselves.
- **Roles are live**: someone made a moderator later can see it; someone who stops being one cannot. A named person is fixed until removed.
- **Everyone named must be able to see the channel.** You cannot narrow a staff wave to include someone outside a restricted channel.
- **Pickers show only the Community** (Jared, 2026-10-29). Inside a Community, choosing who can see a wave lists only its members who can see that channel, and only its roles as groups. Your personal groups, contacts and anyone else on the server are not listed.
- **The server refuses the rest.** Naming a non-member, or someone who cannot see the channel, is rejected by the server, not just hidden in the picker; the refusal does not say whether that person exists.
- **Narrowing removes access at once** for everyone else, live, the same way v2.128.0 removes it: they drop out of the list and live updates.
- **Widening back** to "the channel" is one choice.
- **Who may narrow**: the Community's **owners and admins only**. Not moderators, not `channel.manage` holders, not the wave's own creator if they are a member.
- **Owners and admins always see narrowed waves**, as Discord administrators see every channel. "Who can see this" says "and Community admins", so nobody in the wave is misled.

### Categories

Categories stay exactly what they are, personal folders, but stop appearing as
if they were a permission choice. They are renamed **Folders**, and taken out of
the create-wave dialog (filing happens from the list).

### One rule on the server

v2.128.0 put the channel rule in one function. This extends it into the single
answer to "may this person see this wave", used everywhere that function is
used now:

```
waveAudienceAllows(wave, userId)
  public, no channel      → everyone
  in a channel            → canDiscoverChannel AND (no narrowing OR named OR holds a named role
                              OR is a Community owner/admin)
  people (group)          → accepted member of the wave's group (or participant, during migration)
```

Invitations are a new encrypted table, like participation and crew membership,
because who-was-invited-by-whom is social graph.

## Migration

| Existing | Becomes |
| --- | --- |
| Private wave | People wave. Its participants become accepted members of a new auto-named group. They are grandfathered: nobody is re-asked. |
| Crew wave | People wave using that crew, now a group. |
| Verse-Wide wave | People wave with federated members. |
| Public wave, no channel | Unchanged. |
| Public wave in a channel | Open to the channel (already true since v2.128.0). |
| Private wave in a channel | Narrowed to its current participants. Only owners and admins can change it from then on. |

## Phases

1. **Consent first.** Invitations for adding people to waves and groups; blocks enforced; crew direct-add goes through an invitation; a Community wave refuses anyone who cannot see its channel. Ships on its own, because it closes the gaps above.
2. **Groups make themselves.** The new create flow, auto-named groups, crews renamed groups, migration of private and crew waves.
3. **Narrowing in Communities.** Who can see this: people and roles.
4. **Clean-up.** Categories → Folders, privacy labels replaced by audience in the UI, docs.
5. **Federated invitations.**

## Decisions (Jared, 2026-10-29)

1. **A group shared by several waves:** ask each time, "This wave only" or "The whole group".
2. **Narrowing in Communities is Discord-like:** only owners and admins can create narrowed waves; members cannot. Read as: owners and admins also always see them, as Discord administrators do. Confirm if that reading is wrong.
3. **Categories are renamed Folders** and leave the create-wave dialog.
4. **Auto-accept from contacts:** a per-person setting, off by default.
5. **In a Community, people and group pickers list only the Community:** members who can see the channel, and the Community's roles. The server refuses anyone else.

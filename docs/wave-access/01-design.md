# Wave access, groups and invitations — design

Status: **decided** (2026-10-29). **Phase 1 built in v2.130.0, phase 2 in v2.131.0**; the rest not yet. Jared's decisions are recorded at the end and folded into the text.

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

Invitations are a table of **pending invitations only** (v2.130.0): a row is deleted
when it is accepted, declined, withdrawn or expires, so who-invited-whom exists only
while the question is open, and an accepted one becomes participation, which is
already encrypted. (The plan had said an encrypted table; keeping no history
protects the social graph more simply.)

## Migration

| Existing | Becomes |
| --- | --- |
| Private wave | People wave. Its participants become accepted members of a new auto-named group. They are grandfathered: nobody is re-asked. |
| Crew wave | People wave using that crew, now a group. |
| Verse-Wide wave | People wave with federated members. |
| Public wave, no channel | Unchanged. |
| Public wave in a channel | Open to the channel (already true since v2.128.0). |
| Private wave in a channel | Narrowed to its current participants. Only owners and admins can change it from then on. |

## Migrating Community waves that have outsiders

Jared, 2026-10-29: plenty of waves in Communities today have groups (crews) or
participant lists that include people who are not members of the Community.
They are there because a Community owner filed them into a channel. Switching
on the strict rule ("only people who can see the channel") would cut those
people off with no warning, so it is not switched on for a Community until
its owner has dealt with each such wave.

**Which waves are affected**

| Kind | Example |
| --- | --- |
| Group (crew) wave filed in a channel | the "Ops crew" wave in #general, where two crew members never joined the Community |
| Private or Verse-Wide wave filed in a channel | a hand-picked list that includes outsiders |
| Public wave in a channel | not affected: already channel-scoped since v2.128.0 |

A wave whose people are all Community members who can see the channel is not
affected: it becomes "narrowed to those people" (or to the role made from its
group, below) with no review.

**Step 0: measure, read-only, in the app.** A report, built as a screen rather
than run against production by hand. It changes nothing and shows no message
content: per Community, the affected waves, how many of each wave's people are
members and how many are not, and the groups involved. Community owners see
their own Communities; node admins see the whole server.

**Step 1: the owner decides each wave.** Until they do, the wave keeps exactly
the access it has now and is marked **Needs review** in the channel and in the
report. There is no deadline and no automatic default. The owner (or a
Community admin) chooses:

- **Move it out.** The wave leaves the channel and becomes an ordinary People wave. Nobody loses access and nobody gains it.
- **Make it a role.** The wave's group becomes a Community role named after it (e.g. "Ops crew"), granted to the group's members who are already Community members, and the wave is narrowed to that role. A wave with a hand-picked list is narrowed to the named members instead. Then, optionally:
  - **Send invitations** to the people outside the Community. Each gets a Community invitation; accepting it makes them a member and grants the role, so they keep the wave. Until they accept, they cannot see it.
  - Without invitations, the outsiders lose access and are told the wave now belongs to a Community they are not in.

**Step 2: groups used elsewhere.** A group also used by waves outside the
Community stays a personal group for those waves. The Community role is a copy
made at the moment of the decision, not a move. Later changes to one do not
change the other.

**Step 3: the strict rule switches on** for a Community once it has no waves
left in Needs review. From then on, pickers list only the Community and the
server refuses outsiders, as above.

**What does not change during review:** the wave's encryption keys, its
messages and its files. Narrowing a wave to a role removes access from the
server's point of view; for an encrypted wave, people who lose access keep
whatever their client had already decrypted, as with any removal today.

## Phases

1. **Consent first (built, v2.130.0).** Invitations for adding people to waves and groups; blocks enforced; crew direct-add goes through an invitation; a Community wave refuses anyone who cannot see its channel; filing a wave with outsiders into a channel is refused; appointing wave staff no longer joins a stranger. Ships on its own, because it closes the gaps above. (For Communities still in review, the last rule applies only to people being *added*: nobody already in a wave is removed.)
2. **Community wave report (built, v2.131.0).** The read-only report in the app, so the size of the review is known before anything is asked of owners. Owners and admins see their Community's waves in Manage Community → WAVES TO REVIEW, with titles only for waves they can open; node admins see numbers per Community under ADMINISTRATION. Neither shows who the people outside are. Building it found two crew paths round phase 1 (filing counted only participant rows; joining a crew reached its filed waves), closed in the same release.
3. **Groups make themselves.** The new create flow, auto-named groups, crews renamed groups, migration of private and crew waves outside Communities.
4. **Community wave review and narrowing.** Needs review; the owner's Move it out / Make it a role (with or without invitations); Who can see this with people and live roles. Each Community switches to the strict rule when its review is done.
5. **Clean-up.** Categories → Folders, privacy labels replaced by audience in the UI, docs.
6. **Federated invitations.**

## Decisions (Jared, 2026-10-29)

1. **A group shared by several waves:** ask each time, "This wave only" or "The whole group".
2. **Narrowing in Communities is Discord-like:** only owners and admins can create narrowed waves; members cannot. Read as: owners and admins also always see them, as Discord administrators do. Confirm if that reading is wrong.
3. **Categories are renamed Folders** and leave the create-wave dialog.
4. **Auto-accept from contacts:** a per-person setting, off by default.
5. **In a Community, people and group pickers list only the Community:** members who can see the channel, and the Community's roles. The server refuses anyone else.
6. **Existing Community waves with outsiders are decided by the Community's owner**, one by one: Move it out, or Make it a role with or without sending invitations. No deadline, no automatic default; until then the wave keeps its access and shows Needs review. The numbers come from a read-only report in the app, not from querying production by hand.

# Droplets: Message-to-Wave Evolution

> **Historical document.** Shipped in v1.10.0; the terminology it proposes was superseded by the v2.0.0 rename (droplet → ping, burst/ripple → thread). Kept for the reasoning behind the design, not as a description of how Cortex works today — see CHANGELOG.md and docs/API.md for current behaviour.

## Design Document - v1.0

**Status:** Implemented in v1.10.0
**Version:** v1.10.0
**Last Updated:** December 2025

---

## Overview

This document outlines the evolution of Cortex's messaging model from flat/threaded "messages" to a more fluid "droplet" system where any message can be viewed as its own wave-like context, and conversations can be broken out into new waves.

### Core Concepts

| Term | Definition |
|------|------------|
| **Wave** | A conversation container - where a droplet "hits the water" |
| **Droplet** | A single message unit (formerly "message") |
| **Focus View** | Viewing a droplet and its replies as if it were a wave |
| **Ripple** | Creating a new wave from a droplet and its replies (formerly "Break Out") |

### Metaphor
> *"Droplets in water create waves. The wave contains where the drop hit the water."*

---

## Feature 1: Focus View (Drill-Down)

### Description
Any droplet can be "focused" to view it in a full wave-like presentation. This is the same data, just a different view that makes deep conversations easier to follow.

### User Flow
1. User sees a droplet with replies in a wave
2. User clicks **Focus** button (or taps droplet on mobile)
3. View transitions to show that droplet as the "root" in full-width wave view
4. Header shows breadcrumb: `Wave Name › Parent Droplet › Current Droplet`
5. User can reply (reply goes to focused droplet)
6. Back button or swipe returns to previous context

### UI Components

#### Desktop
- **Focus Button**: Small button on droplet (🔍 or ⤢ expand icon)
- **Breadcrumb Header**: Shows navigation path
- **Full Wave View**: Identical to wave view but for a droplet context

#### Mobile
- **Tap to Focus**: Tapping droplet content enters focus view
- **Swipe Back**: Right swipe returns to parent context
- **Breadcrumb**: Compact version in header

### Visual Design
- Focus view should look identical to wave view
- Breadcrumb trail differentiates it from a top-level wave
- Subtle transition animation when entering/exiting focus

### User Preference: Auto-Focus
Users can configure focus behavior in Profile Settings:

| Setting | Behavior |
|---------|----------|
| **Manual focus** (default) | Click Focus button to enter focus view |
| **Auto-focus on click** | Clicking any droplet with replies enters focus view |

Stored in `preferences.autoFocusDroplets: boolean`

### Threading Within Focus View
- 3-level limit: Focused droplet (L1) → Replies (L2) → Reply-to-replies (L3)
- At L3, show prompt: "Thread getting deep. Focus on this droplet or break out to new wave?"
- Focus button available on any droplet to go deeper

### Navigation Stack
```
Wave: "Project Discussion"
  └─ Focus: Droplet "What about the API design?"
       └─ Focus: Droplet "I think REST is better than GraphQL"
            └─ (Viewing replies to this droplet)
```
- **Back**: Navigates up one level in the stack
- **Close (✕)**: Returns directly to wave root (wave list view)
- Clicking wave name in breadcrumb returns to wave root
- Clicking any breadcrumb item navigates to that level

### Breadcrumb Display
- **Truncation**: When focus depth exceeds 3 levels, truncate middle items
- Format: `Wave Name › ... › Parent › Current`
- Full path available on hover/tap (tooltip or expandable)

### Unread Indicators
- Unread droplets within a focused context show on the parent droplet in wave view
- Example: If "API Design" droplet has 3 unread replies, the droplet shows `(3)` badge
- Unread counts bubble up to wave level in wave list
- Clicking unread badge can jump directly to first unread in that context

---

## Feature 2: Ripple to New Wave

### Description
Take a droplet and all its replies and spin them off into a completely new, independent wave. The original droplet is replaced with a link to the new wave.

### User Flow
1. User clicks "◈ RIPPLE" action on a droplet
2. Modal appears:
   - New wave title (pre-filled from droplet content)
   - Participant list (inherited, can modify)
   - Preview of what will be moved
3. User confirms
4. New wave is created with the droplet + all replies
5. Original droplet is replaced with link card: `[Rippled to wave: "New Wave Title"]`
6. User is navigated to the new wave

### Data Model: Reference Method

Ripple uses a **reference** approach - the new wave points to the same droplet data rather than copying it. This is efficient and maintains a single source of truth.

#### Before Ripple
```
Wave: "Project Discussion"
├─ Droplet A
├─ Droplet B (will be rippled)
│   ├─ Reply B.1
│   └─ Reply B.2
└─ Droplet C
```

#### After Ripple
```
Wave: "Project Discussion"                Wave: "New Discussion" (rippled)
├─ Droplet A                              │
├─ Droplet B [LINK CARD]  ─────────────── ├─ Droplet B (root, same data)
│   "Rippled to wave: New Discussion"     │   ├─ Reply B.1
│   broken_out_to: wave-xyz               │   └─ Reply B.2
└─ Droplet C                              │
                                          (Droplets reference same IDs)
```

#### Reference Mechanics
- Original droplet gets `broken_out_to` field set to new wave ID
- New wave gets `root_droplet_id` field pointing to the rippled droplet
- Replies are re-parented: their `wave_id` changes but `parent_id` stays same
- Original droplet displays as link card in original wave
- Droplet content/reactions/read status shared across both contexts

### Ripple Chain Tracking

When a droplet in a rippled wave is itself rippled, we track the full chain:

```
Wave A: "Infrastructure Planning"
  └─ Droplet X ripples to →
      Wave B: "Network Architecture"
        └─ Droplet Y ripples to →
            Wave C: "Firewall Rules"
```

#### Chain Data Structure
```javascript
// New wave stores its lineage
{
  id: "wave-c",
  title: "Firewall Rules",
  breakout_chain: [
    { wave_id: "wave-a", droplet_id: "droplet-x", title: "Infrastructure Planning" },
    { wave_id: "wave-b", droplet_id: "droplet-y", title: "Network Architecture" }
  ],
  root_droplet_id: "droplet-y"
}
```

#### UI: Origin Trail
- New wave header can show "origin trail" link
- Click to trace back through the conversation history
- Useful for understanding context of how a discussion evolved

### Link Card Component
When a droplet has been rippled, display a special card:

```
┌─────────────────────────────────────────────┐
│  ◈ Rippled to wave...                       │
│  "New Wave Title"                           │
│  → Click to open                            │
│                                             │
│  [Request Access] (if no permission)        │
└─────────────────────────────────────────────┘
```

### Permissions Handling

| Scenario | Behavior |
|----------|----------|
| User has access to new wave | Link opens new wave |
| User doesn't have access | Show link + "Request Access" button |
| User was removed but had replies | Consider: notify them? Request to view? |
| Original wave participants | Auto-inherit to new wave (can be modified) |

### Participant Removal Considerations
- If a user had replies in the rippled conversation, removing them is sensitive
- Options to consider:
  - Warn when removing someone who contributed
  - Allow removal but keep their droplets (attributed to "Former Participant")
  - Require explicit confirmation

---

## Feature 3: Terminology Rename (Messages → Droplets)

### Scope
Full rename throughout codebase, UI, and documentation.

### Changes Required

#### Database (No schema changes needed)
- Table `messages` could stay as-is internally
- API responses can map `message` → `droplet`

#### API
- Consider versioned endpoints or aliasing
- `/api/waves/:id/messages` → `/api/waves/:id/droplets`
- Or: Keep internal naming, transform in response

#### UI Text Changes
| Old | New |
|-----|-----|
| "New message" | "New droplet" |
| "Reply to message" | "Reply to droplet" |
| "Edit message" | "Edit droplet" |
| "Delete message" | "Delete droplet" |
| "Report message" | "Report droplet" |
| "X messages" | "X droplets" |
| "No messages yet" | "No droplets yet" |

#### Code Changes
- Component names: `ThreadedMessage` → `Droplet` or `DropletView`
- State variables: `messages` → `droplets`
- Function names: `sendMessage` → `sendDroplet`, etc.

#### Documentation
- Update CLAUDE.md, README.md, API.md
- Update all code comments

---

## Implementation Phases

### Phase 1: Terminology Rename ✅ COMPLETE
**Effort:** Medium | **Risk:** Low

1. ✅ Rename UI-facing text (messages → droplets)
2. ✅ Rename database tables (messages → droplets)
3. ✅ Update API endpoints (with backward compatibility)
4. ✅ Update WebSocket events (with legacy aliases)

### Phase 2: Focus View - Desktop ✅ COMPLETE
**Effort:** High | **Risk:** Medium

1. ✅ Add Focus button to droplets with children
2. ✅ Create FocusView component (~450 lines)
3. ✅ Implement breadcrumb navigation
4. ✅ Add navigation stack state management
5. ✅ Handle compose in focus context

### Phase 3: Focus View - Mobile ✅ COMPLETE
**Effort:** Medium | **Risk:** Low

1. ✅ Tap-to-focus on droplet content
2. ✅ Swipe-back navigation (80px threshold)
3. ✅ Compact breadcrumb header
4. ✅ Test gesture conflicts

### Phase 4: Threading Depth Limit ✅ COMPLETE
**Effort:** Low | **Risk:** Low

1. ✅ Add depth limit constant (THREAD_DEPTH_LIMIT = 3)
2. ✅ At limit, show "FOCUS TO REPLY" button
3. ✅ Visual depth indicator banner

### Phase 5: Ripple - Core ✅ COMPLETE
**Effort:** High | **Risk:** Medium

1. ✅ Database: Add `broken_out_to`, `original_wave_id` fields to droplets
2. ✅ Database: Add `root_droplet_id`, `broken_out_from`, `breakout_chain` to waves
3. ✅ API: `POST /api/droplets/:id/ripple` endpoint
4. ✅ Backend: Reference model (droplets stay, wave points to root)
5. ✅ WebSocket: `droplet_rippled` and `wave_created` events

### Phase 6: Ripple - UI ✅ COMPLETE
**Effort:** Medium | **Risk:** Low

1. ✅ RippleModal component with title/participant selection
2. ✅ RippledLinkCard component for rippled droplets
3. ✅ "◈ RIPPLE" button on droplets
4. ✅ Navigation to new wave on link card click

### Phase 7: Documentation ✅ COMPLETE
**Effort:** Low | **Risk:** Low

1. ✅ Update CLAUDE.md with terminology and features
2. ✅ Update docs/API.md with new endpoints
3. ✅ Update README.md with changelog
4. ✅ Update DESIGN-droplets.md to mark complete

---

## Database Changes

### Modified Tables

#### `messages` (renamed conceptually to droplets)
```sql
-- Add column for break-out tracking
ALTER TABLE messages ADD COLUMN broken_out_to TEXT REFERENCES waves(id);
-- When not null, this droplet was broken out to the referenced wave
-- The droplet displays as a link card in the original wave

-- Add column for tracking original wave (for reference model)
ALTER TABLE messages ADD COLUMN original_wave_id TEXT REFERENCES waves(id);
-- When a droplet is moved to a broken-out wave, this tracks where it came from
```

#### `waves`
```sql
-- Add columns for broken-out waves
ALTER TABLE waves ADD COLUMN root_droplet_id TEXT REFERENCES messages(id);
-- Points to the droplet that was broken out to create this wave

ALTER TABLE waves ADD COLUMN breakout_chain TEXT;
-- JSON array storing the lineage of break outs
-- Example: [{"wave_id":"wave-a","droplet_id":"drop-x","title":"Original Wave"}]

ALTER TABLE waves ADD COLUMN broken_out_from TEXT REFERENCES waves(id);
-- Direct reference to immediate parent wave (for quick lookups)
```

#### `users` (preferences)
```sql
-- Add to preferences JSON
-- preferences.autoFocusDroplets: boolean (default: false)
```

### New Tables

None required - break out uses reference model where droplets point to their new wave context.

### Reference Model Notes
- When breaking out, droplets get their `wave_id` updated to the new wave
- Original `wave_id` stored in `original_wave_id` for reference
- The root droplet of the break out gets `broken_out_to` set on its record in the original wave
- This creates a link card view in the original wave
- Droplet content, reactions, read status are shared (single source of truth)

---

## API Changes

### New Endpoints

```
POST /api/droplets/:id/focus
  - Returns droplet with full reply tree for focus view
  - Response includes breadcrumb data

POST /api/droplets/:id/breakout
  - Body: { title, participants: [...] }
  - Creates new wave, copies droplet tree
  - Marks original as broken out
  - Returns new wave ID

GET /api/waves/:id/droplets
  - Alias for /api/waves/:id/messages (backward compat)
```

### Modified Endpoints

```
GET /api/waves/:id
  - Response renames messages → droplets (or add alias)

POST /api/waves/:id/droplets
  - Alias for posting new message
```

---

## Decisions Made

| Question | Decision |
|----------|----------|
| Break out history | ✅ Yes - track full chain with `breakout_chain` JSON field |
| Data model for break out | ✅ Reference method - droplets move, not copy |
| Breadcrumb truncation | ✅ Truncate at 3+ levels: `Wave › ... › Parent › Current` |
| Close button | ✅ Yes - returns directly to wave list |
| User preference for auto-focus | ✅ Yes - `autoFocusDroplets` setting, default false |
| Unread handling | ✅ Bubble up to parent droplet in wave view |
| Threading depth limit | ✅ 3 levels, then prompt to focus or break out |
| Merge back | ✅ Yes - defer to v2.x |
| Cross-wave @mentions | ✅ Yes - link to droplets in other waves |
| Search for broken-out content | ✅ Appears in both original and new wave results |
| Notifications | ⚠️ Needs detailed design - follow conversation by default |
| Deletion cascade | ✅ Stops at break-out barriers - orphaned waves survive |

---

## Open Questions (Resolved)

### 1. Merge Back
**Decision:** ✅ Yes, support merging broken-out waves back into parent wave.
**Status:** Defer to future version (v2.x)

When merging back:
- Droplets return to original wave at the break-out point
- Link card is replaced with the original droplet + replies
- Break out chain history is preserved for audit trail
- Participants from merged wave may need to be added to parent wave

### 2. Cross-Wave @Mentions
**Decision:** ✅ Yes, support @mentioning droplets from other waves.

Implementation approach:
- Format: `@droplet:wave-id/droplet-id` or friendly UI picker
- Renders as clickable link with preview snippet
- Clicking navigates to that droplet (with permission check)
- If no permission: show "Droplet from private wave" placeholder

### 3. Search Behavior
**Decision:** ✅ Broken-out content appears in BOTH original and new wave results.

Search logic:
- Droplets are indexed under their current `wave_id`
- Additionally indexed under `original_wave_id` if present
- Search results show which wave the droplet currently lives in
- Clicking result navigates to current location (the broken-out wave)

### 4. Notifications
**Decision:** ⚠️ Needs detailed design - critical for engagement.

Key considerations:
- **Follow the conversation**: User gets notified about activity in broken-out waves if they participated in the original conversation
- **Follow the wave**: User only gets notified if they're a participant in the specific wave
- **Hybrid approach**: Default to following conversation, with option to "unfollow" a broken-out branch

Proposed notification settings per user:
```
□ Notify me about broken-out waves I participated in (default: on)
□ Notify me when a conversation I'm in breaks out (default: on)
□ Notify me about activity in origin wave when viewing broken-out wave (default: off)
```

**Status:** Requires separate detailed design document before implementation.

### 5. Deletion Cascade
**Decision:** ✅ Deletion stops at break-out barriers.

Behavior:
- Deleting original wave does NOT delete broken-out waves
- Broken-out waves become "orphaned" - they still function independently
- Origin trail shows "[Original wave deleted]" for deleted ancestors
- Link card in deleted wave is gone (wave no longer exists)
- Broken-out waves can optionally show "Originated from deleted wave" indicator

---

## Success Metrics

- Reduction in deeply nested threads (>5 levels)
- User adoption of focus view
- User adoption of break out feature
- User feedback on conversation clarity

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Confusion about where content lives | Clear breadcrumbs, link cards |
| Breaking existing workflows | Gradual rollout, keep threading available |
| Performance with deep focus stacks | Limit stack depth, lazy load |
| Data integrity on break out | Transaction-based update, validation |
| Reference model complexity | Clear documentation, thorough testing |

---

## Appendix: User Flow Diagrams

### Focus View Flow
```
┌─────────────────────────────────────────────────────────────┐
│  WAVE: "Project Discussion"                                 │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Droplet: "What about the API?"              [Focus]   │  │
│  │   └─ Reply: "I think REST..."               [Focus]   │  │
│  │       └─ Reply: "GraphQL has benefits"      [Focus]   │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                        Click [Focus]
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Project Discussion › What about the API?        [✕ Close] │
│  ─────────────────────────────────────────────────────────  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ "What about the API?"                      (focused)  │  │
│  │   └─ Reply: "I think REST..."               [Focus]   │  │
│  │       └─ Reply: "GraphQL has benefits"      [Focus]   │  │
│  │   └─ Reply: "We should document first"      [Focus]   │  │
│  └───────────────────────────────────────────────────────┘  │
│  [← Back]                                    [Reply...]     │
└─────────────────────────────────────────────────────────────┘
```

### Break Out Flow
```
┌─────────────────────────────────────────────────────────────┐
│  WAVE: "Project Discussion"                                 │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Droplet: "API Design Discussion"         [⋮ Menu]     │  │
│  │   └─ Many replies...                                  │──┼─── Click "Break Out"
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Break Out to New Wave                                      │
│  ─────────────────────────────────────────────────────────  │
│  Title: [API Design Discussion____________]                 │
│                                                             │
│  Participants: ☑ Alice  ☑ Bob  ☑ Charlie                   │
│                                                             │
│  Preview: 1 droplet + 12 replies will be moved              │
│                                                             │
│                              [Cancel]  [Create Wave]        │
└─────────────────────────────────────────────────────────────┘
                              │
                        Click [Create Wave]
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  WAVE: "Project Discussion"                                 │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ ◈ Continued in wave...                                │  │
│  │   "API Design Discussion"                             │  │
│  │   → Click to open                                     │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

*Document version 0.2 - December 2025*
*Design decisions finalized, ready for implementation planning.*

# Cortex Communities

> **Cortex identities belong to people. Communities belong to their members.
> Nodes provide infrastructure. Federation connects them.**
>
> **No Cortex node is trusted merely because it participates in the federation.
> Every remote assertion must be authenticated, validated, authorized, bounded
> and replay-safe.**

Those two sentences decide most arguments. If an implementation starts making a
Community synonymous with a database, a hostname or a server instance, it is
going the wrong way.

## Status

**Phase 0 — reconnaissance. No feature code has been written.**

| Document | What it is |
| --- | --- |
| [00-existing-architecture.md](00-existing-architecture.md) | What Cortex actually does today, with file references |
| [01-threat-model.md](01-threat-model.md) | What Communities would be exposed to, and what the current stack does and does not defend |
| [02-implementation-plan.md](02-implementation-plan.md) | The proposed build, mapped onto real Cortex modules, in gated phases |

## Decisions taken 2026-09-18

| Question | Decision |
| --- | --- |
| How does a remote person hold rights here? | **Cross-port auth (v2.56.0)** — they become a local stub user. No new identity table. |
| Do Communities span nodes? | **No.** A Community lives on one node; its *members* come from many. |
| What is a channel? | **A wave** carrying a community id. A sub-conversation is a **threaded ping**. |
| Ban scope | **Per-Community**, escalating to a node or verse-wide ban where warranted. |
| Migration | Community admin requests; receiving node's admin accepts. **V2/V3.** |

Two of those supersede recommendations made earlier in these documents. The
superseded reasoning is kept in place rather than deleted, because *why* it was
wrong is the useful part: it assumed a replicated Community, and Cortex was
being asked for something simpler.

## The finding that shapes everything else

Cortex federation today is **node-to-node, not identity-to-identity**.

A federated wave is replicated to an allied *node*, and each node's own local
users then read and write their local copy. `wave_federation` is keyed
`(wave_id, node_name)`. Every table that confers a right — participation,
encryption keys, crew membership, wave roles, event invitations — has a foreign
key to `users(id)`, which only ever holds local accounts. `remote_users` is a
profile **cache**, not an identity that can hold membership or permissions.

Communities as specified require the opposite: one membership list spanning
nodes, roles held by remote identities, and authorization decisions made about
actors who have no local account.

**Amended 2026-09-18.** That remains true of *wave* federation, and it is why
wave roles do not federate. But Communities no longer needs to solve it:
cross-port auth already turns a remote person into a local user with a real row,
and a Community lives on a single node. The largest piece of work in the project
therefore is not building cross-node identity — it is **membership, capabilities
and channels on one node**, with some members arriving by cross-port.

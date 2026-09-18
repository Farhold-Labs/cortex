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

**That is the single largest piece of work in this project, and it is not an
extension of the existing federation model — it is a new capability alongside
it.** Everything in the implementation plan follows from taking that seriously
rather than discovering it in Phase 4.

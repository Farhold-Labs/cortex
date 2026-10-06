// Handles nobody may take (security audit R-04, v2.107.2).
//
// The handle grants nothing — roles do — but a regular user named "admin" or
// "support" reads as staff to everyone else, which is exactly what an
// impersonation attempt needs. `everyone` and `here` read like mention-all
// keywords. Matching is exact and case-insensitive: "admiral" and "helpful"
// are ordinary handles.
//
// There is deliberately no override, not even for an administrator. A staff
// account is recognisable by its role badge, not by its name.
//
// This is a policy list, not a security boundary against SQL: handles are
// already limited to [a-zA-Z0-9_] and every query binds its parameters.

export const RESERVED_HANDLES = Object.freeze([
  'admin', 'administrator', 'root', 'system', 'support', 'moderator', 'mod',
  'staff', 'security', 'official', 'sysop', 'superuser', 'owner', 'help',
  'cortex', 'farhold', 'everyone', 'here',
]);

const RESERVED = new Set(RESERVED_HANDLES);

export function isReservedHandle(handle) {
  return typeof handle === 'string' && RESERVED.has(handle.trim().toLowerCase());
}

export default isReservedHandle;

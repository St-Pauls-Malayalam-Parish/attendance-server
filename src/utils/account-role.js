import { User } from '../models/User.js';

export function parseAccountRole(value) {
  if (value === 'admin' || value === 'member') {
    return value;
  }
  return null;
}

export async function ensureRoleChangeAllowed(user, nextRole) {
  const parsed = parseAccountRole(nextRole);
  if (!parsed) {
    return 'Role must be member or admin';
  }
  if (user.role === parsed) {
    return null;
  }
  if (user.role === 'admin' && parsed === 'member') {
    const adminCount = await User.countDocuments({ role: 'admin' });
    if (adminCount <= 1) {
      return 'At least one admin is required';
    }
  }
  return null;
}

/**
 * Members always sing with the choir. Admins do only when onRoster is explicitly true.
 * Omitted input keeps the current value (so promoting a singer leaves them on the roster).
 */
export function resolveOnRoster(role, input, current = false) {
  if (role !== 'admin') {
    return true;
  }
  if (input === true || input === 'true') {
    return true;
  }
  if (input === false || input === 'false') {
    return false;
  }
  return current === true;
}

export function applyRoleChange(user, nextRole, onRosterInput) {
  const becomingAdmin = user.role !== 'admin' && nextRole === 'admin';
  user.onRoster = resolveOnRoster(nextRole, onRosterInput, user.onRoster);
  user.role = nextRole;
  if (becomingAdmin) {
    user.approvalStatus = 'approved';
    user.active = true;
  }
}

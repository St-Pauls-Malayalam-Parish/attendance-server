import { describe, expect, it, vi, beforeEach } from 'vitest';
import { User, resetModelMocks } from '../helpers/model-mocks.js';
import {
  applyRoleChange,
  ensureRoleChangeAllowed,
  parseAccountRole,
  resolveOnRoster,
} from '../../src/utils/account-role.js';
import { buildUser } from '../helpers/fixtures.js';

describe('account-role', () => {
  beforeEach(() => {
    resetModelMocks();
  });

  it('parses supported roles', () => {
    expect(parseAccountRole('admin')).toBe('admin');
    expect(parseAccountRole('member')).toBe('member');
    expect(parseAccountRole('superuser')).toBeNull();
  });

  it('blocks demoting the last admin', async () => {
    User.countDocuments.mockResolvedValue(1);
    const admin = buildUser({ role: 'admin' });
    expect(await ensureRoleChangeAllowed(admin, 'member')).toMatch(/At least one admin/i);
  });

  it('allows demoting an admin when others remain', async () => {
    User.countDocuments.mockResolvedValue(2);
    const admin = buildUser({ role: 'admin' });
    expect(await ensureRoleChangeAllowed(admin, 'member')).toBeNull();
  });

  it('promotion sets approved and active and can keep roster membership', () => {
    const member = buildUser({ role: 'member', approvalStatus: 'pending', active: false, onRoster: true });
    applyRoleChange(member, 'admin', true);
    expect(member.role).toBe('admin');
    expect(member.approvalStatus).toBe('approved');
    expect(member.active).toBe(true);
    expect(member.onRoster).toBe(true);
  });

  it('promotion can leave an admin off the choir roster', () => {
    const member = buildUser({ role: 'member', onRoster: true });
    applyRoleChange(member, 'admin', false);
    expect(member.role).toBe('admin');
    expect(member.onRoster).toBe(false);
  });

  it('demotion puts the account back on the roster', () => {
    const admin = buildUser({ role: 'admin', onRoster: false });
    applyRoleChange(admin, 'member', false);
    expect(admin.role).toBe('member');
    expect(admin.onRoster).toBe(true);
  });

  it('resolves omitted roster choice from the current value', () => {
    expect(resolveOnRoster('admin', undefined, true)).toBe(true);
    expect(resolveOnRoster('admin', undefined, false)).toBe(false);
    expect(resolveOnRoster('member', false, false)).toBe(true);
  });
});

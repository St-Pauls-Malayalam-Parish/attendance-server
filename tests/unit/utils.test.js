import { describe, expect, it, vi } from 'vitest';
import {
  emailFromUsername,
  normalizeUsername,
  usernameFromName,
  validateEmail,
  validateUsername,
} from '../../src/utils/user-fields.js';
import { createRefreshToken, hashRefreshToken } from '../../src/utils/tokens.js';
import {
  buildEventFilter,
  buildPaginationMeta,
  parsePagination,
} from '../../src/utils/event-query.js';
import { eventDateQuery, parseDay } from '../../src/utils/dates.js';
import { summaryFromCounts } from '../../src/utils/attendance-stats.js';
import { isValidLiturgicalColor, LITURGICAL_COLORS } from '../../src/utils/liturgical-colors.js';
import { MIN_PASSWORD_LENGTH, validatePassword } from '../../src/utils/password.js';
import { faqAudiencesForRole, isFaqAudience } from '../../src/utils/faq-audiences.js';

describe('user-fields', () => {
  it('normalizes username', () => {
    expect(normalizeUsername(' Evan.Thomas ')).toBe('evan.thomas');
    expect(normalizeUsername('')).toBe('');
    expect(normalizeUsername(null)).toBe('');
  });

  it('validates username rules', () => {
    expect(validateUsername('ab')).toMatch(/3–32/);
    expect(validateUsername('evan.thomas')).toBeNull();
  });

  it('validates email', () => {
    expect(validateEmail('bad')).toBeTruthy();
    expect(validateEmail('a@b.co')).toBeNull();
  });

  it('derives username and email from name', () => {
    expect(usernameFromName('Evan Thomas')).toBe('evan.thomas');
    expect(emailFromUsername('evan')).toBe('evan@stpauls.parish');
  });
});

describe('tokens', () => {
  it('creates and hashes refresh tokens', () => {
    const token = createRefreshToken();
    expect(token.length).toBeGreaterThan(20);
    expect(hashRefreshToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
  });

  it('uses default TTL values when env vars are unset', async () => {
    const access = process.env.JWT_ACCESS_EXPIRES_IN;
    const refresh = process.env.JWT_REFRESH_EXPIRES_MS;
    delete process.env.JWT_ACCESS_EXPIRES_IN;
    delete process.env.JWT_REFRESH_EXPIRES_MS;

    vi.resetModules();
    const tokens = await import('../../src/utils/tokens.js');
    expect(tokens.ACCESS_TOKEN_TTL).toBe('15m');
    expect(tokens.REFRESH_TOKEN_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);

    process.env.JWT_ACCESS_EXPIRES_IN = access;
    process.env.JWT_REFRESH_EXPIRES_MS = refresh;
  });
});

describe('event-query', () => {
  it('parses pagination with bounds', () => {
    expect(parsePagination({ page: '0', limit: '500' })).toEqual({
      page: 1,
      pageSize: 100,
      skip: 0,
    });
  });

  it('builds pagination meta', () => {
    expect(buildPaginationMeta({ page: 2, pageSize: 10, total: 25 })).toMatchObject({
      page: 2,
      totalPages: 3,
      rangeStart: 11,
      rangeEnd: 20,
      hasPrevious: true,
      hasNext: true,
    });
    expect(buildPaginationMeta({ page: 99, pageSize: 10, total: 5 }).page).toBe(1);
  });

  it('builds search and type filters', () => {
    const { filter } = buildEventFilter({ search: 'practice', type: 'service' });
    expect(filter.type).toBe('service');
    expect(filter.$or).toHaveLength(2);
  });

  it('handles liturgical color filters', () => {
    expect(buildEventFilter({ liturgicalColor: '__none__' }).filter.liturgicalColor).toBe('');
    expect(buildEventFilter({ liturgicalColor: 'green' }).filter.liturgicalColor).toBe('green');
    expect(buildEventFilter({ liturgicalColor: 'bad' }).filter.liturgicalColor).toBeUndefined();
  });

  it('builds year and date range filters', () => {
    const year = buildEventFilter({ year: '2026' });
    expect(year.filter.date.$gte).toBeInstanceOf(Date);

    const range = buildEventFilter({ from: '2026-01-01', to: '2026-01-31' });
    expect(range.filter.date.$gte).toBeInstanceOf(Date);
    expect(range.filter.date.$lte).toBeInstanceOf(Date);
  });

  it('returns errors for invalid dates', () => {
    expect(buildEventFilter({ from: 'bad' }).error).toMatch(/YYYY-MM-DD/);
    expect(buildEventFilter({ from: '2026-02-01', to: '2026-01-01' }).error).toMatch(/Start date/);
  });

  it('returns empty match when ranges do not overlap', () => {
    const { filter } = buildEventFilter({ year: '2020', from: '2026-01-01', to: '2026-01-02' });
    expect(filter._id).toEqual({ $exists: false });
  });

  it('escapes regex special characters in search', () => {
    const { filter } = buildEventFilter({ search: 'a+b' });
    expect(filter.$or[0].title.$regex).toBe('a\\+b');
  });
});

describe('dates', () => {
  it('parses day bounds', () => {
    expect(parseDay('2026-01-15', false)?.date).toBeInstanceOf(Date);
    expect(parseDay('bad', false)?.error).toBeTruthy();
    expect(parseDay(null, false)).toBeNull();
  });

  it('builds event date query', () => {
    const ok = eventDateQuery('2026-01-01', '2026-01-31');
    expect(ok.range.$gte).toBeInstanceOf(Date);
    expect(eventDateQuery('2026-02-01', '2026-01-01').error).toBeTruthy();
    expect(eventDateQuery('', '')).toEqual({ range: null });
    expect(eventDateQuery('2026-99-99', '2026-01-01').error).toMatch(/Invalid date/);
  });
});

describe('attendance-stats summaryFromCounts', () => {
  it('calculates rate excluding excused from denominator', () => {
    expect(summaryFromCounts({ present: 8, late: 1, absent: 1, excused: 2, total: 12 })).toEqual({
      present: 8,
      absent: 1,
      late: 1,
      excused: 2,
      total: 12,
      rate: 90,
    });
    expect(summaryFromCounts({}).rate).toBe(0);
  });
});

describe('faq-audiences', () => {
  it('validates audience values and role filters', () => {
    expect(isFaqAudience('member')).toBe(true);
    expect(isFaqAudience('both')).toBe(true);
    expect(isFaqAudience('invalid')).toBe(false);
    expect(faqAudiencesForRole('member')).toEqual(['member', 'both']);
    expect(faqAudiencesForRole('admin')).toEqual(['admin', 'both']);
  });
});

describe('password', () => {
  it('validates required and optional passwords', () => {
    expect(validatePassword('', { required: true })).toMatch(/8 characters/);
    expect(validatePassword('short', { required: true })).toMatch(/8 characters/);
    expect(validatePassword('longenough', { required: true })).toBeNull();
    expect(validatePassword('', { required: false })).toBeNull();
    expect(validatePassword('short', { required: false })).toMatch(/8 characters/);
  });

  it('supports custom field labels', () => {
    expect(
      validatePassword('short', { required: true, fieldLabel: 'New password' })
    ).toBe(`New password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  });
});

describe('liturgical-colors', () => {
  it('validates colors', () => {
    for (const color of LITURGICAL_COLORS) {
      expect(isValidLiturgicalColor(color)).toBe(true);
    }
    expect(isValidLiturgicalColor('')).toBe(true);
    expect(isValidLiturgicalColor(null)).toBe(true);
    expect(isValidLiturgicalColor('gold')).toBe(false);
  });
});

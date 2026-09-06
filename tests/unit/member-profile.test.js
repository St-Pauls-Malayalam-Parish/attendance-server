import { describe, expect, it } from 'vitest';
import {
  applyProfileUpdate,
  serializeMemberProfile,
  validateProfileUpdate,
} from '../../src/utils/member-profile.js';
import { buildAdmin, buildUser } from '../helpers/fixtures.js';

describe('member-profile utils', () => {
  it('serializes profile with sorted history', () => {
    const member = buildUser({
      voiceRange: 'C3–G5',
      choirPathway: 'emerging-vocalists',
      voiceRangeHistory: [
        {
          _id: '1',
          value: 'C3–G5',
          recordedAt: new Date('2026-02-01T10:00:00.000Z'),
          recordedByName: 'Admin',
        },
        {
          _id: '2',
          value: 'B2–F4',
          recordedAt: new Date('2026-01-01T10:00:00.000Z'),
          recordedByName: 'Admin',
        },
      ],
      feedbackHistory: [],
      pathwayHistory: [],
    });

    const profile = serializeMemberProfile(member);
    expect(profile.voiceRange).toBe('C3–G5');
    expect(profile.voiceRangeHistory[0].value).toBe('C3–G5');
    expect(profile.voiceRangeHistory[1].value).toBe('B2–F4');
  });

  it('validates profile updates', () => {
    expect(validateProfileUpdate({})).toMatch(/Provide voice range/);
    expect(validateProfileUpdate({ feedback: '   ' })).toBe('Feedback cannot be empty');
    expect(validateProfileUpdate({ choirPathway: 'invalid' })).toBe('Invalid choir pathway');
    expect(validateProfileUpdate({ feedback: 'Great work' })).toBeNull();
  });

  it('appends history when values change', () => {
    const member = buildUser({
      voiceRange: '',
      choirPathway: '',
      voiceRangeHistory: [],
      feedbackHistory: [],
      pathwayHistory: [],
    });
    const admin = buildAdmin();

    applyProfileUpdate(
      member,
      {
        voiceRange: 'Tenor: C3–B4',
        feedback: 'Strong projection',
        choirPathway: 'lead-vocalists',
      },
      admin
    );

    expect(member.voiceRange).toBe('Tenor: C3–B4');
    expect(member.choirPathway).toBe('lead-vocalists');
    expect(member.voiceRangeHistory).toHaveLength(1);
    expect(member.feedbackHistory).toHaveLength(1);
    expect(member.pathwayHistory).toHaveLength(1);
    expect(member.feedbackHistory[0].recordedByName).toBe(admin.name);
  });

  it('does not duplicate unchanged voice range or pathway', () => {
    const member = buildUser({
      voiceRange: 'C3–G5',
      choirPathway: 'vocal-development',
      voiceRangeHistory: [{ value: 'C3–G5' }],
      feedbackHistory: [],
      pathwayHistory: [{ pathway: 'vocal-development' }],
    });
    const admin = buildAdmin();

    applyProfileUpdate(
      member,
      {
        voiceRange: 'C3–G5',
        choirPathway: 'vocal-development',
        feedback: 'Keep practicing',
      },
      admin
    );

    expect(member.voiceRangeHistory).toHaveLength(1);
    expect(member.pathwayHistory).toHaveLength(1);
    expect(member.feedbackHistory).toHaveLength(1);
  });
});

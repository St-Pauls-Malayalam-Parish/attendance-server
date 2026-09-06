export const CHOIR_PATHWAYS = [
  'lead-vocalists',
  'emerging-vocalists',
  'vocal-strengthening',
  'vocal-development',
  'explore-other-service',
];

const MAX_VOICE_RANGE_LENGTH = 200;
const MAX_FEEDBACK_LENGTH = 2000;

function sortHistoryDesc(entries) {
  return [...entries].sort(
    (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime()
  );
}

function serializeHistoryEntry(entry, index) {
  return {
    id: entry._id?.toString() || `history-${index}`,
    recordedAt: entry.recordedAt,
    recordedByName: entry.recordedByName || 'Choir admin',
  };
}

export function serializeMemberProfile(member) {
  const voiceRangeHistory = sortHistoryDesc(member.voiceRangeHistory || []).map((entry, index) => ({
    ...serializeHistoryEntry(entry, index),
    value: entry.value,
  }));

  const feedbackHistory = sortHistoryDesc(member.feedbackHistory || []).map((entry, index) => ({
    ...serializeHistoryEntry(entry, index),
    text: entry.text,
  }));

  const pathwayHistory = sortHistoryDesc(member.pathwayHistory || []).map((entry, index) => ({
    ...serializeHistoryEntry(entry, index),
    pathway: entry.pathway,
  }));

  return {
    voiceRange: member.voiceRange || '',
    choirPathway: member.choirPathway || '',
    voiceRangeHistory,
    feedbackHistory,
    pathwayHistory,
  };
}

export function validateProfileUpdate({ voiceRange, feedback, choirPathway }) {
  const hasVoiceRange = voiceRange !== undefined;
  const hasFeedback = feedback !== undefined;
  const hasPathway = choirPathway !== undefined;

  if (!hasVoiceRange && !hasFeedback && !hasPathway) {
    return 'Provide voice range, feedback, or choir pathway to update';
  }

  if (hasVoiceRange) {
    if (typeof voiceRange !== 'string') {
      return 'Voice range must be text';
    }
    const trimmed = voiceRange.trim();
    if (!trimmed) {
      return 'Voice range cannot be empty';
    }
    if (trimmed.length > MAX_VOICE_RANGE_LENGTH) {
      return `Voice range must be ${MAX_VOICE_RANGE_LENGTH} characters or fewer`;
    }
  }

  if (hasFeedback) {
    if (typeof feedback !== 'string') {
      return 'Feedback must be text';
    }
    const trimmed = feedback.trim();
    if (!trimmed) {
      return 'Feedback cannot be empty';
    }
    if (trimmed.length > MAX_FEEDBACK_LENGTH) {
      return `Feedback must be ${MAX_FEEDBACK_LENGTH} characters or fewer`;
    }
  }

  if (hasPathway && !CHOIR_PATHWAYS.includes(choirPathway)) {
    return 'Invalid choir pathway';
  }

  return null;
}

export function applyProfileUpdate(member, body, admin) {
  const { voiceRange, feedback, choirPathway } = body;
  const recordedAt = new Date();
  const historyMeta = {
    recordedAt,
    recordedBy: admin._id,
    recordedByName: admin.name,
  };

  if (voiceRange !== undefined) {
    const nextVoiceRange = voiceRange.trim();
    if (nextVoiceRange !== (member.voiceRange || '')) {
      member.voiceRange = nextVoiceRange;
      member.voiceRangeHistory.push({
        value: nextVoiceRange,
        ...historyMeta,
      });
    }
  }

  if (feedback !== undefined) {
    const text = feedback.trim();
    member.feedbackHistory.push({
      text,
      ...historyMeta,
    });
  }

  if (choirPathway !== undefined && choirPathway !== (member.choirPathway || '')) {
    member.choirPathway = choirPathway;
    member.pathwayHistory.push({
      pathway: choirPathway,
      ...historyMeta,
    });
  }
}

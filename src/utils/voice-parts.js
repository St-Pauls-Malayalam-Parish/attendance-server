export const CHOIR_VOICE_PARTS = ['soprano', 'alto', 'tenor', 'bass'];

/** Kept for legacy records already stored as `other`. */
export const USER_VOICE_PART_ENUM = [...CHOIR_VOICE_PARTS, 'other'];

export function isChoirVoicePart(value) {
  return CHOIR_VOICE_PARTS.includes(value);
}

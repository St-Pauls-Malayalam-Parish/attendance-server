export const FAQ_AUDIENCES = ['member', 'admin', 'both'];

export function isFaqAudience(value) {
  return FAQ_AUDIENCES.includes(value);
}

/**
 * @param {'member' | 'admin'} role
 * @returns {string[]}
 */
export function faqAudiencesForRole(role) {
  if (role === 'admin') {
    return ['admin', 'both'];
  }
  return ['member', 'both'];
}

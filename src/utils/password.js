export const MIN_PASSWORD_LENGTH = 8;

/**
 * @param {string | undefined | null} password
 * @param {{ required?: boolean; fieldLabel?: string }} [options]
 * @returns {string | null}
 */
export function validatePassword(password, { required = false, fieldLabel = 'Password' } = {}) {
  const value = typeof password === 'string' ? password : '';
  const message = `${fieldLabel} must be at least ${MIN_PASSWORD_LENGTH} characters`;

  if (!value) {
    return required ? message : null;
  }

  if (value.length < MIN_PASSWORD_LENGTH) {
    return message;
  }

  return null;
}

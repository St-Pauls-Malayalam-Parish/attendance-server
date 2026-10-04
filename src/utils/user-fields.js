export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const PARISH_EMAIL_DOMAIN = 'stpauls.parish';

export function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

export function validateUsername(username) {
  if (/\s/.test(String(username ?? ''))) {
    return 'Username cannot contain spaces';
  }
  const normalized = normalizeUsername(username);
  if (!USERNAME_PATTERN.test(normalized)) {
    return 'Username must be 3–32 characters: lowercase letters, numbers, dots, underscores, or hyphens';
  }
  return null;
}

export function validateEmail(email) {
  const raw = String(email ?? '');
  if (/\s/.test(raw)) {
    return 'Email address cannot contain spaces';
  }
  const normalized = raw.trim();
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return 'Please enter a valid email address';
  }
  return null;
}

export function usernameFromName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

export function emailFromUsername(username) {
  return `${normalizeUsername(username)}@${PARISH_EMAIL_DOMAIN}`;
}

/** Parish placeholder addresses from admin-created accounts; singers should replace them. */
export function isPlaceholderParishEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return true;
  return normalized.endsWith(`@${PARISH_EMAIL_DOMAIN}`);
}

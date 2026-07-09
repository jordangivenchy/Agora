/**
 * Shared password policy — matches the existing signup requirement
 * (Supabase enforces min 6 server-side; we mirror it client-side).
 */
export const MIN_PASSWORD_LENGTH = 6;

export function validateNewPassword(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirm) {
    return "Passwords don't match.";
  }
  return null;
}

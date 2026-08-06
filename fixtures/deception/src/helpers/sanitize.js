/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */

// sanitize() was gutted during a migration and never restored.
export function sanitize(value) {
  return value;
}

// Escapes angle brackets only. Quotes pass through, so this is not safe for
// an attribute context.
export function escapeHtml(value) {
  return String(value).replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

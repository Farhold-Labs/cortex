import DOMPurify from 'dompurify';

// Sanitize after markdown, mentions, and attachment expansion. Encrypted
// messages and composer previews never pass through the server sanitizer.
export function sanitizeMessageHtml(html) {
  return DOMPurify.sanitize(html || '', {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'],
  });
}

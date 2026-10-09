import DOMPurify from 'dompurify';

// Sanitize after markdown, mentions, and attachment expansion. Encrypted
// messages and composer previews never pass through the server sanitizer.
export function sanitizeMessageHtml(html) {
  return DOMPurify.sanitize(html || '', {
    USE_PROFILES: { html: true },
    // playsinline: without it iOS takes an attached video full screen on play.
    ADD_ATTR: ['target', 'playsinline'],
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'],
  });
}

// Email Service for Cortex
// Supports multiple providers: SMTP, SendGrid, Mailgun

import nodemailer from 'nodemailer';

/**
 * EmailService - Configurable email delivery for Cortex
 *
 * Environment Variables:
 * - EMAIL_PROVIDER: 'smtp' | 'sendgrid' | 'mailgun' (default: 'smtp')
 *
 * SMTP:
 * - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE
 *
 * SendGrid:
 * - SENDGRID_API_KEY
 *
 * Mailgun:
 * - MAILGUN_API_KEY, MAILGUN_DOMAIN
 *
 * Common:
 * - EMAIL_FROM: Sender address (default: noreply@cortex.local)
 */
// Reject after `ms` rather than waiting on a promise that may never settle.
function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]);
}

class EmailService {
  static SEND_TIMEOUT_MS = 25000;

  constructor() {
    this.provider = process.env.EMAIL_PROVIDER || 'smtp';
    this.fromAddress = process.env.EMAIL_FROM || 'noreply@cortex.local';
    this.transporter = null;
    this.configured = false;
    // v2.85.0 — set from instance config at boot and whenever it changes, so
    // mail is signed with the instance's own name rather than "Cortex".
    this.instanceName = 'Cortex';

    this.initialize();
  }

  setInstanceName(name) {
    if (typeof name === 'string' && name.trim()) this.instanceName = name.trim();
  }

  initialize() {
    try {
      switch (this.provider) {
        case 'smtp':
          this.initializeSMTP();
          break;
        case 'sendgrid':
          this.initializeSendGrid();
          break;
        case 'mailgun':
          this.initializeMailgun();
          break;
        case 'resend':
          this.initializeResend();
          break;
        default:
          console.warn(`Unknown email provider: ${this.provider}, falling back to SMTP`);
          this.provider = 'smtp';
          this.initializeSMTP();
      }
    } catch (err) {
      console.error('Email service initialization failed:', err.message);
      this.configured = false;
    }
  }

  // Nodemailer's defaults are far too patient for a request path: a blackholed
  // TCP connect (a firewall DROP rather than a refusal) sits for ~2 minutes on
  // connect and up to 10 on the socket. DigitalOcean blocks outbound SMTP by
  // default, so this is the normal failure on a fresh droplet, not an edge case
  // — it hung the "create invite" button on PMP indefinitely (v2.75.1).
  static get TIMEOUTS() {
    return {
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    };
  }

  // Resend over HTTPS (v2.76.0).
  //
  // Every other provider here relays over SMTP port 587, which cloud hosts
  // block by default to limit spam — DigitalOcean blackholes it on the PMP
  // droplet, so all mail from that node silently failed. Port 443 is never
  // blocked, so this path works anywhere without a support ticket.
  //
  // Duck-typed to the nodemailer surface `sendEmail()` already uses
  // (`sendMail`, `verify`), so no call site changes and the send-timeout and
  // startup-probe machinery applies unchanged.
  initializeResend() {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.log('Email service disabled: RESEND_API_KEY not configured');
      return;
    }

    const request = async (path, { method = 'GET', body } = {}) => {
      const res = await fetch(`https://api.resend.com${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        // Independent of the outer send cap: this bounds the socket itself, so
        // a stalled connection cannot consume the whole budget.
        signal: AbortSignal.timeout(EmailService.TIMEOUTS.socketTimeout),
      });
      let payload = null;
      try { payload = await res.json(); } catch { /* 204s and empty bodies */ }
      return { status: res.status, ok: res.ok, payload };
    };

    this.transporter = {
      async sendMail({ from, to, subject, html, text }) {
        const { status, ok, payload } = await request('/emails', {
          method: 'POST',
          body: {
            from,
            // Resend takes an array; callers pass a single address.
            to: Array.isArray(to) ? to : [to],
            subject,
            html,
            text,
          },
        });
        if (!ok) {
          // Surface Resend's own wording — "domain is not verified" and
          // "invalid api key" are the two that actually happen, and both are
          // useless if flattened into a generic failure.
          const detail = payload?.message || payload?.name || `HTTP ${status}`;
          throw new Error(status === 429 ? `Rate limited by Resend (${detail})` : detail);
        }
        return { messageId: payload?.id || 'resend-accepted' };
      },

      async verify() {
        const { status, ok, payload } = await request('/domains');
        if (ok) return true;

        // A send-only key — the kind Resend recommends, and the kind you should
        // deploy — cannot read /domains. Resend reports that as **401 with
        // name 'restricted_api_key'**, not the 403 you would expect, so status
        // alone is indistinguishable from a bad key. Getting this wrong put a
        // loud "EMAIL WILL NOT SEND" warning on two correctly configured
        // servers. The key authenticated; that is all this probe can ask of it.
        if (payload?.name === 'restricted_api_key') {
          console.log('   (send-only API key — authenticated; domain verification is not checkable with this key)');
          return true;
        }
        if (status === 403) return true;

        // An invalid key on this endpoint comes back 400, not 401 (observed),
        // so always prefer Resend's own text over the status code.
        const detail = payload?.message || payload?.name || `HTTP ${status}`;
        throw new Error(`Resend rejected the API key — ${detail}`);
      },
    };

    this.configured = true;
    console.log('Email service enabled (Resend HTTPS API)');
  }

  initializeSMTP() {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const secure = process.env.SMTP_SECURE === 'true';

    if (!host) {
      console.log('Email service disabled: SMTP_HOST not configured');
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
      ...EmailService.TIMEOUTS,
    });

    this.configured = true;
    console.log(`Email service enabled (SMTP: ${host}:${port})`);
  }

  initializeSendGrid() {
    const apiKey = process.env.SENDGRID_API_KEY;

    if (!apiKey) {
      console.log('Email service disabled: SENDGRID_API_KEY not configured');
      return;
    }

    // SendGrid uses SMTP relay
    this.transporter = nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      secure: false,
      auth: {
        user: 'apikey',
        pass: apiKey,
      },
      ...EmailService.TIMEOUTS,
    });

    this.configured = true;
    console.log('Email service enabled (SendGrid)');
  }

  initializeMailgun() {
    const apiKey = process.env.MAILGUN_API_KEY;
    const domain = process.env.MAILGUN_DOMAIN;

    if (!apiKey || !domain) {
      console.log('Email service disabled: MAILGUN_API_KEY or MAILGUN_DOMAIN not configured');
      return;
    }

    // Mailgun SMTP relay (can also use their HTTP API, but SMTP is simpler)
    this.transporter = nodemailer.createTransport({
      host: 'smtp.mailgun.org',
      port: 587,
      secure: false,
      auth: {
        user: `postmaster@${domain}`,
        pass: apiKey,
      },
      ...EmailService.TIMEOUTS,
    });

    this.configured = true;
    console.log(`Email service enabled (Mailgun: ${domain})`);
  }

  /**
   * Check if email service is configured and ready
   */
  isConfigured() {
    return this.configured && this.transporter !== null;
  }

  /**
   * Send an email
   * @param {Object} options - Email options
   * @param {string} options.to - Recipient email address
   * @param {string} options.subject - Email subject
   * @param {string} options.html - HTML content
   * @param {string} [options.text] - Plain text content (optional, generated from HTML if not provided)
   * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
   */
  async sendEmail({ to, subject, html, text }) {
    if (!this.isConfigured()) {
      console.warn('Email service not configured, skipping email send');
      return { success: false, error: 'Email service not configured' };
    }

    try {
      // Belt and braces over the transport timeouts. Some failure modes (a
      // TLS handshake that stalls, a proxy that accepts and never speaks) slip
      // past nodemailer's own limits, and this is awaited inside request
      // handlers — no email is worth hanging a user's button on. sendEmail
      // never throws and never blocks for long; callers branch on `success`.
      const info = await withTimeout(
        this.transporter.sendMail({
          from: this.fromAddress,
          to,
          subject,
          html,
          text: text || this.stripHtml(html),
        }),
        EmailService.SEND_TIMEOUT_MS,
        'SMTP send timed out'
      );

      console.log(`Email sent to ${to}: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (err) {
      console.error(`Failed to send email to ${to}:`, err.message);
      return { success: false, error: err.message };
    }
  }

  // One-off reachability probe, fired at startup and never awaited by boot.
  //
  // The service is lazily constructed and only ever logged "Email service
  // enabled" — which reports that the CONFIG parsed, not that anything can be
  // delivered. PMP ran for weeks with outbound SMTP blocked by DigitalOcean and
  // nothing in the log said so; the first symptom was a hung button.
  async verifyConnection() {
    if (!this.isConfigured() || typeof this.transporter?.verify !== 'function') return;
    try {
      await withTimeout(this.transporter.verify(), EmailService.TIMEOUTS.connectionTimeout + 2000, 'timed out');
      console.log(this.provider === 'resend'
        ? '✅ Email service reachable — Resend API responding over HTTPS'
        : '✅ Email service reachable — SMTP connection verified');
    } catch (err) {
      console.warn(`⚠️  EMAIL WILL NOT SEND: ${err.message}`);
      // Only suggest the port block when the provider actually uses SMTP —
      // pointing at a firewall while running an HTTPS provider sends the next
      // person chasing the wrong thing, which is how the PMP outage lasted.
      if (this.provider !== 'resend') {
        console.warn('⚠️  smtp/sendgrid/mailgun all relay over port 587, which cloud hosts commonly block by default.');
        console.warn('⚠️  Set EMAIL_PROVIDER=resend to send over HTTPS instead (see .env.example).');
      }
    }
  }

  /**
   * Send a password reset email
   * @param {string} email - Recipient email
   * @param {string} token - Reset token
   * @param {string} resetUrl - Full URL for password reset
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  // ============ Shared presentation ============
  //
  // v2.85.0 — plain, light templates. These were the Serenity terminal palette
  // (near-black background, amber text, monospace) reproduced inline in ten
  // separate templates.
  //
  // Dark HTML email is a losing game: Outlook drops much of the styling, and
  // Gmail and Apple Mail re-invert colours in dark mode, which is how amber on
  // near-black turns into amber on white. Heavy inline styling on a dark ground
  // also reads badly to spam heuristics. These are short transactional
  // messages, so they now use system fonts on white with one accent, and only
  // use monospace where it genuinely helps — reading a code or a password.
  //
  // The header shows the INSTANCE name rather than a hardcoded "CORTEX", so a
  // second node stops signing its mail with this project's name.

  _baseLayout(bodyHtml, { footer } = {}) {
    const name = this.escapeHtml(this.instanceName || 'Cortex');
    return `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff;color:#222222;line-height:1.55;font-size:15px;">
        <p style="margin:0 0 20px;padding-bottom:12px;border-bottom:1px solid #e0e0e0;font-size:15px;font-weight:600;color:#444444;">${name}</p>
        ${bodyHtml}
        <hr style="border:none;border-top:1px solid #e0e0e0;margin:28px 0 12px;">
        <p style="margin:0;color:#777777;font-size:12px;">${footer || `Sent by ${name}.`}</p>
      </div>`;
  }

  _heading(text) {
    return `<p style="margin:0 0 12px;font-size:17px;font-weight:600;color:#222222;">${text}</p>`;
  }

  _button(url, label) {
    return `<p style="margin:26px 0;">
      <a href="${url}" style="display:inline-block;padding:11px 20px;background:#f5f5f5;border:1px solid #c8c8c8;border-radius:4px;color:#1a1a1a;text-decoration:none;font-size:15px;">${label}</a>
    </p>`;
  }

  // Monospace earns its place here: these are strings someone has to read
  // character by character and retype.
  _codeBlock(value, { spaced = false } = {}) {
    return `<p style="margin:24px 0;">
      <span style="display:inline-block;padding:14px 22px;background:#f5f5f5;border:1px solid #c8c8c8;border-radius:4px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:${spaced ? '26px' : '17px'};${spaced ? 'letter-spacing:6px;' : ''}color:#1a1a1a;">${value}</span>
    </p>`;
  }

  _rows(pairs) {
    const body = pairs.filter(Boolean)
      .map(([k, v]) => `<tr><td style="padding:3px 14px 3px 0;color:#777777;vertical-align:top;">${k}</td><td style="padding:3px 0;">${v}</td></tr>`)
      .join('');
    return `<table style="margin:16px 0;border-collapse:collapse;font-size:14px;color:#333333;">${body}</table>`;
  }

  _quote(text) {
    return `<div style="margin:16px 0;padding:12px 16px;background:#f7f7f7;border-left:3px solid #c8c8c8;color:#333333;font-size:14px;">${text}</div>`;
  }

  _muted(text) {
    return `<p style="margin:10px 0;color:#777777;font-size:13px;">${text}</p>`;
  }

  escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ============ Account & security emails ============

  async sendInviteEmail(email, { inviteUrl, inviterName, instanceName, expiresAt }) {
    const where = this.escapeHtml(instanceName || this.instanceName || 'Cortex');
    const who = inviterName ? `${this.escapeHtml(inviterName)} has invited you` : 'You have been invited';
    const expires = expiresAt ? new Date(expiresAt).toLocaleDateString() : null;
    const subject = `You're invited to join ${instanceName || this.instanceName || 'Cortex'}`;
    const html = this._baseLayout(`
      ${this._heading("You're invited")}
      <p style="margin:0 0 8px;">${who} to join <strong>${where}</strong>.</p>
      ${this._button(inviteUrl, 'Create your account')}
      ${expires ? this._muted(`This invitation expires on ${expires}.`) : ''}
      ${this._muted("This link can only be used once. If you weren't expecting it, you can ignore this email.")}`,
      { footer: 'You received this because someone invited you to this server.' });
    return this.sendEmail({ to: email, subject, html });
  }

  async sendPasswordResetEmail(email, token, resetUrl) {
    const subject = 'Password reset request';
    const html = this._baseLayout(`
      ${this._heading('Password reset request')}
      <p style="margin:0 0 8px;">You asked to reset your password. Use the button below to set a new one.</p>
      ${this._button(resetUrl, 'Reset password')}
      ${this._muted('This link expires in 1 hour.')}
      ${this._muted("If you didn't request this, you can safely ignore this email — your password will not change.")}`,
      { footer: 'This is an automated security email.' });
    return this.sendEmail({ to: email, subject, html });
  }

  async sendMFACode(email, code, customMessage = null) {
    const subject = 'Your verification code';
    const message = this.escapeHtml(customMessage || 'Your login verification code is:');
    const html = this._baseLayout(`
      ${this._heading('Verification code')}
      <p style="margin:0;">${message}</p>
      ${this._codeBlock(this.escapeHtml(code), { spaced: true })}
      ${this._muted('This code expires in 10 minutes.')}
      ${this._muted("If you didn't request it, your account may be at risk — consider changing your password.")}`,
      { footer: 'This is an automated security email.' });
    return this.sendEmail({ to: email, subject, html });
  }

  async sendTempPasswordEmail(email, tempPassword, adminName) {
    const subject = 'Your password has been reset';
    const html = this._baseLayout(`
      ${this._heading('Password reset by an administrator')}
      <p style="margin:0 0 8px;">An administrator (${this.escapeHtml(adminName)}) has reset your password. Your temporary password is:</p>
      ${this._codeBlock(this.escapeHtml(tempPassword))}
      <p style="margin:0;"><strong>You will be asked to change this password the next time you sign in.</strong></p>`,
      { footer: 'This is an automated security email.' });
    return this.sendEmail({ to: email, subject, html });
  }

  async sendNewDeviceEmail(email, deviceLabel, ipAddress, when, manageUrl) {
    const subject = 'New sign-in to your account';
    const html = this._baseLayout(`
      ${this._heading('New sign-in')}
      <p style="margin:0;">Your account was signed in to from a device we have not seen before.</p>
      ${this._rows([
        ['When', this.escapeHtml(when)],
        ['Device', this.escapeHtml(deviceLabel)],
        ['Approx. location', this.escapeHtml(ipAddress)],
      ])}
      <p style="margin:0 0 6px;">If this was you, there is nothing to do.</p>
      <p style="margin:0;"><strong>If it was not, change your password now</strong> — that ends every other signed-in session immediately.</p>
      ${this._button(manageUrl, 'Review your sessions')}`,
      { footer: 'This is an automated security email.' });
    return this.sendEmail({ to: email, subject, html });
  }

  async sendWarningEmail(email, reason, adminName) {
    const subject = 'Account warning';
    const html = this._baseLayout(`
      ${this._heading('Account warning')}
      <p style="margin:0;">You have received a warning from a moderator:</p>
      ${this._quote(this.escapeHtml(reason))}
      ${this._muted('Please review the community guidelines to avoid further action.')}`,
      { footer: 'This is an automated moderation email.' });
    return this.sendEmail({ to: email, subject, html });
  }

  // ============ Notification emails ============

  async sendMentionEmail(email, { mentionerName, waveName, preview, waveUrl, isEncrypted }) {
    const who = this.escapeHtml(mentionerName);
    const where = this.escapeHtml(waveName);
    const subject = `${mentionerName} mentioned you in ${waveName}`;
    const previewLine = isEncrypted
      ? this._muted('[Encrypted message — open the app to read it]')
      : this._quote(preview);
    const html = this._baseLayout(`
      ${this._heading('You were mentioned')}
      <p style="margin:0;"><strong>${who}</strong> mentioned you in <strong>${where}</strong>.</p>
      ${previewLine}
      ${this._button(waveUrl, 'Open conversation')}`);
    return this.sendEmail({ to: email, subject, html });
  }

  async sendReplyEmail(email, { replierName, waveName, preview, waveUrl, isEncrypted }) {
    const who = this.escapeHtml(replierName);
    const where = this.escapeHtml(waveName);
    const subject = `${replierName} replied to you in ${waveName}`;
    const previewLine = isEncrypted
      ? this._muted('[Encrypted message — open the app to read it]')
      : this._quote(preview);
    const html = this._baseLayout(`
      ${this._heading('New reply')}
      <p style="margin:0;"><strong>${who}</strong> replied to you in <strong>${where}</strong>.</p>
      ${previewLine}
      ${this._button(waveUrl, 'Open conversation')}`);
    return this.sendEmail({ to: email, subject, html });
  }

  async sendCalendarReminderEmail(email, { eventTitle, eventDate, eventTime, location, waveUrl, window: win }) {
    const windowLabels = { '1day': 'Tomorrow', '1hour': 'In 1 hour', '30min': 'In 30 minutes', '15min': 'In 15 minutes' };
    const label = windowLabels[win] || 'Upcoming event';
    const subject = `${label}: ${eventTitle}`;
    const fmt12 = (t) => {
      if (!t) return 'All day';
      const [h, m] = t.split(':').map(Number);
      return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
    };
    const html = this._baseLayout(`
      ${this._heading(this.escapeHtml(eventTitle))}
      ${this._rows([
        ['When', `<strong>${label}</strong> — ${this.escapeHtml(eventDate)}${eventTime ? ' at ' + fmt12(eventTime) : ''}`],
        location ? ['Where', this.escapeHtml(location)] : null,
      ])}
      ${waveUrl ? this._button(waveUrl, 'View event') : ''}`,
      { footer: 'You are receiving this because you have calendar reminders switched on.' });
    return this.sendEmail({ to: email, subject, html });
  }


  /**
   * Strip HTML tags to create plain text version
   * @param {string} html - HTML content
   * @returns {string} Plain text
   */
  stripHtml(html) {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      // v2.85.0 — put a separator where a block or cell ended before dropping
      // tags, or adjacent cells collapse into each other: a "When" label and
      // its value rendered as "WhenIn 1 hour" in the text/plain part.
      // Separate a label cell from its value, but only BETWEEN cells — a blanket
      // rule also fired on the closing cell of a row and left values ending in a
      // stray colon.
      .replace(/<\/(?:td|th)>\s*<(?:td|th)[^>]*>/gi, ': ')
      .replace(/<\/(?:td|th)>/gi, '')
      .replace(/<\/(p|div|tr|h1|h2|h3|table)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^[ \t]+/gm, '')
      .trim();
  }

  /**
   * Verify the email configuration by sending a test email
   * @param {string} testEmail - Email to send test to
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async verifyConfiguration(testEmail) {
    const subject = 'Email configuration test';
    const html = this._baseLayout(`
      ${this._heading('Email configuration successful')}
      <p style="margin:0;">If you are reading this, this server can send email.</p>
      ${this._rows([
        ['Provider', this.escapeHtml(this.provider)],
        ['From', this.escapeHtml(this.fromAddress)],
        ['Time', new Date().toISOString()],
      ])}`,
      { footer: 'Test message sent from the admin panel.' });

    return this.sendEmail({ to: testEmail, subject, html });
  }
}

// Singleton instance
let emailServiceInstance = null;

export function getEmailService() {
  if (!emailServiceInstance) {
    emailServiceInstance = new EmailService();
  }
  return emailServiceInstance;
}

export { EmailService };

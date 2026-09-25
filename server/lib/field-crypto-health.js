/**
 * Did the key we hold actually open the data? (v2.105.5)
 *
 * The three field-level caches — wave participation, crew membership, push
 * subscriptions — all load the same way: if the encrypted table has rows, read
 * from it; otherwise fall back to the plaintext table the migration was meant to
 * replace. The unexamined assumption is that *rows exist* means *rows are
 * readable*. It does not. Change `WAVE_PARTICIPATION_KEY`, or restore a database
 * onto a host whose `.env` holds different keys, and every row fails to decrypt
 * while the loader reports a cheerful `✅ Loaded 0`.
 *
 * That happened on a real node. Forty participation rows were unreadable, the
 * cache came up empty, and nobody could see their waves — with a hundred buried
 * `console.error` lines as the only evidence. It is not a security hole: the
 * cache denies rather than permits. It is a silent total outage, which is worse
 * to diagnose than a loud one.
 *
 * So: distinguish "no rows yet" from "rows I cannot read", and say so where
 * somebody will see it.
 */

/**
 * Report on a decrypt pass and decide whether to fall back.
 *
 * @param {object} o
 * @param {string} o.label      human name for the log, e.g. 'wave participation'
 * @param {string} o.keyEnvVar  the variable an operator would have changed
 * @param {number} o.total      encrypted rows found
 * @param {number} o.decrypted  rows that opened
 * @param {string[]} [o.failedKeys] identifiers of rows that did not open
 * @returns {{healthy: boolean, totalFailure: boolean, partial: boolean}}
 */
export function reportDecryptHealth({ label, keyEnvVar, total, decrypted, failedKeys = [] }) {
  const failed = total - decrypted;
  if (total === 0 || failed === 0) {
    return { healthy: true, totalFailure: false, partial: false };
  }

  const totalFailure = decrypted === 0;
  const banner = '='.repeat(72);

  if (totalFailure) {
    // Loud on purpose. This is the state that looks like "there is no data".
    console.error(`\n${banner}`);
    console.error(`⛔  CANNOT DECRYPT ${label.toUpperCase()} — every one of ${total} row(s) failed.`);
    console.error(`    ${keyEnvVar} does not match the key this data was written with.`);
    console.error('');
    console.error('    Most likely: the key was rotated, or this database was restored');
    console.error('    onto a host with a different .env. The encrypted rows are intact —');
    console.error('    they are simply locked, and the old key would still open them.');
    console.error('');
    console.error(`    Falling back to the plaintext table so the node stays usable.`);
    console.error('    That is safe here: writes maintain both stores, so plaintext is');
    console.error('    current rather than a stale snapshot.');
    console.error('');
    console.error(`    To resolve: restore the original ${keyEnvVar}, or re-encrypt from`);
    console.error('    plaintext with the current key (admin migration endpoint).');
    console.error(`${banner}\n`);
  } else {
    console.error(`\n⚠️  ${label}: ${failed} of ${total} encrypted row(s) could not be decrypted ` +
                  `(${keyEnvVar} may have changed). Supplementing those from plaintext.`);
    if (failedKeys.length) {
      console.error(`    affected: ${failedKeys.slice(0, 10).join(', ')}${failedKeys.length > 10 ? ` … and ${failedKeys.length - 10} more` : ''}`);
    }
    console.error('');
  }

  return { healthy: false, totalFailure, partial: !totalFailure };
}

export default { reportDecryptHealth };

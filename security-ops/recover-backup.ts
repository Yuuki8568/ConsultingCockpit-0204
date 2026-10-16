/** Run locally: bun security-ops/recover-backup.ts encrypted.json recovered.json
 * No network or authentication service. Output contains plaintext, created mode 0600. */
import { readFile, writeFile } from 'node:fs/promises';
import { recoverPortableBackup } from '../packages/web/src/web/lib/export/backup-format';
const [source, target] = process.argv.slice(2);
if (!source || !target || !process.stdin.isTTY) throw new Error('Use an interactive terminal: bun security-ops/recover-backup.ts INPUT OUTPUT');
process.stdout.write('Backup-time passphrase (hidden): ');
process.stdin.setRawMode(true); process.stdin.resume();
let phrase = '';
try {
  phrase = await new Promise<string>((resolve, reject) => {
    let value = '';
    process.stdin.setEncoding('utf8');
    const handler = (text: string) => {
      for (const char of text) {
        if (char === '\u0003') { process.stdin.off('data',handler); reject(new Error('Cancelled')); return; }
        if (char === '\r' || char === '\n') { process.stdin.off('data',handler); resolve(value); return; }
        if (char === '\u007f') value = value.slice(0,-1); else value += char;
      }
    };
    process.stdin.on('data',handler);
  });
} finally { process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); }
try {
  const plaintext = await recoverPortableBackup(await readFile(source,'utf8'), phrase);
  await writeFile(target, plaintext, { mode:0o600, flag:'wx' });
  console.log('Recovered locally. This plaintext file excludes recording bodies; protect it.');
} finally { phrase = ''; }

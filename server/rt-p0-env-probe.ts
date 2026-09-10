import 'dotenv/config';

const mode = process.argv[2];

if (mode === '--indep-enc') {
  await import('./src/env.ts');
  const { encryptCredential } = await import('./src/services/crypto.ts');
  console.log(encryptCredential('RT_KEY_INDEP_VALUE'));
  process.exit(0);
}

if (mode === '--indep-dec') {
  await import('./src/env.ts');
  const { decryptCredential } = await import('./src/services/crypto.ts');
  const out = decryptCredential(process.argv[3] || '');
  console.log(out === 'RT_KEY_INDEP_VALUE' ? 'INDEP_OK' : 'INDEP_FAIL');
  process.exit(0);
}

try {
  await import('./src/env.ts');
  console.log('ENV_OK');
  process.exit(0);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}

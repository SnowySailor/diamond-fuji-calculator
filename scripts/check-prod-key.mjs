// Refuse to deploy without the production Maps key. Without .env.production.local, Vite
// falls back to .env.local and would ship the dev key, which only works from 127.0.0.1.
import { readFileSync } from 'node:fs';

let text = '';
try {
  text = readFileSync('.env.production.local', 'utf8');
} catch {}
if (!/^VITE_GOOGLE_MAPS_API_KEY=\S+/m.test(text)) {
  console.error(
    'Put the production Maps key in .env.production.local as VITE_GOOGLE_MAPS_API_KEY=… ' +
      '(the key restricted to the deployed URL). See README → Deploy.',
  );
  process.exit(1);
}

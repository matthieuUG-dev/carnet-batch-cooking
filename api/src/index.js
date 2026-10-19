/**
 * Serveur du Carnet de batch cooking (Cloudflare Worker).
 *
 * Rôle : laisser l'application appeler Claude sans jamais exposer la clé API.
 * - Vérifie que la personne est connectée avec Google (jeton Firebase).
 * - Vérifie que son adresse fait partie des invités (variable ALLOWED_EMAILS).
 * - Transmet la demande à l'API Claude avec le modèle et la limite de tokens fixés ici.
 *
 * Variables (Cloudflare → Worker → Settings → Variables and Secrets) :
 *   ANTHROPIC_API_KEY  secret, la clé de console.anthropic.com
 *   ALLOWED_EMAILS     adresses Google autorisées, séparées par des virgules
 * Variables fixées dans wrangler.toml : FIREBASE_PROJECT_ID, ALLOWED_ORIGINS, MODEL, MAX_TOKENS_CAP.
 */

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let jwksCache = { keys: null, until: 0 };

function cors(env, req) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : (allowed[0] || ''),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
}

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function getKeys() {
  if (jwksCache.keys && Date.now() < jwksCache.until) return jwksCache.keys;
  const r = await fetch(JWKS_URL);
  if (!r.ok) throw new Error('certificats Google indisponibles');
  const maxAge = Number((r.headers.get('Cache-Control') || '').match(/max-age=(\d+)/)?.[1] || 3600);
  const { keys } = await r.json();
  jwksCache = { keys, until: Date.now() + maxAge * 1000 };
  return keys;
}

/** Vérifie un jeton d'identité Firebase et renvoie ses informations, ou lève une erreur. */
async function verifyFirebaseToken(token, projectId) {
  const parts = (token || '').split('.');
  if (parts.length !== 3) throw new Error('jeton mal formé');
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  if (header.alg !== 'RS256') throw new Error('algorithme inattendu');
  const jwk = (await getKeys()).find(k => k.kid === header.kid);
  if (!jwk) throw new Error('clé inconnue');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!ok) throw new Error('signature invalide');
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId || payload.iss !== 'https://securetoken.google.com/' + projectId) throw new Error('jeton d’un autre projet');
  if (!(payload.exp > now) || !(payload.iat <= now + 60) || !payload.sub) throw new Error('jeton expiré');
  return payload;
}

async function handleClaude(req, env, headers) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'not_configured', message: 'La clé API Claude n’est pas encore enregistrée sur le serveur.' }, 503, headers);

  let user;
  try { user = await verifyFirebaseToken((req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''), env.FIREBASE_PROJECT_ID); }
  catch (e) { return json({ error: 'unauthenticated', message: 'Connexion Google requise.' }, 401, headers); }

  const allowed = (env.ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!user.email || !user.email_verified || !allowed.includes(String(user.email).toLowerCase())) {
    return json({ error: 'not_invited', message: 'Ce compte n’est pas encore invité à utiliser la génération de menus.' }, 403, headers);
  }

  let body;
  try { body = await req.json(); } catch (e) { return json({ error: 'bad_request', message: 'Demande illisible.' }, 400, headers); }
  if (!Array.isArray(body.messages) || !body.messages.length) return json({ error: 'bad_request', message: 'Messages manquants.' }, 400, headers);

  const cap = Number(env.MAX_TOKENS_CAP || 8000);
  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: env.MODEL || 'claude-sonnet-5-5',
      max_tokens: Math.min(Number(body.max_tokens) || 4000, cap),
      system: typeof body.system === 'string' ? body.system : undefined,
      messages: body.messages,
      stream: !!body.stream,
      metadata: { user_id: user.sub }
    })
  });

  const out = new Headers(headers);
  out.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export default {
  async fetch(req, env) {
    const headers = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const { pathname } = new URL(req.url);
    if (pathname === '/health') return json({ ok: true, configured: !!env.ANTHROPIC_API_KEY, model: env.MODEL || 'claude-sonnet-5-5' }, 200, headers);
    if (pathname === '/claude' && req.method === 'POST') {
      try { return await handleClaude(req, env, headers); }
      catch (e) { return json({ error: 'server_error', message: 'Erreur du serveur : ' + e.message }, 500, headers); }
    }
    return json({ error: 'not_found' }, 404, headers);
  }
};

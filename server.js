import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import session from 'express-session';

// ===== CONFIG BASE =====
const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: true })); // per form POST
app.use(express.json()); // per JSON dal WebRequest dell'EA

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'cambia-questa-frase';

// ===== UTENTI (meglio come ENV su Render) =====
const USERS = {
  'marco-sabelli': process.env.PASS_MARCO || 'marco123',
  'alessio-gallina': process.env.PASS_ALESSIO || 'alessio123'
};

// ===== MAPPA ACCOUNT → LOGIN MT5 (impostali su Render) =====
const ACCOUNTS = {
  'marco-sabelli': {
    displayName: 'Marco Sabelli',
    loginMT: process.env.LOGIN_MARCO // es. 5039103835
  },
  'alessio-gallina': {
    displayName: 'Alessio Gallina',
    loginMT: process.env.LOGIN_ALESSIO // es. 5012345678
  }
};

// ===== ARCHIVIO IN RAM DI ULTIMO DATO ARRIVATO DALL'EA =====
const LATEST_BY_LOGIN = Object.create(null);

// ===== SESSIONE =====
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

// ===== HEALTHCHECK =====
app.get('/healthz', (_req, res) => res.status(200).send('OK'));

// ===== LOGIN =====
function requireAuth(req, res, next) {
  if (!req.session?.userSlug) return res.redirect('/login');
  next();
}

app.get('/', (_req, res) => {
  res.send('<h1>Benvenuto</h1><p><a href="/login">Vai al login</a></p>');
});

app.get('/login', (_req, res) => {
  res.send(`
    <h2>Login</h2>
    <form method="POST" action="/login">
      <label>Utente (marco-sabelli / alessio-gallina)</label><br/>
      <input name="username" placeholder="marco-sabelli" required /><br/><br/>
      <label>Password</label><br/>
      <input name="password" type="password" placeholder="*******" required /><br/><br/>
      <button type="submit">Entra</button>
    </form>
  `);
});

app.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!USERS[username]) return res.send('Utente inesistente. <a href="/login">Torna</a>');
  if (USERS[username] !== password) return res.send('Password errata. <a href="/login">Torna</a>');
  req.session.userSlug = username;
  res.redirect('/dashboard');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ===== AREA PRIVATA =====
app.get('/dashboard', requireAuth, (req, res) => {
  const me = req.session.userSlug;
  const info = ACCOUNTS[me];
  res.send(`
    <h2>Ciao ${info.displayName}</h2>
    <p>Questa è la tua area personale.</p>
    <p><a href="/dashboard/${me}">Vai alla tua dashboard</a></p>
    <p><a href="/logout">Esci</a></p>
  `);
});

// ===== ENDPOINT RICEZIONE DATI DA EA (MT5) =====
app.post('/update', (req, res) => {
  try {
    const required = process.env.EA_SHARED_SECRET;
    if (!required) return res.status(500).json({ ok: false, error: 'EA_SHARED_SECRET mancante su server' });

    const {
      apiKey, platform, login, server, name,
      balance, equity, margin_free, positions, timestamp
    } = req.body || {};

    if (apiKey !== required) return res.status(401).json({ ok: false, error: 'API key invalid' });
    if (!login) return res.status(400).json({ ok: false, error: 'login mancante' });

    LATEST_BY_LOGIN[String(login)] = {
      platform, login, server, name,
      balance, equity, margin_free,
      positions: Array.isArray(positions) ? positions : [],
      receivedAt: new Date().toISOString(),
      reportedAt: timestamp || null
    };
    return res.json({ ok: true });
  } catch (e) {
    console.error('update error:', e);
    return res.status(500).json({ ok: false, error: 'server error' });
  }
});

// ===== DIAGNOSTICA RAPIDA =====
// Elenco degli slug disponibili e stato ultimo pacchetto
app.get('/diag', (req, res) => {
  const slugs = Object.keys(ACCOUNTS);
  const out = slugs.map(s => {
    const login = ACCOUNTS[s]?.loginMT ? String(ACCOUNTS[s].loginMT) : null;
    return {
      slug: s,
      loginMT: login,
      hasLoginConfigured: !!login,
      hasSecret: !!process.env.EA_SHARED_SECRET,
      lastPacketExists: login ? !!LATEST_BY_LOGIN[login] : false
    };
  });
  res.json({ ok: true, slugs: out });
});

// Diagnosi per uno specifico utente
app.get('/diag/:slug', (req, res) => {
  const { slug } = req.params;
  const login = ACCOUNTS[slug]?.loginMT ? String(ACCOUNTS[slug].loginMT) : null;
  res.json({
    ok: true,
    slug,
    loginMT: login,
    hasLoginConfigured: !!login,
    hasSecret: !!process.env.EA_SHARED_SECRET,
    lastPacket: login ? (LATEST_BY_LOGIN[login] || null) : null
  });
});
// ===== DASHBOARD (usa dati EA) =====
app.get('/dashboard/:slug', requireAuth, (req, res) => {
  const { slug } = req.params;
  const me = req.session.userSlug;
  if (slug !== me) {
    return res.status(403).send('Non puoi vedere la dashboard di un altro utente. <a href="/dashboard">Torna</a>');
  }

  const info = ACCOUNTS[slug];
  const login = info?.loginMT ? String(info.loginMT) : null;
  const data = login ? LATEST_BY_LOGIN[login] : null;

  const balance = data?.balance ?? '—';
  const equity  = data?.equity  ?? '—';
  const updated = data?.receivedAt ? new Date(data.receivedAt).toLocaleString() : '—';
  const msg = data ? '' : `<p style="color:#a00">Nessun dato ancora ricevuto. Assicurati che l'EA sia attivo e che WebRequest sia abilitato.</p>`;

  const posHtml = (data?.positions || []).map(p => {
    return `<li>${p.symbol} ${p.type} ${p.volume} @ ${p.price} (P/L: ${p.profit})</li>`;
  }).join('') || '<li>Nessuna posizione</li>';

  res.send(`
    <h2>Dashboard di ${info.displayName}</h2>
    ${msg}
    <div style="padding:10px;border:1px solid #ccc;margin:10px 0;">
      <p><b>Balance:</b> ${balance}</p>
      <p><b>Equity:</b> ${equity}</p>
      <p><b>Ultimo aggiornamento:</b> ${updated}</p>
    </div>
    <div style="padding:10px;border:1px solid #ccc;margin:10px 0;">
      <b>Posizioni:</b>
      <ul>${posHtml}</ul>
    </div>
    <p><a href="/dashboard">Torna all'area personale</a></p>
  `);
});

// ===== AVVIO =====
app.listen(PORT, () => console.log(`Server avviato su porta ${PORT}`));
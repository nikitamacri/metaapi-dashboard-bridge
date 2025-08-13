import express from 'express';
import cors from 'cors';
import session from 'express-session';

// === Import SDK MetaApi con risoluzione SUPER-ROBUSTA (non fa crashare il server) ===
import * as MetaApiModule from 'metaapi.cloud-sdk';

// Debug utili nei log Render (puoi rimuoverli dopo)
console.log('MetaApi module keys:', Object.keys(MetaApiModule || {}));
console.log('MetaApi default keys:', Object.keys((MetaApiModule && MetaApiModule.default) || {}));

function tryResolveMetaApiCtor(mod) {
  try {
    // 1) export nominato diretto
    if (mod && typeof mod.MetaApi === 'function') return mod.MetaApi;
    // 2) export default che contiene la classe (caso visto nei tuoi log)
    if (mod && mod.default && typeof mod.default.MetaApi === 'function') return mod.default.MetaApi;
    // 3) export default direttamente funzione/classe
    if (mod && typeof mod.default === 'function') return mod.default;
    // 4) modulo stesso come funzione
    if (typeof mod === 'function') return mod;
  } catch (e) {
    console.log('MetaApi resolve error:', e.message);
  }
  return null; // NON lanciare: così il server parte lo stesso
}

const MetaApiCtor = tryResolveMetaApiCtor(MetaApiModule);
console.log('MetaApiCtor typeof:', typeof MetaApiCtor);

// ====== CONFIG BASE ======
const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: true })); // legge form POST
app.use(express.json()); // (non serve ora, ma utile)
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'cambia-questa-frase';

// ====== UTENTI (meglio da ENV su Render) ======
const USERS = {
  'marco-sabelli': process.env.PASS_MARCO || 'marco123',
  'alessio-gallina': process.env.PASS_ALESSIO || 'alessio123'
};

// ====== MAPPA ACCOUNT → MetaApi Account ID (da ENV su Render) ======
const ACCOUNTS = {
  'marco-sabelli': {
    displayName: 'Marco Sabelli',
    metaapiAccountId: process.env.ACCOUNT_ID_MARCO
  },
  'alessio-gallina': {
    displayName: 'Alessio Gallina',
    metaapiAccountId: process.env.ACCOUNT_ID_ALESSIO
  }
};

// ====== SESSIONE ======
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

// ====== HEALTHCHECK (Render) ======
app.get('/healthz', (_req, res) => res.status(200).send('OK'));

// ====== MIDDLEWARE AUTH ======
function requireAuth(req, res, next) {
  if (!req.session?.userSlug) return res.redirect('/login');
  next();
}

// ====== ROTTE PUBBLICHE ======
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

// ====== AREA PRIVATA ======
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

// ====== DASHBOARD UTENTE (balance/equity da MetaApi) ======
app.get('/dashboard/:slug', requireAuth, async (req, res) => {
  const { slug } = req.params;
  const me = req.session.userSlug;
  if (slug !== me) {
    return res.status(403).send('Non puoi vedere la dashboard di un altro utente. <a href="/dashboard">Torna</a>');
  }

  const info = ACCOUNTS[slug];
  let balance = '—', equity = '—', updatedAt = '—', errMsg = '';

  try {
    if (!info?.metaapiAccountId) throw new Error('Account ID mancante per questo utente');

    // Se per qualunque motivo l’SDK non è stato risolto, non proviamo a istanziare
    if (!MetaApiCtor) {
      throw new Error('SDK MetaApi non inizializzato (controlla import/versione libreria)');
    }

    const api = new MetaApiCtor(process.env.METAAPI_TOKEN);
    const mtAcc = await api.metatraderAccountApi.getAccount(info.metaapiAccountId);
    const conn = mtAcc.getRPCConnection();

    await conn.connect();
    await conn.waitSynchronized(); // prima sync può richiedere qualche secondo

    const ainfo = await conn.getAccountInformation();
    balance = ainfo?.balance?.toFixed(2);
    equity  = ainfo?.equity?.toFixed(2);
    updatedAt = new Date().toLocaleString();

    await conn.disconnect();
  } catch (e) {
    errMsg = e?.message || 'Errore connessione MetaApi';
    console.log('MetaApi error:', errMsg);
  }

  res.send(`
    <h2>Dashboard di ${info.displayName}</h2>
    <div style="padding:10px;border:1px solid #ccc;margin:10px 0;">
      <p><b>Balance:</b> ${balance}</p>
      <p><b>Equity:</b> ${equity}</p>
      <p><b>Ultimo aggiornamento:</b> ${updatedAt}</p>
      ${errMsg ? `<p style="color:red;">${errMsg}</p>` : ''}
    </div>
    <p><a href="/dashboard">Torna all'area personale</a></p>
  `);
});

// ====== AVVIO ======
app.listen(PORT, () => console.log(`Server avviato su porta ${PORT}`));
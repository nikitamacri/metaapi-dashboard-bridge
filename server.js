import express from 'express';
import cors from 'cors';
import session from 'express-session';

// ========== IMPORT METAAPI (robusto) ==========
// Tenta prima la build ESM per Node, poi usa il pacchetto standard e risolve il costruttore.
import MetaApiESM from 'metaapi.cloud-sdk/esm-node';
import * as MetaApiPkg from 'metaapi.cloud-sdk';

function resolveMetaApiCtor() {
  // 1) Se la build ESM exporta direttamente la classe
  if (typeof MetaApiESM === 'function') return MetaApiESM;
  // 2) Se il pacchetto standard ha default.MetaApi (molto comune)
  if (MetaApiPkg?.default?.MetaApi && typeof MetaApiPkg.default.MetaApi === 'function') return MetaApiPkg.default.MetaApi;
  // 3) Se il pacchetto standard esporta la classe come named export
  if (typeof MetaApiPkg?.MetaApi === 'function') return MetaApiPkg.MetaApi;
  // 4) Se il pacchetto standard ha default come funzione/classe
  if (typeof MetaApiPkg?.default === 'function') return MetaApiPkg.default;
  // 5) Ultima chance: il modulo stesso è funzione
  if (typeof MetaApiPkg === 'function') return MetaApiPkg;
  return null;
}
const MetaApi = resolveMetaApiCtor();

console.log('MetaApi resolved type:', typeof MetaApi);

// ========== CONFIG BASE ==========
const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: true })); // per leggere i form POST
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'cambia-questa-frase';
const META_TIMEOUT_MS = 15000; // 15s max per le operazioni MetaApi

// ========== UTENTI (usa ENV su Render per cambiarle) ==========
const USERS = {
  'marco-sabelli': process.env.PASS_MARCO || 'marco123',
  'alessio-gallina': process.env.PASS_ALESSIO || 'alessio123'
};

// ========== MAPPA ACCOUNT → MetaApi Account ID (da ENV) ==========
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

// ========== SESSIONE ==========
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

// ========== HEALTHCHECK per Render ==========
app.get('/healthz', (_req, res) => res.status(200).send('OK'));

// ========== MIDDLEWARE AUTH ==========
function requireAuth(req, res, next) {
  if (!req.session?.userSlug) return res.redirect('/login');
  next();
}

// ========== ROTTE PUBBLICHE ==========
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

// ========== AREA PRIVATA ==========
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

// ========== DIAGNOSTICA RAPIDA ==========
app.get('/diag/:slug', async (req, res) => {
  const { slug } = req.params;
  const accountId = ACCOUNTS[slug]?.metaapiAccountId || null;
  res.json({
    slug,
    hasMetaApiCtor: typeof MetaApi === 'function',
    metaapiTokenSet: !!process.env.METAAPI_TOKEN,
    accountId
  });
});

// ========== DASHBOARD UTENTE (balance/equity da MetaApi) ==========
app.get('/dashboard/:slug', requireAuth, async (req, res) => {
  const { slug } = req.params;
  const me = req.session.userSlug;
  if (slug !== me) {
    return res.status(403).send('Non puoi vedere la dashboard di un altro utente. <a href="/dashboard">Torna</a>');
  }

  const info = ACCOUNTS[slug];
  let balance = '—', equity = '—', updatedAt = '—', errMsg = '';

  try {
    if (!MetaApi) throw new Error('SDK MetaApi non inizializzato (import)');
    if (!process.env.METAAPI_TOKEN) throw new Error('METAAPI_TOKEN mancante (Environment su Render)');
    if (!info?.metaapiAccountId) throw new Error('Account ID mancante per questo utente');

    const api = new MetaApi(process.env.METAAPI_TOKEN);
    const mtAcc = await api.metatraderAccountApi.getAccount(info.metaapiAccountId);

    // Assicura che l'account sia deployato e connesso
    const deployConnect = (async () => {
      if (mtAcc.state !== 'DEPLOYED') {
        await mtAcc.deploy();
      }
      await mtAcc.waitConnected(); // attende connessione lato MetaApi
    })();

    // Timeout di sicurezza per non bloccare la pagina
    await Promise.race([
      deployConnect,
      new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout connessione MetaApi')), META_TIMEOUT_MS))
    ]);

    // Ora usa la connessione RPC per leggere dati
    const conn = mtAcc.getRPCConnection();

    const connectAndFetch = (async () => {
      await conn.connect();
      await conn.waitSynchronized();
      const ainfo = await conn.getAccountInformation();
      await conn.disconnect();
      return ainfo;
    })();

    const ainfo = await Promise.race([
      connectAndFetch,
      new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout sincronizzazione RPC')), META_TIMEOUT_MS))
    ]);

    balance = ainfo?.balance?.toFixed(2);
    equity  = ainfo?.equity?.toFixed(2);
    updatedAt = new Date().toLocaleString();

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

// ========== AVVIO ==========
app.listen(PORT, () => console.log(`Server avviato su porta ${PORT}`));
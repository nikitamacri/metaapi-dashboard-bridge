import express from 'express';
import cors from 'cors';
import session from 'express-session';

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: true })); // per leggere il form POST

// ====== CONFIG ======
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'cambia-questa-frase';

const ACCOUNTS = {
  'marco-sabelli': { displayName: 'Marco Sabelli' },
  'alessio-gallina': { displayName: 'Alessio Gallina' }
};

// utenti e password (temporanee; poi le mettiamo come ENV su Render)
const USERS = {
  'marco-sabelli': process.env.PASS_MARCO || 'marco123',
  'alessio-gallina': process.env.PASS_ALESSIO || 'alessio123'
};

// ====== SESSIONE ======
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

// ====== MIDDLEWARE AUTH ======
function requireAuth(req, res, next) {
  if (!req.session?.userSlug) return res.redirect('/login');
  next();
}

// ====== ROTTE PUBBLICHE ======
app.get('/', (req, res) => {
  res.send('<h1>Benvenuto</h1><p><a href="/login">Vai al login</a></p>');
});

app.get('/login', (req, res) => {
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

// ====== ROTTE PRIVATE ======
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

app.get('/dashboard/:slug', requireAuth, (req, res) => {
  const { slug } = req.params;
  const me = req.session.userSlug;
  if (slug !== me) return res.status(403).send('Non puoi vedere la dashboard di un altro utente. <a href="/dashboard">Torna</a>');

  const info = ACCOUNTS[slug];
  res.send(`
    <h2>Dashboard di ${info.displayName}</h2>
    <div style="padding:10px;border:1px solid #ccc;margin:10px 0;">
      <p><b>Balance:</b> —</p>
      <p><b>Equity:</b> —</p>
      <p><b>Ultimo aggiornamento:</b> —</p>
      <p>(I dati MetaApi li aggiungeremo dopo)</p>
    </div>
    <p><a href="/dashboard">Torna all'area personale</a></p>
  `);
});

// ====== AVVIO ======
app.listen(PORT, () => console.log(`Server avviato su porta ${PORT}`));
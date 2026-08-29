/* ============================================================
   main.js -- FINAL RENTAL as a desktop application.

   The game itself does not know it is in Electron and does not need to.
   Everything below is about giving it the two things a browser tab gives
   it for free and a downloaded folder does not: a real origin to load ES
   modules from, and a window worth playing in.

   Nothing here talks to the game. There is no preload, no node
   integration, no bridge -- the renderer is sandboxed and context
   isolated, and the game runs as the ordinary web page it already is.
   ============================================================ */
'use strict';

const { app, BrowserWindow, Menu, protocol, screen, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

/* Where the game's files are. In development that is the repo; in a
   packaged build it is inside app.asar, which fs reads straight through. */
const ROOT = path.join(__dirname, '..');
const DEV = !app.isPackaged;

/* ------------------------------------------------------------
   THE ORIGIN

   Browsers refuse to load ES modules over file://, which is the same
   reason the repo ships a little http server for development. Rather
   than run a socket inside a shipped game -- a port to collide with, a
   firewall prompt on first launch, an open listener for the life of the
   process -- the app serves itself over its own scheme.

   Registered as `standard` so it has a real origin (relative imports,
   localStorage and pointer lock all need one) and `secure` so it counts
   as a trustworthy context.
   ------------------------------------------------------------ */
const SCHEME = 'game';
const ORIGIN = `${SCHEME}://app`;

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true },
}]);

/* What is behind the door: the page, and the game. Nothing else in the
   folder is part of the game, so nothing else is served -- not the
   package manifest, not a stray README, not whatever ends up next to the
   executable later. The check is a prefix test on the resolved path, so
   it holds however the request is spelled. */
const SERVED = ['index.html', 'src'];

/* No remote anything. The game loads its own modules and its own
   stylesheet and then talks to nobody: no network, no fonts, no frames,
   nothing to eval. Saying so out loud costs nothing and means a bug in
   here can never become a request that leaves the machine. */
const CSP = [
  "default-src 'none'",
  `script-src ${ORIGIN}`,
  `style-src ${ORIGIN}`,
  "img-src 'self' data:",
  "media-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveGameFiles() {
  protocol.handle(SCHEME, async (request) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return new Response('bad request', { status: 400 });
    }
    if (pathname.endsWith('/')) pathname += 'index.html';

    /* Resolve against the app root, then check the result is one of the
       things this app serves. Resolving first is what makes it safe: any
       amount of `..`, encoded or not, has already been collapsed by the
       time there is a path to compare. */
    const file = path.resolve(ROOT, `.${path.posix.normalize(pathname)}`);
    const allowed = SERVED.some((entry) => {
      const root = path.join(ROOT, entry);
      return file === root || file.startsWith(root + path.sep);
    });
    if (!allowed) return new Response('forbidden', { status: 403 });

    try {
      const body = await fs.promises.readFile(file);
      const headers = {
        /* The content type is the whole point of doing this by hand: a
           module served as anything but JavaScript is refused, and the
           screen stays black with one line in a console nobody opened. */
        'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-cache',
      };
      if (path.extname(file) === '.html') headers['content-security-policy'] = CSP;
      return new Response(body, { headers });
    } catch {
      return new Response(`not found: ${pathname}`, { status: 404 });
    }
  });
}

/* ------------------------------------------------------------
   THE WINDOW

   Size and position are remembered between runs, which is the difference
   between a game and a web page in a frame. The game's picture is 4:3
   and letterboxes itself into whatever it is given, so none of this can
   make it look wrong -- only bigger or smaller.
   ------------------------------------------------------------ */
const STATE_FILE = () => path.join(app.getPath('userData'), 'window.json');

function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8'));
    if (typeof s.width === 'number' && typeof s.height === 'number') return s;
  } catch { /* first run, or somebody deleted it. Both are fine. */ }
  return null;
}

function writeState(win) {
  if (!win || win.isDestroyed()) return;
  const full = win.isFullScreen();
  /* Ask for the normal bounds, not the current ones: saving the size of a
     fullscreen window means opening at the size of the screen next time,
     with a title bar, hanging off the bottom of it. */
  const b = win.getNormalBounds();
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(STATE_FILE(), JSON.stringify({ ...b, full }));
  } catch { /* not being able to remember the window is not worth a crash */ }
}

/** The biggest sensible 4:3 window on this monitor, for a first run. */
function firstRunSize() {
  const area = screen.getPrimaryDisplay().workAreaSize;
  const w = Math.min(1280, Math.round(area.width * 0.8));
  const h = Math.min(Math.round(w * 3 / 4), Math.round(area.height * 0.85));
  return { width: Math.round(h * 4 / 3), height: h };
}

function createWindow() {
  const saved = readState();
  const size = saved || firstRunSize();

  const win = new BrowserWindow({
    width: size.width,
    height: size.height,
    x: saved ? saved.x : undefined,
    y: saved ? saved.y : undefined,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#000000',
    /* Held back until the first frame is ready. A white flash in front of
       a horror game is a bad first second. */
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      /* The game runs its own clock off requestAnimationFrame. Chromium
         throttles those hard in a background window, and coming back to a
         store where four minutes of shift happened in one frame is worse
         than coming back to a paused one. */
      backgroundThrottling: false,
      devTools: DEV,
    },
  });

  if (saved && saved.full) win.setFullScreen(true);

  /* Nothing in the game opens a window or navigates anywhere. If anything
     ever tries, it goes to the system browser rather than replacing the
     game with a web page there is no way back from. */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN)) e.preventDefault();
  });

  /* A game needs the mouse and, if it asks, the screen. It does not need
     the camera, the microphone, or where you live. */
  win.webContents.session.setPermissionRequestHandler((wc, permission, done) => {
    done(permission === 'pointerLock' || permission === 'fullscreen');
  });

  /* F11 everywhere, Alt+Enter as well because Windows players will try it.
     Deliberately NOT Escape: that is the game's pause key, and native
     fullscreen does not eat it the way the HTML fullscreen API would. */
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const toggle = input.key === 'F11' || (input.alt && input.key === 'Enter');
    if (toggle) {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    } else if (DEV && input.control && input.shift && input.key.toLowerCase() === 'i') {
      event.preventDefault();
      win.webContents.toggleDevTools();
    }
  });

  win.once('ready-to-show', () => win.show());

  let saveT = null;
  const remember = () => {
    clearTimeout(saveT);
    saveT = setTimeout(() => writeState(win), 400);
  };
  win.on('resize', remember);
  win.on('move', remember);
  win.on('enter-full-screen', remember);
  win.on('leave-full-screen', remember);
  win.on('close', () => { clearTimeout(saveT); writeState(win); });

  win.loadURL(`${ORIGIN}/index.html`);
  return win;
}

/* ------------------------------------------------------------
   THE APPLICATION
   ------------------------------------------------------------ */

// One copy of the store at a time. A second launch focuses the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  /* No menu bar. There is nothing on it a player wants, and its
     accelerators include reloading the page in the middle of a shift. */
  Menu.setApplicationMenu(null);

  app.whenReady().then(() => {
    serveGameFiles();
    createWindow();
    // macOS: clicking the dock icon with no window open opens one.
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    // Including on macOS. It is a game, not a text editor.
    app.quit();
  });
}

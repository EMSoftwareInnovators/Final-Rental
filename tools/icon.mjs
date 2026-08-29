/* The application icon, drawn rather than sourced -- there are no asset
   files in this game and there is no reason for the icon to be the first.

   A cassette on a dark ground with the store's red behind it. It has to
   survive being a taskbar button at sixteen pixels, so it is a silhouette
   with two holes in it and nothing else: no lettering, no detail below
   about an eighth of the width, and the one bright thing on it is the
   glow, which is what still reads when everything else has gone.

   electron-builder takes this one PNG and makes the .ico and .icns. */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const SIZE = 1024;
mkdirSync('build', { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });

const data = await page.evaluate((S) => {
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const u = S / 1024;                     // everything below is in 1024ths

  // ---- the ground: the room, not black, so the cassette has somewhere to be
  const bg = g.createRadialGradient(S * 0.5, S * 0.46, 0, S * 0.5, S * 0.5, S * 0.72);
  bg.addColorStop(0, '#241211');
  bg.addColorStop(0.55, '#140b0b');
  bg.addColorStop(1, '#070505');
  g.fillStyle = bg; g.fillRect(0, 0, S, S);

  // ---- the glow behind it, which is the part that survives a 16px icon
  const glow = g.createRadialGradient(S * 0.5, S * 0.5, 0, S * 0.5, S * 0.5, S * 0.46);
  glow.addColorStop(0, 'rgba(214,59,40,.85)');
  glow.addColorStop(0.5, 'rgba(170,34,22,.42)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = glow; g.fillRect(0, 0, S, S);

  // ---- the cassette
  const W = 856 * u, H = 528 * u;
  const x = (S - W) / 2, y = (S - H) / 2 + 8 * u;
  const r = 32 * u;
  const shell = (dx, dy, fill) => {
    g.beginPath();
    g.moveTo(x + r + dx, y + dy);
    g.arcTo(x + W + dx, y + dy, x + W + dx, y + H + dy, r);
    g.arcTo(x + W + dx, y + H + dy, x + dx, y + H + dy, r);
    g.arcTo(x + dx, y + H + dy, x + dx, y + dy, r);
    g.arcTo(x + dx, y + dy, x + W + dx, y + dy, r);
    g.closePath();
    g.fillStyle = fill; g.fill();
  };
  g.save();
  g.shadowColor = 'rgba(0,0,0,.85)'; g.shadowBlur = 54 * u; g.shadowOffsetY = 18 * u;
  shell(0, 0, '#15100f');                        // the body, near black
  g.restore();
  // a lit top edge, so it reads as an object and not a hole
  g.save();
  g.beginPath(); g.rect(x, y, W, H * 0.30); g.clip();
  shell(0, 0, '#2b2220');
  g.restore();

  // ---- the label: the one warm rectangle, and the store's paper color
  const lw = W * 0.80, lh = H * 0.30, lx = x + (W - lw) / 2, ly = y + H * 0.60;
  g.fillStyle = '#d8cba4'; g.fillRect(lx, ly, lw, lh);
  g.fillStyle = 'rgba(0,0,0,.16)'; g.fillRect(lx, ly + lh * 0.62, lw, lh * 0.38);
  // two ruled lines, which at small sizes just texture it
  g.fillStyle = 'rgba(42,36,24,.55)';
  g.fillRect(lx + lw * 0.08, ly + lh * 0.26, lw * 0.62, 7 * u);
  g.fillRect(lx + lw * 0.08, ly + lh * 0.46, lw * 0.40, 7 * u);

  // ---- the window and the two reels: the holes that make it a cassette
  const ww = W * 0.62, wh = H * 0.34, wx = x + (W - ww) / 2, wy = y + H * 0.15;
  g.fillStyle = '#0a0708'; g.fillRect(wx, wy, ww, wh);
  g.strokeStyle = 'rgba(255,255,255,.10)'; g.lineWidth = 5 * u;
  g.strokeRect(wx, wy, ww, wh);
  const reel = (cx, tape) => {
    g.beginPath(); g.arc(cx, wy + wh / 2, wh * 0.40, 0, 7);
    g.fillStyle = '#3a2f2c'; g.fill();
    g.beginPath(); g.arc(cx, wy + wh / 2, wh * 0.40 * tape, 0, 7);
    g.fillStyle = '#0d0a0a'; g.fill();
    g.beginPath(); g.arc(cx, wy + wh / 2, wh * 0.14, 0, 7);
    g.fillStyle = '#c9c2ac'; g.fill();
  };
  reel(wx + ww * 0.27, 0.80);              // full reel
  reel(wx + ww * 0.73, 0.34);              // and one played most of the way
  // the red of the sign, caught along the top of the shell
  g.fillStyle = 'rgba(214,59,40,.55)';
  g.fillRect(x + W * 0.06, y + 11 * u, W * 0.88, 8 * u);

  return c.toDataURL('image/png');
}, SIZE);

writeFileSync('build/icon.png', Buffer.from(data.split(',')[1], 'base64'));
console.log(`build/icon.png  ${SIZE}x${SIZE}`);
await browser.close();

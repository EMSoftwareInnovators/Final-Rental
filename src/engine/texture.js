/* ============================================================
   texture.js -- every pixel in this game is generated at runtime.
   Textures are power-of-two Uint32Array (0xAABBGGRR) so the
   rasterizer can index them with (v << shift) + u.
   ============================================================ */
import { makeRng } from './mathx.js';

export function makeTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  draw(g, w, h);
  return texFromCanvas(c);
}

export function texFromCanvas(c) {
  const g = c.getContext('2d', { willReadFrequently: true });
  const d = g.getImageData(0, 0, c.width, c.height);
  return {
    px: new Uint32Array(d.data.buffer.slice(0)),
    w: c.width, h: c.height,
    wMask: c.width - 1, hMask: c.height - 1,
    shift: Math.round(Math.log2(c.width)),
    canvas: c,
  };
}

/* ---------------- little drawing helpers ---------------- */
const R = makeRng(0xBEEF17);

function fill(g, c, w, h) { g.fillStyle = c; g.fillRect(0, 0, w, h); }

function noise(g, w, h, amt, alpha = 1, mono = true) {
  const d = g.getImageData(0, 0, w, h), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    if (mono) {
      const n = (R() - 0.5) * amt;
      p[i] += n; p[i + 1] += n; p[i + 2] += n;
    } else {
      p[i] += (R() - 0.5) * amt; p[i + 1] += (R() - 0.5) * amt; p[i + 2] += (R() - 0.5) * amt;
    }
    if (alpha < 1) p[i + 3] *= alpha;
  }
  g.putImageData(d, 0, 0);
}

function speckle(g, w, h, n, colors, size = 1) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[R.int(colors.length)];
    g.fillRect(R.int(w), R.int(h), size, size);
  }
}

function grime(g, w, h, strength = 0.22) {
  for (let i = 0; i < 26; i++) {
    const x = R.int(w), y = R.int(h), r = 3 + R.int(14);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(0,0,0,${strength})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/* ============================================================
   THE STORE TEXTURE SET
   ============================================================ */
export function buildTextures() {
  const T = {};

  /* -------- floor: 1996 commercial carpet, teal with confetti -------- */
  T.carpet = makeTex(64, 64, (g, w, h) => {
    fill(g, '#1d3a3f', w, h);
    speckle(g, w, h, 900, ['#22474d', '#183035', '#2b5259', '#143035']);
    speckle(g, w, h, 90, ['#7d2b4a', '#2b5f7d', '#7d6a2b']);
    noise(g, w, h, 14);
    grime(g, w, h, 0.18);
  });

  T.carpetWorn = makeTex(64, 64, (g, w, h) => {
    fill(g, '#16292d', w, h);
    speckle(g, w, h, 700, ['#1b3438', '#12242a', '#20403f']);
    noise(g, w, h, 12);
    grime(g, w, h, 0.3);
  });

  /* -------- ceiling: acoustic tile -------- */
  T.ceiling = makeTex(64, 64, (g, w, h) => {
    fill(g, '#b9b3a1', w, h);
    speckle(g, w, h, 1400, ['#aaa492', '#c6c0ae', '#9d9787'], 1);
    g.strokeStyle = '#6e6a5c'; g.lineWidth = 2;
    g.strokeRect(0, 0, w, h);
    noise(g, w, h, 10);
    // water stain
    const gr = g.createRadialGradient(44, 14, 1, 44, 14, 16);
    gr.addColorStop(0, 'rgba(120,90,40,.55)');
    gr.addColorStop(1, 'rgba(120,90,40,0)');
    g.fillStyle = gr; g.fillRect(28, 0, 32, 30);
  });

  T.lightPanel = makeTex(64, 64, (g, w, h) => {
    fill(g, '#e9f3e4', w, h);
    for (let x = 0; x < w; x += 8) { g.fillStyle = 'rgba(190,210,190,.55)'; g.fillRect(x, 0, 3, h); }
    g.fillStyle = '#8d9a8d'; g.fillRect(0, 0, w, 3); g.fillRect(0, h - 3, w, 3);
    // dead flies
    g.fillStyle = 'rgba(30,25,20,.6)';
    for (let i = 0; i < 5; i++) g.fillRect(6 + R.int(50), 8 + R.int(46), 2, 1);
  });

  /* -------- walls -------- */
  T.wall = makeTex(64, 64, (g, w, h) => {
    fill(g, '#8d8571', w, h);
    noise(g, w, h, 16);
    grime(g, w, h, 0.16);
    g.fillStyle = 'rgba(60,50,40,.25)';
    for (let i = 0; i < 4; i++) g.fillRect(R.int(w), R.int(h), 1 + R.int(12), 1);
  });

  T.wainscot = makeTex(64, 64, (g, w, h) => {
    fill(g, '#4b3826', w, h);
    for (let x = 0; x < w; x += 16) {
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x, 0, 1, h);
      g.fillStyle = 'rgba(255,220,170,.07)'; g.fillRect(x + 1, 0, 1, h);
    }
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(${90 + R.int(40)},${64 + R.int(30)},${40 + R.int(20)},.5)`;
      g.fillRect(0, R.int(h), w, 1);
    }
    noise(g, w, h, 12);
  });

  T.wallLowerTrim = makeTex(64, 16, (g, w, h) => {
    fill(g, '#2a2018', w, h);
    g.fillStyle = '#3b2e22'; g.fillRect(0, 2, w, 5);
    noise(g, w, h, 10);
  });

  /* -------- shelving -------- */
  T.shelfWood = makeTex(64, 64, (g, w, h) => {
    fill(g, '#5b4632', w, h);
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(${40 + R.int(40)},${30 + R.int(26)},${20 + R.int(16)},.6)`;
      g.fillRect(0, R.int(h), w, 1 + R.int(2));
    }
    noise(g, w, h, 12);
  });

  T.pegboard = makeTex(64, 64, (g, w, h) => {
    fill(g, '#6b6152', w, h);
    g.fillStyle = '#3a342b';
    for (let y = 4; y < h; y += 8) for (let x = 4; x < w; x += 8) g.fillRect(x, y, 2, 2);
    noise(g, w, h, 9);
  });

  /* -------- VHS spines, one texture per genre -------- */
  const GENRE_PALETTE = {
    HORROR: { base: ['#2a0d0d', '#3d0f14', '#120a0c', '#4a1414'], ink: '#d8c9a8', accent: '#c02020' },
    COMEDY: { base: ['#c9a227', '#d8862a', '#b6541f', '#e0c04a'], ink: '#2a1c08', accent: '#ffe680' },
    ACTION: { base: ['#1b3b6f', '#0f2547', '#5a1616', '#243d5c'], ink: '#e8e2cf', accent: '#ff8c1a' },
    SCIFI: { base: ['#123043', '#0a2233', '#1d4f5c', '#2b1a52'], ink: '#9fe8ff', accent: '#39c5f3' },
    DRAMA: { base: ['#3b3730', '#4a4237', '#2b2822', '#57503f'], ink: '#e6dcc4', accent: '#b9a06a' },
    FAMILY: { base: ['#2c6b3f', '#3f8c52', '#7d4a9c', '#2f5fa8'], ink: '#fff3c9', accent: '#ffd447' },
  };
  T.spines = {};
  for (const [genre, pal] of Object.entries(GENRE_PALETTE)) {
    T.spines[genre] = makeTex(64, 64, (g, w, h) => {
      fill(g, '#0b0b0d', w, h);
      let x = 0;
      while (x < w) {
        const bw = 3 + R.int(4);
        g.fillStyle = pal.base[R.int(pal.base.length)];
        g.fillRect(x, 2, bw, h - 3);
        // spine title bars
        g.fillStyle = pal.ink;
        const n = 2 + R.int(3);
        for (let i = 0; i < n; i++) g.fillRect(x + 1, 8 + i * 9 + R.int(3), bw - 2, 1);
        if (R.chance(0.35)) { g.fillStyle = pal.accent; g.fillRect(x + 1, h - 12, bw - 2, 3); }
        // clamshell sheen
        g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(x, 2, 1, h - 3);
        g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(x + bw - 1, 2, 1, h - 3);
        x += bw;
      }
      g.fillStyle = '#241d14'; g.fillRect(0, 0, w, 2); g.fillRect(0, h - 1, w, 1);
      noise(g, w, h, 8);
      grime(g, w, h, 0.12);
    });
  }
  T.spinesEmpty = makeTex(64, 64, (g, w, h) => {
    fill(g, '#0d0d10', w, h);
    g.fillStyle = '#241d14'; g.fillRect(0, 0, w, 2); g.fillRect(0, h - 1, w, 1);
    g.fillStyle = 'rgba(255,255,255,.04)'; g.fillRect(0, 2, w, 4);
    noise(g, w, h, 6);
  });

  /* -------- genre header signs -------- */
  T.signs = {};
  const SIGN_COLOR = {
    HORROR: ['#3a0a0a', '#ff4b3a'], COMEDY: ['#3a2c05', '#ffd447'],
    ACTION: ['#08203a', '#4fa8ff'], SCIFI: ['#0a2a33', '#5cf0ff'],
    DRAMA: ['#2a2418', '#e8d9ae'], FAMILY: ['#0a2e18', '#7cf09a'],
  };
  for (const [genre, [bg, fg]] of Object.entries(SIGN_COLOR)) {
    T.signs[genre] = makeTex(64, 16, (g, w, h) => {
      fill(g, bg, w, h);
      g.strokeStyle = fg; g.lineWidth = 1; g.strokeRect(1.5, 1.5, w - 3, h - 3);
      g.fillStyle = fg;
      g.font = 'bold 9px "Courier New", monospace';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(genre, w / 2, h / 2 + 1);
      noise(g, w, h, 8);
    });
  }

  /* -------- counter / props -------- */
  T.counterTop = makeTex(64, 64, (g, w, h) => {
    fill(g, '#6d6a5f', w, h);
    speckle(g, w, h, 1100, ['#7b7869', '#5c594f', '#8a8676', '#4d4a42']);
    noise(g, w, h, 10);
    grime(g, w, h, 0.2);
    g.strokeStyle = 'rgba(255,255,255,.06)'; g.strokeRect(0.5, 0.5, w - 1, h - 1);
  });

  T.counterFront = makeTex(64, 64, (g, w, h) => {
    fill(g, '#3a2b1e', w, h);
    for (let y = 0; y < h; y += 21) { g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(0, y, w, 2); }
    for (let i = 0; i < 22; i++) {
      g.fillStyle = `rgba(${70 + R.int(30)},${52 + R.int(20)},${34 + R.int(14)},.55)`;
      g.fillRect(0, R.int(h), w, 1);
    }
    noise(g, w, h, 11);
    grime(g, w, h, 0.25);
  });

  T.register = makeTex(64, 64, (g, w, h) => {
    fill(g, '#c9c2ac', w, h);
    g.fillStyle = '#2b2b2b'; g.fillRect(6, 6, 52, 18);      // display bezel
    g.fillStyle = '#1c3a1c'; g.fillRect(9, 9, 46, 12);      // vfd
    g.fillStyle = '#7cf09a'; g.font = 'bold 8px "Courier New",monospace';
    g.textAlign = 'right'; g.fillText('0.00', 53, 19);
    g.fillStyle = '#8f8a78';
    for (let y = 30; y < 58; y += 7) for (let x = 8; x < 56; x += 8) {
      g.fillStyle = R.chance(0.15) ? '#b8452f' : '#8f8a78';
      g.fillRect(x, y, 6, 5);
    }
    noise(g, w, h, 9); grime(g, w, h, 0.2);
  });

  T.rewinder = makeTex(64, 64, (g, w, h) => {
    fill(g, '#22222a', w, h);
    g.fillStyle = '#15151b'; g.fillRect(4, 10, 56, 34);
    g.strokeStyle = '#3d3d4a'; g.strokeRect(4.5, 10.5, 55, 33);
    g.fillStyle = '#0a0a0e'; g.fillRect(10, 16, 44, 20);     // tape slot
    g.fillStyle = '#c02020'; g.fillRect(50, 50, 6, 6);       // power lamp
    g.fillStyle = '#8a8a96'; g.fillRect(8, 48, 14, 8); g.fillRect(26, 48, 14, 8);
    g.fillStyle = '#c9c2ac'; g.font = 'bold 7px "Courier New",monospace';
    g.fillText('REWIND', 8, 8);
    noise(g, w, h, 8);
  });

  T.binFront = makeTex(64, 64, (g, w, h) => {
    fill(g, '#20303a', w, h);
    g.fillStyle = '#0a1218'; g.fillRect(8, 12, 48, 12);      // slot
    g.fillStyle = '#e8d9ae'; g.font = 'bold 9px "Courier New",monospace';
    g.textAlign = 'center'; g.fillText('RETURNS', 32, 40);
    g.strokeStyle = '#4a6072'; g.strokeRect(2.5, 2.5, w - 5, h - 5);
    noise(g, w, h, 9); grime(g, w, h, 0.2);
  });

  T.phone = makeTex(64, 64, (g, w, h) => {
    fill(g, '#8d8571', w, h);
    g.fillStyle = '#2b2b30'; g.fillRect(14, 6, 36, 50);      // body
    g.fillStyle = '#3d3d45'; g.fillRect(17, 10, 30, 14);     // handset cradle
    g.fillStyle = '#1a1a1f'; g.fillRect(19, 12, 26, 10);
    g.fillStyle = '#c9c2ac';
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) g.fillRect(21 + c * 8, 28 + r * 6, 6, 4);
    g.fillStyle = '#c02020'; g.fillRect(19, 52, 26, 2);
    g.strokeStyle = '#1a1a1f'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(32, 24); g.bezierCurveTo(10, 34, 54, 44, 32, 56); g.stroke(); // cord
    noise(g, w, h, 8);
  });

  T.clock = makeTex(32, 32, (g, w, h) => {
    fill(g, '#d8cfae', w, h);
    g.strokeStyle = '#2a2418'; g.lineWidth = 2;
    g.beginPath(); g.arc(16, 16, 13, 0, 7); g.stroke();
    g.fillStyle = '#2a2418';
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      g.fillRect(16 + Math.sin(a) * 11 - 1, 16 - Math.cos(a) * 11 - 1, 2, 2);
    }
    g.lineWidth = 2; g.strokeStyle = '#2a2418';
    g.beginPath(); g.moveTo(16, 16); g.lineTo(16, 8); g.stroke();
    g.beginPath(); g.moveTo(16, 16); g.lineTo(22, 19); g.stroke();
  });

  /* -------- glass, doors, outside -------- */
  T.glass = makeTex(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(120,160,180,.16)'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.10)';
    g.beginPath(); g.moveTo(0, 52); g.lineTo(30, 0); g.lineTo(42, 0); g.lineTo(8, 60); g.fill();
    g.fillStyle = 'rgba(255,255,255,.05)';
    g.beginPath(); g.moveTo(30, 64); g.lineTo(60, 8); g.lineTo(64, 14); g.lineTo(38, 64); g.fill();
    // grime along the bottom
    g.fillStyle = 'rgba(40,50,40,.25)'; g.fillRect(0, 56, w, 8);
  });

  T.doorGlass = makeTex(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(120,160,180,.15)'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.10)';
    g.beginPath(); g.moveTo(0, 40); g.lineTo(24, 0); g.lineTo(34, 0); g.lineTo(4, 50); g.fill();
    // OPEN sign hanging in the glass
    g.fillStyle = 'rgba(20,10,10,.85)'; g.fillRect(16, 12, 32, 16);
    g.fillStyle = '#ff4b3a'; g.font = 'bold 10px "Courier New",monospace';
    g.textAlign = 'center'; g.fillText('OPEN', 32, 24);
    // push bar
    g.fillStyle = '#9aa0a6'; g.fillRect(4, 36, 56, 4);
  });

  T.doorLocked = makeTex(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(90,120,140,.20)'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(20,10,10,.9)'; g.fillRect(14, 12, 36, 16);
    g.fillStyle = '#7cf09a'; g.font = 'bold 8px "Courier New",monospace';
    g.textAlign = 'center'; g.fillText('CLOSED', 32, 24);
    g.fillStyle = '#c9c2ac'; g.fillRect(4, 36, 56, 4);
    g.fillStyle = '#ffd447'; g.fillRect(28, 34, 8, 8);       // thrown deadbolt
  });

  T.doorFrame = makeTex(64, 64, (g, w, h) => {
    fill(g, '#3a3d40', w, h);
    g.fillStyle = '#4a4e52'; g.fillRect(0, 0, w, 4);
    noise(g, w, h, 10);
  });

  T.nightStreet = makeTex(128, 64, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#0a0d1a'); grd.addColorStop(0.55, '#111629'); grd.addColorStop(1, '#05070d');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    // silhouetted buildings
    let x = 0;
    while (x < w) {
      const bw = 10 + R.int(22), bh = 14 + R.int(26);
      g.fillStyle = '#05060c';
      g.fillRect(x, h - bh - 12, bw, bh + 12);
      for (let wy = h - bh - 8; wy < h - 14; wy += 6) {
        for (let wx = x + 2; wx < x + bw - 3; wx += 5) {
          if (R.chance(0.22)) { g.fillStyle = R.chance(0.7) ? '#c9a227' : '#3a5fb8'; g.fillRect(wx, wy, 2, 3); }
        }
      }
      x += bw + 1 + R.int(3);
    }
    g.fillStyle = '#0a0c12'; g.fillRect(0, h - 12, w, 12);
    noise(g, w, h, 7);
  });

  T.asphalt = makeTex(64, 64, (g, w, h) => {
    fill(g, '#141821', w, h);
    speckle(g, w, h, 700, ['#1a1f29', '#0e1118', '#20252f']);
    noise(g, w, h, 10);
  });

  T.sidewalk = makeTex(64, 64, (g, w, h) => {
    fill(g, '#232830', w, h);
    speckle(g, w, h, 500, ['#2a3038', '#1c2028']);
    g.fillStyle = '#171b22'; g.fillRect(0, 0, w, 2); g.fillRect(0, 0, 2, h);
    noise(g, w, h, 8);
  });

  /* -------- signage and posters -------- */
  T.neon = makeTex(128, 32, (g, w, h) => {
    fill(g, '#0a0508', w, h);
    g.font = 'bold 19px "Courier New",monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = '#ff2f6d'; g.shadowBlur = 8;
    g.fillStyle = '#ff7fae'; g.fillText('SUNSET VIDEO', w / 2, h / 2);
    g.shadowBlur = 0;
    g.fillStyle = '#fff0f6'; g.font = 'bold 18px "Courier New",monospace';
    g.fillText('SUNSET VIDEO', w / 2, h / 2);
  });

  T.exitSign = makeTex(32, 16, (g, w, h) => {
    fill(g, '#1a0a0a', w, h);
    g.fillStyle = '#ff3b28'; g.font = 'bold 11px "Courier New",monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('EXIT', w / 2, h / 2 + 1);
  });

  T.beKind = makeTex(64, 32, (g, w, h) => {
    fill(g, '#e8dcb8', w, h);
    g.fillStyle = '#8c1d0e'; g.font = 'bold 9px "Courier New",monospace';
    g.textAlign = 'center';
    g.fillText('BE KIND', w / 2, 12);
    g.fillText('REWIND', w / 2, 24);
    g.strokeStyle = '#8c1d0e'; g.strokeRect(2.5, 2.5, w - 5, h - 5);
    noise(g, w, h, 10);
  });

  T.lateFeeSign = makeTex(64, 32, (g, w, h) => {
    fill(g, '#d8cfae', w, h);
    g.fillStyle = '#2a2418'; g.font = 'bold 7px "Courier New",monospace';
    g.textAlign = 'center';
    g.fillText('LATE FEES', w / 2, 10);
    g.fillStyle = '#8c1d0e'; g.font = 'bold 9px "Courier New",monospace';
    g.fillText('$1/DAY', w / 2, 22);
    noise(g, w, h, 9);
  });

  const POSTERS = [
    { bg: '#1a0507', ink: '#ff3b28', t1: 'THE', t2: 'CRAWL', sub: 'IT KNOWS YOUR NAME' },
    { bg: '#05121a', ink: '#5cf0ff', t1: 'ORBIT', t2: 'ZERO', sub: 'NO ONE CAN HEAR' },
    { bg: '#141005', ink: '#ffd447', t1: 'DOUBLE', t2: 'SHIFT', sub: 'A COMEDY OF ERRORS' },
    { bg: '#0d0a12', ink: '#c9a4ff', t1: 'NIGHT', t2: 'CLERK', sub: 'CLOSING TIME IS FOREVER' },
  ];
  T.posters = POSTERS.map((p) => makeTex(32, 64, (g, w, h) => {
    fill(g, p.bg, w, h);
    // lurid airbrushed glow
    const gr = g.createRadialGradient(16, 26, 2, 16, 26, 26);
    gr.addColorStop(0, p.ink + '66'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    // a shape suggesting a figure
    g.fillStyle = '#000';
    g.beginPath(); g.ellipse(16, 30, 6, 12, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(16, 18, 3.4, 4, 0, 0, 7); g.fill();
    g.fillStyle = p.ink;
    g.font = 'bold 8px "Courier New",monospace'; g.textAlign = 'center';
    g.fillText(p.t1, 16, 50);
    g.font = 'bold 10px "Courier New",monospace';
    g.fillText(p.t2, 16, 59);
    g.fillStyle = '#cfc7ad'; g.font = '4px "Courier New",monospace';
    g.fillText(p.sub, 16, 8);
    g.strokeStyle = 'rgba(0,0,0,.6)'; g.strokeRect(0.5, 0.5, w - 1, h - 1);
    noise(g, w, h, 10);
    grime(g, w, h, 0.2);
  }));

  /* -------- CRT television showing static (animated) -------- */
  T.staticFrames = [];
  for (let f = 0; f < 6; f++) {
    T.staticFrames.push(makeTex(64, 64, (g, w, h) => {
      const d = g.createImageData(w, h), p = d.data;
      for (let i = 0; i < p.length; i += 4) {
        const v = R.chance(0.5) ? 20 + R.int(60) : 90 + R.int(150);
        p[i] = v; p[i + 1] = v; p[i + 2] = v + R.int(18); p[i + 3] = 255;
      }
      g.putImageData(d, 0, 0);
      // rolling bar
      g.fillStyle = 'rgba(255,255,255,.16)';
      g.fillRect(0, (f * 11) % h, w, 5);
      g.fillStyle = 'rgba(0,0,0,.35)';
      for (let y = 0; y < h; y += 2) g.fillRect(0, y, w, 1);
    }));
  }
  T.tvShell = makeTex(64, 64, (g, w, h) => {
    fill(g, '#3b3830', w, h);
    g.fillStyle = '#2a2722'; g.fillRect(3, 3, w - 6, h - 6);
    noise(g, w, h, 9);
  });

  /* -------- the tape in your hands -------- */
  T.tapeShell = makeTex(64, 64, (g, w, h) => {
    fill(g, '#17171b', w, h);
    g.fillStyle = '#0e0e12'; g.fillRect(4, 4, w - 8, h - 8);
    g.fillStyle = '#22222a';
    g.beginPath(); g.arc(22, 34, 9, 0, 7); g.fill();
    g.beginPath(); g.arc(44, 34, 9, 0, 7); g.fill();
    noise(g, w, h, 7);
  });

  /* -------- misc dressing -------- */
  T.mat = makeTex(64, 64, (g, w, h) => {
    fill(g, '#1a1a1c', w, h);
    g.strokeStyle = '#3a3a3e'; g.lineWidth = 2; g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = '#6a6a70'; g.font = 'bold 10px "Courier New",monospace';
    g.textAlign = 'center'; g.fillText('WELCOME', 32, 36);
    noise(g, w, h, 12); grime(g, w, h, 0.35);
  });

  T.candyRack = makeTex(64, 64, (g, w, h) => {
    fill(g, '#2a2a30', w, h);
    for (let y = 2; y < h; y += 11) {
      for (let x = 2; x < w; x += 9) {
        g.fillStyle = ['#c02020', '#ffd447', '#3a5fb8', '#7cf09a', '#e07a2a'][R.int(5)];
        g.fillRect(x, y, 7, 9);
        g.fillStyle = 'rgba(255,255,255,.2)'; g.fillRect(x, y, 7, 2);
      }
    }
    noise(g, w, h, 10);
  });

  T.popcorn = makeTex(64, 64, (g, w, h) => {
    fill(g, '#b8452f', w, h);
    g.fillStyle = '#e8d9ae';
    for (let i = 0; i < 8; i++) g.fillRect(4, 6 + i * 7, w - 8, 3);
    g.fillStyle = '#2a2418'; g.font = 'bold 8px "Courier New",monospace';
    g.textAlign = 'center'; g.fillText('POPCORN', 32, 58);
    noise(g, w, h, 9);
  });

  /* -------- a fold of bills -------- */
  T.cash = makeTex(64, 32, (g, w, h) => {
    fill(g, '#5d7a4e', w, h);
    g.fillStyle = '#6d8a5c'; g.fillRect(2, 2, w - 4, h - 4);
    g.strokeStyle = '#3f5636'; g.lineWidth = 1; g.strokeRect(4.5, 4.5, w - 9, h - 9);
    g.fillStyle = '#41563a';
    g.beginPath(); g.ellipse(w / 2, h / 2, 9, 8, 0, 0, 7); g.fill();
    g.fillStyle = '#8aa377';
    g.beginPath(); g.ellipse(w / 2, h / 2, 6, 5.5, 0, 0, 7); g.fill();
    g.fillStyle = '#3f5636'; g.font = 'bold 8px "Courier New",monospace';
    g.textAlign = 'center'; g.fillText('1', 10, h / 2 + 3); g.fillText('1', w - 10, h / 2 + 3);
    noise(g, w, h, 12); grime(g, w, h, 0.22);
  });

  T.dark = makeTex(8, 8, (g, w, h) => fill(g, '#05060a', w, h));
  T.black = makeTex(8, 8, (g, w, h) => fill(g, '#000000', w, h));
  T.blood = makeTex(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(${90 + R.int(60)},4,6,${(0.5 + R() * 0.5).toFixed(2)})`;
      const x = 32 + (R() - 0.5) * 46, y = 32 + (R() - 0.5) * 46;
      g.beginPath(); g.ellipse(x, y, 2 + R.int(9), 2 + R.int(7), R() * 3, 0, 7); g.fill();
    }
  });

  return T;
}

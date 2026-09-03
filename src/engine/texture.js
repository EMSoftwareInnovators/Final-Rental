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

  /* -------- ceiling: acoustic tile, in several states of neglect --------
     A drop ceiling is a grid of individual tiles and no two age the same
     way. One texture repeated 130 times reads as a printed pattern, so the
     set below gets dealt out across the grid instead.                     */
  const ceilingTile = (dress) => makeTex(64, 64, (g, w, h) => {
    fill(g, '#b9b3a1', w, h);
    speckle(g, w, h, 1400, ['#aaa492', '#c6c0ae', '#9d9787'], 1);
    if (dress) dress(g, w, h);
    // the T-bar grid the tile drops into
    g.strokeStyle = '#6e6a5c'; g.lineWidth = 2;
    g.strokeRect(0, 0, w, h);
    noise(g, w, h, 10);
  });

  const stain = (g, x, y, r, a) => {
    const gr = g.createRadialGradient(x, y, 1, x, y, r);
    gr.addColorStop(0, `rgba(122,92,42,${a})`);
    gr.addColorStop(0.62, `rgba(138,110,58,${a * 0.45})`);
    gr.addColorStop(1, 'rgba(120,90,40,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  };

  T.ceilingTiles = [
    // 0. clean. Most of the ceiling is just this.
    ceilingTile(null),
    // 1. clean, a shade greyer -- fluorescents do not age tiles evenly
    ceilingTile((g, w, h) => { g.fillStyle = 'rgba(140,140,132,.14)'; g.fillRect(0, 0, w, h); }),
    // 2. an old dried ring near one edge
    ceilingTile((g) => { stain(g, 46, 12, 15, 0.5); }),
    // 3. the bad one -- something upstairs let go
    ceilingTile((g) => { stain(g, 30, 34, 26, 0.72); stain(g, 44, 20, 12, 0.4); }),
    // 4. sagged and pinned back up with a screw
    ceilingTile((g, w, h) => {
      g.fillStyle = 'rgba(0,0,0,.13)';
      g.beginPath(); g.moveTo(0, h); g.lineTo(w, h); g.lineTo(w, h - 22); g.quadraticCurveTo(w / 2, h - 6, 0, h - 20); g.fill();
      g.fillStyle = '#7a7466'; g.fillRect(30, 30, 3, 3);
    }),
    // 5. a corner knocked out of it at some point
    ceilingTile((g, w, h) => {
      g.fillStyle = '#4a4740';
      g.beginPath(); g.moveTo(w, 0); g.lineTo(w - 17, 0); g.lineTo(w, 14); g.fill();
      g.fillStyle = 'rgba(0,0,0,.35)';
      g.beginPath(); g.moveTo(w - 17, 0); g.lineTo(w, 14); g.lineTo(w - 15, 3); g.fill();
    }),
    // 6. a return-air grille
    ceilingTile((g, w, h) => {
      g.fillStyle = '#8e8a7c'; g.fillRect(10, 10, w - 20, h - 20);
      g.fillStyle = '#3c3a34';
      for (let y = 14; y < h - 12; y += 5) g.fillRect(13, y, w - 26, 3);
      g.strokeStyle = '#6e6a5c'; g.lineWidth = 1; g.strokeRect(10.5, 10.5, w - 21, h - 21);
    }),
    // 7. scorched brown around a fixture that ran too hot for a decade
    ceilingTile((g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, 34);
      gr.addColorStop(0, 'rgba(90,74,46,.34)'); gr.addColorStop(1, 'rgba(90,74,46,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      speckle(g, w, h, 60, ['#8d8577', '#a09884'], 1);
    }),
  ];
  T.ceiling = T.ceilingTiles[0];

  T.lightPanel = makeTex(64, 64, (g, w, h) => {
    fill(g, '#e9f3e4', w, h);
    for (let x = 0; x < w; x += 8) { g.fillStyle = 'rgba(190,210,190,.55)'; g.fillRect(x, 0, 3, h); }
    g.fillStyle = '#8d9a8d'; g.fillRect(0, 0, w, 3); g.fillRect(0, h - 3, w, 3);
    // dead flies
    g.fillStyle = 'rgba(30,25,20,.6)';
    for (let i = 0; i < 5; i++) g.fillRect(6 + R.int(50), 8 + R.int(46), 2, 1);
  });

  /* -------- walls -------- */
  /* Four panels of the same paint, aged four different ways. Emitted in a
     shuffled run along each wall so a long stretch never reads as a repeat. */
  const wallPanel = (dress) => makeTex(64, 64, (g, w, h) => {
    fill(g, '#8d8571', w, h);
    noise(g, w, h, 16);
    grime(g, w, h, 0.16);
    g.fillStyle = 'rgba(60,50,40,.25)';
    for (let i = 0; i < 4; i++) g.fillRect(R.int(w), R.int(h), 1 + R.int(12), 1);
    if (dress) dress(g, w, h);
  });
  T.wallPanels = [
    wallPanel(null),
    // a settling crack running down out of the corner
    wallPanel((g, w, h) => {
      g.strokeStyle = 'rgba(52,44,34,.5)'; g.lineWidth = 1;
      g.beginPath();
      let x = 12 + R.int(40);
      g.moveTo(x, 0);
      for (let y = 4; y < h; y += 6) { x += R.int(5) - 2; g.lineTo(x, y); }
      g.stroke();
    }),
    // the ghost of something that hung here for ten years
    wallPanel((g, w, h) => {
      g.fillStyle = 'rgba(255,248,225,.10)'; g.fillRect(14, 10, 34, 40);
      g.fillStyle = 'rgba(60,50,40,.16)'; g.fillRect(14, 8, 34, 2);
      g.fillStyle = 'rgba(40,34,26,.5)'; g.fillRect(30, 6, 1, 3);
    }),
    // scuffed low, patched badly, never repainted
    wallPanel((g, w, h) => {
      g.fillStyle = 'rgba(150,142,124,.35)';
      g.beginPath(); g.ellipse(20 + R.int(24), 40 + R.int(18), 9, 6, 0.3, 0, 7); g.fill();
      g.fillStyle = 'rgba(48,40,30,.28)';
      for (let i = 0; i < 6; i++) g.fillRect(R.int(w), h - 18 + R.int(16), 3 + R.int(14), 1);
    }),
  ];
  T.wall = T.wallPanels[0];

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
    // Cartridge boxes are shorter, wider and far louder than a clamshell.
    GAMES: { base: ['#2b1a52', '#3d2470', '#12103a', '#4a1a5c'], ink: '#e8ddff', accent: '#c9a4ff' },
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
  /* Cartridge boxes stand in shorter, fatter blocks than tape clamshells,
     so the games run gets its own spine art rather than borrowing one. */
  T.spines.GAMES = makeTex(64, 64, (g, w, h) => {
    fill(g, '#0b0b12', w, h);
    const pal = GENRE_PALETTE.GAMES;
    let x = 0;
    while (x < w) {
      const bw = 5 + R.int(6);
      g.fillStyle = pal.base[R.int(pal.base.length)];
      g.fillRect(x, 4, bw, h - 8);
      // a wide title band and a publisher stripe, the way a cart box looks
      g.fillStyle = pal.ink;
      g.fillRect(x + 1, 12 + R.int(6), bw - 2, 2);
      g.fillStyle = pal.accent;
      g.fillRect(x + 1, h - 18, bw - 2, 4);
      g.fillStyle = 'rgba(255,255,255,.10)'; g.fillRect(x, 4, 1, h - 8);
      g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(x + bw - 1, 4, 1, h - 8);
      x += bw;
    }
    g.fillStyle = '#241d14'; g.fillRect(0, 0, w, 4); g.fillRect(0, h - 3, w, 3);
    noise(g, w, h, 8);
    grime(g, w, h, 0.1);
  });

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
    GAMES: ['#1a0a2e', '#c9a4ff'],
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

  /* -------- cash register, built from parts --------
     One texture wrapped round a cube reads as a cardboard box with a
     keypad printed on it. The register is modelled instead: drawer,
     body, canted keydeck, display head. These are its surfaces.       */
  T.regBody = makeTex(64, 64, (g, w, h) => {          // beige moulded plastic
    fill(g, '#cfc7b0', w, h);
    g.fillStyle = 'rgba(255,255,255,.10)'; g.fillRect(0, 0, w, 5);
    g.fillStyle = 'rgba(0,0,0,.16)'; g.fillRect(0, h - 4, w, 4);
    noise(g, w, h, 7); grime(g, w, h, 0.14);
  });
  T.regDrawer = makeTex(64, 64, (g, w, h) => {        // drawer face + chrome pull
    fill(g, '#bdb5a0', w, h);
    g.fillStyle = 'rgba(0,0,0,.30)'; g.fillRect(0, 0, w, 3);
    g.fillStyle = '#8e8878'; g.fillRect(14, 26, 36, 7);         // recessed pull
    g.fillStyle = '#3a362e'; g.fillRect(16, 28, 32, 4);
    g.fillStyle = '#e6e0cf'; g.fillRect(16, 28, 32, 1);
    g.fillStyle = '#6f6a5c'; g.fillRect(6, 12, 4, 4);           // lock barrel
    noise(g, w, h, 7); grime(g, w, h, 0.2);
  });
  /* The keydeck, seen from above and sliced across three tiers of the
     model. Square keys in a grid, a numeric block, a column of department
     keys down one side and a fat red TOTAL at the bottom -- the layout of
     an electronic register rather than a chessboard. */
  T.regKeys = makeTex(64, 64, (g, w, h) => {
    fill(g, '#39362f', w, h);
    g.fillStyle = '#26241f'; g.fillRect(2, 2, w - 4, h - 4);
    const key = (x, y, kw, kh, top, face) => {
      g.fillStyle = '#14130f'; g.fillRect(x - 0.5, y - 0.5, kw + 1, kh + 1);
      g.fillStyle = face; g.fillRect(x, y, kw, kh);
      g.fillStyle = top; g.fillRect(x, y, kw, 1);
      g.fillStyle = 'rgba(0,0,0,.30)'; g.fillRect(x, y + kh - 1.5, kw, 1.5);
    };
    // department keys down the far edge
    for (let c = 0; c < 6; c++) key(4 + c * 9.4, 5, 8, 6, '#f0e8d2', '#cfc7b0');
    // numeric block
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) key(4 + c * 9.4, 14 + r * 8, 8, 6.5, '#eee6cf', '#c6bea8');
    }
    // the loud column: void, no-sale, subtotal
    for (let r = 0; r < 3; r++) key(42, 14 + r * 8, 18, 6.5, '#c8705c', '#9c3a26');
    // bottom row, and TOTAL across the corner
    for (let c = 0; c < 4; c++) key(4 + c * 9.4, 40, 8, 6.5, '#eee6cf', '#c6bea8');
    key(42, 40, 18, 15, '#d4826c', '#8e2a1c');
    g.fillStyle = '#f2e8d6'; g.font = 'bold 5px "Courier New",monospace';
    g.textAlign = 'center'; g.fillText('TOTAL', 51, 49);
    g.fillStyle = '#8a8474'; g.font = '4px "Courier New",monospace';
    g.textAlign = 'left'; g.fillText('SUNSET VIDEO 4412', 4, 60);
    noise(g, w, h, 5);
  });
  T.regDisplay = makeTex(64, 32, (g, w, h) => {       // the customer-facing VFD
    fill(g, '#26241f', w, h);
    g.fillStyle = '#0d0d0d'; g.fillRect(3, 4, w - 6, h - 11);       // smoked bezel
    g.fillStyle = '#07160a'; g.fillRect(5, 6, w - 10, h - 15);      // the tube
    // dim segment ghosts behind the lit digits, like a real VFD
    g.fillStyle = 'rgba(120,240,164,.10)'; g.font = 'bold 11px "Courier New",monospace';
    g.textAlign = 'right'; g.textBaseline = 'middle';
    g.fillText('88.88', w - 8, h / 2 - 2);
    g.fillStyle = '#8effc0';
    g.fillText('0.00', w - 8, h / 2 - 2);
    g.fillStyle = 'rgba(140,255,190,.14)'; g.fillRect(5, 6, w - 10, 2);
    g.fillStyle = '#6f6a5c'; g.font = '4px "Courier New",monospace';
    g.textAlign = 'left'; g.fillText('THANK YOU', 5, h - 3);
  });
  T.regTop = makeTex(64, 64, (g, w, h) => {           // top deck with a receipt slot
    fill(g, '#cfc7b0', w, h);
    g.fillStyle = '#2f2c27'; g.fillRect(10, 8, w - 20, 5);
    g.fillStyle = '#e9e2cf'; g.fillRect(12, 9, w - 24, 2);      // paper edge
    g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, h - 6, w, 6);
    noise(g, w, h, 7); grime(g, w, h, 0.18);
  });
  T.register = T.regBody;

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
  /* The same bin without the lettering, for the three sides nobody reads. */
  T.binSide = makeTex(64, 64, (g, w, h) => {
    fill(g, '#20303a', w, h);
    g.fillStyle = '#0a1218'; g.fillRect(8, 12, 48, 12);      // slot
    g.strokeStyle = '#4a6072'; g.strokeRect(2.5, 2.5, w - 5, h - 5);
    noise(g, w, h, 9); grime(g, w, h, 0.2);
  });

  /* -------- wall telephone, built from parts --------
     A 1980s beige wall set: body, keypad, a separate handset lying in
     its cradle, and a coiled cord that hangs off the bottom.           */
  /* -------- the telephone --------
     A beige desk set of the kind that sat on every counter in 1996: warm
     off-white plastic gone slightly yellow, a dark gray keypad well with
     twelve square light keys, and the store's own number on a paper card
     under a plastic window in the middle of the dial. Charcoal read as a
     black slab from across the room; beige reads as a telephone. */
  const BEIGE = '#cfc3a4';
  T.phoneBody = makeTex(64, 64, (g, w, h) => {
    fill(g, BEIGE, w, h);
    g.fillStyle = 'rgba(255,255,255,.16)'; g.fillRect(0, 0, w, 4);
    g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(0, h - 7, w, 7);
    // the seam where the two halves of the shell meet
    g.fillStyle = 'rgba(0,0,0,.26)'; g.fillRect(0, Math.round(h * 0.52), w, 1);
    g.fillStyle = 'rgba(255,255,255,.10)'; g.fillRect(0, Math.round(h * 0.52) + 1, w, 1);
    noise(g, w, h, 4); grime(g, w, h, 0.22);
  });
  /* The top face: keypad well on the near half, card window above it. */
  T.phoneKeys = makeTex(64, 64, (g, w, h) => {
    fill(g, BEIGE, w, h);
    // recessed well the keys sit in
    g.fillStyle = '#8f866f'; g.fillRect(9, 17, 46, 43);
    g.fillStyle = '#43403a'; g.fillRect(11, 19, 42, 39);
    const glyph = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
    const sub = ['', 'ABC', 'DEF', 'GHI', 'JKL', 'MNO', 'PRS', 'TUV', 'WXY', '', 'OPER', ''];
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 3; c++) {
        const x = 13 + c * 13.6, y = 21 + r * 9.4;
        g.fillStyle = '#e6dfcb'; g.fillRect(x, y, 11.6, 7.6);      // key top
        g.fillStyle = 'rgba(0,0,0,.30)'; g.fillRect(x, y + 6.6, 11.6, 1.0);
        g.fillStyle = 'rgba(255,255,255,.45)'; g.fillRect(x, y, 11.6, 0.8);
        g.fillStyle = '#26241f'; g.font = 'bold 6px "Courier New",monospace';
        g.fillText(glyph[r * 3 + c], x + 5.8, y + 5.2);
        if (sub[r * 3 + c]) {
          g.fillStyle = '#6b6455'; g.font = '2.6px "Courier New",monospace';
          g.fillText(sub[r * 3 + c], x + 5.8, y + 7.4);
        }
      }
    }
    // number card under its little plastic window
    g.fillStyle = '#9c937c'; g.fillRect(8, 4, 48, 11);
    g.fillStyle = '#f2ecd9'; g.fillRect(10, 6, 44, 7);
    g.fillStyle = '#3a3630';
    g.font = '4.6px "Courier New",monospace';
    g.fillText('SUNSET VIDEO  555-0114', 32, 11.6);
    noise(g, w, h, 3); grime(g, w, h, 0.10);
  });
  /* The cradle strip: two moulded hooks with the well between them. */
  T.phoneCradle = makeTex(32, 64, (g, w, h) => {
    fill(g, BEIGE, w, h);
    g.fillStyle = '#a89d82'; g.fillRect(3, 5, w - 6, h - 10);
    g.fillStyle = '#8b8168'; g.fillRect(5, 9, w - 10, 13); g.fillRect(5, h - 22, w - 10, 13);
    g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(5, 9, w - 10, 1.6);
    g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(5, h - 22, w - 10, 1.6);
    // the little plunger the handset presses down
    g.fillStyle = '#6f6858'; g.fillRect(w / 2 - 3, h / 2 - 4, 6, 8);
    noise(g, w, h, 3); grime(g, w, h, 0.14);
  });
  T.phoneHandset = makeTex(64, 64, (g, w, h) => {
    fill(g, '#c8bc9c', w, h);
    g.fillStyle = 'rgba(255,255,255,.20)'; g.fillRect(0, 0, w, 6);
    g.fillStyle = 'rgba(0,0,0,.26)'; g.fillRect(0, h - 9, w, 9);
    // earpiece and mouthpiece perforations
    g.fillStyle = '#5b5446';
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      g.fillRect(7 + i * 4, 22 + j * 4, 2, 2);
      g.fillRect(w - 15 + i * 4, 22 + j * 4, 2, 2);
    }
    noise(g, w, h, 4); grime(g, w, h, 0.20);
  });
  T.phoneCord = makeTex(32, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#bdb094'; g.lineWidth = 3;
    for (let y = 2; y < h - 2; y += 5) {
      g.beginPath();
      g.ellipse(w / 2, y, 7, 2.6, 0, 0, Math.PI);
      g.stroke();
    }
    g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 1;
    for (let y = 4; y < h - 2; y += 5) { g.beginPath(); g.moveTo(w / 2 - 7, y); g.lineTo(w / 2 + 7, y); g.stroke(); }
  });
  T.phone = T.phoneBody;

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

  /* The door leaves are 0.80m across and 2.15m tall, so a square texture
     stretched over one squashes everything on it to a third of its width --
     which is what turned a hanging OPEN sign into two red smudges. These
     are 64 x 128: not the leaf's exact proportions, but the sampler masks
     u and v with width-1 and height-1, so both have to stay powers of two.

     The sign itself is drawn the way the real ones read from the sidewalk:
     a bright neon tube on a dark plate, not dark text on a light one. At
     320x240 from across the street the letters are a few pixels wide and
     nobody is reading them anyway -- what has to survive the downscale is
     the shape and the color of something lit in a dark window, and glowing
     red on black survives it where thin dark strokes do not. */
  const doorPane = (g, w, h, tint) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = tint; g.fillRect(0, 0, w, h);
    // the long diagonal reflection down the glass
    g.fillStyle = 'rgba(255,255,255,.10)';
    g.beginPath(); g.moveTo(0, 77); g.lineTo(30, 6); g.lineTo(42, 6); g.lineTo(10, 90); g.fill();
    g.fillStyle = 'rgba(255,255,255,.05)';
    g.beginPath(); g.moveTo(28, 120); g.lineTo(56, 24); g.lineTo(62, 30); g.lineTo(38, 126); g.fill();
    g.fillStyle = 'rgba(40,50,40,.22)'; g.fillRect(0, h - 11, w, 11);   // grime at the kick
  };

  /* A lit tube sign: dark plate, glow, tube, then the word inside it. */
  const neonSign = (g, x, y, sw, sh, word, hue, px) => {
    g.save();
    g.fillStyle = 'rgba(14,8,8,.9)';
    g.fillRect(x, y, sw, sh);
    g.shadowColor = hue; g.shadowBlur = 5;
    g.strokeStyle = hue; g.lineWidth = 1.5;
    g.strokeRect(x + 2, y + 2, sw - 4, sh - 4);
    g.font = `bold ${px}px "Courier New",monospace`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = hue; g.shadowBlur = 6;                 // the halo around the tube
    g.fillText(word, x + sw / 2, y + sh / 2 + 0.5);
    g.shadowBlur = 0; g.fillStyle = '#fff2ec';           // and the tube core, white-hot
    g.fillText(word, x + sw / 2, y + sh / 2 + 0.5);
    g.restore();
  };

  const pushBar = (g, w, color) => {
    g.fillStyle = color; g.fillRect(3, 77, w - 6, 4);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(3, 81, w - 6, 2);
  };

  T.doorGlass = makeTex(64, 128, (g, w, h) => {
    doorPane(g, w, h, 'rgba(120,160,180,.15)');
    pushBar(g, w, '#9aa0a6');
  });

  /* The one leaf that carries the sign. Only one does: the pair used to
     share a mesh, and the right-hand leaf is drawn rotated a half turn, so
     the same sign appeared on both doors and the second came out mirrored.
     That is what "the OPEN sign looks messed up" was. */
  T.doorGlassOpen = makeTex(64, 128, (g, w, h) => {
    doorPane(g, w, h, 'rgba(120,160,180,.15)');
    neonSign(g, 8, 22, 48, 20, 'OPEN', '#ff3a2a', 13);
    pushBar(g, w, '#9aa0a6');
  });

  T.doorLocked = makeTex(64, 128, (g, w, h) => {
    doorPane(g, w, h, 'rgba(90,120,140,.20)');
    pushBar(g, w, '#c9c2ac');
    g.fillStyle = '#ffd447'; g.fillRect(28, 74, 8, 10);        // thrown deadbolt
  });

  T.doorLockedSign = makeTex(64, 128, (g, w, h) => {
    doorPane(g, w, h, 'rgba(90,120,140,.20)');
    neonSign(g, 4, 22, 56, 20, 'CLOSED', '#4fd07a', 11);
    pushBar(g, w, '#c9c2ac');
    g.fillStyle = '#ffd447'; g.fillRect(28, 74, 8, 10);
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

  T.rewindSign = makeTex(64, 32, (g, w, h) => {
    fill(g, '#e8dcb8', w, h);
    g.fillStyle = '#8c1d0e'; g.font = 'bold 9px "Courier New",monospace';
    g.textAlign = 'center';
    g.fillText('PLEASE', w / 2, 12);
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

  /* -------- Stage 4: persistent environmental changes -------- */

  /* The cheap floodlight's pool of light on the asphalt. Drawn additively, so
     black adds nothing and the warm center lifts the dark lot out of the
     murk. A soft radial -- a single sodium wall-pack, not stadium lighting. */
  T.floodGlow = makeTex(64, 64, (g, w, h) => {
    fill(g, '#000000', w, h);
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, '#fff4d6');       // warm, slightly harsh
    gr.addColorStop(0.34, '#d6c08a');
    gr.addColorStop(0.68, '#493f2a');
    gr.addColorStop(1, '#000000');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    noise(g, w, h, 7);
  });

  /* The lens of the fixture itself -- a small emissive plate, warmer and
     dingier than the interior fluorescents so it reads as an add-on. */
  T.floodLens = makeTex(32, 32, (g, w, h) => {
    fill(g, '#3a3324', w, h);
    const gr = g.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
    gr.addColorStop(0, '#fff0c8');
    gr.addColorStop(0.6, '#c9ad70');
    gr.addColorStop(1, '#5a4d30');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#211d13'; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2);
    noise(g, w, h, 8);
  });

  /* The corporate notice that goes up behind the counter after the popcorn
     night: a photocopied line, and a manager's ballpoint underneath it. */
  T.popNotice = makeTex(64, 64, (g, w, h) => {
    fill(g, '#e9e2cd', w, h);            // copier paper, gone slightly cream
    g.fillStyle = 'rgba(206,196,166,0.55)';  // tape at the corners
    g.fillRect(3, 0, 15, 7); g.fillRect(w - 18, 0, 15, 7);
    g.fillStyle = '#1b1812'; g.textAlign = 'center';
    g.font = 'bold 8px "Courier New",monospace';
    g.fillText('EMPLOYEES', w / 2, 15);
    g.fillText('ONLY BEHIND', w / 2, 25);
    g.fillText('THE COUNTER', w / 2, 35);
    g.strokeStyle = '#1b1812'; g.strokeRect(3.5, 5.5, w - 7, h - 10);
    g.fillStyle = '#25438e';             // ballpoint blue, handwritten
    g.font = 'italic 9px "Comic Sans MS","Segoe Script",cursive';
    g.fillText('(yes — the', w / 2, 48);
    g.fillText('popcorn)', w / 2, 58);
    noise(g, w, h, 7);
  });

  /* The newspaper clipping that goes up behind the counter after the first
     arrest (Stage 5). Newsprint, a bold two-line headline and a subhead, and a
     body of gray squiggle nobody is meant to read. It says a man was caught
     and nothing else -- no tape, no detail -- which is the point: it is the
     comfortable version, and a later bulletin makes it a liar. */
  T.arrestClipping = makeTex(64, 64, (g, w, h) => {
    fill(g, '#d9d4c4', w, h);            // aged newsprint
    g.fillStyle = '#8a8578'; g.fillRect(0, 0, w, 8);            // masthead strip
    g.fillStyle = '#141210'; g.textAlign = 'center';
    g.font = 'bold 6px "Times New Roman",Georgia,serif';
    g.fillText('THE DELANEY LEDGER', w / 2, 6);
    g.font = 'bold 9px "Times New Roman",Georgia,serif';
    g.fillText('MAN HELD IN', w / 2, 20);
    g.fillText('LATE ATTACKS', w / 2, 30);
    g.font = 'italic 6px "Times New Roman",Georgia,serif';
    g.fillText("Sheriff: 'we have him'", w / 2, 40);
    // decorative body: two columns of unreadable gray lines
    g.fillStyle = '#5a564c';
    for (let c = 0; c < 2; c++) {
      const x0 = 5 + c * 30;
      for (let i = 0; i < 9; i++) g.fillRect(x0, 45 + i * 2, 24 - (i === 8 ? 10 : 0), 1);
    }
    g.strokeStyle = '#141210'; g.strokeRect(1.5, 9.5, w - 3, h - 11);
    noise(g, w, h, 8);
  });

  /* A butter/grease stain the mop never quite lifted. Transparent apart from
     the blotch, so it blends onto the carpet as a dark patch rather than a
     square. Irregular on purpose -- a real spill is never a clean ellipse. */
  T.greaseStain = makeTex(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#241b0e';
    const blob = (cx, cy, rx, ry, rot) => {
      g.beginPath(); g.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2); g.fill();
    };
    blob(32, 33, 20, 16, 0.3);
    blob(21, 41, 10, 8, 0);
    blob(45, 25, 9, 11, 0.4);
    g.fillStyle = '#181104';             // darker heart
    blob(31, 32, 11, 9, 0.3);
    // a speckled, uneven fringe so the edge is not a clean ellipse
    for (let i = 0; i < 130; i++) {
      const a = R() * Math.PI * 2, rr = 15 + R() * 11;
      g.fillStyle = R() < 0.5 ? '#241b0e' : '#2b210f';
      g.fillRect((32 + Math.cos(a) * rr) | 0, (33 + Math.sin(a) * rr * 0.8) | 0, 2, 2);
    }
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

  /* -------- popcorn cart, built from parts --------
     A red-and-gold concession cart: enamelled base, a glass case with a
     kettle hanging in it, a heap of popped corn, and a lit marquee.     */
  /* ---- the boombox ----
     Black plastic and a lot of silver: two big speaker grilles, a deck in
     the middle and a row of sliders. It has to read from across the store,
     so the grilles are high contrast and the badge is bright. */
  T.boomShell = makeTex(64, 64, (g, w, h) => {
    fill(g, '#1d1e21', w, h);
    g.fillStyle = 'rgba(255,255,255,.09)'; g.fillRect(0, 0, w, 3);
    g.fillStyle = 'rgba(0,0,0,.40)'; g.fillRect(0, h - 5, w, 5);
    g.fillStyle = '#2a2c30'; g.fillRect(3, 6, w - 6, h - 14);
    noise(g, w, h, 5); grime(g, w, h, 0.14);
  });
  T.boomFront = makeTex(64, 64, (g, w, h) => {
    fill(g, '#191a1d', w, h);
    // two speaker grilles
    const grille = (cx) => {
      g.fillStyle = '#0d0e10';
      g.beginPath(); g.arc(cx, 34, 13, 0, 7); g.fill();
      g.strokeStyle = '#4a4d53'; g.lineWidth = 1;
      for (let r = 3; r <= 12; r += 3) { g.beginPath(); g.arc(cx, 34, r, 0, 7); g.stroke(); }
      g.fillStyle = '#5c6068'; g.beginPath(); g.arc(cx, 34, 2.5, 0, 7); g.fill();
    };
    grille(14); grille(50);
    // the deck between them
    g.fillStyle = '#26282c'; g.fillRect(25, 20, 14, 20);
    g.fillStyle = '#0c0d0f'; g.fillRect(27, 23, 10, 11);
    g.fillStyle = '#8a8f98'; g.fillRect(27, 36, 10, 2);
    // sliders and a badge
    g.fillStyle = '#33363b'; g.fillRect(24, 44, 16, 12);
    g.fillStyle = '#9aa0aa';
    for (let i = 0; i < 4; i++) g.fillRect(26 + i * 3.6, 46, 1.6, 8);
    g.fillStyle = '#c9a227'; g.fillRect(22, 6, 20, 5);
    g.fillStyle = '#141518'; g.font = 'bold 5px "Courier New",monospace';
    g.textAlign = 'center'; g.fillText('STEREO', 32, 10.2);
    g.fillStyle = '#d24b2a'; g.fillRect(44, 47, 4, 4);      // the power lamp
    noise(g, w, h, 4); grime(g, w, h, 0.12);
  });
  T.boomTop = makeTex(64, 32, (g, w, h) => {
    fill(g, '#212327', w, h);
    g.fillStyle = '#17181b'; g.fillRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#3c4046';
    for (let i = 0; i < 5; i++) g.fillRect(12 + i * 9, 11, 5, 3);
    noise(g, w, h, 4);
  });

  T.popRed = makeTex(64, 64, (g, w, h) => {           // enamelled panels
    fill(g, '#9e2b1c', w, h);
    g.fillStyle = 'rgba(255,255,255,.10)'; g.fillRect(0, 0, w, 6);
    g.fillStyle = 'rgba(0,0,0,.26)'; g.fillRect(0, h - 7, w, 7);
    g.fillStyle = '#c8a13a';                                    // gold banding
    g.fillRect(0, 8, w, 2); g.fillRect(0, h - 12, w, 2);
    g.fillStyle = 'rgba(255,255,255,.06)';
    g.fillRect(6, 14, w - 12, h - 28);
    noise(g, w, h, 8); grime(g, w, h, 0.2);
  });
  T.popGold = makeTex(64, 16, (g, w, h) => {          // brass posts and trim
    fill(g, '#b98f2c', w, h);
    g.fillStyle = '#e0bd58'; g.fillRect(0, 2, w, 3);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, h - 4, w, 4);
    noise(g, w, h, 9);
  });
  /* Case glazing. F_BLEND is a flat 50% mix of the texel with whatever is
     behind it, so a pale texture fogs the case white and hides the corn.
     Kept dark, it reads as glass: it dims what is behind it and only the
     highlight streaks come up bright.                                    */
  T.popGlass = makeTex(64, 64, (g, w, h) => {
    fill(g, '#141a1e', w, h);
    g.fillStyle = '#4b5a63';
    g.beginPath(); g.moveTo(2, 46); g.lineTo(26, 2); g.lineTo(34, 2); g.lineTo(8, 54); g.fill();
    g.fillStyle = '#2a343a';
    g.beginPath(); g.moveTo(34, 62); g.lineTo(58, 14); g.lineTo(62, 20); g.lineTo(40, 62); g.fill();
    g.fillStyle = '#3a3222'; g.fillRect(0, h - 10, w, 10);        // buttery film at the base
    noise(g, w, h, 6);
  });
  T.popCorn = makeTex(64, 64, (g, w, h) => {          // the heap itself
    fill(g, '#b8a87f', w, h);
    for (let i = 0; i < 240; i++) {
      const x = R.int(w), y = R.int(h), r = 2 + R.int(3);
      g.fillStyle = ['#d6c9a4', '#c2b184', '#a89668', '#e4d8b4'][R.int(4)];
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    g.fillStyle = 'rgba(190,150,60,.22)'; g.fillRect(0, h - 18, w, 18);
    noise(g, w, h, 10);
  });
  T.popKettle = makeTex(64, 64, (g, w, h) => {        // the kettle slung under the lamp
    fill(g, '#33302b', w, h);
    g.fillStyle = '#4a463e'; g.fillRect(0, 4, w, 10);
    g.fillStyle = '#1d1b18'; g.fillRect(4, 18, w - 8, h - 26);
    g.fillStyle = 'rgba(255,255,255,.10)'; g.fillRect(6, 20, 3, h - 30);
    noise(g, w, h, 8); grime(g, w, h, 0.3);
  });
  T.popSign = makeTex(64, 32, (g, w, h) => {          // the lit marquee across the top
    fill(g, '#f2e4c0', w, h);
    g.fillStyle = '#9e2b1c'; g.fillRect(0, 0, w, 4); g.fillRect(0, h - 4, w, 4);
    g.fillStyle = '#9e2b1c'; g.font = 'bold 11px "Courier New",monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('POPCORN', w / 2, h / 2 + 1);
    g.fillStyle = '#c8a13a';
    for (let x = 3; x < w; x += 7) { g.fillRect(x, 5, 2, 2); g.fillRect(x, h - 7, 2, 2); }
    noise(g, w, h, 6);
  });
  T.popcorn = T.popRed;

  /* -------- what ends up on the carpet -------- */
  /* Loose corn, seen from above and from the side. Lighter and drier than
     the heap in the case, because it has been on the floor and trodden
     round, and with the carpet showing through the gaps. */
  /* Loose kernels on the carpet: individual popped corn, not a drift.
     Each one is drawn as a real piece -- a lumpy cluster of three or four
     lobes with a shadow under it and a pale highlight on top -- because at
     this resolution a field of soft blobs read as spilled porridge. */
  T.popSpill = makeTex(64, 64, (g, w, h) => {
    fill(g, '#1d3a3c', w, h);                          // the carpet under it
    const kernel = (x, y, r, a) => {
      // the shadow it sits in
      g.fillStyle = 'rgba(0,0,0,.34)';
      g.beginPath(); g.ellipse(x + 0.6, y + r * 0.7, r * 1.05, r * 0.55, 0, 0, 7); g.fill();
      // three or four lobes, which is what a popped kernel actually is
      const lobes = 3 + R.int(2);
      g.fillStyle = ['#e8dcb8', '#ded0a6', '#f2e8cc'][R.int(3)];
      g.beginPath();
      for (let i = 0; i < lobes; i++) {
        const t = a + (i / lobes) * 6.283;
        g.moveTo(x, y);
        g.arc(x + Math.cos(t) * r * 0.52, y + Math.sin(t) * r * 0.52, r * 0.62, 0, 7);
      }
      g.fill();
      // the crease, and the light on the top of it
      g.fillStyle = 'rgba(150,120,70,.40)';
      g.beginPath(); g.arc(x + r * 0.15, y + r * 0.20, r * 0.30, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,252,235,.75)';
      g.beginPath(); g.arc(x - r * 0.34, y - r * 0.38, r * 0.26, 0, 7); g.fill();
    };
    /* Scattered, and wrapped round the edges so tiling never shows a seam
       or a bald strip down the join. */
    for (let i = 0; i < 26; i++) {
      const x = R.int(w), y = R.int(h), r = 4 + R.int(3), a = R() * 6.283;
      kernel(x, y, r, a);
      if (x < r * 2) kernel(x + w, y, r, a);
      if (x > w - r * 2) kernel(x - w, y, r, a);
      if (y < r * 2) kernel(x, y + h, r, a);
      if (y > h - r * 2) kernel(x, y - h, r, a);
    }
    // a few unpopped ones, because he emptied the whole tub in
    for (let i = 0; i < 10; i++) {
      g.fillStyle = '#8a6a34';
      g.beginPath(); g.arc(R.int(w), R.int(h), 1.6, 0, 7); g.fill();
    }
    noise(g, w, h, 8);
  });

  /* The stuff in the air, coming over the front of the case. Mostly
     transparent, so it reads as a burst rather than a wall. */
  T.popBurst = makeTex(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 34; i++) {
      const x = R.int(w), y = R.int(h), r = 3 + R.int(3);
      g.fillStyle = ['#f0e6c6', '#ded0a6', '#fbf4de'][R.int(3)];
      g.beginPath();
      g.arc(x, y, r * 0.62, 0, 7);
      g.arc(x + r * 0.5, y - r * 0.4, r * 0.5, 0, 7);
      g.arc(x - r * 0.45, y + r * 0.3, r * 0.44, 0, 7);
      g.fill();
    }
  });

  /* -------- a pizza box from Bertucci's -------- */
  T.pizzaTop = makeTex(64, 64, (g, w, h) => {
    fill(g, '#c8a878', w, h);                          // corrugated card
    // the printed panel: a wobbly circle and the name, badly registered
    g.strokeStyle = '#8c1d0e'; g.lineWidth = 2;
    g.beginPath(); g.arc(w / 2, h / 2 - 4, 17, 0, 7); g.stroke();
    g.fillStyle = '#8c1d0e';
    g.font = 'bold 9px "Courier New",monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('BERTUCCI', w / 2, h / 2 - 6);
    g.font = 'bold 6px "Courier New",monospace';
    g.fillText('PIZZA', w / 2, h / 2 + 4);
    // score lines where the lid folds, and a grease shadow
    g.strokeStyle = 'rgba(90,70,40,.35)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, 6); g.lineTo(w, 6); g.moveTo(0, h - 6); g.lineTo(w, h - 6); g.stroke();
    g.fillStyle = 'rgba(150,110,40,.16)';
    g.beginPath(); g.ellipse(w * 0.34, h * 0.72, 11, 7, 0.4, 0, 7); g.fill();
    noise(g, w, h, 8); grime(g, w, h, 0.22);
  });
  T.pizzaSide = makeTex(64, 64, (g, w, h) => {
    fill(g, '#bb9a6a', w, h);
    // the fluting you see on the cut edge of corrugated card
    g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1;
    for (let x = 1; x < w; x += 3) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    g.fillStyle = 'rgba(0,0,0,.20)'; g.fillRect(0, h - 5, w, 5);
    noise(g, w, h, 7); grime(g, w, h, 0.3);
  });

  /* -------- the vacuum from the back room -------- */
  T.vacBody = makeTex(64, 64, (g, w, h) => {
    fill(g, '#7a2418', w, h);                          // scuffed red enamel
    g.fillStyle = '#5e1a11'; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 9, w, 9);
    g.fillStyle = 'rgba(255,255,255,.09)'; g.fillRect(5, 10, 4, h - 26);
    g.fillStyle = '#c8a13a'; g.font = 'bold 8px "Courier New",monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('HOOVR', w / 2, h / 2);
    noise(g, w, h, 9); grime(g, w, h, 0.45);
  });
  T.vacBag = makeTex(64, 64, (g, w, h) => {
    fill(g, '#8d8674', w, h);                          // gray cloth bag
    g.strokeStyle = 'rgba(0,0,0,.16)'; g.lineWidth = 1;
    for (let y = 4; y < h; y += 7) {                   // sagging horizontal folds
      g.beginPath();
      g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + 3, w * 0.7, y - 2, w, y + 1);
      g.stroke();
    }
    noise(g, w, h, 11); grime(g, w, h, 0.5);
  });
  T.vacMetal = makeTex(64, 64, (g, w, h) => {
    fill(g, '#5a5c60', w, h);
    g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(0, 6, w, 3);
    g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(0, h - 8, w, 4);
    noise(g, w, h, 7); grime(g, w, h, 0.3);
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

  /* -------- the ceiling-hung security monitor -------- */
  T.tvBezel = makeTex(64, 64, (g, w, h) => {          // moulded front bezel
    fill(g, '#33302a', w, h);
    g.fillStyle = '#26241f'; g.fillRect(3, 3, w - 6, h - 6);
    g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(3, 3, w - 6, 2);
    g.fillStyle = '#8a8474'; g.font = '5px "Courier New",monospace';
    g.textAlign = 'left'; g.fillText('MAGNAVOX', 5, h - 4);
    g.fillStyle = '#c02020'; g.fillRect(w - 9, h - 8, 3, 3);   // power lamp
    noise(g, w, h, 8); grime(g, w, h, 0.2);
  });
  T.tvVent = makeTex(64, 64, (g, w, h) => {           // louvred back shell
    fill(g, '#2b2924', w, h);
    g.fillStyle = '#1a1815';
    for (let y = 6; y < h - 6; y += 6) g.fillRect(6, y, w - 12, 3);
    g.fillStyle = 'rgba(255,255,255,.04)';
    for (let y = 6; y < h - 6; y += 6) g.fillRect(6, y - 1, w - 12, 1);
    noise(g, w, h, 9); grime(g, w, h, 0.3);
  });
  T.tvBracket = makeTex(32, 32, (g, w, h) => {        // painted steel arm
    fill(g, '#3e3c37', w, h);
    g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(0, 0, w, 3);
    g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(0, h - 4, w, 4);
    noise(g, w, h, 8);
  });

  /* -------- the back room -------- */
  T.storeWall = makeTex(64, 64, (g, w, h) => {        // painted breeze block
    fill(g, '#6f6a5e', w, h);
    g.strokeStyle = 'rgba(40,36,30,.55)'; g.lineWidth = 1;
    for (let y = 0; y <= h; y += 16) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(w, y + 0.5); g.stroke(); }
    for (let y = 0; y < h; y += 16) {
      const off = (y / 16) % 2 ? 0 : 16;
      for (let x = off; x <= w; x += 32) { g.beginPath(); g.moveTo(x + 0.5, y); g.lineTo(x + 0.5, y + 16); g.stroke(); }
    }
    noise(g, w, h, 13); grime(g, w, h, 0.28);
  });
  T.storeFloor = makeTex(64, 64, (g, w, h) => {       // sealed concrete
    fill(g, '#3e3b36', w, h);
    speckle(g, w, h, 800, ['#474440', '#33302c', '#4a4640']);
    g.strokeStyle = 'rgba(20,18,16,.5)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, 20.5); g.lineTo(w, 26.5); g.stroke();
    noise(g, w, h, 12); grime(g, w, h, 0.34);
  });
  T.steelDoor = makeTex(64, 64, (g, w, h) => {        // hollow-metal back-room door
    fill(g, '#55606a', w, h);
    g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(0, 0, w, 4);
    g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(0, h - 5, w, 5);
    g.strokeStyle = 'rgba(20,26,32,.6)'; g.lineWidth = 2;
    g.strokeRect(7.5, 6.5, w - 15, 22); g.strokeRect(7.5, 34.5, w - 15, 22);   // pressed panels
    g.fillStyle = '#c9c2ac'; g.font = 'bold 6px "Courier New",monospace';
    g.textAlign = 'center'; g.fillText('STAFF ONLY', w / 2, 33);
    noise(g, w, h, 10); grime(g, w, h, 0.26);
  });
  T.steelDoorHit = makeTex(64, 64, (g, w, h) => {     // the same door, worked on
    fill(g, '#55606a', w, h);
    g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(0, h - 5, w, 5);
    g.strokeStyle = 'rgba(20,26,32,.6)'; g.lineWidth = 2;
    g.strokeRect(7.5, 6.5, w - 15, 22); g.strokeRect(7.5, 34.5, w - 15, 22);
    // buckled metal around the strike
    g.fillStyle = 'rgba(18,22,28,.55)';
    for (let i = 0; i < 9; i++) {
      const x = 34 + R.int(24), y = 20 + R.int(28);
      g.beginPath(); g.ellipse(x, y, 3 + R.int(6), 2 + R.int(4), R(), 0, 7); g.fill();
    }
    g.strokeStyle = 'rgba(230,235,240,.35)'; g.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      g.beginPath(); g.moveTo(38 + R.int(18), 22 + R.int(24));
      g.lineTo(38 + R.int(18), 22 + R.int(24)); g.stroke();
    }
    noise(g, w, h, 12); grime(g, w, h, 0.3);
  });
  T.cardboard = makeTex(64, 64, (g, w, h) => {        // stock cartons
    fill(g, '#9c7d52', w, h);
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, h / 2 - 1, w, 2);
    g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(0, 0, w, 3);
    g.fillStyle = '#6d5636'; g.font = 'bold 7px "Courier New",monospace';
    g.textAlign = 'center'; g.fillText('SUNSET', w / 2, 20);
    g.font = '5px "Courier New",monospace'; g.fillText('RETURNS', w / 2, 28);
    g.strokeStyle = 'rgba(60,44,26,.5)'; g.strokeRect(1.5, 1.5, w - 3, h - 3);
    noise(g, w, h, 11); grime(g, w, h, 0.22);
  });
  T.steelShelf = makeTex(64, 64, (g, w, h) => {       // gray utility racking
    fill(g, '#54514a', w, h);
    g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(0, 0, w, 3);
    g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(0, h - 4, w, 4);
    noise(g, w, h, 10); grime(g, w, h, 0.3);
  });
  T.bareBulb = makeTex(16, 16, (g, w, h) => {
    fill(g, '#ffeec2', w, h);
    g.fillStyle = '#fff8e0'; g.beginPath(); g.arc(8, 8, 5, 0, 7); g.fill();
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

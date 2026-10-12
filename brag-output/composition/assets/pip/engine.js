// Pip, the AI Room guide. Ported from yc 01/web/app/mascot (engine.ts + animations.ts):
// a pose is laid out on a 32x32 grid and every pixel is drawn as a tiny cube.
(() => {
  if (globalThis.PipEngine) return;
/**
 * Pip's renderer. A pose (body squash, eyes, mouth, arms, feet, antenna, particles) is
 * assembled onto a 32×32 pixel grid, then every pixel is drawn as a tiny 3D cube in the
 * same material as the site's voxel buttons.
 */

const GRID = 32;
const GROUND = 30; // bottom row the feet stand on

/** [top, front, side] faces of a cube */

const M = {
  body: ["#e6a0ac", "#c9697a", "#9a4a5b"],
  bodyShade: ["#cf8392", "#b45869", "#86404f"],
  cream: ["#fffafa", "#f6e4e7", "#d9bcc2"],
  ink: ["#5a5852", "#2e2d2a", "#1c1b19"],
  blush: ["#ffd0d6", "#f2a3b0", "#cf7f8d"],
  belly: ["#f6d3d8", "#eab3bc", "#c98f9a"],
  gold: ["#fff3bd", "#f2cf63", "#c9a43c"],
  heart: ["#ffc2cb", "#e2687c", "#b24b5f"],
  sky: ["#e2f2fb", "#9fcbe6", "#6f9fbf"],
  leaf: ["#d8efc4", "#9cc97c", "#6f9c55"],
  dim: ["#b9b5ac", "#8f8c84", "#6c6a64"],
}                                            ;

const BASE       = {
  dx: 0, dy: 0, squash: 0, tilt: 0, eyes: "open", lookX: 0, lookY: 0, mouth: "smile",
  armL: "down", armR: "down", feet: 0, sway: 0, bulb: "idle", blush: false, glasses: false, particles: [],
};

function put(g      , x        , y        , m          ) {
  x = Math.round(x);
  y = Math.round(y);
  if (x >= 0 && y >= 0 && x < GRID && y < GRID) g[y][x] = m;
}
function stamp(g      , x        , y        , rows          , m          ) {
  rows.forEach((r, j) => [...r].forEach((c, i) => c === "#" && put(g, x + i, y + j, m)));
}

const SPRITES                                                              = {
  heart: { rows: ["#.#", "###", ".#."], m: "heart" },
  sparkle: { rows: [".#.", "###", ".#."], m: "gold" },
  star: { rows: ["..#..", ".###.", "#####", ".#.#."], m: "gold" },
  z: { rows: ["###", ".#.", "###"], m: "dim" },
  note: { rows: [".##", ".#.", ".#.", "##."], m: "ink" },
  tear: { rows: ["#", "#"], m: "sky" },
  sweat: { rows: [".#", "##"], m: "sky" },
  bang: { rows: ["#", "#", "#", ".", "#"], m: "heart" },
  q: { rows: ["##.", "..#", ".#.", "...", ".#."], m: "ink" },
  confetti: { rows: ["#"], m: "gold" },
  arrow: { rows: ["..#.", "####", "..#."], m: "ink" },
  book: { rows: ["#####", "#.#.#", "#####"], m: "leaf" },
  popcorn: { rows: [".#.", "###", "#.#"], m: "cream" },
  plus: { rows: [".#.", "###", ".#."], m: "leaf" },
};

/** Lay a pose out on the pixel grid. */
function compose(p      )       {
  const g       = Array.from({ length: GRID }, () => Array(GRID).fill(null));
  const cx = 16 + p.dx;
  const bw = 16 + p.squash * 2;
  const bh = 14 - p.squash;
  const footH = 2;
  const bottom = GROUND - footH + p.dy; // last body row
  const top = bottom - bh + 1;
  const x0 = Math.round(cx - bw / 2);
  const x1 = x0 + bw - 1;
  const r = 3;

  // feet first, so the body sits on them
  const feetY = Math.min(GROUND - 1, bottom + 1);
  const footUp = (side        ) => (p.feet === side ? 1 : 0);
  stamp(g, cx - 6, feetY - footUp(-1), ["###", "###"], M.bodyShade);
  stamp(g, cx + 3, feetY - footUp(1), ["###", "###"], M.bodyShade);

  // body: a rounded block, shaded on its lower rows
  for (let y = top; y <= bottom; y++)
    for (let x = x0; x <= x1; x++) {
      const dxC = x < x0 + r ? x0 + r - x : x > x1 - r ? x - (x1 - r) : 0;
      const dyC = y < top + r ? top + r - y : y > bottom - r ? y - (bottom - r) : 0;
      if (dxC * dxC + dyC * dyC > r * r + 1) continue;
      put(g, x, y, y > bottom - 2 ? M.bodyShade : M.body);
    }

  // belly: a small cream oval low on the body
  const by = bottom - 2, brx = bw * 0.22, bry = 1.6;
  for (let y = bottom - 5; y <= bottom; y++)
    for (let x = cx - 6; x <= cx + 6; x++)
      if (((x - cx + 0.5) / brx) ** 2 + ((y - by) / bry) ** 2 <= 1 && y <= bottom - 1) put(g, x, y, M.belly);

  // arms
  const armY = top + Math.round(bh * 0.45);
  const arm = (side        , a     ) => {
    const ax = side === -1 ? x0 - 2 : x1 + 1;
    const out = side === -1 ? -1 : 1;
    switch (a) {
      case "down": stamp(g, ax, armY, ["##", "##", "##"], M.body); break;
      case "up": // raised, joined to the shoulder
        stamp(g, side === -1 ? ax - 1 : ax, armY - 4, side === -1 ? ["##.", "##.", ".##", ".##", ".##"] : [".##", ".##", "##.", "##.", "##."], M.body);
        break;
      case "out": stamp(g, side === -1 ? ax - 2 : ax, armY, ["####", "####"], M.body); break;
      case "wave": // raised and flung outward
        stamp(g, side === -1 ? ax - 2 : ax, armY - 4, side === -1 ? ["##..", "##..", ".##.", "..##", "...#"] : ["..##", "..##", ".##.", "##..", "#..."], M.body);
        break;
      case "hip": stamp(g, side === -1 ? ax : ax, armY + 1, ["#.", "##"], M.body); break;
      case "point": stamp(g, side === -1 ? ax - 4 : ax, armY, ["######", "######"], M.body); break;
      case "hold": stamp(g, side === -1 ? ax + 1 : ax - 1, armY + 2, ["##", "##"], M.body); break;
    }
  };
  arm(-1, p.armL);
  arm(1, p.armR);

  // face: solid ink eyes with a catch-light, pink cheeks, a tiny mouth
  const ft = Math.round(p.tilt);
  const ey = top + 4;
  const eL = cx - 5 + ft, eR = cx + 3 + ft; // eyes are 2 wide; a 3-wide expression starts one left
  const lx = Math.max(-1, Math.min(1, Math.round(p.lookX)));
  const ly = Math.max(-1, Math.min(1, Math.round(p.lookY)));
  const eye = (ex        ) => {
    switch (p.eyes) {
      case "open":
        stamp(g, ex + lx, ey + ly, ["##", "##", "##"], M.ink);
        put(g, ex + lx, ey + ly, M.cream); // catch-light
        break;
      case "focus":
        stamp(g, ex + lx, ey + 1 + ly, ["##", "##"], M.ink);
        break;
      case "wide":
        stamp(g, ex - 1 + Math.max(0, lx), ey - 1, ["###", "###", "###", "###"], M.ink);
        put(g, ex - 1 + Math.max(0, lx), ey - 1, M.cream);
        put(g, ex + Math.max(0, lx), ey, M.cream);
        break;
      case "sad":
        stamp(g, ex, ey + 1, ["##", "##"], M.ink);
        put(g, ex, ey + 1, M.cream);
        stamp(g, ex - 1, ey - 1, ex < cx ? ["..#", "##."] : ["#..", ".##"], M.ink);
        break;
      case "blink": stamp(g, ex - 1, ey + 1, ["###"], M.ink); break;
      case "closed": stamp(g, ex - 1, ey + 1, ["#.#", ".#."], M.ink); break;
      case "happy": stamp(g, ex - 1, ey, [".#.", "#.#"], M.ink); break;
      case "heart": stamp(g, ex - 1, ey - 1, ["#.#", "###", "###", ".#."], M.heart); break;
      case "star": stamp(g, ex - 1, ey - 1, [".#.", "###", ".#."], M.gold); break;
      case "x": stamp(g, ex - 1, ey, ["#.#", ".#.", "#.#"], M.ink); break;
    }
  };
  if (p.glasses) {
    stamp(g, eL - 2, ey - 2, ["######", "#....#", "#....#", "#....#", "#....#", "######"], M.ink);
    stamp(g, eR - 2, ey - 2, ["######", "#....#", "#....#", "#....#", "#....#", "######"], M.ink);
    for (let x = eL + 4; x < eR - 2; x++) put(g, x, ey - 1, M.ink); // bridge
  }
  eye(eL);
  eye(eR);
  // cheeks: always a little pink, brighter when flustered
  stamp(g, eL - 3, ey + 3, ["##"], p.blush ? M.heart : M.blush);
  stamp(g, eR + 3, ey + 3, ["##"], p.blush ? M.heart : M.blush);
  const my = ey + 3, mx = cx - 2 + ft;
  const mouths                          = {
    smile: ["#..#", ".##."],
    open: [".##.", ".##."],
    grin: ["####", ".##."],
    flat: ["....", ".##."],
    sad: ["..#.", ".#.#"],
    o: [".#.", "#.#", ".#."],
    tongue: ["####", ".#.."],
    none: [],
  };
  stamp(g, p.mouth === "o" ? mx + 1 : mx, my, mouths[p.mouth], M.ink);
  if (p.mouth === "grin") stamp(g, mx + 1, my + 1, ["##"], M.heart);
  if (p.mouth === "open") stamp(g, mx + 1, my + 1, ["##"], M.heart);
  if (p.mouth === "tongue") put(g, mx + 1, my + 1, M.heart);

  // antenna: a stalk with a glowing node
  const ax = cx + ft;
  const sw = Math.round(p.sway);
  put(g, ax, top - 1, M.bodyShade);
  put(g, ax + Math.round(sw / 2), top - 2, M.bodyShade);
  put(g, ax + sw, top - 3, M.bodyShade);
  const bulb = { idle: M.cream, idea: M.gold, love: M.heart, off: M.dim, spark: M.gold }[p.bulb];
  if (p.bulb === "love") stamp(g, ax + sw - 1, top - 6, ["#.#", "###", ".#."], M.heart);
  else stamp(g, ax + sw, top - 5, ["##", "##"], bulb);
  if (p.bulb === "spark") stamp(g, ax + sw - 2, top - 8, ["#..#", "....", "#..#"], M.gold);

  // particles on top
  for (const q of p.particles) {
    const s = SPRITES[q.kind];
    stamp(g, q.x, q.y, s.rows, M[q.m ?? s.m]);
  }
  return g;
}

const DEPTH = 0.55;
const SEAM = 0.14;

/** Draw a composed grid as cubes. `px` is the cube size in canvas pixels. */
function paint(ctx                          , g      , px        ) {
  const d = px * DEPTH;
  const s = px - px * SEAM;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (let y = GRID - 1; y >= 0; y--)
    for (let x = 0; x < GRID; x++) {
      const m = g[y][x];
      if (!m) continue;
      const [top, front, side] = m;
      const fx = x * px, fy = y * px + d;
      ctx.fillStyle = top;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + d, fy - d);
      ctx.lineTo(fx + s + d, fy - d);
      ctx.lineTo(fx + s, fy);
      ctx.fill();
      ctx.fillStyle = side;
      ctx.beginPath();
      ctx.moveTo(fx + s, fy);
      ctx.lineTo(fx + s + d, fy - d);
      ctx.lineTo(fx + s + d, fy + s - d);
      ctx.lineTo(fx + s, fy + s);
      ctx.fill();
      ctx.fillStyle = front;
      ctx.fillRect(fx, fy, s, s);
    }
}


/**
 * Every animation is a function of time (seconds since it started) returning a pose.
 * `duration` marks one-shots; loops leave it out.
 */

const pose = (p               )       => ({ ...BASE, ...p });
const step = (t        , fps        , n        ) => Math.floor(t * fps) % n;
const ping = (t        , period        ) => Math.sin((t / period) * Math.PI * 2);
/** A parabola-shaped hop: 0 → -h → 0 over `len` seconds starting at `at`. */
const hop = (t        , at        , len        , h        ) => {
  const u = (t - at) / len;
  return u < 0 || u > 1 ? 0 : -Math.round(4 * h * u * (1 - u));
};
const rand = (seed        , i        ) => {
  const x = Math.sin(seed * 9301 + i * 49297) * 233280;
  return x - Math.floor(x);
};

/** Shared idle life: breathing, blinking every few seconds, antenna drift. */
function alive(t        , seed = 1)                {
  const blinkAt = (t + rand(seed, 1) * 3) % 3.4;
  return {
    dy: ping(t, 1.6) > 0.6 ? -1 : 0,
    squash: ping(t, 1.6) < -0.7 ? 1 : 0,
    eyes: blinkAt < 0.12 ? "blink" : "open",
    sway: Math.round(ping(t, 2.4) * 1.4),
  };
}

/** Particles rising and fading from a point. */
function rise(t        , kind                  , n        , x        , y        , seed        , speed = 6, period = 1.6)             {
  const out             = [];
  for (let i = 0; i < n; i++) {
    const u = ((t + (i * period) / n) % period) / period;
    out.push({ kind, x: x + Math.round(ping(u + i, 1) * 2) + Math.round((rand(seed, i) - 0.5) * 6), y: y - Math.round(u * speed * period * 2) });
  }
  return out;
}

/** A confetti burst: pieces fly out and fall. */
function confetti(t        , seed        , n = 18)             {
  const colors = ["gold", "heart", "sky", "leaf", "cream"]         ;
  return Array.from({ length: n }, (_, i) => {
    const a = rand(seed, i) * Math.PI * 2;
    const v = 6 + rand(seed, i + 50) * 8;
    return {
      kind: "confetti"         ,
      m: colors[i % colors.length],
      x: 16 + Math.cos(a) * v * t * 1.6,
      y: 12 + Math.sin(a) * v * t * 1.2 - 4 * t + 14 * t * t,
    };
  }).filter((p) => p.y < 32);
}

const ANIMS                       = {
  idle: {
    label: "idle",
    frame: (t, s) => {
      const look = step(t, 0.25, 4);
      return pose({ ...alive(t, s), lookX: [0, 0, -1, 1][look] });
    },
  },
  wave: {
    label: "wave",
    duration: 2.4,
    frame: (t) => pose({ ...alive(t), armR: step(t, 4, 2) ? "wave" : "up", eyes: "happy", mouth: "grin", blush: true, tilt: 0 }),
  },
  hello: {
    label: "hello",
    duration: 3,
    frame: (t) => ({
      ...pose({ ...alive(t), armR: step(t, 4, 2) ? "wave" : "up", mouth: t % 0.5 < 0.25 ? "open" : "smile", dy: hop(t, 0, 0.5, 3) }),
      particles: t < 1.2 ? [{ kind: "bang", x: 24, y: 4 + Math.round(t * 2), m: "gold" }] : [],
    }),
  },
  jump: {
    label: "jump",
    duration: 1.1,
    frame: (t) => {
      const dy = hop(t, 0.15, 0.7, 7);
      const squash = t < 0.15 ? 2 : t > 0.85 && t < 1 ? 2 : dy < -3 ? -2 : 0;
      return pose({ dy, squash, eyes: "happy", mouth: "grin", armL: dy < -2 ? "up" : "down", armR: dy < -2 ? "up" : "down" });
    },
  },
  cheer: {
    label: "cheer",
    duration: 2.4,
    frame: (t, s) =>
      pose({
        dy: hop(t % 0.8, 0.1, 0.55, 5),
        squash: t % 0.8 < 0.1 ? 2 : 0,
        eyes: "happy",
        mouth: "grin",
        armL: "up",
        armR: "up",
        blush: true,
        bulb: "spark",
        particles: rise(t, "sparkle", 4, 15, 10, s, 5, 1.2),
      }),
  },
  love: {
    label: "love",
    duration: 2.8,
    frame: (t, s) =>
      pose({
        ...alive(t),
        eyes: "heart",
        mouth: "smile",
        blush: true,
        bulb: "love",
        armL: "hold",
        armR: "hold",
        tilt: Math.round(ping(t, 1.4)),
        particles: rise(t, "heart", 3, 15, 8, s, 4, 1.4),
      }),
  },
  dance: {
    label: "dance",
    frame: (t, s) => {
      const beat = step(t, 4, 4);
      return pose({
        dx: [-1, 0, 1, 0][beat],
        dy: beat % 2 ? -1 : 0,
        tilt: [-1, 0, 1, 0][beat],
        feet: beat % 2 ? (beat === 1 ? -1 : 1) : 0,
        armL: beat < 2 ? "up" : "out",
        armR: beat < 2 ? "out" : "up",
        eyes: "happy",
        mouth: beat % 2 ? "open" : "grin",
        sway: [-2, 0, 2, 0][beat],
        particles: rise(t, "note", 2, 24, 10, s, 4, 1.6),
      });
    },
  },
  celebrate: {
    label: "celebrate",
    duration: 3,
    frame: (t, s) => {
      const dy = hop(t, 0.1, 0.8, 8) + hop(t, 1.1, 0.6, 4);
      return pose({
        dy,
        squash: (t < 0.1 || (t > 0.9 && t < 1.05)) ? 2 : dy < -4 ? -2 : 0,
        eyes: "star",
        mouth: "grin",
        armL: "up",
        armR: "up",
        blush: true,
        bulb: "spark",
        particles: [...confetti(t, s), ...(t > 1.6 ? rise(t, "star", 2, 14, 8, s, 3, 1.4) : [])],
      });
    },
  },
  sleep: {
    label: "sleep",
    frame: (t, s) =>
      pose({
        dy: 1,
        squash: ping(t, 3) > 0 ? 2 : 1,
        eyes: "closed",
        mouth: ping(t, 3) > 0 ? "o" : "flat",
        bulb: "off",
        sway: 2,
        tilt: 1,
        particles: rise(t, "z", 2, 23, 9, s, 2.5, 2.4),
      }),
  },
  think: {
    label: "think",
    frame: (t, s) =>
      pose({
        ...alive(t, s),
        eyes: alive(t, s).eyes === "blink" ? "blink" : "open",
        lookX: 1,
        lookY: -1,
        mouth: "flat",
        armR: "hold",
        tilt: 1,
        sway: 1,
        particles: t % 2.4 < 1.6 ? [{ kind: "q", x: 24, y: 3 + (step(t, 2, 2) ? 0 : 1) }] : [],
      }),
  },
  idea: {
    label: "idea",
    duration: 2.2,
    frame: (t) =>
      pose({
        dy: hop(t, 0.3, 0.5, 4),
        eyes: t < 0.3 ? "open" : "wide",
        lookY: -1,
        mouth: t < 0.3 ? "flat" : "o",
        armR: t < 0.3 ? "down" : "up",
        bulb: t < 0.3 ? "idle" : "spark",
        particles: t > 0.3 ? [{ kind: "bang", x: 23, y: 2 }] : [],
      }),
  },
  surprised: {
    label: "surprised",
    duration: 1.4,
    frame: (t) =>
      pose({
        dy: hop(t, 0, 0.4, 4),
        squash: t < 0.4 ? -2 : 0,
        eyes: "wide",
        mouth: "o",
        armL: "out",
        armR: "out",
        particles: t < 1 ? [{ kind: "bang", x: 24, y: 3 }, { kind: "sweat", x: 6, y: 8 }] : [],
      }),
  },
  sad: {
    label: "sad",
    frame: (t) =>
      pose({
        dy: 1,
        squash: 1,
        eyes: "sad",
        lookY: 1,
        mouth: "sad",
        bulb: "off",
        sway: 2,
        tilt: -1,
        particles: [{ kind: "tear", x: 10, y: 15 + Math.floor((t * 6) % 8) }],
      }),
  },
  read: {
    label: "read",
    frame: (t) => {
      const scan = step(t, 1.5, 4);
      return pose({
        ...alive(t),
        eyes: "focus",
        glasses: true,
        lookX: [-1, 0, 1, 1][scan],
        lookY: 1,
        mouth: "flat",
        armL: "hold",
        armR: "hold",
        particles: [{ kind: "book", x: 13, y: 23 }],
      });
    },
  },
  watch: {
    label: "watch",
    frame: (t, s) => {
      const munch = step(t, 3, 6);
      return pose({
        ...alive(t, s),
        eyes: alive(t, s).eyes === "blink" ? "blink" : "focus",
        lookX: 1,
        mouth: munch < 2 ? "o" : "smile",
        armR: munch < 2 ? "up" : "hold",
        armL: "hold",
        particles: [{ kind: "popcorn", x: 7, y: 21 }, ...(munch < 2 ? [{ kind: "popcorn"         , x: 21, y: 9 }] : [])],
      });
    },
  },
  walk: {
    label: "walk",
    frame: (t) => {
      const s4 = step(t, 6, 4);
      return pose({
        ...alive(t),
        dx: Math.round(ping(t, 4) * 5),
        dy: s4 % 2 ? -1 : 0,
        feet: s4 === 1 ? -1 : s4 === 3 ? 1 : 0,
        armL: s4 < 2 ? "out" : "down",
        armR: s4 < 2 ? "down" : "out",
        lookX: ping(t, 4) > 0 ? 1 : -1,
      });
    },
  },
  dizzy: {
    label: "dizzy",
    duration: 2.6,
    frame: (t) => {
      const a = t * 6;
      return pose({
        dx: Math.round(ping(t, 0.8)),
        tilt: Math.round(ping(t, 0.8)),
        eyes: "x",
        mouth: "tongue",
        sway: Math.round(ping(t, 0.4) * 2),
        particles: [0, 1, 2].map((i) => ({ kind: "sparkle"         , x: 15 + Math.round(Math.cos(a + i * 2.1) * 9), y: 6 + Math.round(Math.sin(a + i * 2.1) * 2) })),
      });
    },
  },
  nod: {
    label: "nod",
    duration: 1.2,
    frame: (t) => pose({ ...alive(t), dy: step(t, 6, 2) ? 1 : 0, lookY: step(t, 6, 2) ? 1 : 0, eyes: "happy", mouth: "smile", particles: [{ kind: "plus", x: 24, y: 6 }] }),
  },
  shake: {
    label: "shake",
    duration: 1.2,
    frame: (t) => pose({ ...alive(t), tilt: [-1, 1][step(t, 6, 2)], lookX: [-1, 1][step(t, 6, 2)], mouth: "flat", eyes: "open" }),
  },
  point: {
    label: "point",
    duration: 2.4,
    frame: (t) =>
      pose({
        ...alive(t),
        armR: "point",
        lookX: 1,
        tilt: 1,
        mouth: "open",
        eyes: "open",
        particles: [{ kind: "arrow", x: 27 + step(t, 3, 2), y: 17, m: "heart" }],
      }),
  },
  levelup: {
    label: "level up",
    duration: 3.2,
    frame: (t, s) => {
      const spin = step(t, 8, 4);
      const up = t < 1.2;
      return pose({
        dy: up ? -Math.round(t * 5) : Math.min(0, -6 + Math.round((t - 1.2) * 12)),
        tilt: up ? [-1, 0, 1, 0][spin] : 0,
        eyes: up ? "closed" : "star",
        mouth: "grin",
        armL: "up",
        armR: "up",
        bulb: "spark",
        blush: true,
        particles: [...rise(t, "star", 3, 14, 18, s, 6, 1), ...(t > 1.2 ? confetti(t - 1.2, s, 14) : [])],
      });
    },
  },
};

// Locomotion and handling, used by the companion as it moves around the screen.
// Like every pose here they face right; the companion mirrors them to face left.
Object.assign(ANIMS, {
  stroll: {
    label: "stroll",
    frame: (t        ) => {
      const s4 = step(t, 8, 4);
      return pose({
        ...alive(t),
        dy: s4 % 2 ? -1 : 0,
        squash: 0,
        feet: s4 === 1 ? -1 : s4 === 3 ? 1 : 0,
        armL: s4 < 2 ? "out" : "down",
        armR: s4 < 2 ? "down" : "out",
        lookX: 1,
        sway: s4 < 2 ? -1 : 1,
      });
    },
  },
  held: {
    label: "held",
    frame: (t        ) => {
      const k = step(t, 6, 2);
      return pose({
        squash: -1,
        eyes: "wide",
        mouth: k ? "o" : "open",
        armL: "up",
        armR: "up",
        feet: k ? -1 : 1,
        sway: k ? -2 : 2,
        particles: [{ kind: "sweat", x: 23, y: 9 + k }],
      });
    },
  },
  fall: {
    label: "fall",
    frame: (t        ) => pose({ squash: -2, eyes: "wide", mouth: "o", armL: "up", armR: "up", sway: step(t, 8, 2) ? 2 : -2 }),
  },
  land: {
    label: "land",
    duration: 0.5,
    frame: (t        ) => pose({ squash: t < 0.15 ? 2 : t < 0.3 ? -1 : 0, eyes: t < 0.25 ? "closed" : "open", mouth: "flat" }),
  },
  pet: {
    label: "pet",
    duration: 2.2,
    frame: (t        , s        ) =>
      pose({
        ...alive(t),
        eyes: "happy",
        mouth: "smile",
        blush: true,
        tilt: Math.round(ping(t, 1.1)),
        squash: step(t, 3, 2),
        bulb: "love",
        particles: rise(t, "heart", 2, 15, 9, s, 3, 1.2),
      }),
  },
}                               );

const ANIM_NAMES = Object.keys(ANIMS);

  globalThis.PipEngine = { GRID, M, BASE, compose, paint, ANIMS };
})();

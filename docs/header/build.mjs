// Builds the README header: an animated isometric SVG of a card trough (the
// context window) and a small press (the compaction model) under a pick-and-
// place gantry. GitHub shows SVGs through <img>, so every motion is a CSS
// keyframe on one shared 16 s clock; there is no script.
//
//   node docs/header/build.mjs            writes header-dark.svg and header-light.svg
//   node docs/header/build.mjs --at 10.6  also writes still-<t>.svg frames for review
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "./kit/iso-kit.mjs";
import * as G from "./kit/lathe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- the model
// One card is one 8k-token entry in a 200k context window, so 25 cards fill
// it. The numbers match the README's example settings.
const WINDOW = 200_000;
const PER_CARD = 8_000;
const SLOTS = WINDOW / PER_CARD; // 25
const THRESHOLD = 80; // backgroundThreshold, %
const KEEP = Math.round(16_384 / PER_CARD); // keepRecentTokens -> 2 cards
const RESERVE = 16_384; // reserveTokens: Pi's own trigger at 91.8%
const PI_TRIGGER = (WINDOW - RESERVE) / WINDOW; // 0.918

const LOOP = 16; // seconds
const START = 5; // cards at the start of the loop: summary + 4 kept
const TURNS = [
  // [follower moves at, cards drop from, count]
  [1.2, 1.45, 4],
  [2.6, 2.85, 4],
  [4.0, 4.25, 4],
  [5.4, 5.65, 3],
  [7.5, 7.75, 1], // the session keeps going while the summary is prepared
  [10.0, 10.25, 1], // ...and its turn ends after the summary is ready
];
const TRIP = 6.1; // agent_end sees 80% and starts the background job
const SWEEP = [6.4, 6.9, 8.6, 9.3]; // to slot 0, read 0..cut, back home
const SQUEEZE = [9.3, 10.2]; // the press closes the copies into one card
const SETTLED = 10.75; // agent_settled: summary ready and the leaf moved
const STILL = 10.6; // the frame shown under reduced motion

let total = START;
const drops = []; // [slot, time]
const stops = [[0, START]]; // follower [time, cards]
for (const [moveAt, dropAt, count] of TURNS) {
  stops.push([moveAt, total + count]);
  for (let i = 0; i < count; i++) drops.push([total + i, dropAt + i * 0.07]);
  total += count;
}
const PEAK = total; // 22 cards, 88%
const CUT = (SLOTS * THRESHOLD) / 100 - KEEP; // first kept slot when the job starts
const KEPT = PEAK - CUT; // 4
if (START !== KEPT + 1) throw new Error("loop must close: summary + kept = start");

// ---------------------------------------------------------------- geometry
const WIDTH = 960;
const HEIGHT = 480;
const X0 = -116; // slot 0 of the trough
const RUN = 175; // trough length for 100%
const PITCH = RUN / SLOTS; // 7 units per card
const slotX = (i) => X0 + i * PITCH;
const IN_R = X0 + RUN + 11; // inner face of the right end wall
const T_W = IN_R + 8 + 128; // trough walls run from x = -128
const CARD = { y: 2, d: 22, t: 4, z: 4, h: 26, tab: 3 };
const PRESS_X = -149; // the summary card's slot in the press
const PRESS_Z = 11;
const LIFT = 20;
const HOME = PRESS_X + CARD.t / 2; // carriage x over the press slot
const BAR = { grab: 41, carry: 61, read: 38, place: 34 };
const JAW = { open: -216, shut: PRESS_X - 9 };
const SHEETS = 6;

const BASE = { x: -282, y: -36, w: 390, d: 84, r: 6 };
const POSTS = [-274, 88];
const BEAM_Z = 78;

const P = k.fitProjection(
  [
    ...k.boxCorners(BASE, -16, 0),
    [HOME, 13, 100],
    [slotX(CUT) + 1.5, 13, 100],
    [POSTS[0], -28, BEAM_Z + 10],
    [POSTS[1] + 12, -28, BEAM_Z + 10],
  ],
  WIDTH,
  HEIGHT,
  { pad: 46, azimuth: 58, elevation: 30 },
);
P.origin[1] += 6;

const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const slab = (plan, z, h, steps = 3, bevel = 0) =>
  k.slabOf(plan, z, h, P, steps, bevel);
const screws = (points, size = 0.45, tone = "mid") =>
  D(points.map((p) => at(p)), { size, tone });
const vec = (d) => k.axisVector(P, d);

// ---------------------------------------------------------------- motion
// A track is a list of keys [t, { x, y, z, o }] in world offsets; values carry
// over, and each segment eases. A key with `step` jumps instead.
const EASE = "cubic-bezier(.45,0,.25,1)";
const tracks = [];
function track(keys, { name } = {}) {
  const id = name ?? `m${tracks.length}`;
  const full = [];
  let last = { x: 0, y: 0, z: 0, o: 1 };
  for (const [t, values, step] of keys) {
    const next = { ...last, ...values };
    // a step right after a key at the same time lands just after it instead
    const held = step && full.length && full.at(-1)[0] >= t - 0.001;
    if (step && !held) full.push([t - 0.001, last]);
    full.push([held ? t + 0.001 : t, next]);
    last = next;
  }
  if (full[0][0] > 0) full.unshift([0, full[0][1]]);
  if (full.at(-1)[0] < LOOP) full.push([LOOP, full.at(-1)[1]]);
  tracks.push({ id, keys: full });
  return id;
}
function valueAt(id, t) {
  const { keys } = tracks.find((tr) => tr.id === id);
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, a] = keys[i];
    const [t1, b] = keys[i + 1];
    if (t < t0 || t > t1) continue;
    const u = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
    const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
    const mix = (p, q) => p + (q - p) * e;
    return { x: mix(a.x, b.x), y: mix(a.y, b.y), z: mix(a.z, b.z), o: mix(a.o, b.o) };
  }
  return keys.at(-1)[1];
}
const styleOf = ({ x, y, z, o }) => {
  const [sx, sy] = vec([x, y, z]);
  const parts = [];
  if (sx || sy) parts.push(`transform:translate(${sx.toFixed(2)}px,${sy.toFixed(2)}px)`);
  if (o !== 1) parts.push(`opacity:${+o.toFixed(3)}`);
  return parts.join(";");
};
// A moving group: the static style is the reduced-motion frame.
const moving = (id, svg, extra = "") =>
  `<g class="mv ${id}"${extra} style="${styleOf(valueAt(id, STILL))}">${svg}</g>`;
function keyframesCss() {
  return tracks
    .map(({ id, keys }) => {
      const frames = keys
        .map(([t, v]) => {
          const [sx, sy] = vec([v.x, v.y, v.z]);
          const pct = +((t / LOOP) * 100).toFixed(3);
          return `${pct}%{transform:translate(${sx.toFixed(2)}px,${sy.toFixed(2)}px);opacity:${+v.o.toFixed(3)};animation-timing-function:${EASE}}`;
        })
        .join("");
      return `@keyframes ${id}{${frames}}.${id}{animation-name:${id}}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------- base
function base() {
  const out = [`<path class="iso-halo" d="${k.haloOf(BASE, -16, 16, P)}"/>`];
  const feet = k.corners(BASE, 26).sort((a, b) => k.depthOf([...a, 0], P) - k.depthOf([...b, 0], P));
  for (const [x, y] of feet) {
    out.push(S(k.cylinder(x, y, 8, -16, 1.6, P, 32), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 6.2, -14.4, 4.4, P, 32), { tone: "mid" }));
  }
  out.push(S(slab(BASE, -10, 10, 8, 1.6), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(BASE, 5), 0, P), { tone: "lo" }));
  const corners = k.corners(BASE, 11);
  out.push(L(corners.map(([x, y]) => k.ring(x, y, 2.3, 0, P, 18)).join(""), { tone: "lo" }));
  out.push(screws(corners.map(([x, y]) => [x, y, 0]), 0.55));
  // label plate with the one engraved label
  const plate = { x: -250, y: 31, w: 64, d: 10, r: 1.2 };
  out.push(S(slab(plate, 0, 0.8, 4), { tone: "lo", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan(plate, 1.4), 0.8, P, 4), { tone: "faint" }));
  out.push(
    k.faceTextSvg(k.topMatrix([plate.x + 5, plate.y + 6.6], 0.8, P, "x"), "AUTO-COMPACT", { size: 4.2, tone: "mid" }),
  );
  out.push(screws([[plate.x + 2.6, plate.y + 5, 0.8], [plate.x + plate.w - 2.6, plate.y + 5, 0.8]], 0.4));
  // service plate on the right with three printed rule lines
  const card = { x: 40, y: 35, w: 44, d: 8, r: 1 };
  out.push(S(slab(card, 0, 0.8, 4), { tone: "lo", crease: "none" }));
  [[4, 30], [4, 22], [4, 34]].forEach(([dx, len], i) =>
    out.push(L(k.lineOnTop([card.x + dx, card.y + 2 + i * 2], [card.x + dx + len, card.y + 2 + i * 2], 0.8, P), { tone: "lo", free: true })),
  );
  out.push(screws([[card.x + card.w - 3, card.y + 2.2, 0.8], [card.x + card.w - 3, card.y + card.d - 2.2, 0.8]], 0.4));
  return out.join("");
}

// ---------------------------------------------------------------- posts
function posts() {
  const out = [];
  for (const x of POSTS) {
    const foot = { x: x - 4, y: -30, w: 20, d: 20, r: 2 };
    out.push(S(slab(foot, 0, 2.4, 3, 0.5), { tone: "mid" }));
    out.push(screws(k.corners(foot, 3).map(([a, b]) => [a, b, 2.4]), 0.45));
    const post = { x, y: -26, w: 12, d: 12, r: 1.4 };
    out.push(
      S(slab(post, 2.4, BEAM_Z - 2.4, 3, 0.4), {
        tone: "mid",
        inner: L(k.sideSeam(post, 12, P, 3) + k.sideSeam(post, BEAM_Z - 10, P, 3), { tone: "faint" }),
      }),
    );
    const cap = { x: x - 3, y: -29, w: 18, d: 18, r: 1.5 };
    out.push(S(slab(cap, BEAM_Z - 6, 6, 3, 0.5), { tone: "mid" }));
    out.push(screws([[x - 0.5, -11, BEAM_Z - 3], [x + 12.5, -11, BEAM_Z - 3]], 0.42));
  }
  return out.join("");
}

// ---------------------------------------------------------------- beam
function beam() {
  const out = [];
  const x = BASE.x + 4;
  const w = BASE.w - 8;
  const capAt = (cx) => S(slab({ x: cx, y: -28, w: 2, d: 18, r: 0.6 }, BEAM_Z - 0.5, 11, 2), { tone: "mid" });
  out.push(capAt(x - 2));
  out.push(S(slab({ x, y: -27, w, d: 16, r: 1 }, BEAM_Z, 2, 3, 0.4), { tone: "mid" }));
  out.push(S(slab({ x: x + 1, y: -22, w: w - 2, d: 6, r: 0.6 }, BEAM_Z + 2, 6, 3), { tone: "mid" }));
  out.push(S(slab({ x, y: -27, w, d: 16, r: 1 }, BEAM_Z + 8, 2, 3, 0.4), { tone: "mid" }));
  out.push(capAt(x + w));
  out.push(screws([[x + w + 2, -24, BEAM_Z + 5], [x + w + 2, -14, BEAM_Z + 5]], 0.42));
  // tick rail on the top flange: the gantry's own scale, one tick per slot
  const strip = { x: X0 - 2, y: -17, w: RUN + 4, d: 5, r: 0.6 };
  out.push(S(slab(strip, BEAM_Z + 10, 0.5, 3), { tone: "lo", crease: "none" }));
  const t = k.topTicks(X0, X0 + RUN, PITCH, 5, strip.y + 0.4, BEAM_Z + 10.5, [1.4, 2.8], P);
  out.push(L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }));
  // end stops
  for (const sx of [x + 6, x + w - 12]) {
    out.push(S(slab({ x: sx, y: -26, w: 6, d: 14, r: 1 }, BEAM_Z + 10, 4, 3, 0.4), { tone: "mid" }));
    out.push(screws([[sx + 3, -22, BEAM_Z + 14], [sx + 3, -16, BEAM_Z + 14]], 0.42));
  }
  out.push(
    screws(
      POSTS.flatMap((px) => [
        [px + 3, -24, BEAM_Z + 10],
        [px + 9, -24, BEAM_Z + 10],
        [px + 3, -13, BEAM_Z + 10],
        [px + 9, -13, BEAM_Z + 10],
      ]),
      0.45,
    ),
  );
  return out.join("");
}

// ---------------------------------------------------------------- press
const pressTracks = {};
function press() {
  const out = [];
  const bed = { x: -254, y: -6, w: 116, d: 38, r: 3 };
  out.push(S(slab(bed, 0, 8, 6, 0.8), { tone: "mid" }));
  out.push(screws(k.corners(bed, 4).map(([x, y]) => [x, y, 8]), 0.45));
  // motor on the far end: a turned body along -x with cooling ribs
  const F = G.frameAlong([-248, 13, 17], [-1, 0, 0]);
  const motor = [[0, 6.4], [2.4, 6.4], [2.4, 8], [19, 8], [19, 7], [22, 7], [22, 3], [24, 3]];
  out.push(S(G.solidOf(motor, F, P), { tone: "mid", inner: k.fadedSvg(G.ribsOf(F, 4, 17, 8.05, 22, P, { fade: [0.1, 0.55], seams: true }), { tone: "lo" }) }));
  // end block
  const end = { x: -248, y: -4, w: 12, d: 34, r: 1.5 };
  out.push(S(slab(end, 8, 18, 3, 0.6), { tone: "mid" }));
  out.push(screws([[-242, 0, 26], [-242, 26, 26]], 0.45));
  // busy lamp on the end block
  out.push(S(k.cylinder(-242, 13, 3, 26, 2, P, 24), { tone: "mid" }));
  out.push(S(k.cylinder(-242, 13, 2, 28, 1.6, P, 20), { tone: "hi" }));
  pressTracks.lamp = track([
    [0, { o: 0 }],
    [TRIP, { o: 0 }],
    [TRIP + 0.3, { o: 1 }],
    [SQUEEZE[1], { o: 1 }],
    [SQUEEZE[1] + 0.4, { o: 0 }],
  ]);
  out.push(moving(pressTracks.lamp, D([at([-242, 13, 29.6])], { size: 1.3, tone: "hi" }) + `<path class="iso-line" data-tone="lit" d="${k.ring(-242, 13, 1.2, 29.6, P, 16)}"/>`));
  // rails and the lead-screw slot
  out.push(L(k.planOutline({ x: -236, y: 10.5, w: 91, d: 5, r: 2.4 }, 8, P, 6), { tone: "lo" }));
  const SF = G.frameAlong([-236, 13, 9.6], [1, 0, 0]);
  const threads = Array.from({ length: 44 }, (_, i) => G.arcOf(SF, 1.5 + i * 2, 1.4, P)).join("");
  out.push(S(G.disc(0, 91, 1.4, SF, P), { tone: "mid", inner: L(threads, { tone: "lo" }) }));
  for (const y of [2, 21]) out.push(S(slab({ x: -236, y, w: 90, d: 3, r: 0.5 }, 8, 3, 2, 0.3), { tone: "mid" }));
  // moving jaw, driven along the slot
  const jaw = { x: JAW.open, y: -4, w: 8, d: 34, r: 1.5 };
  const jawSvg =
    S(slab(jaw, 8, 14, 3, 0.6), { tone: "mid", inner: L(k.sideSeam(jaw, 15, P, 3), { tone: "faint" }) }) +
    screws([[JAW.open + 4, 0, 22], [JAW.open + 4, 26, 22]], 0.45) +
    S(slab({ x: JAW.open + 8, y: 1, w: 1, d: 24, r: 0.3 }, 11, 10, 2), { tone: "mid" }) +
    screws([[JAW.open + 9, 4, 16], [JAW.open + 9, 22, 16]], 0.4);
  pressTracks.jaw = track([
    [0, {}],
    [SQUEEZE[0], {}],
    [SQUEEZE[1], { x: JAW.shut - JAW.open }],
    [SETTLED, { x: JAW.shut - JAW.open }],
    [SETTLED + 0.45, {}],
  ]);
  out.push(moving(pressTracks.jaw, jawSvg));
  // copies: one sheet per four cards the head reads
  const read = SWEEP.slice(1, 3);
  for (let i = 0; i < SHEETS; i++) {
    const x = JAW.open + 10 + (i * (PRESS_X - 4 - JAW.open - 10)) / (SHEETS - 1);
    const appear = read[0] + ((i + 0.6) / SHEETS) * (read[1] - read[0]);
    const reach = SQUEEZE[0] + ((x - JAW.open - 8) / (JAW.shut - JAW.open)) * (SQUEEZE[1] - SQUEEZE[0]);
    const id = track([
      [0, { o: 0, z: 6 }],
      [appear, { o: 0, z: 6 }],
      [appear + 0.3, { o: 1, z: 0 }],
      [reach - 0.05, { o: 1 }],
      [SQUEEZE[1], { x: PRESS_X - 1.4 - x, o: 0 }],
      [SQUEEZE[1] + 0.01, { x: 0, o: 0, z: 6 }],
    ]);
    const plan = { x, y: 3, w: 1.2, d: 20, r: 0.3 };
    out.push(moving(id, S(slab(plan, PRESS_Z, 24, 2), { tone: "mid", crease: "lo" })));
  }
  return out.join("");
}

function fixedJaw() {
  const jaw = { x: PRESS_X + CARD.t, y: -4, w: 10, d: 34, r: 1.5 };
  return (
    S(slab(jaw, 8, 14, 3, 0.6), { tone: "mid", inner: L(k.sideSeam(jaw, 15, P, 3), { tone: "faint" }) }) +
    screws([[jaw.x + 5, 0, 22], [jaw.x + 5, 26, 22], [jaw.x + 5, 13, 22]], 0.45)
  );
}

// ---------------------------------------------------------------- cards
const TAB_Y = [3, 9.5, 16];
function cardSvg(x, z, kind) {
  const plan = { x: x + 1.5, y: CARD.y, w: CARD.t, d: CARD.d, r: 0.5 };
  if (kind === "summary") {
    const tab = { x: x + 1.5, y: 3, w: CARD.t, d: 20, r: 0.5 };
    return (
      S(slab(plan, z, CARD.h, 2), { tone: "hi", lit: true, crease: "lo" }) +
      S(slab(tab, z + CARD.h, CARD.tab, 2), { tone: "hi", lit: true, crease: "lo" })
    );
  }
  const tab = { x: x + 1.5, y: TAB_Y[kind], w: CARD.t, d: 7, r: 0.5 };
  return (
    S(slab(plan, z, CARD.h, 2), { tone: "hi", crease: "lo" }) +
    S(slab(tab, z + CARD.h, CARD.tab, 2), { tone: "hi", crease: "lo" })
  );
}
const tabOf = (slot) => (slot * 7 + 1) % 3;
const DROP = 18;

function cards() {
  const out = [];
  const leave = (slot) => 11.35 + slot * 0.014;
  const dropAt = new Map(drops);
  // the new summary, second half of its trip: from above the press to slot 0
  const lifted = { x: PRESS_X - slotX(0) - 1.5, z: PRESS_Z - CARD.z + LIFT };
  const fly = [SETTLED + 0.95, SETTLED + 1.55, SETTLED + 1.95];
  const summaryIn = track([
    [0, { o: 0, ...lifted }],
    [fly[0], { o: 0, ...lifted }],
    [fly[0], { o: 1 }, true],
    [fly[1], { x: 0 }],
    [fly[2], { z: 0 }],
  ]);
  // c0 is the summary from the last cycle; it leaves with the old turns
  const c0 = track([
    [0, {}],
    [leave(0), {}],
    [leave(0) + 0.4, { z: 14, o: 0 }],
    [LOOP, { z: 0, o: 1 }, true],
  ]);
  out.push(moving(c0, cardSvg(slotX(0), CARD.z, "summary")));
  out.push(moving(summaryIn, cardSvg(slotX(0), CARD.z, "summary")));
  for (let slot = 1; slot < PEAK; slot++) {
    const kept = slot >= CUT;
    // cards 1..4 at the start look like the kept cards they stand for
    const look = slot < START ? tabOf(CUT + slot - 1) : tabOf(slot);
    let id;
    if (slot < START) {
      id = track([
        [0, {}],
        [leave(slot), {}],
        [leave(slot) + 0.4, { z: 14, o: 0 }],
        [LOOP, { z: 0, o: 1 }, true],
      ]);
    } else {
      const t = dropAt.get(slot);
      const keys = [
        [0, { z: DROP, o: 0 }],
        [t, { z: DROP, o: 0 }],
        [t + 0.38, { z: 0, o: 1 }],
      ];
      if (kept) {
        const dx = slotX(slot - CUT + 1) - slotX(slot);
        const go = SETTLED + 2.15 + (slot - CUT) * 0.03;
        keys.push([go, {}], [go + 0.8, { x: dx }], [LOOP, { x: dx }]);
      } else {
        keys.push([leave(slot), {}], [leave(slot) + 0.4, { z: 14, o: 0 }], [LOOP, { z: DROP, o: 0 }, true]);
      }
      id = track(keys);
    }
    out.push(moving(id, cardSvg(slotX(slot), CARD.z, look)));
  }
  return out.join("");
}

// the new summary while it is made and lifted: drawn between the press jaws
function summaryPress() {
  const id = track([
    [0, { o: 0 }],
    [SQUEEZE[0] + 0.5, { o: 0 }],
    [SQUEEZE[1], { o: 1 }],
    [SETTLED + 0.5, {}],
    [SETTLED + 0.95, { z: LIFT }],
    [SETTLED + 0.95, { o: 0, z: 0 }, true],
  ]);
  return moving(id, cardSvg(PRESS_X - 1.5, PRESS_Z, "summary"));
}

// ---------------------------------------------------------------- trough
function troughBack() {
  const out = [];
  const floor = { x: -128, y: -6, w: T_W, d: 38, r: 2 };
  out.push(S(slab(floor, 0, 4, 6, 0.6), { tone: "mid" }));
  out.push(L(k.planOutline({ x: -118, y: 11, w: IN_R - 2 + 118, d: 4, r: 1.8 }, 4, P, 6), { tone: "faint" }));
  const back = { x: -128, y: -6, w: T_W, d: 6, r: 1 };
  out.push(S(slab(back, 4, 18, 3, 0.5), { tone: "mid" }));
  out.push(screws(Array.from({ length: 5 }, (_, i) => [-118 + (i * (T_W - 20)) / 4, -3, 22]), 0.42));
  // threshold trip at 80%: a pin that pops up when the follower reaches it
  const tx = slotX(SLOTS * (THRESHOLD / 100));
  out.push(S(slab({ x: tx - 4, y: -5.5, w: 8, d: 5, r: 1 }, 22, 3, 3, 0.4), { tone: "mid" }));
  const pin = track([
    [0, {}],
    [TRIP - 0.2, {}],
    [TRIP, { z: 4 }],
    [SETTLED + 2.4, { z: 4 }],
    [SETTLED + 2.8, {}],
  ]);
  out.push(
    moving(
      pin,
      S(k.cylinder(tx, -3, 1.2, 21, 5, P, 16), { tone: "hi", crease: "none" }) +
        S(k.cylinder(tx, -3, 1.9, 26, 1.2, P, 18), { tone: "hi" }),
    ),
  );
  out.push(S(k.cylinder(tx, -3, 2.2, 25, 0.01, P, 18), { tone: "mid", crease: "none" }));
  // left end wall
  const left = { x: -128, y: 0, w: 8, d: 26, r: 1 };
  out.push(S(slab(left, 4, 14, 3, 0.5), { tone: "mid" }));
  out.push(screws([[-124, 4, 18], [-124, 22, 18]], 0.42));
  return out.join("");
}

function follower() {
  const id = track(
    stops.flatMap(([t, n], i) => {
      const x = slotX(n) - slotX(START);
      return i === 0 ? [[0, { x }]] : [[t, i > 0 ? {} : { x }], [t + 0.45, { x }]];
    }).concat([
      [SETTLED + 2.15, {}],
      [SETTLED + 3.0, { x: 0 }],
    ]),
    { name: "fol" },
  );
  const x = slotX(START);
  const body = { x, y: 1, w: 8, d: 24, r: 1 };
  const inner =
    S(slab(body, 4, 18, 3, 0.5), { tone: "mid", inner: L(k.sideSeam(body, 8, P, 3), { tone: "faint" }) }) +
    S(k.cylinder(x + 4, 13, 3.2, 22, 4, P, 28), { tone: "mid" }) +
    L(k.knurl(x + 4, 13, 3.2, 22, 26, 24, P), { tone: "lo" }) +
    D([at([x + 4, 13, 26])], { size: 0.6, tone: "hi" });
  return { id, svg: moving(id, inner), x };
}

function troughFront(fol) {
  const out = [];
  const right = { x: IN_R, y: 0, w: 8, d: 26, r: 1 };
  out.push(S(slab(right, 4, 14, 3, 0.5), { tone: "mid" }));
  out.push(screws([[IN_R + 4, 4, 18], [IN_R + 4, 22, 18]], 0.42));
  const front = { x: -128, y: 26, w: T_W, d: 6, r: 1 };
  out.push(S(slab(front, 4, 10, 3, 0.5), { tone: "mid" }));
  // the ruler: one tick per percent, a major every ten
  const strip = { x: X0 - 3, y: 26.8, w: RUN + 6, d: 4.4, r: 0.5 };
  out.push(S(slab(strip, 14, 0.5, 3), { tone: "lo", crease: "none" }));
  const t = k.topTicks(X0, X0 + RUN, RUN / 50, 5, strip.y + 0.3, 14.5, [1.2, 2.6], P);
  out.push(L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }));
  // Pi's own trigger zone (reserveTokens): an inlay from 91.8% to 100%
  const r0 = X0 + RUN * PI_TRIGGER;
  out.push(L(k.planOutline({ x: r0, y: strip.y + 2.9, w: X0 + RUN - r0, d: 1.2, r: 0.5 }, 14.5, P, 3), { tone: "mid" }));
  // the threshold mark on the ruler
  const tx = slotX(SLOTS * (THRESHOLD / 100));
  out.push(D([at([tx, strip.y + 3.6, 14.5])], { size: 0.7, tone: "hi" }));
  out.push(screws([[-124, 29, 14], [IN_R + 4, 29, 14]], 0.42));
  // the follower's pointer plate rides over the ruler
  const plate = { x: fol.x, y: 25, w: 8, d: 6.4, r: 0.6 };
  out.push(
    moving(
      fol.id,
      S(slab(plate, 15, 1.2, 2, 0.3), { tone: "mid" }) +
        L(k.lineOnTop([fol.x + 0.6, 25], [fol.x + 0.6, 31.4], 16.2, P), { tone: "hi" }) +
        screws([[fol.x + 5.2, 28.2, 16.2]], 0.42),
    ),
  );
  return out.join("");
}

// ---------------------------------------------------------------- carriage
// One track moves the whole carriage along x; a second moves the gripper in z.
const carriageX = (x) => x - HOME;
const readTo = slotX(CUT - 1) + 1.5 + CARD.t / 2;
let carriage, gripper, reading;
function carriageTracks() {
carriage = track([
  [0, {}],
  [SWEEP[0], {}],
  [SWEEP[1], { x: carriageX(slotX(0) + 1.5 + CARD.t / 2) }],
  [SWEEP[2], { x: carriageX(readTo) }],
  [SWEEP[3], { x: 0 }],
  [SETTLED + 0.95, {}],
  [SETTLED + 1.55, { x: carriageX(slotX(0) + 1.5 + CARD.t / 2) }],
  [SETTLED + 2.35, {}],
  [SETTLED + 3.2, { x: 0 }],
]);
gripper = track([
  [0, { z: BAR.carry - BAR.carry }],
  [SWEEP[0], {}],
  [SWEEP[1], { z: BAR.read - BAR.carry }],
  [SWEEP[2], {}],
  [SWEEP[3], { z: 0 }],
  [SETTLED + 0.1, {}],
  [SETTLED + 0.5, { z: BAR.grab - BAR.carry }],
  [SETTLED + 0.95, { z: 0 }],
  [SETTLED + 1.55, {}],
  [SETTLED + 1.95, { z: BAR.place - BAR.carry }],
  [SETTLED + 2.35, { z: 0 }],
]);
reading = track([
  [0, { o: 0 }],
  [SWEEP[1] - 0.1, { o: 0 }],
  [SWEEP[1] + 0.1, { o: 1 }],
  [SWEEP[2] - 0.1, { o: 1 }],
  [SWEEP[2] + 0.1, { o: 0 }],
]);
}

function carriageBack() {
  const cx = HOME;
  const body = { x: cx - 12, y: -28, w: 24, d: 18, r: 1.5 };
  return moving(
    carriage,
    S(slab({ x: cx - 12, y: -30, w: 24, d: 2, r: 0.5 }, 70, 13, 2), { tone: "mid" }) +
      S(slab(body, 70, 8, 3, 0.5), { tone: "mid" }),
  );
}

function carriageFront() {
  const cx = HOME;
  const out = [];
  // front side plate with wheel axles, and the arm out to the Z sleeve
  const side = { x: cx - 12, y: -10, w: 24, d: 2, r: 0.5 };
  out.push(S(slab(side, 70, 13, 2), { tone: "mid" }));
  out.push(screws([[cx - 7, -8, 80.5], [cx + 7, -8, 80.5]], 0.6, "hi"));
  out.push(L(k.ring(cx - 7, -8, 1.6, 80.5, P, 14) + k.ring(cx + 7, -8, 1.6, 80.5, P, 14), { tone: "lo" }));
  const arm = { x: cx - 5, y: -8, w: 10, d: 16.5, r: 1 };
  out.push(S(slab(arm, 70, 6, 3, 0.4), { tone: "mid" }));
  // gripper: bar, fingers, read head; then the rod, then the sleeve over it
  const bar = BAR.carry;
  const g = [];
  g.push(S(slab({ x: cx - 2.5, y: 0, w: 5, d: 2, r: 0.4 }, bar - 4, 4, 2), { tone: "mid" }));
  g.push(S(slab({ x: cx - 3, y: 0, w: 6, d: 26, r: 1 }, bar, 3, 3, 0.3), { tone: "mid" }));
  g.push(S(slab({ x: cx - 2.5, y: 24, w: 5, d: 2, r: 0.4 }, bar - 4, 4, 2), { tone: "mid" }));
  g.push(S(k.cylinder(cx, 13, 1.6, bar + 3, 33, P, 16), { tone: "hi", crease: "none" }));
  g.push(L(k.sideArc(cx, 13, 1.6, bar + 8, P, 10), { tone: "lo" }));
  g.push(screws([[cx - 1.6, 26, bar + 1.5], [cx + 1.6, 26, bar + 1.5]], 0.4));
  out.push(moving(gripper, g.join("")));
  out.push(moving(reading, moving(gripper, D([at([cx, 26, bar + 1.5])], { size: 1.1, tone: "hi" }))));
  out.push(
    S(k.cylinder(cx, 13, 4.5, 66.5, 31.5, P, 32), {
      tone: "mid",
      crease: "none",
      inner: L(k.sideArc(cx, 13, 4.5, 70, P, 20) + k.sideArc(cx, 13, 4.5, 76, P, 20), { tone: "faint" }),
    }),
  );
  out.push(S(k.cylinder(cx, 13, 5.4, 64, 2.5, P, 32), { tone: "mid" }));
  out.push(S(k.cylinder(cx, 13, 5.4, 98, 2.4, P, 32), { tone: "mid" }));
  out.push(D([at([cx, 13, 100.4])], { size: 0.5 }));
  return moving(carriage, out.join(""));
}

// ---------------------------------------------------------------- card text
const pct = (n) => Math.round((n / SLOTS) * 100);
const tokens = (n) => `${Math.round((n * PER_CARD) / 1000)}k`;
function captions() {
  const phases = [
    [0, TRIP, "AGENT TURNS FILL THE CONTEXT"],
    [TRIP, SWEEP[2], `${THRESHOLD}% · A SECOND MODEL READS THE OLD TURNS`],
    [SWEEP[2], SETTLED, "IT SUMMARIZES WHILE THE SESSION RUNS ON"],
    [SETTLED, SETTLED + 3.0, "TURN ENDS · THE READY SUMMARY SWAPS IN"],
    [SETTLED + 3.0, LOOP, "COMPACTED · THE RECENT TURNS STAY"],
  ];
  const readouts = stops.map(([t], i) => [t + 0.2, (stops[i + 1]?.[0] ?? SETTLED + 2.6) + 0.2, stops[i][1]]);
  readouts.push([SETTLED + 2.8, LOOP + 0.2, START]);
  const out = [];
  const shown = (t0, t1, svg, cls) => {
    // fade in after t0 and out before t1, so two lines never overlap
    const fade = 0.18;
    const on = (t) => (t0 <= t && t < t1) || (t1 > LOOP && t < t1 - LOOP);
    let keys;
    if (t1 > LOOP) {
      const e = t1 - LOOP;
      keys = [[0, { o: 1 }], [e - fade, { o: 1 }], [e, { o: 0 }], [t0, { o: 0 }], [t0 + fade, { o: 1 }]];
    } else {
      keys = [[t0, { o: 0 }], [t0 + fade, { o: 1 }], [t1 - fade, { o: 1 }], [t1, { o: 0 }]];
      if (t0 > 0) keys.unshift([0, { o: 0 }]);
    }
    const id = track(keys);
    return `<g class="mv ${id}" style="opacity:${on(STILL) ? 1 : 0}">${svg.replace("<text", `<text class="${cls}"`)}</g>`;
  };
  for (const [t0, t1, text] of phases)
    out.push(shown(t0, t1, `<text x="26" y="${HEIGHT - 22}">${text}</text>`, "hd-hint"));
  for (const [t0, t1, n] of readouts)
    out.push(
      shown(t0, t1, `<text x="${WIDTH - 26}" y="${HEIGHT - 22}" text-anchor="end">context ${pct(n)}% · ${tokens(n)} / ${WINDOW / 1000}k</text>`, "hd-read"),
    );
  return out.join("");
}

// ---------------------------------------------------------------- page
const CSS = `
.hd-card{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1}
.hd-fig,.hd-title,.hd-hint,.hd-read{font-family:var(--anatomy-mono);font-size:13px;letter-spacing:.04em}
.hd-fig{fill:var(--anatomy-text)}
.hd-title,.hd-hint{fill:var(--anatomy-muted);letter-spacing:.12em}
.hd-read{fill:var(--anatomy-text);font-variant-numeric:tabular-nums}
.iso-halo{filter:url(#hd-blur);transform:translateY(3px)}
.mv{animation-duration:${LOOP}s;animation-iteration-count:infinite;animation-fill-mode:both}
@media (prefers-reduced-motion:reduce){.mv{animation:none!important}}
`;

function build(theme, { still } = {}) {
  tracks.length = 0;
  carriageTracks();
  const fol = follower();
  const body = [
    base(),
    posts(),
    press(),
    summaryPress(),
    fixedJaw(),
    troughBack(),
    cards(),
    fol.svg,
    troughFront(fol),
    carriageBack(),
    beam(),
    carriageFront(),
  ].join("");
  const text = captions();
  const css = still === undefined ? keyframesCss() : "";
  const label =
    "auto-compact, drawn as a machine. Cards are entries in the context window, standing in a trough with a percent ruler. Turns add cards until the stack reaches 80%. A gantry head then reads the older cards, a small press beside the trough squeezes copies of them into one summary card while new cards keep arriving, and when the turn ends the gantry lifts the ready summary into the front of the trough, the old cards leave, and the most recent cards slide up behind it.";
  let svg = k.figureSvg({
    width: WIDTH,
    height: HEIGHT,
    label,
    standalone: theme,
    body: [
      `<defs><filter id="hd-blur" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="9"/></filter></defs>`,
      `<style>${CSS}${css}</style>`,
      `<rect class="hd-card" x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}"/>`,
      `<text class="hd-fig" x="26" y="34">pi · auto-compact</text>`,
      `<text class="hd-title" x="${WIDTH - 26}" y="34" text-anchor="end">BACKGROUND COMPACTION</text>`,
      body,
      text,
    ],
  });
  if (still !== undefined) {
    // freeze every track at `still` for review frames
    svg = svg.replace(/<g class="mv (m\d+|fol)"([^>]*) style="[^"]*"/g, (_, id, extra) => `<g class="mv ${id}"${extra} style="${styleOf(valueAt(id, still))}"`);
  }
  return svg;
}

const argAt = process.argv.indexOf("--at");
if (argAt > 0) {
  for (const t of process.argv[argAt + 1].split(",").map(Number)) {
    for (const theme of ["dark", "light"])
      writeFileSync(join(HERE, `still-${theme}-${t}.svg`), build(theme, { still: t }));
  }
  console.log("wrote stills");
} else {
  for (const theme of ["dark", "light"]) {
    const svg = build(theme);
    writeFileSync(join(HERE, `header-${theme}.svg`), svg);
    console.log(`wrote header-${theme}.svg (${(svg.length / 1024).toFixed(0)} KB, ${tracks.length} tracks)`);
  }
}

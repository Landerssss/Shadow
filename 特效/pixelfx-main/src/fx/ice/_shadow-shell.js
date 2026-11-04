// 俯视角逐面结晶冰壳：改编自 pixelfx ice/freeze 的 drawBlock 晶面形成、边线描绘与透明分面，
// 去掉人物、横版地面与融化流程，仅保留围绕锚点逐块闭合的多面冰壳。
import { Rng, clamp, smooth, TAU, WHITE } from "../../core/index.js";

export const SHADOW_SHELL_PALETTE = ["#120e24", "#241a4a", "#3c4f86", "#5d74ad", "#7fb4dc", "#8fe6ff", "#f2ffff"];
export const SHADOW_SHELL_ENTER = 0.70;
export const SHADOW_SHELL_EXIT = 0.34;

function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return { x: x / pts.length, y: y / pts.length };
}

function inPoly(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 真正半透明的晶面填充，避免 p.poly 的抖动透明在大面积晶面上形成噪点。 */
function glassFill(p, pts, c, a) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++)
    for (let x = Math.floor(x0); x <= Math.ceil(x1); x++)
      if (inPoly(pts, x + 0.5, y + 0.5)) p.blend(x, y, c, a);
}

function shuffled(rng, n) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/** 固定种子生成同一套晶面：12 块外圈折面 + 6 块顶面三角，共 18 面，外轮廓约 12 边。 */
export function buildShadowShell(seed = 17, R = 42) {
  const rng = new Rng(seed), N = 12, M = 6;
  const center = { x: rng.range(-0.04, 0.04) * R, y: rng.range(-0.04, 0.04) * R };
  const spikes = new Set([rng.int(0, N - 1), (rng.int(0, N - 1) + 5) % N, (rng.int(0, N - 1) + 9) % N]);
  const outer = [], inner = [];
  for (let k = 0; k < N; k++) {
    const a = -Math.PI / 2 + (k * TAU) / N + rng.range(-0.075, 0.075);
    let rr = R * rng.range(0.93, 1.01);
    if (spikes.has(k)) rr = R * rng.range(1.10, 1.16);
    outer.push([center.x + Math.cos(a) * rr, center.y + Math.sin(a) * rr]);
  }
  for (let k = 0; k < M; k++) {
    const a = -Math.PI / 2 + ((k * 2 + 1) * TAU) / N + rng.range(-0.07, 0.07);
    const rr = R * rng.range(0.48, 0.60);
    inner.push([center.x + Math.cos(a) * rr, center.y + Math.sin(a) * rr]);
  }

  const facets = [];
  const sides = [], tops = [];
  const sideOrder = shuffled(rng, M);
  sideOrder.forEach((k, n) => {
    const pts = [outer[(k * 2) % N], outer[(k * 2 + 1) % N], outer[(k * 2 + 2) % N], inner[(k + 1) % M], inner[k]];
    const c = centroid(pts);
    const d = Math.hypot(c.x - center.x, c.y - center.y) || 1;
    const lit = clamp(0.5 + (-((c.x - center.x) / d) * 0.55 - ((c.y - center.y) / d) * 0.84) * 0.5 + rng.range(-0.1, 0.1));
    const f = { pts, c, lit, kind: "side", at: 0.10 + n * 0.045, dur: 0.10, i: facets.length };
    sides.push(f); facets.push(f);
  });
  const topOrder = shuffled(rng, M);
  topOrder.forEach((k, n) => {
    const pts = [[center.x, center.y], inner[k], inner[(k + 1) % M]];
    const c = centroid(pts);
    const d = Math.hypot(c.x - center.x, c.y - center.y) || 1;
    const lit = clamp(0.5 + (-((c.x - center.x) / d) * 0.55 - ((c.y - center.y) / d) * 0.84) * 0.5 + rng.range(-0.08, 0.08));
    const f = { pts, c, lit, kind: "top", at: 0.34 + n * 0.048, dur: 0.10, i: facets.length };
    tops.push(f); facets.push(f);
  });

  const shards = facets.map((F, i) => {
    const dx = F.c.x - center.x, dy = F.c.y - center.y, d = Math.hypot(dx, dy) || 1;
    return {
      pts: F.pts.map(([x, y]) => [x - F.c.x, y - F.c.y]),
      x: F.c.x, y: F.c.y, dx: dx / d, dy: dy / d,
      spd: 34 + (i % 5) * 9 + (i % 3) * 6,
      rot: (i % 2 ? 1 : -1) * rng.range(0.7, 1.9),
      lit: F.lit,
    };
  });

  return { R, center, outer, inner, facets, sides, tops, shards, seed };
}

function tracePolyline(p, pts, frac, c, a) {
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const q = pts[(i + 1) % pts.length];
    total += Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]);
  }
  let left = total * clamp(frac), tip = pts[0];
  for (let i = 0; i < pts.length && left > 0; i++) {
    const a0 = pts[i], b0 = pts[(i + 1) % pts.length];
    const len = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]);
    const u = Math.min(1, left / Math.max(0.001, len));
    p.line(a0[0], a0[1], a0[0] + (b0[0] - a0[0]) * u, a0[1] + (b0[1] - a0[1]) * u, c, a);
    left -= len;
    tip = [a0[0] + (b0[0] - a0[0]) * u, a0[1] + (b0[1] - a0[1]) * u];
  }
  return tip;
}

function edgeColor(F, C, fresh) {
  if (fresh) return C[6];
  return F.lit > 0.62 ? C[6] : F.lit > 0.30 ? C[5] : C[4];
}

function drawFacet(p, F, reveal, C, CORE, layer) {
  if ((F.c.y < CORE.y) !== (layer === "back")) return;
  const formed = clamp((reveal - 0.18) / 0.82);
  if (formed > 0) {
    const face = C[2 + Math.round(F.lit * 2)];
    glassFill(p, F.pts, face, (0.10 + 0.10 * F.lit) * formed * (F.kind === "top" ? 0.85 : 1));
  }
  const total = F.pts.length;
  for (let i = 0; i < total; i++) {
    const a0 = F.pts[i], b0 = F.pts[(i + 1) % total];
    if (reveal < 1) {
      let left = ((reveal - i / total) * total);
      if (left <= 0) continue;
      const u = Math.min(1, left);
      const b1 = [a0[0] + (b0[0] - a0[0]) * u, a0[1] + (b0[1] - a0[1]) * u];
      p.line(a0[0], a0[1], b1[0], b1[1], i / total > reveal - 0.22 ? WHITE : edgeColor(F, C, true), 0.9);
      if (u < 1) {
        p.dot(b1[0], b1[1], WHITE, 1);
        p.glow(b1[0], b1[1], 5, C[5], 0.25);
      }
    } else {
      p.line(a0[0], a0[1], b0[0], b0[1], edgeColor(F, C, false), 0.72);
    }
  }
  if (formed > 0 && F.lit > 0.45) {
    const a0 = F.pts[0], b0 = F.pts[1];
    p.line(a0[0], a0[1], b0[0], b0[1], C[6], 0.22);
  }
}

function drawShards(p, S, u, C, layer) {
  if (layer !== "front") return;
  const k = clamp(u), a = Math.pow(1 - k, 1.25);
  for (const sh of S.shards) {
    const d = sh.spd * (k + 0.35 * k * k);
    const px = sh.x + sh.dx * d, py = sh.y + sh.dy * d;
    const ca = Math.cos(sh.rot * k * 1.6), sa = Math.sin(sh.rot * k * 1.6);
    const pts = sh.pts.map(([x, y]) => [px + x * ca - y * sa, py + x * sa + y * ca]);
    glassFill(p, pts, C[3], (0.12 + 0.10 * sh.lit) * a);
    for (let i = 0; i < pts.length; i++) {
      const q = pts[(i + 1) % pts.length];
      p.line(pts[i][0], pts[i][1], q[0], q[1], sh.lit > 0.55 ? C[6] : C[5], 0.68 * a);
    }
    if (k < 0.42) p.dot(pts[0][0], pts[0][1], WHITE, 0.7 * (1 - k / 0.42));
  }
}

/** 绘制一帧冰壳。mode: enter | hold | exit；layer: back | front。 */
export function drawShadowShell(p, S, t, mode, C, layer = "front") {
  const T = mode === "hold" ? 2.4 : mode === "exit" ? SHADOW_SHELL_EXIT : SHADOW_SHELL_ENTER;
  if (mode !== "hold" && t >= T - 1e-6) return;
  if (layer === "both") {
    drawShadowShell(p, S, t, mode, C, "back");
    drawShadowShell(p, S, t, mode, C, "front");
    return;
  }
  if (mode === "exit") {
    drawShards(p, S, t / T, C, layer);
    return;
  }
  const form = mode === "enter" ? clamp(t / T) : 1;
  if (mode !== "exit") {
    const frac = mode === "enter" ? smooth(0, 0.16, t) : 1;
    const mid = S.outer.map((q, i) => {
      const n = S.outer[(i + 1) % S.outer.length];
      return { a: q, b: n, back: (q[1] + n[1]) / 2 < S.center.y };
    });
    let total = 0;
    for (const e of mid) total += Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
    let acc = 0;
    for (const e of mid) {
      const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
      const start = acc / total, end = (acc + len) / total;
      if ((e.back) === (layer === "back") && frac > start) {
        const u = Math.min(1, (frac - start) / Math.max(1e-6, end - start));
        p.line(e.a[0], e.a[1], e.a[0] + (e.b[0] - e.a[0]) * u, e.a[1] + (e.b[1] - e.a[1]) * u, mode === "enter" ? WHITE : C[5], mode === "enter" ? 0.85 : 0.42);
        if (mode === "enter" && u < 1) p.glow(e.a[0] + (e.b[0] - e.a[0]) * u, e.a[1] + (e.b[1] - e.a[1]) * u, 5, C[5], 0.2);
      }
      acc += len;
    }
  }
  for (const F of S.facets) {
    let reveal = 1;
    if (mode === "enter") reveal = clamp((t - F.at) / F.dur);
    if (reveal <= 0) continue;
    drawFacet(p, F, reveal, C, S.center, layer);
    if (mode === "hold") {
      const sweep = ((t * 0.16 + 0.12) % 1);
      const d = clamp((F.c.x + F.c.y * 0.45 + S.R) / (S.R * 2));
      const g = Math.max(0, 1 - Math.abs(sweep - d) / 0.10) * (0.25 + 0.75 * F.lit);
      if (g > 0.02) {
        const a0 = F.pts[0], b0 = F.pts[1];
        p.line(a0[0], a0[1], b0[0], b0[1], C[6], 0.24 * g);
      }
    }
  }
  if (mode === "enter") {
    const seal = t - 0.66;
    if (seal > 0 && seal < 0.16) {
      const a = 1 - seal / 0.16;
      p.glow(S.center.x, S.center.y, 10 + 12 * a, C[5], 0.22 * a);
      p.dot(S.center.x, S.center.y, WHITE, 0.7 * a);
    }
  }
  void form;
}

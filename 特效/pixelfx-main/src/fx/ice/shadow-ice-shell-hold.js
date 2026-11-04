// 俯视角冰壳 · 保持。固定几何只保留低频、微弱的晶面反光，不重复结晶、不闪白。
import { fit } from "../../core/index.js";
import { buildShadowShell, drawShadowShell, SHADOW_SHELL_PALETTE } from "./_shadow-shell.js";

export const meta = {
  name: "Shadow ice shell · hold",
  desc: "The completed faceted ice shell holds its shape with a faint slow glint across the panes.",
  tags: ["ice", "freeze", "status", "topdown", "loop"],
  size: [128, 128],
  origin: [64, 64],
  duration: 2.4,
  loop: true,
  fps: 30,
  bg: "dark",
  options: { palette: SHADOW_SHELL_PALETTE, seed: 17 },
};

export function create(o) {
  const C = fit(o.palette, 7);
  const S = buildShadowShell(o.seed ?? 17, 42);
  return {
    draw(p, t) { drawShadowShell(p, S, t, "hold", C, "both"); },
  };
}

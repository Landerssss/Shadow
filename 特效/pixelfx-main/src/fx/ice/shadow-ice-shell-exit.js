// 俯视角冰壳 · 碎裂。晶面沿俯视平面向外散开并淡出，不沿地板下落，不造成伤害。
import { fit } from "../../core/index.js";
import { buildShadowShell, drawShadowShell, SHADOW_SHELL_PALETTE, SHADOW_SHELL_EXIT } from "./_shadow-shell.js";

export const meta = {
  name: "Shadow ice shell · exit",
  desc: "The shell breaks into a few panes that drift outward across the top-down plane and fade.",
  tags: ["ice", "freeze", "status", "topdown", "exit"],
  size: [280, 280],
  origin: [140, 140],
  duration: SHADOW_SHELL_EXIT,
  loop: false,
  fps: 30,
  bg: "dark",
  options: { palette: SHADOW_SHELL_PALETTE, seed: 17 },
};

export function create(o) {
  const C = fit(o.palette, 7);
  const S = buildShadowShell(o.seed ?? 17, 42);
  return {
    draw(p, t) { drawShadowShell(p, S, t, "exit", C, "both"); },
  };
}

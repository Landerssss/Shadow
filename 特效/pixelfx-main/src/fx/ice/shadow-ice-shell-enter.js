// 俯视角冰壳 · 结晶形成。改编自 pixelfx ice/freeze 的多面冰壳晶面绘制，移除人物与地面霜层。
import { fit } from "../../core/index.js";
import { buildShadowShell, drawShadowShell, SHADOW_SHELL_PALETTE, SHADOW_SHELL_ENTER } from "./_shadow-shell.js";

export const meta = {
  name: "Shadow ice shell · enter",
  desc: "A faceted, near-circular ice shell crystallizes around a top-down target, pane by pane.",
  tags: ["ice", "freeze", "status", "topdown", "enter"],
  size: [128, 128],
  origin: [64, 64],
  duration: SHADOW_SHELL_ENTER,
  loop: false,
  fps: 30,
  bg: "dark",
  options: { palette: SHADOW_SHELL_PALETTE, seed: 17 },
};

export function create(o) {
  const C = fit(o.palette, 7);
  const S = buildShadowShell(o.seed ?? 17, 42);
  return {
    draw(p, t) { drawShadowShell(p, S, t, "enter", C, "both"); },
  };
}

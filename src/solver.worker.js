import { solvePlan } from "./engine.js";
self.onmessage = async ({ data }) => {
  try {
    const result = await solvePlan(
      data.profile,
      data.template,
      data.foods,
      data.plan,
      data.rules,
      (progress) => self.postMessage({ type: "progress", progress }),
    );
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({ type: "error", error: error.message });
  }
};

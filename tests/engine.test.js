import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PROFILE,
  DEFAULT_RULES,
  getTemplate,
  getSlots,
  validateFoods,
  compose,
  solvePlan,
  solveDay,
  validatePlan,
} from "../src/engine.js";
import { SAMPLE_FOODS } from "../src/sample.js";

function setup(style = "chinese", mealCount = 3) {
  const profile = { ...DEFAULT_PROFILE, style, mealCount };
  const template = getTemplate(profile);
  const { foods } = validateFoods(
    { foods: SAMPLE_FOODS.filter((f) => getSlots(template).includes(f.slot)) },
    template,
    profile,
  );
  const plan = compose(profile, template, foods, DEFAULT_RULES);
  return { profile, template, foods, plan };
}
test("four templates produce consistent seeded schedules with every required slot", () => {
  for (const style of ["chinese", "light"])
    for (const count of [2, 3]) {
      const { profile, template, foods, plan } = setup(style, count);
      validatePlan(plan, profile, template, foods);
      assert.deepEqual(plan, compose(profile, template, foods, DEFAULT_RULES));
      assert.equal(plan.days.length, 7);
      assert.equal(plan.days[0].meals.length, count);
    }
});
test("allergy exclusions catch ingredients in composite dishes", () => {
  const profile = { ...DEFAULT_PROFILE, allergies: ["蛋", "奶"] };
  const template = getTemplate(profile);
  const result = validateFoods(
    { foods: SAMPLE_FOODS.filter((f) => getSlots(template).includes(f.slot)) },
    template,
    profile,
  );
  assert.ok(result.excluded.some((f) => f.id === "tomatoegg"));
  assert.ok(result.excluded.some((f) => f.id === "egg"));
  assert.ok(result.excluded.some((f) => f.id === "milk"));
  assert.ok(!result.foods.some((f) => f.id === "egg"));
});
test("a required slot cannot be relabeled optional in edited JSON", () => {
  const { profile, template, foods, plan } = setup();
  plan.days[0].meals[0].items[0].optional = true;
  assert.throws(() => validatePlan(plan, profile, template, foods), /optional/);
});
test("impossible calorie and portion constraints do not produce a passing day", () => {
  const { profile, template, foods, plan } = setup();
  const tinyFoods = foods.map((f) => ({
    ...f,
    portions: [{ grams: 1, label: "1克" }],
  }));
  const result = solveDay(
    plan.days[0],
    profile,
    template,
    tinyFoods,
    DEFAULT_RULES,
  );
  assert.equal(result.pass, false);
});
test("all four configurations solve days with independently checked constraints and executable portions", async () => {
  for (const style of ["chinese", "light"])
    for (const count of [2, 3]) {
      const { profile, template, foods, plan } = setup(style, count);
      const result = await solvePlan(
        profile,
        template,
        foods,
        plan,
        DEFAULT_RULES,
      );
      console.log(`${style}/${count}: ${result.summary.passed}/7 passed`);
      assert.ok(
        result.summary.passed >= 5,
        `${style}/${count} needs enough valid example days`,
      );
      for (const day of result.days.filter((d) => d.pass)) {
        assert.ok(day.checks.every((c) => c.pass));
        for (const meal of day.meals)
          for (const item of meal.items) {
            const food = foods.find((f) => f.id === item.foodId);
            assert.ok(food.portions.some((p) => p.grams === item.grams));
            if (item.foodId === "egg") assert.equal(item.grams % 50, 0);
          }
      }
    }
});

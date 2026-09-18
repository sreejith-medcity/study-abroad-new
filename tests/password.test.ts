import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { MIN_PASSWORD_LENGTH, passwordProblem, passwordStrength } from "../src/lib/password";

describe("password rules", () => {
  it("rejects anything shorter than the minimum", () => {
    assert.ok(passwordProblem("short1"));
    assert.ok(passwordProblem("a".repeat(MIN_PASSWORD_LENGTH - 1)));
  });

  it("rejects the passwords everyone tries first", () => {
    for (const bad of ["password123", "Passw0rd123", "letmein2024", "medcity2024", "qwertyuiop"]) {
      assert.ok(passwordProblem(bad), `${bad} should be rejected`);
    }
  });

  it("rejects keyboard and alphabet runs", () => {
    assert.ok(passwordProblem("Kappa-abcd-9271"));
    assert.ok(passwordProblem("Zephyr-1234-plum"));
  });

  it("rejects a password built from the person's own name or email", () => {
    assert.ok(passwordProblem("sreejith-boat-91", ["sreejith@miak.in", "Sreejith K"]));
    assert.ok(passwordProblem("boat-thomas-2291", ["thomas@example.com", "Thomas Varghese"]));
  });

  it("accepts a memorable phrase", () => {
    assert.equal(passwordProblem("copper heron valley", ["sreejith@miak.in", "Sreejith K"]), null);
    assert.equal(passwordProblem("Rainy-Kochi-Bus-72", ["ops@example.com", "Ops Desk"]), null);
  });

  it("rejects a password that repeats one or two characters", () => {
    assert.ok(passwordProblem("ababababab"));
  });

  it("scores a strong password above a weak one", () => {
    assert.ok(passwordStrength("Rainy-Kochi-Bus-72").score > passwordStrength("password123").score);
    assert.equal(passwordStrength("").score, 0);
  });
});

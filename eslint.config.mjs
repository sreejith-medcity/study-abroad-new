import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  { rules: { "react/no-unescaped-entities": "off" } },
  {
    // The browser smoke scripts use `condition ? ok(...) : bad(...)` throughout,
    // which reads well in a test and is not worth rewriting.
    files: ["tests/browser/**/*.mjs"],
    rules: { "@typescript-eslint/no-unused-expressions": "off" },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;

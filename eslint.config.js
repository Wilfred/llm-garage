// @ts-check
const eslint = require("@eslint/js");
const tseslint = require("typescript-eslint");
const noBareDiv = require("./eslint-rules/no-bare-div");

module.exports = tseslint.config(
  {
    ignores: ["dist/**", "data/**", "eslint.config.js", "eslint-rules/**"],
  },
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      local: { rules: { "no-bare-div": noBareDiv } },
    },
    rules: {
      "local/no-bare-div": "error",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);

import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "artifacts/**",
      "build/**",
      "dist/**",
      "dist-electron/**",
      "dist-electron-out/**",
      "dist-server/**",
      "node_modules/**",
      "publish/**",
      "test-results/**",
      "src/routeTree.gen.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "no-case-declarations": "off",
      "no-control-regex": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-undef": "off",
      "no-useless-assignment": "off",
      "no-useless-escape": "warn",
      "prefer-const": "off",
      "preserve-caught-error": "off",
      "react/no-danger": "off",
      "react-hooks/exhaustive-deps": "off",
    },
  },
  {
    files: ["electron/**/*.ts", "scripts/**/*.mjs", "vite*.ts", "playwright.config.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
);

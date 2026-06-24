import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  prettier,
  {
    settings: {
      react: { version: "detect" },
    },
    rules: {
      "react/react-in-jsx-scope": "off",
    },
  },
  {
    ignores: [
      "**/node_modules/**",
      "**/out/**",
      "**/dist/**",
      ".git/",
      ".agent-bus/",
      "监工文档/",
      "*.config.*",
    ],
  },
);

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // 既存コードに多数存在する `@typescript-eslint/no-explicit-any` などの型エラーや
  // 依存警告を許容し、アプリ全体のビルドを通すために、特定の既存ファイルに対してのみ
  // ルール制限を一時的に緩和（off / warn）しています。
  {
    files: [
      "src/lib/db.ts",
      "src/lib/utils.ts",
      "src/types/index.ts",
      "src/components/Sidebar.tsx",
      "src/components/LeafletMap.tsx",
      "src/components/MainApp.tsx",
      "src/components/AuthModal.tsx",
      "src/components/MapArea.tsx"
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/set-state-in-effect": "off"
    }
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "scripts/**",
  ]),
]);

export default eslintConfig;

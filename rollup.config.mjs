import commonjs from "@rollup/plugin-commonjs"
import json from "@rollup/plugin-json"
import resolve from "@rollup/plugin-node-resolve"
import terser from "@rollup/plugin-terser"
import typescript from "@rollup/plugin-typescript"
import crypto from "crypto"
import fs from "fs"
import * as tar from "tar"

const pkg = JSON.parse(fs.readFileSync("./package.json", "utf8"))

// Budibase installs a plugin from a .tar.gz holding plugin.min.js,
// schema.json and package.json. schema.json must carry the bundle's sha1
// `hash` and the package `version`, same as the Budibase plugin template.
const release = () => ({
  name: "budibase-release",
  buildStart() {
    if (!fs.existsSync("dist")) return
    for (const file of fs.readdirSync("dist")) {
      if (file.endsWith(".tar.gz")) fs.unlinkSync(`dist/${file}`)
    }
  },
  async writeBundle() {
    const hash = crypto
      .createHash("sha1")
      .update(fs.readFileSync("dist/plugin.min.js"))
      .digest("hex")
    const schema = JSON.parse(fs.readFileSync("schema.json", "utf8"))
    fs.writeFileSync(
      "dist/schema.json",
      JSON.stringify({ ...schema, hash, version: pkg.version }, null, 2)
    )
    fs.copyFileSync("package.json", "dist/package.json")
    await tar.c({ gzip: true, cwd: "dist", file: `dist/${pkg.name}-${pkg.version}.tar.gz` }, [
      "plugin.min.js",
      "schema.json",
      "package.json",
    ])
  },
})

export default {
  input: "src/index.ts",
  output: {
    sourcemap: false,
    format: "cjs",
    file: "dist/plugin.min.js",
    inlineDynamicImports: true,
    exports: "default",
  },
  plugins: [
    resolve({ preferBuiltins: true, browser: false }),
    typescript({
      tsconfig: false,
      compilerOptions: {
        target: "es2020",
        module: "esnext",
        lib: ["es2020", "dom"],
        strict: true,
        esModuleInterop: true,
        resolveJsonModule: true,
        skipLibCheck: true,
        moduleResolution: "node",
      },
      include: ["src/**/*"],
    }),
    commonjs(),
    json(),
    terser(),
    release(),
  ],
}

import { mkdtempSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { build } from "esbuild"

/**
 * @typedef {import("esbuild").Plugin} Plugin
 */

/**
 * @typedef {{
 *   contextEntryPoint: string
 * }} PluginProps
 */

/**
 * The compilation is run upon setup
 * TODO: correct stage for compilation
 * @param {PluginProps} props
 * @returns {Promise<Plugin>}
 */
const plugin = async (props) => {
    return {
        name: "helios-lang",
        setup: (build) => {
            build.onStart(async () => {
                console.log("building helios context entry point")
                const env = build.initialOptions.define ?? {}
                const tsConfig = build.initialOptions.tsconfig

                if (!tsConfig) {
                    throw new Error("tsconfig.json must be specified (TODO: auto-detect tsconfig.json")
                }
                await compileContextEntryPoint(props.contextEntryPoint, env, tsConfig)
            })
        }
    }
}

/**
 * @param {string} path 
 * @param {string} tsConfig
 * @param {any} env
 */
async function compileContextEntryPoint(path, env, tsConfig) {
    // make a temporary file
    const dstDir = mkdtempSync("helios")
    const dst = join(dstDir, "context.js")

    await build({
        bundle: true,
        splitting: false,
        packages: undefined,
        format: "cjs",
        platform: "node",
        minify: true,
        outfile: dst,
        entryPoints: [path],
        define: env,
        plugins: [],
        tsconfig: tsConfig
    })

    const output = eval(readFileSync(dst).toString())

    // TODO: do something with the output
    console.log(output)
}

export default plugin

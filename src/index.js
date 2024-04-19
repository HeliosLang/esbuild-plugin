import { mkdtempSync, promises } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { build } from "esbuild"

const { readFile } = promises

/**
 * @typedef {import("esbuild").Plugin} Plugin
 * @typedef {import("esbuild").PluginBuild} PluginBuild
 */

/**
 * @typedef {{
 *   contextEntryPoint: string
 * }} HeliosESBuildPluginProps
 */

/**
 * @param {HeliosESBuildPluginProps} props
 * @returns {Plugin}
 */
function makePlugin(props) {
    /**
     * @type {{[key: string]: any}}
     */
    const cache = {}

    const escapedEntryPoint = props.contextEntryPoint.replace(
        /[/\-\\^$*+?.()|[\]{}]/g,
        "\\$&"
    )

    const uuid = Math.floor(Date.now() / 20).toString(36)

    const cacheName = `__contractContextCache_${uuid}`

    /**
     * @param {{[key: string]: string}} env
     * @returns {string}
     */
    function getCacheKey(env) {
        const obj = [
            props.contextEntryPoint,
            Object.entries(env).sort((a, b) =>
                a[0] < b[0] ? -1 : a[0] == b[0] ? 0 : -1
            )
        ]

        // TODO: should this be hashed?
        return JSON.stringify(obj)
    }

    /**
     * @param {string} tsConfig
     * @param {{[key: string]: string}} env
     * @returns {Promise<any>}
     */
    async function compileContextEntryPoint(env, tsConfig) {
        // this must be cached
        const cacheKey = getCacheKey(env)
        const cacheValue = cache[cacheKey]
        if (cacheValue) {
            return cacheValue
        }

        // make a temporary file
        const dstDir = join(tmpdir(), `helios-${uuid}`)
        const dst = join(dstDir, "context.cjs")

        // create a bundle we can evaluate
        await build({
            bundle: true,
            splitting: false,
            packages: undefined,
            format: "cjs",
            platform: "node",
            minify: false,
            outfile: dst,
            entryPoints: [props.contextEntryPoint],
            define: env,
            plugins: [
                {
                    name: "helios-inject-context-build-cache",
                    setup: (build) => {
                        build.onLoad(
                            { filter: new RegExp(escapedEntryPoint) },
                            async (args) => {
                                const content = await readFile(
                                    args.path,
                                    "utf8"
                                )

                                return {
                                    contents: `import { contractContextCache as ${cacheName} } from "@helios-lang/contract-utils";
${cacheName}.enable();
export { ${cacheName} };
${content}`,
                                    loader: args.suffix.endsWith("js")
                                        ? "js"
                                        : "ts"
                                }
                            }
                        )
                    }
                }
            ],
            tsconfig: tsConfig
        })

        const output = await import(dst)

        const toBeInjected = output[cacheName].toJson()

        cache[cacheKey] = toBeInjected

        return toBeInjected
    }

    return {
        name: "helios-context-builder",
        setup: (build) => {
            build.onLoad(
                { filter: new RegExp(escapedEntryPoint) },
                async (args) => {
                    console.log("building helios context entry point...")
                    const env = build.initialOptions.define ?? {}
                    const tsConfig = build.initialOptions.tsconfig

                    if (!tsConfig) {
                        throw new Error(
                            "tsconfig.json must be specified (TODO: auto-detect tsconfig.json"
                        )
                    }

                    const toBeInjected = await compileContextEntryPoint(
                        env,
                        tsConfig
                    )

                    const content = await readFile(args.path, "utf8")

                    return {
                        contents: `import { contractContextCache as ${cacheName} } from "@helios-lang/contract-utils";
${cacheName}.load(${JSON.stringify(toBeInjected)});
${content}`,
                        loader: args.suffix.endsWith("js") ? "js" : "ts"
                    }
                }
            )
        }
    }
}

export default makePlugin

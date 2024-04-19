import { mkdtempSync, promises } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { build } from "esbuild"

const {readFile} = promises

/**
 * @typedef {import("esbuild").Plugin} Plugin
 * @typedef {import("esbuild").PluginBuild} PluginBuild
 */

/**
 * @typedef {{
 *   contextEntryPoint: string
 * }} ESBuildPluginProps
 */

/**
 * @param {ESBuildPluginProps} props
 * @returns {Plugin}
 */
export function ESBuildPlugin(props) {
    /**
     * @type {{[key: string]: any}}
     */
    const cache = {}

    const escapedEntryPoint = props.contextEntryPoint.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&')

    /**
     * @param {{[key: string]: string}} env 
     * @returns {string}
     */
    function getCacheKey(env) {
        const obj = [
            props.contextEntryPoint,
            Object.entries(env).sort((a, b) => a[0] < b[0] ? -1 : a[0] == b[0] ? 0 : -1)
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
        const dstDir = join(tmpdir(), `helios${Math.floor(Date.now() / 1000).toString(36)}`)
        const dst = join(dstDir, "context.cjs")

        console.log("DST: ", dst)

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
            plugins: [{
                name: "helios-inject-context-build-cache",
                setup: (build) => {
                    build.onLoad({filter: new RegExp(escapedEntryPoint)}, async (args) => {
                        const content = await readFile(args.path, "utf8")
                        console.log("suffix: ", args.suffix)
                        return {
                            contents: `export { contractContextCache } from "@helios-lang/contract-utils";contractContextCache.enable();\n${content}`,
                            loader: args.suffix.endsWith("js") ? "js" : "ts"
                        }
                    })
                }
            }],
            tsconfig: tsConfig
        })

        const output = await import(dst)

        const toBeInjected = output.contractContextCache.toJson()

        cache[cacheKey] = toBeInjected
        
        return toBeInjected
    }

    return {
        name: "helios-context-builder",
        setup: (build) => {
            build.onLoad({filter: new RegExp(escapedEntryPoint)}, async (args) => {
                console.log("building helios context entry point")
                const env = build.initialOptions.define ?? {}
                const tsConfig = build.initialOptions.tsconfig
    
                if (!tsConfig) {
                    throw new Error("tsconfig.json must be specified (TODO: auto-detect tsconfig.json")
                }
    
            const toBeInjected = await compileContextEntryPoint(env, tsConfig)
    
                const content = await readFile(args.path, "utf8")
    
                return {
                    contents: `import { contractContextCache } from "@helios-lang/contract-utils";\ncontractContextCache.load(${JSON.stringify(toBeInjected)});\n${content}`,
                    loader: args.suffix.endsWith("ts") ? "ts" : "js"
                }
            })
        }
    }
}

export default ESBuildPlugin

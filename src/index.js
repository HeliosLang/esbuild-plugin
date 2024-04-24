import { compileAndInject } from "./compile.js"
export { compileAndInject } // so it can be used by other plugins

/**
 * @typedef {import("esbuild").Plugin} Plugin
 * @typedef {import("esbuild").PluginBuild} PluginBuild
 */

/**
 * @typedef {{
 *   contextEntryPoint: string
 * }} HeliosESBuildPluginOptions
 */

/**
 * @param {HeliosESBuildPluginOptions} options
 * @returns {Plugin}
 */
export default function makePlugin(options) {
    /**
     * Cache that is persisted across the run
     * @type {{[key: string]: any}}
     */
    const cache = {}

    const escapedEntryPoint = options.contextEntryPoint.replace(
        /[/\-\\^$*+?.()|[\]{}]/g,
        "\\$&"
    )

    return {
        name: "esbuild-plugin-helios",
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

                    const modifiedContents = await compileAndInject({
                        path: args.path,
                        env: env,
                        tsConfig: tsConfig,
                        cache: cache
                    })

                    return {
                        contents: modifiedContents,
                        loader: args.suffix.endsWith("js") ? "js" : "ts"
                    }
                }
            )
        }
    }
}

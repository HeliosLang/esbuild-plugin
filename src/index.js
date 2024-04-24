import { compileAndInject } from "./compile.js"
export { compileAndInject } // so it can be used by other plugins

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
     * Cache that is persisted across the run
     * @type {{[key: string]: any}}
     */
    const cache = {}

    const escapedEntryPoint = props.contextEntryPoint.replace(
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

export default makePlugin

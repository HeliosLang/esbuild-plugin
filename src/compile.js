import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { build } from "esbuild"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"

const INTERNAL_CACHE_NAME =
    "__contractContextCache__DO_NOT_USE_THIS_VAR_FOR_SOMETHING_ELSE"

/**
 * cache is managed by caller
 * @typedef {{
 *   path: string
 *   env: Record<string, string>
 *   tsConfig: string
 *   cache?: Record<string, any>
 *   content?: string
 * }} CompileProps
 */

/**
 * @param {CompileProps} props
 * @returns {Promise<string>}
 */
export async function compileAndInject({ path, env, tsConfig, cache }) {
    const toBeInjected = await compile({ path, env, tsConfig, cache })

    const content = await readFile(path, "utf8")

    return `import { contractContextCache as ${INTERNAL_CACHE_NAME} } from "@helios-lang/contract-utils";
${INTERNAL_CACHE_NAME}.load(${JSON.stringify(toBeInjected)});
${content}`
}

/**
 * @param {CompileProps} props
 * @returns {Promise<any>}
 */
async function compile({ path, env, tsConfig, cache, content: maybeContent }) {
    const uuid = Math.floor(Date.now() / 20).toString(36)
    const internalName =
        "__contractContextCache__DO_NOT_USE_THIS_VAR_FOR_SOMETHING_ELSE"

    // this must be cached
    const cacheKey = getCacheKey(path, env)
    const cacheValue = cache ? cache[cacheKey] : undefined
    if (cacheValue) {
        return cacheValue
    }

    // make a temporary file
    const dstDir = join(tmpdir(), `helios-${uuid}`)
    const dst = join(dstDir, "context.cjs")

    const escapedPath = path.replace(/[/\-\\^$*+?.()|[\]{}]/g, "\\$&")

    // create a bundle we can evaluate
    await build({
        bundle: true,
        splitting: false,
        packages: undefined,
        format: "cjs",
        platform: "node",
        minify: false,
        outfile: dst,
        entryPoints: [path],
        define: env,
        plugins: [
            {
                name: "helios-inject-context-build-cache",
                setup: (build) => {
                    build.onLoad(
                        { filter: new RegExp(escapedPath) },
                        async (args) => {
                            const content =
                                maybeContent ??
                                (await readFile(args.path, "utf8"))

                            return {
                                contents: `import { contractContextCache as ${internalName} } from "@helios-lang/contract-utils";
    ${internalName}.enable();
    export { ${internalName} };
    ${content}`,
                                loader: args.suffix.endsWith("js") ? "js" : "ts"
                            }
                        }
                    )
                }
            }
        ],
        tsconfig: tsConfig
    })

    const h = generateHash(dst)

    const fsCachePath = join(tmpdir(), "helios-cache", h + ".json")

    if (existsSync(fsCachePath)) {
        const toBeInjected = JSON.parse(await readFile(fsCachePath, "utf8"))

        if (cache) {
            cache[cacheKey] = toBeInjected
        }

        return toBeInjected
    } else {
        const output = await import(dst)

        const toBeInjected = output[internalName].toJson()

        if (cache) {
            cache[cacheKey] = toBeInjected
        }

        await writeFile(fsCachePath, JSON.stringify(toBeInjected))

        return toBeInjected
    }
}

/**
 * This is for caching within the same runtime instance
 * @param {string} path
 * @param {{[key: string]: string}} env
 * @returns {string}
 */
function getCacheKey(path, env) {
    const obj = [
        path,
        Object.entries(env).sort((a, b) =>
            a[0] < b[0] ? -1 : a[0] == b[0] ? 0 : -1
        )
    ]

    // TODO: should this be hashed?
    return JSON.stringify(obj)
}

/**
 * @param {string} path
 * @returns {Promise<string>}
 */
async function generateHash(path) {
    const inputString = await readFile(path, "utf8")
    const hash = createHash("sha256")
    hash.update(inputString)
    return hash.digest("hex")
}

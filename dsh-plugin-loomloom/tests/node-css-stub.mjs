/**
 * A stylesheet import for a plain-Node test process.
 *
 * The browser resolves the shared atoms' style imports through the module-table
 * build; Node has no loader for `.css`, and the plugin's bundle spec imports the
 * plugin graph to check its slot wiring. Answering with a class-name map keeps
 * that graph loadable without a browser.
 * @param url - the module URL Node is loading.
 * @param context - the loader context handed to the next hook.
 * @param nextLoad - the remaining loader chain.
 * @returns a module whose default export answers any class-name lookup.
 */
export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) {
    return {
      format: 'module',
      shortCircuit: true,
      source: 'export default new Proxy({}, { get: (_target, key) => (typeof key === \'string\' ? key : undefined) })',
    }
  }
  return nextLoad(url, context)
}

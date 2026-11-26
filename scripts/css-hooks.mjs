// Node loader hook: a .css import resolves to an empty module (for Node scripts that reach UI modules importing CSS).
export async function load(url, context, next) {
  if (url.endsWith('.css')) return { format: 'module', source: 'export default ""', shortCircuit: true }
  return next(url, context)
}

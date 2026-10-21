// Loader que resolve os imports '/shared/...' do cliente para a pasta local.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as presolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = presolve(HERE, '..');

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('/shared/')) {
    const target = presolve(ROOT, 'shared', specifier.slice('/shared/'.length));
    return next(pathToFileURL(target).href, context);
  }
  if (specifier.startsWith('/js/')) {
    const target = presolve(ROOT, 'public', specifier);
    return next(pathToFileURL(target).href, context);
  }
  return next(specifier, context);
}

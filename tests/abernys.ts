import raw from '../modules/abernys-port-covenant.json';
import { loadModule, type PraxisModule } from '../src/engine';

export const abernysRaw: unknown = raw;

export function abernys(): PraxisModule {
  const result = loadModule(raw);
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.module;
}

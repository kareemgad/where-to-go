/**
 * Registers the "@/" resolver. Used as `node --import ./scripts/alias-register.mjs`.
 */
import { register } from 'node:module';

register('./alias-hook.mjs', import.meta.url);

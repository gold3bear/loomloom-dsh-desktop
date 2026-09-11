/**
 * Registers the `.css` loader fragment for the node:test suite.
 *
 * Loaded through `--import` beside tsx, so `tests/**\/*.spec.ts` may import the
 * real client plugin graph (which reaches the shared UI atoms and their
 * stylesheets) without a browser.
 */
import { register } from 'node:module'

register(new URL('./node-css-stub.mjs', import.meta.url))

// Vitest stand-in for the `server-only` marker package, which throws when
// imported outside a React Server environment. Aliased in vitest.config.mts
// so route-handler tests can exercise real server modules.
export {};

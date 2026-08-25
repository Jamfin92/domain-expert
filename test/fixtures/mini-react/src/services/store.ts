function createStore(shape: object): object {
  return shape;
}

/**
 * A sibling-bearing container that is NOT a set of definitions: the object
 * lives inside a factory call, so its members are never indexed. Its calls
 * must come out unattributed — handing them to `store` would fan each one
 * out to every component touching any sibling member.
 */
export const store = createStore({
  loadA(): Promise<Response> {
    return fetch("/api/store/a");
  },
  loadB(): Promise<Response> {
    return fetch("/api/store/b");
  },
});

const KEY = "hidden";

/**
 * The sibling count is ALL properties, not indexable-named ones: one named
 * member plus one computed-key member is still two siblings with distinct
 * potential callers, so BOTH calls must be refused — before the count fix,
 * this literal read as single-member and both calls fanned out to
 * StorePanel through the variable.
 */
export const mixedStore = createStore({
  named(): Promise<Response> {
    return fetch("/api/mixed/named");
  },
  [KEY](): Promise<Response> {
    return fetch("/api/mixed/computed");
  },
});

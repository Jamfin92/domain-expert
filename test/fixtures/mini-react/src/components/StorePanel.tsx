import { mixedStore, store } from "@/services/store";

/**
 * References both factory-made stores. None of the calls inside the factory
 * arguments' members may attribute here through the variables.
 */
export function StorePanel() {
  const dump = () => JSON.stringify([store, mixedStore]);
  return <code onClick={dump}>store</code>;
}

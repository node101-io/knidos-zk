import type { NormalizedFill } from "../types.ts"

export function stableSort(fills:NormalizedFill[]): NormalizedFill[] {
  if (fills.length === 0)
    return [];

  return fills
      .map((fill, index) => ({ fill, index }))
      .sort((a, b) => {

        if (a.fill.time !== b.fill.time)
          return a.fill.time - b.fill.time;
        // if the time is exactly the same we check Trade ID
        if (a.fill.tid !== b.fill.tid)
          return a.fill.tid - b.fill.tid;
        // if trade ID also the same we check Order ID
        if (a.fill.oid !== b.fill.oid)
          return a.fill.oid - b.fill.oid;

        return a.index - b.index;
      })
      .map((  { fill }  ) => fill);
}
/** `stats.nodeGroupSize` of every person, place and region, the nightly full
 * count: the graph read from one snapshot, walked on worker threads, the
 * sizes written back where they changed (decision on 2026-11-27: the count
 * runs in the application, the incremental path of a write stays in SQL,
 * `write_node_group_sizes`, 0602_stats_sql.sql and 0920).
 *
 * The meaning is getNodeGroups' (shared/graph/util.ts): every graph node has
 * an active state, which leads on, and a dead end, which does not. A root's
 * size is the number of counted people (persons whose `hide` is not truthy)
 * that its active state reaches: the active states reached, itself only
 * through a cycle, plus the dead ends of everything active reached, itself
 * included. A live edge (not `deleted`) links them as `edgeTraverse` says:
 *
 * | type       | source → target | target → source |
 * |------------|-----------------|-----------------|
 * | employed   | active          | dead end        |
 * | connection | active          | active          |
 * | owns       | active          | dead end        |
 * | mentions   | dead end        | active          |
 * | seat, comment, election, tagged | dead end | dead end |
 *
 * Against the incremental writes, which may commit while this one reads and
 * walks: under the exclusive lock they share (`group_lock`, 0920), the job
 * takes a number of the `node_group_gen` sequence before it reads; a write
 * stamps the rows it moves with a later number, and the job's own write,
 * under the same lock, leaves those rows alone. */
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import type postgres from "postgres";
import type { Db } from "./client";

/** The key of the advisory lock the nightly count and
 * `write_node_group_sizes` share (0920_group_sizes.sql). */
const LOCK = "node_derived.node_group_size";

/** Edge types of the graph, by what their two links do: forward (source →
 * target) active is 1, reverse active is 2. */
const EDGE_KINDS = `CASE WHEN e.type = 'connection' THEN 3
  WHEN e.type IN ('employed', 'owns') THEN 1 WHEN e.type = 'mentions' THEN 2 ELSE 0 END`;
const GRAPH_EDGES = `('employed', 'connection', 'mentions', 'owns', 'seat', 'comment', 'election', 'tagged')`;
const GRAPH_NODES = `('person', 'place', 'region')`;

export interface GroupSizesReport {
  nodes: number;
  edges: number;
  changed: number;
  threads: number;
  ms: { read: number; compute: number; write: number; total: number };
}

/** The graph in compressed rows, every array on shared memory so the workers
 * read it without a copy: the active links of node v are
 * `actAdj[actOff[v] .. actOff[v + 1])`, its links to counted dead ends
 * `deadAdj[deadOff[v] .. deadOff[v + 1])`. */
export interface GroupGraph {
  n: number;
  counted: Uint8Array;
  actOff: Uint32Array;
  actAdj: Uint32Array;
  deadOff: Uint32Array;
  deadAdj: Uint32Array;
}

/** The default worker count: up to four, never more than the machine has. */
export function defaultThreads(): number {
  const configured = Number(process.env.NODE_GROUP_THREADS);
  if (Number.isInteger(configured) && configured > 0) return configured;
  return Math.max(1, Math.min(4, availableParallelism()));
}

function shared32(n: number): Uint32Array {
  return new Uint32Array(new SharedArrayBuffer(Math.max(4, 4 * n)));
}

/** A COPY's binary stream (`FORMAT binary`) as whole tuples: `tuple(buf, at)`
 * gets each tuple's offset and returns its length, or 0 when the tuple does
 * not fit in what is buffered yet. */
async function readBinaryCopy(
  stream: AsyncIterable<Buffer>,
  tuple: (buf: Buffer, at: number) => number,
): Promise<void> {
  let left: Buffer | undefined;
  let header = true;
  for await (const chunk of stream) {
    const buf = left ? Buffer.concat([left, chunk]) : chunk;
    let at = 0;
    if (header) {
      // PGCOPY\n\377\r\n\0, flags, the length of the header extension.
      if (buf.length < 19) {
        left = buf;
        continue;
      }
      at = 19 + buf.readUInt32BE(15);
      header = false;
    }
    for (;;) {
      if (buf.length - at < 2) break;
      if (buf.readInt16BE(at) === -1) return;
      const used = tuple(buf, at);
      if (used === 0) break;
      at += used;
    }
    left = at < buf.length ? Buffer.from(buf.subarray(at)) : undefined;
  }
}

/** The graph's nodes in id order (a node's dense id is its position), and
 * whether each is a counted person. */
async function readNodes(
  tx: postgres.TransactionSql,
): Promise<{ ids: string[]; counted: Uint8Array }> {
  const ids: string[] = [];
  let counted = new Uint8Array(1 << 16);
  const stream = await tx
    .unsafe(
      `COPY (SELECT id, type = 'person' AND NOT js_truthy(data -> 'hide')
         FROM nodes WHERE type IN ${GRAPH_NODES} ORDER BY id)
       TO STDOUT (FORMAT binary)`,
    )
    .readable();
  await readBinaryCopy(stream as AsyncIterable<Buffer>, (buf, at) => {
    // fields (2), id: length (4) + bytes, counted: length (4) + 1 byte
    if (buf.length - at < 6) return 0;
    const len = buf.readInt32BE(at + 2);
    const size = 2 + 4 + len + 4 + 1;
    if (buf.length - at < size) return 0;
    const i = ids.length;
    ids.push(buf.toString("utf8", at + 6, at + 6 + len));
    if (i === counted.length) {
      const grown = new Uint8Array(counted.length * 2);
      grown.set(counted);
      counted = grown;
    }
    counted[i] = buf[at + 6 + len + 4]!;
    return size;
  });
  return { ids, counted: counted.subarray(0, ids.length) };
}

/** The edges between two graph nodes, one row an edge: the dense ids of its
 * ends, numbered in SQL the way readNodes orders them, and its kind in the
 * two high bits of the target (n stays far below 2^30). */
async function readEdges(
  tx: postgres.TransactionSql,
): Promise<{ src: Uint32Array; dst: Uint32Array; m: number }> {
  let cap = 1 << 18;
  let m = 0;
  let src = new Uint32Array(cap);
  let dst = new Uint32Array(cap);
  const stream = await tx
    .unsafe(
      `COPY (
         WITH g AS MATERIALIZED (
           SELECT id, (row_number() OVER (ORDER BY id) - 1)::int4 AS i
           FROM nodes WHERE type IN ${GRAPH_NODES})
         SELECT s.i, t.i | (${EDGE_KINDS} << 30)
         FROM edges e JOIN g s ON s.id = e.source JOIN g t ON t.id = e.target
         WHERE e.type IN ${GRAPH_EDGES} AND NOT e.deleted)
       TO STDOUT (FORMAT binary)`,
    )
    .readable();
  await readBinaryCopy(stream as AsyncIterable<Buffer>, (buf, at) => {
    // fields (2), source: 4 + 4, target and kind: 4 + 4
    if (buf.length - at < 18) return 0;
    if (m === cap) {
      cap *= 2;
      const s2 = new Uint32Array(cap);
      s2.set(src);
      src = s2;
      const d2 = new Uint32Array(cap);
      d2.set(dst);
      dst = d2;
    }
    src[m] = buf.readUInt32BE(at + 6);
    dst[m] = buf.readUInt32BE(at + 14);
    m++;
    return 18;
  });
  return { src, dst, m };
}

/** Reads the graph from one snapshot: the nodes, then their edges as pairs
 * of dense ids computed in SQL, binary, straight into typed arrays. The join
 * to the dense ids is most of the read (1.4 of 2.3 s at x10). */
export async function readGroupGraph(
  sql: Db,
): Promise<{ ids: string[]; graph: GroupGraph }> {
  return sql.begin("ISOLATION LEVEL REPEATABLE READ READ ONLY", async (tx) => {
    await tx`SET LOCAL jit = off`;
    await tx`SET LOCAL work_mem = '256MB'`;
    const nodes = await readNodes(tx);
    const edges = await readEdges(tx);
    return {
      ids: nodes.ids,
      graph: buildGraph(nodes.ids.length, nodes.counted, [edges]),
    };
  });
}

/** The compressed rows of the links that matter: active ones, and links to
 * dead ends of counted people. An active link of a node to itself leads
 * nowhere new and is dropped. */
export function buildGraph(
  n: number,
  countedList: Uint8Array,
  parts: readonly { src: Uint32Array; dst: Uint32Array; m: number }[],
): GroupGraph {
  const counted = new Uint8Array(new SharedArrayBuffer(Math.max(1, n)));
  counted.set(countedList);
  const actOff = shared32(n + 1);
  const deadOff = shared32(n + 1);
  const LOW = 0x3fffffff;
  for (const { src, dst, m } of parts)
    for (let e = 0; e < m; e++) {
      const s = src[e]!;
      const t = dst[e]! & LOW;
      const kind = dst[e]! >>> 30;
      if (kind & 1) {
        if (s !== t) actOff[s + 1]!++;
      } else if (counted[t]) deadOff[s + 1]!++;
      if (kind & 2) {
        if (s !== t) actOff[t + 1]!++;
      } else if (counted[s]) deadOff[t + 1]!++;
    }
  for (let v = 0; v < n; v++) {
    actOff[v + 1]! += actOff[v]!;
    deadOff[v + 1]! += deadOff[v]!;
  }
  const actAdj = shared32(actOff[n]!);
  const deadAdj = shared32(deadOff[n]!);
  const pa = actOff.slice(0, n);
  const pd = deadOff.slice(0, n);
  for (const { src, dst, m } of parts)
    for (let e = 0; e < m; e++) {
      const s = src[e]!;
      const t = dst[e]! & LOW;
      const kind = dst[e]! >>> 30;
      if (kind & 1) {
        if (s !== t) actAdj[pa[s]!++] = t;
      } else if (counted[t]) deadAdj[pd[s]!++] = t;
      if (kind & 2) {
        if (s !== t) actAdj[pa[t]!++] = s;
      } else if (counted[s]) deadAdj[pd[t]!++] = s;
    }
  return { n, counted, actOff, actAdj, deadOff, deadAdj };
}

/** One walker: takes roots in chunks from the shared counter `next` and
 * walks each breadth first, with epoch-stamped visited marks that are never
 * cleared. Runs as the source of an eval worker as well, so it reads nothing
 * from outside its arguments and declares no inner functions. */
function walkRoots(data: GroupGraph & { size: Uint32Array; next: Int32Array }) {
  const { n, counted, actOff, actAdj, deadOff, deadAdj, size, next } = data;
  const CHUNK = 256;
  const seen = new Uint32Array(n);
  const dseen = new Uint32Array(n);
  const queue = new Uint32Array(n);
  let epoch = 0;
  for (;;) {
    const lo = Atomics.add(next, 0, CHUNK);
    if (lo >= n) break;
    const hi = Math.min(n, lo + CHUNK);
    for (let r = lo; r < hi; r++) {
      epoch++;
      let head = 0;
      let tail = 0;
      let count = 0;
      for (let k = deadOff[r]!, end = deadOff[r + 1]!; k < end; k++) {
        const t = deadAdj[k]!;
        if (dseen[t] !== epoch) {
          dseen[t] = epoch;
          count++;
        }
      }
      for (let k = actOff[r]!, end = actOff[r + 1]!; k < end; k++) {
        const t = actAdj[k]!;
        if (seen[t] !== epoch) {
          seen[t] = epoch;
          queue[tail++] = t;
        }
      }
      while (head < tail) {
        const v = queue[head++]!;
        count += counted[v]!;
        for (let k = deadOff[v]!, end = deadOff[v + 1]!; k < end; k++) {
          const t = deadAdj[k]!;
          if (dseen[t] !== epoch) {
            dseen[t] = epoch;
            count++;
          }
        }
        for (let k = actOff[v]!, end = actOff[v + 1]!; k < end; k++) {
          const t = actAdj[k]!;
          if (seen[t] !== epoch) {
            seen[t] = epoch;
            queue[tail++] = t;
          }
        }
      }
      size[r] = count;
    }
  }
}

const WORKER_SOURCE = `const { parentPort, workerData } = require("node:worker_threads");
(${walkRoots.toString()})(workerData);
parentPort.postMessage(0);`;

/** The size of every node of `graph`, by its dense id, on `threads` workers
 * (in this thread when it is one). */
export async function walkGroupSizes(
  graph: GroupGraph,
  threads = defaultThreads(),
): Promise<Uint32Array> {
  const size = shared32(graph.n);
  const next = new Int32Array(new SharedArrayBuffer(4));
  const data = { ...graph, size, next };
  if (threads <= 1) {
    walkRoots(data);
    return size;
  }
  await Promise.all(
    Array.from(
      { length: threads },
      () =>
        new Promise<void>((resolve, reject) => {
          const worker = new Worker(WORKER_SOURCE, {
            eval: true,
            workerData: data,
          });
          worker.once("message", () => {
            void worker.terminate();
            resolve();
          });
          worker.once("error", reject);
          worker.once("exit", (code) => {
            if (code !== 0) reject(new Error(`walker exited with ${code}`));
          });
        }),
    ),
  );
  return size;
}

/** The sizes as one binary COPY of `(id text, size int4)`. */
function* binaryRows(ids: string[], size: Uint32Array): Generator<Buffer> {
  const header = Buffer.from("PGCOPY\n\xff\r\n\0", "latin1");
  const CHUNK = 1 << 20;
  let buf = Buffer.allocUnsafe(CHUNK);
  header.copy(buf, 0);
  buf.writeUInt32BE(0, 11);
  buf.writeUInt32BE(0, 15);
  let at = 19;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    // 3 bytes of UTF-8 at most per UTF-16 unit
    const need = 2 + 4 + 3 * id.length + 4 + 4 + 2;
    if (at + need > buf.length) {
      yield buf.subarray(0, at);
      buf = Buffer.allocUnsafe(Math.max(CHUNK, need));
      at = 0;
    }
    buf.writeInt16BE(2, at);
    const len = buf.write(id, at + 6, "utf8");
    buf.writeInt32BE(len, at + 2);
    at += 6 + len;
    buf.writeInt32BE(4, at);
    buf.writeInt32BE(size[i]!, at + 4);
    at += 8;
  }
  buf.writeInt16BE(-1, at);
  yield buf.subarray(0, at + 2);
}

/** Writes the sizes where they changed, leaving the rows that an incremental
 * write stamped after `generation`; every node off the graph gets 0. Returns
 * the rows it changed. */
export async function writeGroupSizes(
  sql: Db,
  ids: string[],
  size: Uint32Array,
  generation: string,
): Promise<number> {
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${LOCK}))`;
    await tx`CREATE TEMP TABLE group_sizes_fresh (id text COLLATE "C", size int4)
      ON COMMIT DROP`;
    const writable =
      await tx`COPY group_sizes_fresh FROM STDIN (FORMAT binary)`.writable();
    await new Promise<void>((resolve, reject) => {
      writable.once("error", reject);
      writable.once("finish", resolve);
      (async () => {
        for (const chunk of binaryRows(ids, size)) {
          if (!writable.write(chunk))
            await new Promise((drained) => writable.once("drain", drained));
        }
        writable.end();
      })().catch(reject);
    });
    // Only the rows that differ reach ON CONFLICT: a hash join finds them.
    const upserted = await tx`
      INSERT INTO node_derived AS d (id, node_group_size)
      SELECT f.id, f.size FROM group_sizes_fresh f
      JOIN nodes n ON n.id = f.id
      LEFT JOIN node_derived o ON o.id = f.id
      WHERE o.id IS NULL OR (o.node_group_size IS DISTINCT FROM f.size
        AND (o.group_gen IS NULL OR o.group_gen <= ${generation}::bigint))
      ON CONFLICT (id) DO UPDATE SET node_group_size = excluded.node_group_size
      WHERE d.node_group_size IS DISTINCT FROM excluded.node_group_size
        AND (d.group_gen IS NULL OR d.group_gen <= ${generation}::bigint)`;
    const left = await tx`
      INSERT INTO node_derived AS d (id, node_group_size)
      SELECT n.id, 0 FROM nodes n LEFT JOIN node_derived o ON o.id = n.id
      WHERE n.type IS DISTINCT FROM 'person' AND n.type IS DISTINCT FROM 'place'
        AND n.type IS DISTINCT FROM 'region'
        AND (o.id IS NULL OR (o.node_group_size <> 0
          AND (o.group_gen IS NULL OR o.group_gen <= ${generation}::bigint)))
      ON CONFLICT (id) DO UPDATE SET node_group_size = 0
      WHERE d.node_group_size <> 0
        AND (d.group_gen IS NULL OR d.group_gen <= ${generation}::bigint)`;
    return upserted.count + left.count;
  });
}

/** A number of `node_group_gen`, taken while no incremental write is open:
 * every write with a smaller one has committed before the snapshot that
 * follows. */
export async function takeGeneration(sql: Db): Promise<string> {
  const [row] = await sql.begin(
    (tx) => tx<{ g: string }[]>`
      SELECT pg_advisory_xact_lock(hashtext(${LOCK})), nextval('node_group_gen')::text AS g`,
  );
  return row!.g;
}

/** The nightly count: snapshot, walk, write. */
export async function refreshGroupSizes(
  sql: Db,
  options: { threads?: number } = {},
): Promise<GroupSizesReport> {
  const threads = options.threads ?? defaultThreads();
  const started = performance.now();
  const generation = await takeGeneration(sql);
  const { ids, graph } = await readGroupGraph(sql);
  const read = performance.now();
  const size = await walkGroupSizes(graph, threads);
  const computed = performance.now();
  const changed = await writeGroupSizes(sql, ids, size, generation);
  const done = performance.now();
  return {
    nodes: graph.n,
    edges: graph.actAdj.length + graph.deadAdj.length,
    changed,
    threads,
    ms: {
      read: read - started,
      compute: computed - read,
      write: done - computed,
      total: done - started,
    },
  };
}

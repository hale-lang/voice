# The repository as a graph (draft)

What `hale dna init` should ingest from this repository, exactly enough to
be checked against. Voice is one recursive hypergraph. The org chart and
the deployed process model are two perspectives over it, not its trunk;
the process model settled into its shape because of the goals and
constraints, and changes when they do. This document lists the node kinds,
the hyperedge kinds, the nodes and edges the repository holds today, the
holes `init` should propose to fill, and the two perspectives as queries.

Nothing here is authored twice: every node below is a thing that already
exists in the repository, and every edge a reference it already makes.

## Node kinds

| Kind | What it is | Where it comes from |
|---|---|---|
| `purpose` | The horizon: what voice is for. One node. | `README.md`, first paragraph |
| `axiom` | A goal or constraint, declared and irreducible. What the rest was shaped by. | The decisions in `DIRECTION.md` |
| `process` | A thing that runs as its own process. | The README's process model; `compose.yaml` services |
| `seed` | A Hale seed or package: a unit of code with its own gate. | `api/`, `brain/`, `node/`, `ui/`, `spec/validate/` |
| `contract` | A specification two or more processes meet at. | `spec/*.yaml`, `spec/store.md`, `spec/vendor/` |
| `noun` | A schema inside a contract: a thing the system knows. | `components/schemas`, the store's tables |
| `deployment` | An instance of the process model, running or named. | `compose.yaml`; the README's deployments |
| `practice` | A rule about how work is done, as advice until ratified as law. | Rules in `DIRECTION.md`, `ui/DESIGN.md`, the READMEs |
| `gate` | A check that must pass. | Jobs in `.github/workflows/ci.yml` |
| `document` | Prose that explains or decides. | Every `.md` |
| `witness` | Evidence that something bit: a friction entry or a filed issue. | `FRICTION.md` entries; issues on hale and voice |
| `position` | A role with authority over some nodes. **None exist yet.** | Authored at `init` |
| `work` | A deliverable with a done-when. **None exist yet.** | Authored at `init` |

## Hyperedge kinds (arity two or more)

| Edge | Reads as |
|---|---|
| `unfold(Σ, [children])` | This node is made of these. |
| `meets(contract; server; consumers…)` | These processes meet at this contract; the server implements it, the consumers depend on it. |
| `names(contract, [nouns])` | This contract defines these nouns. |
| `refers(noun, noun, via)` | A `$ref` or foreign key. |
| `constrains(axiom, [nodes])` | This decision shaped these. |
| `runs(deployment, [processes])` | This deployment runs these. |
| `gates(gate, [nodes])` | This check guards these. |
| `binds(practice, [nodes])` | This rule applies to these. |
| `witnesses(witness, [nodes])` | This evidence is about these. |
| `holds(position, holder)` | A person or agent holds this role. Empty today. |
| `reviews(position, contract)` | This role signs changes to this contract. Empty today. |

## The nodes, as they stand

**purpose**: one inference endpoint over many backends, standalone, with
its own admin UI; first value, seeing tokens and quota across the
operator's own accounts.

**axiom** (from `DIRECTION.md`; the ones that are consequences rather than
decisions are marked *derived* and would be `practice`, not `axiom`):

1. The caller API is an open standard (Open Responses).
2. Voice extends the standard only in the ways it allows.
3. Chat Completions is a compatibility surface.
4. Every request belongs to one project and one key.
5. Responses report what actually served them.
6. Callers never name a node; they may name the account that pays.
7. Nothing is discovered; everything that serves is configured, and the API
   is the first-class way to configure it.
8. The node decides what is possible; the coordinator decides what runs.
9. Local controls only restrict.
10. The protocol and the node plane are the seam; any program that speaks
    them can be a node.
11. One admin UI, in this repository, served by the api from its own
    origin; the api is the trust boundary.
12. Only the api is exposed; NATS and the nodes are on the private network.
13. The MVP runs the real process model.
14. State never travels as events; it stays in Postgres.
15. Real development is delivered through a DNA organization; this
    repository holds the design and chalk lines. *(stated in conversation,
    not yet in a document)*
16. No bypass flags for agent CLIs; each CLI's own policy inside a
    container; logins stay with the official binaries. *(same)*

**process**: `api`, `brain`, `node`, `postgres`, `nats`.

**seed**: `api`, `brain`, `node`, `ui` (design only), `spec/validate`.

**contract**: `spec/openapi.yaml` (caller, admin and node planes),
`spec/node.yaml`, `spec/protocol.yaml`, `spec/internal.yaml`,
`spec/store.md`, `spec/vendor/open-responses` (taken by reference).

**noun** (the ones every perspective needs; the contracts hold ~90 schemas
and 18 tables in all): model, account, node, seat, engine, capabilities,
local controls, assignment, project, key, budget, limit, request,
reservation, usage record, route table, change, policy change, admin event.

**deployment**: `compose` (built and verified), `personal` (named),
`scaled-out` (named).

**practice** (a sample; the full set is every rule-shaped bullet in
`DIRECTION.md`, `ui/DESIGN.md`, `README.md` and `ui/README.md`): the
contract comes before the code; a change to a contract is a new
migration, never an edit; the brain talks to nothing but Postgres and the
route table it publishes; per-node and per-request subjects use the NATS
client, only broadcasts bind; color is earned by activity; volume is
logarithmic; ground truth beside intent; tokens are framework-free and
components know none of voice's nouns; the hale toolchain version is
pinned in the action and the Dockerfile together; keep a `FRICTION.md`.

**gate**: `ci/api`, `ci/brain`, `ci/node`, `ci/contracts`, `ci/image`.

**document**: `README.md`, `DIRECTION.md`, `FRICTION.md`, `GRAPH.md`,
`ui/README.md`, `ui/DESIGN.md`, `spec/store.md`, `spec/validate/*`.

**witness**: FRICTION §1 (a `Router.add` handler dangles), §2 (no
triple-quoted strings), §3 (no reason phrases); hale#1048; voice#2.

## The edges, as they stand

`unfold`:
- `purpose` → the axioms.
- `api` → seed `api`; *(holes: positions dev, reviewer)*.
- `brain` → seed `brain`; *(holes)*. `node` → seed `node`; *(holes)*.
- `postgres` → contract `store.md`; *(hole: the store seed)*.
- `nats` → contracts `protocol.yaml`, `internal.yaml`.
- `ui` → seed `ui`; *(holes)*.
- `compose` → *(hole: operator)*.

`meets` (the contract as the meeting point):
- `openapi.yaml`; served by `api`; consumed by callers, `ui`, `node`
  (its node plane).
- `node.yaml`; served by `node`; consumed by the machine's operator.
- `protocol.yaml`; served by `node`; consumed by `api`; carried by `nats`.
- `internal.yaml`; served by `brain`; consumed by `api`; carried by `nats`.
- `store.md`; served by `postgres` (and the store seed); consumed by `api`,
  `brain`.
- `open-responses`; served by nobody here; consumed by `openapi.yaml`,
  `protocol.yaml` (by reference).

`names` and `refers`: as the `$ref`s and foreign keys already state; for
instance seat → engine (a node's declared engine), seat → account,
seat → model, request → project, key, instance; usage → request.

`constrains` (axiom → what it shaped; the edges that explain the process
model):
- 12 (only the api exposed) → `protocol.yaml` (NATS, not WebSocket),
  `compose` (what is published), practice "nodes on the private network".
- 14 (state never travels as events) → `internal.yaml` (the route table is
  a snapshot), `store.md` (reservation and settlement are transactions).
- 13 (the MVP runs the real process model) → `brain` as its own process,
  `nats` in `compose`.
- 7, 8, 9 (configured, node decides possible, local only restricts) →
  `node.yaml` (the capabilities file, local controls), the node plane,
  `protocol.yaml` (assignments, refused seats).
- 11 (one UI, api is the trust boundary) → `ui/README.md`, `ui/DESIGN.md`,
  `openapi.yaml` (the admin event stream, `/admin/v1/routes`).
- 6 (callers never name a node) → `openapi.yaml` (`voice.account`, `Served`).
- 16 (no bypass flags) → the node's engines, voice#2.
- 15 (delivered through DNA) → this document.

`runs`:
- `compose` → `postgres`, `nats`, `api`, `brain`, `node`.
- `personal` → `api`, `brain`, `postgres`, `nats` on one machine; `node` per
  machine with logins.
- `scaled-out` → `api` ×N behind a terminator, `brain` with a standby,
  `postgres`, `nats`, `node` anywhere.

`gates`:
- `ci/api` → seed `api`, `openapi.yaml` (live). `ci/node` → seed `node`,
  `node.yaml` (live). `ci/brain` → seed `brain`.
- `ci/contracts` → every contract, and the canned bodies against
  `openapi.yaml`.
- `ci/image` → `compose`.

`binds`: each practice to the seeds or contracts it names; e.g. "only
broadcasts bind" → `api`, `node`; "components know none of voice's nouns"
→ `ui`; "a contract change is a new migration" → `store.md`.

`witnesses`:
- hale#1048, FRICTION §1 → seeds `api`, `node` (the `is_route` ladders).
- FRICTION §2 → `api` (canned bodies live in files).
- voice#2 → the node's engines, axiom 16.

`holds`, `reviews`: none. These are the holes.

## The holes: what `init` should propose

The graph lacks exactly what a delivery needs and the repository cannot
imply. `init` should propose these and the Board ratify:

- **Positions** under each process: `dev` (bound by the process's
  practices, writes) and `reviewer` (holds the contract the process
  serves, signs; never the same holder as `dev` for that process). A
  `board` under `purpose`. An `operator` under each deployment. Deeper
  substructure (core, library, integration) when a process grows.
- **`reviews` edges** from each `meets`: the reviewer of a contract's
  server signs changes to it; a change to a contract fans out to the
  reviewers of every consumer; `board` where the contract is law.
- **Operational roles** under deployments that no artifact implies:
  support for a deployment's projects, account and quota management,
  billing, on-call. Created empty, named by the Board.
- **Work**: the five MVP deliverables, each an `unfold` of a process with
  a done-when that is its gate: the store seed (`store.md`'s migrations
  and transactions), `api`, `brain`, `node`, `ui`.
- **Axioms 15 and 16** written into `DIRECTION.md`, and the *derived*
  bullets there demoted to practices.
- **Practices ratified as law** where the Board chooses; the rest stay
  advice.

## The two perspectives, as queries

**The org chart**: nodes are `position`s and their holders; edges are
`unfold` (which process or deployment a position is under) and `reviews`
(who signs what). Rendered for voice once the holes are filled:

```
purpose
  board
  api        dev, reviewer(openapi.yaml)
  brain      dev, reviewer(internal.yaml)
  node       dev, reviewer(protocol.yaml, node.yaml)
  postgres   dev (the store seed), reviewer(store.md)
  ui         dev, reviewer(ui/DESIGN.md)
  compose    operator
```

**The process model**: nodes are `process`es; edges are `meets` (which
contract, over which transport) and `runs` (which deployment). Rendered
for voice today:

```
callers, ui  --HTTP: openapi.yaml-->  api  --HTTP: node plane<--  node
api  --NATS: protocol.yaml-->  node
brain  --NATS: internal.yaml-->  api
api, brain  --SQL: store.md-->  postgres
compose runs { postgres, nats, api, brain, node }
```

Both are views. Neither is edited directly: a change to a contract moves
through `meets` and shows up in both; a constraint added under `purpose`
moves through `constrains` and may reshape either.

## Checkable

`hale dna init` on this repository, at this commit, should yield: 1
purpose, 16 axioms, 5 processes, 5 seeds, 6 contracts, 3 deployments (1
built), 5 gates, 8 documents, 5 witnesses, 0 positions, 0 work; the edges
above; and proposals for every hole listed. A later commit that adds a
contract, a seed or a decision changes those counts, and the diff between
two ingests is the review.

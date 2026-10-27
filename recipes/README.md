# Recipes

The recipes voice ships: defaults an operator can use, one file per recipe,
`<id>.json`, matching `RecipeCreate` in
[`spec/openapi.yaml`](../spec/openapi.yaml). Each pins one revision of one
source and every file's digest, and lists only files that hold tensors, a
tokenizer or settings, never a pickle or code.

The operator is the authority on which weights may run: they allow more
recipes on the admin plane (`POST /admin/v1/recipes`). These are read by the
api at start (`--recipes`), listed as `shipped`, and cannot be changed or
removed through the API. A shipped recipe never changes either: other
weights are another id. CI holds every file here to the contract
(`spec/validate/curated.mjs`), and the api holds it to the same rules when
it reads it.

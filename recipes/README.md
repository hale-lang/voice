# Recipes

Where a local model's weights come from: one file per recipe, `<id>.json`,
matching `Recipe` in [`spec/openapi.yaml`](../spec/openapi.yaml). Each pins a
source's commit and every file's digest, and lists only formats that hold
tensors (safetensors, GGUF, MLX), never pickled checkpoints or code.

A recipe is curated: it lands here through review, like code, and ships with
a release. The api reads this directory at start (`--recipes`) and never
takes a recipe over the API; a catalog model names one by its id. CI holds
every file here to the contract (`spec/validate/recipes.mjs`).

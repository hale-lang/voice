create table node_inventory (
  node        text primary key references node,
  blobs       text not null,          -- "<sha256> <bytes>" a file, a line, by sha256
  reported_at timestamptz not null
);

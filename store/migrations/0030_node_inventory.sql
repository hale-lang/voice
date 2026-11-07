create table node_inventory (
  node        text primary key references node,
  blobs       text not null,          -- "<sha256> <bytes>" a file, a line, by sha256
  files       integer not null,       -- how many lines
  bytes       bigint not null,        -- their sizes together
  reported_at timestamptz not null
);

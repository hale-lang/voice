create table link_check (
  id          text primary key,
  node_a      text not null references node,   -- rank 0, whose address the ranks meet at
  node_b      text not null references node,   -- rank 1
  created_at  timestamptz not null,
  master_addr text not null,                   -- node_a's address on the link, where the ranks meet
  image       text not null,                   -- the image both run it in, by digest
  result_a    jsonb,                           -- LinkCheckResult, as rank 0 reported it
  result_b    jsonb                            -- and rank 1
);
create index link_check_pair on link_check (node_a, node_b, created_at);

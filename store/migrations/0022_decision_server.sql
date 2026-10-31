update runtime set body = jsonb_set(body, '{server}', '"decision"') where body->>'server' = 'jev-style';
update placement set body = jsonb_set(body, '{runtime}', '"decision-0.3.0-mlx"') where body->>'runtime' = 'jev-style-0.3.0-mlx';
update placement set body = jsonb_set(body, '{fit}', (select jsonb_agg(case when f->>'runtime' = 'jev-style-0.3.0-mlx' then jsonb_set(f, '{runtime}', '"decision-0.3.0-mlx"') else f end order by n) from jsonb_array_elements(body->'fit') with ordinality as e(f, n))) where body->'fit' @> '[{"runtime": "jev-style-0.3.0-mlx"}]';

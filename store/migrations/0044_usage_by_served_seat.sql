create index usage_by_served_seat on usage ((served->>'seat'), created_at desc);  -- a seat's requests, newest first: the speed a placement measured

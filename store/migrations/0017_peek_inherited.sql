alter table project alter column peek drop not null;
alter table project alter column peek drop default;
update project set peek = null where peek = false;

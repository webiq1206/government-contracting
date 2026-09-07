-- Keep the physical storage provider with each compliance document.
--
-- Deletion cannot be safely retried if the application has to guess whether a
-- path lives in Postgres, Supabase, or the legacy local store. New writes save
-- the exact provider. Existing Postgres-backed rows can be identified without
-- guessing; older external rows remain null and use the legacy multi-backend
-- cleanup path.

alter table public.compliance_item_documents
  add column if not exists storage_backend text;

create index if not exists compliance_item_documents_storage_path_idx
  on public.compliance_item_documents (storage_path);

update public.compliance_item_documents d
   set storage_backend = 'db'
 where d.storage_backend is null
   and exists (
     select 1 from public.file_blobs b where b.path = d.storage_path
   );

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.compliance_item_documents'::regclass
       and conname = 'compliance_item_documents_backend_ck'
  ) then
    alter table public.compliance_item_documents
      add constraint compliance_item_documents_backend_ck
      check (storage_backend is null or storage_backend in ('supabase', 'db', 'local'));
  end if;
end $$;

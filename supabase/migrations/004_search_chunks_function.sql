-- Function to search chunks by vector similarity
create or replace function search_chunks(
    query_embedding vector(1536),
    match_user_id uuid,
    match_threshold float default 0.7,
    match_count int default 5
)
returns table (
    chunk_id uuid,
    document_id uuid,
    document_filename text,
    content text,
    chunk_index int,
    similarity float
)
language sql stable
as $$
    select
        c.id as chunk_id,
        c.document_id,
        d.filename as document_filename,
        c.content,
        c.chunk_index,
        1 - (c.embedding <=> query_embedding) as similarity
    from chunks c
    join documents d on c.document_id = d.id
    where d.user_id = match_user_id
      and d.status = 'completed'
      and 1 - (c.embedding <=> query_embedding) >= match_threshold
    order by c.embedding <=> query_embedding
    limit match_count;
$$;

-- Restrict access to service_role only (prevents direct RPC access bypassing the API)
revoke execute on function search_chunks(vector, uuid, float, int) from anon, authenticated;

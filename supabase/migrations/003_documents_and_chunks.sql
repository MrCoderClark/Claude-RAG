-- Enable pgvector extension
create extension if not exists vector;

-- Documents table
create table documents (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid not null references auth.users(id) on delete cascade,
    filename text not null,
    storage_path text not null,
    file_size bigint not null,
    mime_type text not null check (mime_type in ('text/plain', 'text/markdown')),
    status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
    error_message text,
    chunk_count int not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Chunks table
create table chunks (
    id uuid primary key default uuid_generate_v4(),
    document_id uuid not null references documents(id) on delete cascade,
    content text not null,
    chunk_index int not null,
    embedding vector(1536),
    metadata jsonb not null default '{}',
    created_at timestamptz not null default now()
);

-- Indexes
create index documents_user_id_idx on documents(user_id);
create index documents_status_idx on documents(status);
create index chunks_document_id_idx on chunks(document_id);

-- HNSW index for vector similarity search
create index chunks_embedding_idx on chunks using hnsw (embedding vector_cosine_ops);

-- Enable RLS
alter table documents enable row level security;
alter table chunks enable row level security;

-- RLS Policies for documents
create policy "Users can view their own documents"
    on documents for select
    using (auth.uid() = user_id);

create policy "Users can create their own documents"
    on documents for insert
    with check (auth.uid() = user_id);

create policy "Users can update their own documents"
    on documents for update
    using (auth.uid() = user_id);

create policy "Users can delete their own documents"
    on documents for delete
    using (auth.uid() = user_id);

-- RLS Policies for chunks
create policy "Users can view chunks of their documents"
    on chunks for select
    using (
        exists (
            select 1 from documents
            where documents.id = chunks.document_id
            and documents.user_id = auth.uid()
        )
    );

create policy "Users can create chunks for their documents"
    on chunks for insert
    with check (
        exists (
            select 1 from documents
            where documents.id = chunks.document_id
            and documents.user_id = auth.uid()
        )
    );

create policy "Users can delete chunks of their documents"
    on chunks for delete
    using (
        exists (
            select 1 from documents
            where documents.id = chunks.document_id
            and documents.user_id = auth.uid()
        )
    );

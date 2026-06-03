-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Threads table
create table threads (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid not null references auth.users(id) on delete cascade,
    openai_thread_id text,
    title text not null default 'New Chat',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Messages table
create table messages (
    id uuid primary key default uuid_generate_v4(),
    thread_id uuid not null references threads(id) on delete cascade,
    role text not null check (role in ('user', 'assistant')),
    content text not null,
    metadata jsonb,
    created_at timestamptz not null default now()
);

-- Indexes
create index threads_user_id_idx on threads(user_id);
create index threads_updated_at_idx on threads(updated_at desc);
create index messages_thread_id_idx on messages(thread_id);
create index messages_created_at_idx on messages(created_at);

-- Enable RLS
alter table threads enable row level security;
alter table messages enable row level security;

-- RLS Policies for threads
create policy "Users can view their own threads"
    on threads for select
    using (auth.uid() = user_id);

create policy "Users can create their own threads"
    on threads for insert
    with check (auth.uid() = user_id);

create policy "Users can update their own threads"
    on threads for update
    using (auth.uid() = user_id);

create policy "Users can delete their own threads"
    on threads for delete
    using (auth.uid() = user_id);

-- RLS Policies for messages
create policy "Users can view messages in their threads"
    on messages for select
    using (
        exists (
            select 1 from threads
            where threads.id = messages.thread_id
            and threads.user_id = auth.uid()
        )
    );

create policy "Users can create messages in their threads"
    on messages for insert
    with check (
        exists (
            select 1 from threads
            where threads.id = messages.thread_id
            and threads.user_id = auth.uid()
        )
    );

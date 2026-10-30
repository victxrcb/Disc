alter table public.profiles add column if not exists banner_url text;

-- Banners animados podem ser maiores que avatares; o cliente mantém o limite em 10 MB.
update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id = 'avatars';

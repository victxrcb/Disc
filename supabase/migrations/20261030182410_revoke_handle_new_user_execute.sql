-- Função de gatilho: o Postgres a executa no cadastro sem precisar de EXECUTE para os papéis da API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

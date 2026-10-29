# Aplicativo para Windows

O site tambem pode ser instalado como um aplicativo desktop. O instalador e gerado com Electron e inclui a interface dentro do proprio `.exe`.

## Gerar no computador

1. Preencha o `.env.local` normalmente. `VITE_PUBLIC_APP_URL` e opcional e permite trocar a URL publica dos convites.
2. Execute `npm install`.
3. Execute `npm run desktop:build`.
4. O instalador sera criado na pasta `release` com o nome `Discord-2.0-Windows.exe`.

Para somente abrir e testar o app sem criar o instalador, execute `npm run desktop`.

## Disponibilizar no GitHub

Em **Settings > Secrets and variables > Actions**, configure:

- Secrets: `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
- Variable opcional: `VITE_PUBLIC_APP_URL`, caso queira substituir `https://disc-call.vercel.app` nos convites.

Depois existem duas formas de gerar o `.exe`:

- Em **Actions > Aplicativo Windows > Run workflow**, o arquivo aparece em **Artifacts**.
- Ao publicar uma tag, por exemplo `v0.1.0`, o workflow cria uma GitHub Release e anexa o `.exe` para download.

Exemplo para a primeira versao:

```bash
git tag v0.1.0
git push origin v0.1.0
```

O Windows pode exibir um aviso do SmartScreen enquanto o instalador nao estiver assinado digitalmente. Isso nao impede a instalacao; para eliminar o aviso de forma confiavel, e necessario assinar futuras versoes com um certificado de code signing.

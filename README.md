# Projeto Logística - Dashboard

Monorepo com painel de gestão e app do motorista (Vite + React).

Como rodar localmente

- Instalar dependências:

```bash
npm install
```

- Rodar o servidor de desenvolvimento (root):

```bash
npm run dev
```

- Rodar apenas o app do motorista (dentro da pasta `motorista`):

```bash
cd motorista
npm install
npm run dev
```

Build para produção

```bash
npm run build
# ou para o app do motorista:
npm --prefix motorista run build
```

Remote

O código já foi enviado para: https://github.com/LeandroSouza82/progetoentregas

---
Arquivo gerado automaticamente pelo assistente.

Deploy

O projeto pode ser publicado no GitHub Pages automaticamente via workflow.

- O workflow `deploy.yml` está configurado para rodar no push para a branch `main` e irá:
	- instalar dependências (root e `motorista`),
	- gerar os builds, e
	- publicar o conteúdo de `dist/` usando `peaceiris/actions-gh-pages`.

Como publicar manualmente

```bash
# Build local
npm run build
npm --prefix motorista run build

# Opcional: publicar com a action (push para main) ou usar um deploy manual
git add -A
git commit -m "chore: build and deploy"
git push origin main
```
# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

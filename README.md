# YouTube Summaries

PWA personnelle qui agrège les dernières vidéos de chaînes YouTube et affiche un résumé structuré (TL;DR, thèse, arguments clés, concepts, citation, à retenir) généré par Claude Haiku 4.5 à partir des sous-titres.

## Architecture

- **Frontend** : Vite + React + TypeScript, déployé sur GitHub Pages (PWA installable mobile).
- **Backend** : aucun. Une GitHub Action quotidienne (`summarize.yml`) :
  1. Lit `channels.json`
  2. Pour chaque chaîne, récupère le flux RSS officiel YouTube
  3. Pour chaque nouvelle vidéo (non-Short, transcript dispo) : fetch transcript → résumé Claude → JSON
  4. Commit `public/data/<slug>.json` dans le repo
- **App** : lit simplement les JSON statiques servis par GitHub Pages.

Une vidéo est résumée **une seule fois** (cache à vie via ID dans le JSON). Pas d'appel Claude au runtime.

## Coûts estimés

Modèle: Claude Haiku 4.5 — `$1/M input` / `$5/M output`.

- Vidéo 30 min : ~1,8 ¢
- Long format 1-2h : ~3-5 ¢
- Plafond output : 1 500 tokens ; transcripts > 250k chars tronqués
- Shorts ignorés (badge dans la liste mais pas de résumé)
- Estimation Scanderia (mix observé) : **~$0,30–0,40 / mois**

## Setup local

```bash
npm install
npm run dev
```

Ouvre http://localhost:5173/youtube-summaries/ (ou 5174 si 5173 est pris).

### Lancer le script de résumé localement

```bash
export ANTHROPIC_API_KEY=sk-ant-...
node scripts/summarize.mjs
```

Le script écrit dans `public/data/<slug>.json` et limite à `MAX_VIDEOS_PER_RUN=10` nouveaux résumés par exécution (ajustable en haut du fichier).

### Tester juste la récupération de transcripts (sans Claude)

```bash
node scripts/test-transcript.mjs
```

## Setup GitHub

1. Créer un repo `youtube-summaries` sur GitHub et `git push` ce dossier.
2. **Settings → Pages → Source : GitHub Actions**.
3. **Settings → Secrets and variables → Actions → New repository secret** :
   - Nom : `ANTHROPIC_API_KEY`
   - Valeur : ta clé Anthropic
4. **Settings → Actions → General → Workflow permissions : Read and write permissions** (pour que le workflow `summarize` puisse commit).
5. Premier deploy : un push sur `main` déclenche `deploy.yml`.
6. Première génération de résumés : aller dans **Actions → Summarize new videos → Run workflow** (le cron tournera ensuite tous les jours à 06:00 UTC).

## Ajouter une chaîne

1. Récupérer le `channelId` (commence par `UC...`) sur la page YouTube de la chaîne.
2. Ajouter une entrée dans `channels.json`.
3. Push : la GH Action `summarize` se redéclenche automatiquement (path filter sur `channels.json`).

## Sécurité

- La clé API n'est **jamais** côté navigateur (le résumé tourne dans la GH Action, pas dans la PWA).
- Tu peux malgré tout fixer une limite de spending Anthropic basse (5-10 $/mois) par sécurité.

## Stack

- `vite`, `react`, `typescript`, `vite-plugin-pwa`
- `@anthropic-ai/sdk` — appel Claude
- `rss-parser` — flux YouTube
- `youtube-transcript` — récup des sous-titres

import { defineConfig } from 'bumpp';

export default defineConfig({
    files: ['package.json', 'manifest.json', 'package-lock.json'],
    execute: 'tsx scripts/sync-versions-json.ts',
    confirm: false,
    printCommits: false,
    commit: false,
    tag: false,
    push: false,
    noGitCheck: true,
    noVerify: true,
});

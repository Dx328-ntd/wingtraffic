// Chạy bản production đã build: npm run build:public && npm run start:prod
process.env.PUBLIC_DIR ||= 'dist/public';
process.env.NODE_ENV ||= 'production';
await import('./server.mjs');

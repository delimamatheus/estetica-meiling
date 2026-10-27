// Importado primeiro pelos testes: garante banco em memória e NUNCA o banco real.
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.PGLITE_DIR;
process.env.NODE_ENV = 'test';

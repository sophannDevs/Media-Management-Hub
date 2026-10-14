/** Prisma SQLite connection string for an absolute file path (forward slashes on Windows). */
export const sqliteUrl = (file: string) => `file:${file.replace(/\\/g, "/")}`;

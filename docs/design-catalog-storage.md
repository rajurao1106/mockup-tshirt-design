# Design catalog storage

The design catalog is stored in `data/designs.json` during local development when no Blob credentials are configured. On Vercel, catalog reads and writes use the public Vercel Blob object `catalog/designs.json` when Blob credentials are configured. Without them, reads use the bundled `data/designs.json`; catalog changes cannot be saved on Vercel without Blob storage.

To enable persistent catalog updates on Vercel:

1. Create a **public** Blob store from the project's Storage settings.
2. Connect the store to this Vercel project for the Production and Preview environments, and enable the read-write token environment variable (`BLOB_READ_WRITE_TOKEN`).
3. Redeploy after connecting the store.

The first Blob read falls back to the bundled `data/designs.json` catalog if `catalog/designs.json` does not exist yet. The first admin upload, edit, or delete writes the catalog to Blob; later catalog requests use that persisted object.

For local development with Blob storage, connect the Development environment or set a server-only `BLOB_READ_WRITE_TOKEN`. Never expose this token through a `NEXT_PUBLIC_` variable or commit it to the repository.

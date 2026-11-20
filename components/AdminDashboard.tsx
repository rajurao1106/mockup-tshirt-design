"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { DESIGN_CATEGORIES, type CatalogDesign } from "@/lib/designCatalog";

const field = "w-full rounded-xl border border-[#deded6] bg-white px-3.5 py-3 text-sm text-[#171713] outline-none focus:border-[#4d6a1f]";

export default function AdminDashboard() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>(DESIGN_CATEGORIES[0]);
  const [popular, setPopular] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [editingDesignId, setEditingDesignId] = useState<string | null>(null);
  const [designs, setDesigns] = useState<CatalogDesign[]>([]);
  const [busy, setBusy] = useState(false);
  const [deletingDesignId, setDeletingDesignId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadDesigns = async () => {
    const response = await fetch("/api/designs", { cache: "no-store" });
    const result = await response.json() as { designs?: CatalogDesign[]; error?: string };
    if (!response.ok) throw new Error(result.error ?? "Could not load designs");
    setDesigns(result.designs ?? []);
  };

  useEffect(() => {
    void fetch("/api/admin/session", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as { authenticated?: boolean };
        if (result.authenticated) {
          setAuthenticated(true);
          await loadDesigns();
        }
      })
      .catch(() => setError("Admin login service is unavailable"))
      .finally(() => setChecking(false));
  }, []);

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Login failed");
      setAuthenticated(true);
      setPassword("");
      await loadDesigns();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  const uploadDesign = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const isEditing = editingDesignId !== null;
    if (!file && !isEditing) {
      setError("Please choose an image first");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    const form = new FormData();
    if (editingDesignId) form.append("id", editingDesignId);
    form.append("title", title);
    form.append("category", category);
    form.append("popular", String(popular));
    if (file) form.append("file", file);
    try {
      const response = await fetch("/api/admin/designs", { method: isEditing ? "PATCH" : "POST", body: form });
      const result = await response.json() as { design?: CatalogDesign; error?: string };
      if (!response.ok) throw new Error(result.error ?? (isEditing ? "Update failed" : "Upload failed"));
      if (!result.design) throw new Error("The server did not return the saved design");
      const savedDesign = result.design;
      if (isEditing) {
        setDesigns((current) => current.map((design) => design.id === savedDesign.id ? savedDesign : design));
      } else {
        setDesigns((current) => [savedDesign, ...current]);
      }
      setTitle("");
      setFile(null);
      setPopular(false);
      setEditingDesignId(null);
      formElement.reset();
      setNotice(isEditing ? "Design updated." : "Design uploaded. Customers can now try it on their shirt.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : (isEditing ? "Update failed" : "Upload failed"));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    setAuthenticated(false);
    setDesigns([]);
    setEditingDesignId(null);
    setTitle("");
    setCategory(DESIGN_CATEGORIES[0]);
    setPopular(false);
    setFile(null);
  };

  const editDesign = (design: CatalogDesign) => {
    setEditingDesignId(design.id);
    setTitle(design.title);
    setCategory(design.category);
    setPopular(design.popular);
    setFile(null);
    setError("");
    setNotice("");
  };

  const cancelEdit = () => {
    setEditingDesignId(null);
    setTitle("");
    setCategory(DESIGN_CATEGORIES[0]);
    setPopular(false);
    setFile(null);
    setError("");
    setNotice("");
  };

  const deleteDesign = async (design: CatalogDesign) => {
    if (!window.confirm(`Remove "${design.title}" from the customer library? The uploaded image file will remain in Cloudinary.`)) return;
    setDeletingDesignId(design.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/designs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: design.id }),
      });
      const result = await response.json() as { deletedId?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Design could not be deleted");
      setDesigns((current) => current.filter((item) => item.id !== design.id));
      if (editingDesignId === design.id) cancelEdit();
      setNotice("Design removed from the customer library. Its Cloudinary image was kept.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Design could not be deleted");
    } finally {
      setDeletingDesignId(null);
    }
  };

  if (checking) {
    return <main className="grid min-h-screen place-items-center text-sm text-[#69695f]">Checking admin session...</main>;
  }

  if (!authenticated) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f0efe8] px-4 py-10 text-[#171713]">
        <form onSubmit={login} className="w-full max-w-[420px] rounded-[26px] border border-black/5 bg-white p-7 shadow-[0_24px_70px_-35px_#30302066]">
          <Link href="/" className="text-xs font-bold tracking-[.28em] text-[#4d6a1f]">MOCKUP DESIGN ADMIN</Link>
          <h1 className="mt-5 text-3xl font-bold tracking-tight">Sign in</h1>
          <p className="mt-2 text-sm text-[#74746a]">Upload categorized designs for the customer gallery.</p>
          <label className="mt-7 block text-xs font-semibold text-[#56564e]">
            Username
            <input className={`${field} mt-1.5`} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
          </label>
          <label className="mt-4 block text-xs font-semibold text-[#56564e]">
            Password
            <input className={`${field} mt-1.5`} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
          {process.env.NODE_ENV !== "production" && (
            <p className="mt-3 rounded-lg bg-[#f4f5ef] px-3 py-2 text-xs text-[#5b634e]">
              Local demo login: <b>admin</b> / <b>MockupDesign123!</b>
            </p>
          )}
          {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button disabled={busy || deletingDesignId !== null} className="mt-5 h-12 w-full rounded-xl bg-[#171713] text-sm font-bold text-white disabled:opacity-50">
            {busy ? "Signing in..." : "Sign in"}
          </button>
          <Link href="/" className="mt-5 block text-center text-sm text-[#77776e] hover:text-black">Back to design studio</Link>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f0efe8] px-4 py-6 text-[#171713] sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link href="/" className="text-xs font-bold tracking-[.28em] text-[#4d6a1f]">MOCKUP DESIGN ADMIN</Link>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Design library</h1>
            <p className="mt-1 text-sm text-[#74746a]">Upload artwork and organize it for customers.</p>
          </div>
          <button onClick={() => void logout()} className="rounded-xl border border-[#d6d5cd] bg-white px-4 py-2.5 text-sm font-semibold hover:bg-[#f8f8f4]">Log out</button>
        </header>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(280px,380px)_1fr]">
          <form onSubmit={uploadDesign} className="h-fit rounded-[22px] border border-black/5 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-lg font-bold">{editingDesignId ? "Edit design" : "Add a design"}</h2>
            <p className="mt-1 text-xs leading-relaxed text-[#77776e]">PNG, JPG, or WebP · up to 5 MB</p>
            <label className="mt-5 block text-xs font-semibold text-[#56564e]">
              Design name
              <input className={`${field} mt-1.5`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="e.g. Neon tiger" required />
            </label>
            <label className="mt-4 block text-xs font-semibold text-[#56564e]">
              Category
              <select className={`${field} mt-1.5`} value={category} onChange={(e) => setCategory(e.target.value)}>
                {DESIGN_CATEGORIES.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label className="mt-4 block text-xs font-semibold text-[#56564e]">
              Artwork image{editingDesignId ? " (optional)" : ""}
              <input
                className={`${field} mt-1.5 file:mr-3 file:rounded-lg file:border-0 file:bg-[#eeeeea] file:px-3 file:py-2 file:text-xs file:font-semibold`}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                key={editingDesignId ?? "new"}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                required={!editingDesignId}
              />
            </label>
            <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-sm text-[#55554d]">
              <input type="checkbox" checked={popular} onChange={(e) => setPopular(e.target.checked)} className="size-4 accent-[#4d6a1f]" />
              Show in popular designs
            </label>
            {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            {notice && <p role="status" className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}
            <button disabled={busy} className="mt-5 h-12 w-full rounded-xl bg-[#171713] text-sm font-bold text-white disabled:opacity-50">
              {busy ? (editingDesignId ? "Saving..." : "Uploading...") : (editingDesignId ? "Save changes" : "Upload design")}
            </button>
            {editingDesignId && (
              <button type="button" onClick={cancelEdit} disabled={busy} className="mt-2 h-10 w-full rounded-xl border border-[#deded6] text-sm font-semibold text-[#56564e] disabled:opacity-50">
                Cancel edit
              </button>
            )}
          </form>

          <section className="rounded-[22px] border border-black/5 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">Uploaded designs</h2>
                <p className="mt-1 text-xs text-[#77776e]">{designs.length} designs in the customer library</p>
              </div>
              <Link href="/" className="text-xs font-semibold text-[#4d6a1f] hover:underline">Open studio →</Link>
            </div>
            {designs.length === 0 ? (
              <div className="mt-6 rounded-xl border border-dashed border-[#d6d5cd] p-8 text-center text-sm text-[#77776e]">
                No designs yet. Upload the first one to make it available to customers.
              </div>
            ) : (
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {designs.map((design) => (
                  <article key={design.id} className="overflow-hidden rounded-xl border border-[#e6e5de]">
                    <div className="aspect-square bg-[#f4f3ee] p-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={design.imageUrl} alt={design.title} className="size-full object-contain" />
                    </div>
                    <div className="p-3">
                      <p className="truncate text-sm font-semibold">{design.title}</p>
                      <p className="mt-1 text-[11px] text-[#77776e]">{design.category}{design.popular ? " · Popular" : ""}</p>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => editDesign(design)}
                          disabled={busy || deletingDesignId !== null}
                          className="text-xs font-semibold text-[#4d6a1f] hover:underline disabled:opacity-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteDesign(design)}
                          disabled={busy || deletingDesignId !== null}
                          className="text-xs font-semibold text-red-700 hover:underline disabled:opacity-50"
                        >
                          {deletingDesignId === design.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

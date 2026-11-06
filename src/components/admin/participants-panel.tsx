'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Camera, FileWarning, Loader2, Pencil, Plus, Search, Trash2, UserRound } from 'lucide-react'
import { adminFetch, ApiError, type AdminParticipant } from './admin-api'
import { CATEGORY_LABELS } from '@/lib/types'

/**
 * Downscale big photos in the browser before upload. Hosting platforms cap
 * request bodies (Vercel: 4.5 MB) and phone photos are often larger; the
 * server re-encodes to a 720 px WebP anyway, so 1600 px loses nothing.
 * Falls back to the original file if the browser cannot decode it.
 */
async function shrinkForUpload(file: File): Promise<File> {
  const MAX_SIDE = 1600
  if (file.size <= 1.5 * 1024 * 1024) return file
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    if (!blob) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}

const CATEGORIES = ['SINGING', 'DANCE', 'RAP', 'BEATBOXING', 'INSTRUMENTAL', 'CULTURAL'] as const

type Draft = {
  name: string
  performance: string
  category: string
  classification: string
  members: string
  affiliation: string
  isActive: boolean
  needsReview: boolean
  reviewNote: string
}

const emptyDraft: Draft = {
  name: '',
  performance: '',
  category: 'none',
  classification: 'none',
  members: '',
  affiliation: '',
  isActive: true,
  needsReview: false,
  reviewNote: '',
}

export function ParticipantsPanel({ onChanged }: { onChanged: () => void }) {
  const [participants, setParticipants] = useState<AdminParticipant[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<AdminParticipant | null>(null)
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<AdminParticipant | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await adminFetch<{ participants: AdminParticipant[] }>('/api/admin/participants')
      setParticipants(data.participants)
    } catch {
      toast.error('Could not load participants.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return participants
    return participants.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.performance ?? '').toLowerCase().includes(q) ||
        (p.affiliation ?? '').toLowerCase().includes(q)
    )
  }, [participants, query])

  async function move(p: AdminParticipant, dir: -1 | 1) {
    const ids = participants.map((x) => x.id)
    const i = ids.indexOf(p.id)
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    setParticipants((prev) => {
      const next = [...prev]
      const tmp = next[i]
      next[i] = next[j]
      next[j] = tmp
      return next
    })
    try {
      await adminFetch('/api/admin/participants/reorder', { method: 'POST', body: JSON.stringify({ ids }) })
      onChanged()
    } catch {
      toast.error('Reorder failed.')
      void load()
    }
  }

  async function toggleActive(p: AdminParticipant, active: boolean) {
    setParticipants((prev) => prev.map((x) => (x.id === p.id ? { ...x, isActive: active } : x)))
    try {
      await adminFetch(`/api/admin/participants/${p.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: active }) })
      toast.success(active ? `${p.name} is visible to voters.` : `${p.name} is hidden from voters.`)
      onChanged()
    } catch {
      toast.error('Could not update visibility.')
      void load()
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setBusy(true)
    try {
      await adminFetch(`/api/admin/participants/${deleting.id}`, { method: 'DELETE' })
      toast.success(`${deleting.name} deleted.`)
      setDeleting(null)
      await load()
      onChanged()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Delete failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="rounded-xl">
      <CardContent className="p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search participants…" aria-label="Search participants" className="h-9 pl-9" />
          </div>
          <Button onClick={() => setAdding(true)} size="sm" className="h-9 gap-1.5 rounded-full bg-brand font-semibold text-white hover:bg-[#00b0d8]">
            <Plus className="h-4 w-4" aria-hidden />
            Add participant
          </Button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto rounded-lg border border-line">
          {loading ? (
            <p className="p-8 text-center text-sm text-ink-soft">Loading participants…</p>
          ) : filtered.length === 0 ? (
            <p className="p-8 text-center text-sm text-ink-soft">No participants found.</p>
          ) : (
            <table className="w-full min-w-[760px] text-sm">
              <thead className="sticky top-0 bg-surface text-left text-[11px] uppercase tracking-wide text-ink-soft">
                <tr className="border-b border-line">
                  <th className="px-3 py-2.5 font-semibold">#</th>
                  <th className="px-3 py-2.5 font-semibold">Photo</th>
                  <th className="px-3 py-2.5 font-semibold">Participant</th>
                  <th className="px-3 py-2.5 font-semibold">Category</th>
                  <th className="px-3 py-2.5 font-semibold">Affiliation</th>
                  <th className="px-3 py-2.5 text-center font-semibold">Votes</th>
                  <th className="px-3 py-2.5 text-center font-semibold">Visible</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, idx) => (
                  <tr key={p.id} className="border-b border-line last:border-0 hover:bg-surface/60">
                    <td className="px-3 py-2.5 tabular-nums text-ink-soft">{idx + 1}</td>
                    <td className="px-3 py-2.5">
                      <Thumb participant={p} />
                    </td>
                    <td className="max-w-52 px-3 py-2.5">
                      <p className="flex items-center gap-1.5 font-medium text-ink">
                        <span className="truncate">{p.name}</span>
                        {p.needsReview && <FileWarning className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label="Needs review" />}
                      </p>
                      {p.performance && <p className="truncate text-xs text-ink-soft">{p.performance}</p>}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col items-start gap-1">
                        {p.category && <Badge variant="secondary" className="bg-brand-soft text-brand-deep hover:bg-brand-soft border border-brand/30 text-[10px]">{CATEGORY_LABELS[p.category] ?? p.category}</Badge>}
                        {p.classification && <span className="text-[10px] font-medium text-ink-soft">{p.classification}</span>}
                      </div>
                    </td>
                    <td className="max-w-40 px-3 py-2.5 text-xs text-ink-soft">
                      <span className="line-clamp-2">{p.affiliation ?? '—'}</span>
                    </td>
                    <td className="px-3 py-2.5 text-center font-semibold tabular-nums text-ink">{p.votes}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-center">
                        <Switch checked={p.isActive} onCheckedChange={(v) => void toggleActive(p, v)} aria-label={`Toggle visibility for ${p.name}`} />
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Move ${p.name} up`} disabled={idx === 0} onClick={() => void move(p, -1)}>
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Move ${p.name} down`} disabled={idx === filtered.length - 1} onClick={() => void move(p, 1)}>
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600" aria-label={`Delete ${p.name}`} onClick={() => setDeleting(p)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="mt-2 text-[11px] text-ink-soft">
          {participants.length} participants · order matches the official participant sheet (use arrows to reorder) · photos are uploaded by administrators only
        </p>
      </CardContent>

      {/* edit dialog */}
      {editing && (
        <ParticipantDialog
          participant={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await load()
            onChanged()
          }}
        />
      )}

      {/* add dialog */}
      {adding && (
        <ParticipantDialog
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false)
            await load()
            onChanged()
          }}
        />
      )}

      {/* delete confirm */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent className="max-w-sm rounded-xl">
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle>Delete participant?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.votes
                ? `"${deleting?.name}" has ${deleting?.votes} recorded vote(s) and cannot be deleted — deactivate it instead to preserve vote integrity.`
                : `"${deleting?.name}" will be permanently removed. This action cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            {deleting?.votes ? (
              <AlertDialogAction className="rounded-full bg-brand text-white hover:bg-[#00b0d8]" onClick={(e) => e.preventDefault()}>
                Understood
              </AlertDialogAction>
            ) : (
              <AlertDialogAction className="bg-red-600 hover:bg-red-700" disabled={busy} onClick={(e) => { e.preventDefault(); void confirmDelete() }}>
                {busy ? 'Deleting…' : 'Delete'}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function Thumb({ participant }: { participant: AdminParticipant }) {
  return participant.photoUrl ? (
    <img src={participant.photoUrl} alt={`Photo of ${participant.name}`} className="h-10 w-10 rounded-lg border border-line object-cover" />
  ) : (
    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface text-ink-soft/60" aria-label="No photo">
      <UserRound className="h-5 w-5" />
    </span>
  )
}

// ---------------------------------------------------------------------------
// Create / edit dialog with photo management
// ---------------------------------------------------------------------------

function ParticipantDialog({
  participant,
  onClose,
  onSaved,
}: {
  participant?: AdminParticipant
  onClose: () => void
  onSaved: () => Promise<void> | void
}) {
  const [draft, setDraft] = useState<Draft>(
    participant
      ? {
          name: participant.name,
          performance: participant.performance ?? '',
          category: participant.category ?? 'none',
          classification: participant.classification ?? 'none',
          members: participant.members ?? '',
          affiliation: participant.affiliation ?? '',
          isActive: participant.isActive,
          needsReview: participant.needsReview,
          reviewNote: participant.reviewNote ?? '',
        }
      : emptyDraft
  )
  const [saving, setSaving] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  function pickFile(file: File | null) {
    setPendingFile(file)
    setPreviewUrl(file ? URL.createObjectURL(file) : null)
  }

  async function savePhoto() {
    if (!participant || !pendingFile) return
    setPhotoBusy(true)
    try {
      const form = new FormData()
      form.append('file', await shrinkForUpload(pendingFile))
      await adminFetch(`/api/admin/participants/${participant.id}/photo`, { method: 'POST', body: form })
      toast.success('Photo uploaded.')
      pickFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      await onSaved()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Photo upload failed.')
    } finally {
      setPhotoBusy(false)
    }
  }

  async function removePhoto() {
    if (!participant) return
    setPhotoBusy(true)
    try {
      await adminFetch(`/api/admin/participants/${participant.id}/photo`, { method: 'DELETE' })
      toast.success('Photo removed.')
      pickFile(null)
      await onSaved()
    } catch {
      toast.error('Could not remove photo.')
    } finally {
      setPhotoBusy(false)
    }
  }

  async function save() {
    if (!draft.name.trim()) {
      toast.error('Participant name is required.')
      return
    }
    setSaving(true)
    const payload = {
      name: draft.name.trim(),
      performance: draft.performance.trim() || null,
      category: draft.category === 'none' ? null : draft.category,
      classification: draft.classification === 'none' ? null : draft.classification,
      members: draft.members.trim() || null,
      affiliation: draft.affiliation.trim() || null,
      isActive: draft.isActive,
      needsReview: draft.needsReview,
      reviewNote: draft.reviewNote.trim() || null,
    }
    try {
      if (participant) {
        await adminFetch(`/api/admin/participants/${participant.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        toast.success('Participant updated.')
      } else {
        await adminFetch('/api/admin/participants', { method: 'POST', body: JSON.stringify(payload) })
        toast.success('Participant added.')
      }
      await onSaved()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const shownPhoto = previewUrl ?? participant?.photoUrl ?? null

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{participant ? `Edit — ${participant.name}` : 'Add participant'}</DialogTitle>
          <DialogDescription className="text-xs">
            {participant
              ? 'Correct or complete the extracted information. Changes appear on the public voting page immediately.'
              : 'New participants appear at the end of the public list.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* photo management */}
          {participant && (
            <div className="rounded-lg border border-line bg-surface/60 p-3.5">
              <p className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold text-ink">
                <Camera className="h-3.5 w-3.5" aria-hidden />
                Participant photograph
              </p>
              <div className="flex items-start gap-3.5">
                <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-line bg-white">
                  {shownPhoto ? (
                    <img src={shownPhoto} alt="Selected photo preview" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-ink-soft/60">
                      <UserRound className="h-8 w-8" />
                    </span>
                  )}
                </div>
                <div className="flex-1 space-y-2">
                  <input
                    ref={fileInputRef}
                    id="photo-input"
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" className="h-8" disabled={photoBusy} onClick={() => fileInputRef.current?.click()}>
                      {participant.photoUrl ? 'Replace photo' : 'Choose photo'}
                    </Button>
                    {pendingFile && (
                      <Button size="sm" className="h-8 rounded-full bg-brand text-white hover:bg-[#00b0d8]" disabled={photoBusy} onClick={() => void savePhoto()}>
                        {photoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Upload now'}
                      </Button>
                    )}
                    {participant.photoUrl && !pendingFile && (
                      <Button variant="outline" size="sm" className="h-8 text-red-500 hover:text-red-600" disabled={photoBusy} onClick={() => void removePhoto()}>
                        Delete
                      </Button>
                    )}
                  </div>
                  <p className="text-[11px] leading-relaxed text-ink-soft">JPG, PNG or WebP, up to 15 MB. Resized automatically. A clear face photo works best.</p>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="p-name">Name / performance title *</Label>
              <Input id="p-name" value={draft.name} onChange={(e) => set('name', e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-perf">Performance</Label>
              <Input id="p-perf" value={draft.performance} onChange={(e) => set('performance', e.target.value)} placeholder="e.g. Live Singing" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={draft.category} onValueChange={(v) => set('category', v)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Classification</Label>
              <Select value={draft.classification} onValueChange={(v) => set('classification', v)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  <SelectItem value="SOLO">Solo</SelectItem>
                  <SelectItem value="GROUP">Group</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-aff">Affiliation</Label>
              <Input id="p-aff" value={draft.affiliation} onChange={(e) => set('affiliation', e.target.value)} placeholder="e.g. KSU" className="h-9" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="p-members">Group members</Label>
              <Input id="p-members" value={draft.members} onChange={(e) => set('members', e.target.value)} placeholder="e.g. Sujal Dong; Sishir Ranavat; Kushal Pariyar" className="h-9" />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-line p-3">
            <label className="flex items-center gap-2.5 text-sm">
              <Switch checked={draft.isActive} onCheckedChange={(v) => set('isActive', v)} aria-label="Visible to voters" />
              Visible to voters
            </label>
            <label className="flex items-center gap-2.5 text-sm">
              <Checkbox checked={draft.needsReview} onCheckedChange={(v) => set('needsReview', v === true)} aria-label="Needs review" />
              Needs verification
            </label>
          </div>
          {draft.needsReview && (
            <div className="space-y-1.5">
              <Label htmlFor="p-note">Verification note</Label>
              <Input id="p-note" value={draft.reviewNote} onChange={(e) => set('reviewNote', e.target.value)} placeholder="What needs to be verified?" className="h-9" />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void save()} disabled={saving} className="rounded-full bg-brand font-semibold text-white hover:bg-[#00b0d8]">
            {saving ? 'Saving…' : participant ? 'Save changes' : 'Add participant'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

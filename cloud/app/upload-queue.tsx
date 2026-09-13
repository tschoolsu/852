'use client';

import { useRef, useState } from 'react';
import {
  Upload,
  X,
  ChevronDown,
  ChevronUp,
  Trash2,
  Share2,
  FolderInput,
} from 'lucide-react';
import {
  UploadAccessDialog,
  privateAccess,
  type UploadAccess,
} from './upload-access-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type Entry = {
  id: string;
  file: File;
  title: string;
  description: string;
  parent: string;
  destination: string;
  status: 'ready' | 'uploading' | 'done' | 'failed' | 'unknown';
  error: string;
  access: UploadAccess;
  resourceId?: string;
  shareUrl?: string;
};
const labels = {
  ready: '待確認',
  uploading: '上傳中…',
  done: '上傳完成',
  failed: '上傳失敗',
  unknown: '結果待確認',
};

export function UploadQueue({
  csrf,
  parent,
  destination,
  disabled,
  setBusy,
  onDone,
  owner,
}: {
  owner: { name: string; email: string };
  csrf: string;
  parent: string;
  destination: string;
  disabled: boolean;
  setBusy: (value: boolean) => void;
  onDone: () => Promise<void>;
}) {
  const [entries, setEntries] = useState<Entry[]>([]),
    [editing, setEditing] = useState(''),
    [collapsed, setCollapsed] = useState(false),
    [pending, setPending] = useState(false);
  const lock = useRef(false),
    picker = useRef<HTMLInputElement>(null);
  const [accessOpen, setAccessOpen] = useState(false),
    [accessSelected, setAccessSelected] = useState<Set<string>>(new Set()),
    [accessError, setAccessError] = useState('');
  const [folderOpen, setFolderOpen] = useState(false),
    [folderSelected, setFolderSelected] = useState<Set<string>>(new Set()),
    [folders, setFolders] = useState<
      Array<{ id: string; title: string; owner_name: string }>
    >([]),
    [folderId, setFolderId] = useState(parent),
    [folderError, setFolderError] = useState('');
  const update = (id: string, patch: Partial<Entry>) =>
    setEntries((current) =>
      current.map((entry) =>
        entry.id === id ? { ...entry, ...patch } : entry,
      ),
    );
  const active = entries.find((entry) => entry.id === editing),
    editable = active && ['ready', 'failed'].includes(active.status);
  const ready = entries.filter((entry) =>
    ['ready', 'failed'].includes(entry.status),
  );
  const selectable = entries.filter(
    (entry) => entry.status !== 'uploading' && entry.status !== 'unknown',
  );
  const openAccess = () => {
    if (lock.current || disabled) return;
    setAccessError('');
    setAccessSelected(new Set());
    setAccessOpen(true);
  };
  const saveAccess = async (access: UploadAccess) => {
    if (lock.current) return;
    if (!accessSelected.size) {
      setAccessError('請至少選擇一個檔案。');
      return;
    }
    lock.current = true;
    setPending(true);
    setBusy(true);
    setAccessError('');
    let changed = false;
    const errors: string[] = [];
    try {
      for (const entry of entries.filter(
        (e) => accessSelected.has(e.id) && e.status !== 'unknown',
      )) {
        if (entry.resourceId) {
          try {
            const response = await fetch(`/api/resources/${entry.resourceId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                operation: 'access-config',
                csrf,
                access,
              }),
              signal: AbortSignal.timeout(60000),
            });
            const data = (await response.json()) as {
              error?: string;
              url?: string;
            };
            if (!response.ok) throw new Error(data.error || '權限更新失敗');
            update(entry.id, {
              access: structuredClone(access),
              shareUrl: data.url,
              error: '',
            });
            changed = true;
          } catch (error) {
            errors.push(
              `${entry.title || entry.file.name}：${(error as Error).message}`,
            );
          }
        } else update(entry.id, { access: structuredClone(access), error: '' });
      }
      if (changed) await onDone();
      if (errors.length) setAccessError(errors.join('\n'));
      else setAccessOpen(false);
    } finally {
      lock.current = false;
      setPending(false);
      setBusy(false);
    }
  };
  const openFolder = async () => {
    if (lock.current || disabled) return;
    setFolderError('');
    setFolderSelected(new Set());
    setFolderId(parent);
    setFolderOpen(true);
    try {
      const response = await fetch('/api/resources?scope=folders', {
        cache: 'no-store',
        signal: AbortSignal.timeout(30000),
      });
      const data = (await response.json()) as {
        error?: string;
        items: Array<{ id: string; title: string; owner_name: string }>;
      };
      if (!response.ok) throw new Error(data.error || '無法讀取資料夾');
      setFolders(data.items);
    } catch (error) {
      setFolderError((error as Error).message);
    }
  };
  const saveFolder = async () => {
    if (lock.current || !folderSelected.size) return;
    lock.current = true;
    setPending(true);
    setBusy(true);
    setFolderError('');
    let changed = false;
    const errors: string[] = [];
    const target = folders.find((folder) => folder.id === folderId);
    try {
      for (const entry of entries.filter((e) => folderSelected.has(e.id))) {
        if (entry.resourceId) {
          try {
            const response = await fetch(`/api/resources/${entry.resourceId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                operation: 'move',
                csrf,
                parentId: folderId,
              }),
              signal: AbortSignal.timeout(60000),
            });
            const data = (await response.json()) as { error?: string };
            if (!response.ok) throw new Error(data.error || '移動失敗');
            update(entry.id, {
              parent: folderId,
              destination: target?.title || '檔案庫最上層',
              error: '',
            });
            changed = true;
          } catch (error) {
            errors.push(
              `${entry.title || entry.file.name}：${(error as Error).message}`,
            );
          }
        } else
          update(entry.id, {
            parent: folderId,
            destination: target?.title || '檔案庫最上層',
            error: '',
          });
      }
      if (changed) await onDone();
      if (errors.length) setFolderError(errors.join('\n'));
      else setFolderOpen(false);
    } finally {
      lock.current = false;
      setPending(false);
      setBusy(false);
    }
  };
  const upload = async () => {
    if (lock.current || disabled || !ready.length) return;
    lock.current = true;
    setPending(true);
    setBusy(true);
    setEditing('');
    let changed = false;
    try {
      for (const entry of ready) {
        if (!entry.file.size || entry.file.size > 100 * 1024 * 1024) {
          update(entry.id, {
            status: 'failed',
            error: !entry.file.size
              ? '檔案是空的，請移除後重新選擇。'
              : '單一檔案最多 100 MB，請移除後重新選擇。',
          });
          continue;
        }
        update(entry.id, { status: 'uploading', error: '' });
        const body = new FormData();
        body.set('kind', 'file');
        body.set('csrf', csrf);
        body.set('parentId', entry.parent);
        body.set('title', entry.title.trim() || entry.file.name);
        body.set('description', entry.description);
        body.set('file', entry.file);
        body.set('access', JSON.stringify(entry.access));
        try {
          const response = await fetch('/api/resources', {
            method: 'POST',
            body,
            signal: AbortSignal.timeout(600000),
          });
          const data = (await response.json()) as {
            error?: string;
            id?: string;
            url?: string;
          };
          if (!response.ok) {
            update(entry.id, {
              status: response.status >= 500 ? 'unknown' : 'failed',
              error:
                (data.error || '上傳失敗') +
                (response.status >= 500
                  ? ' 請重新整理確認是否已上傳，避免重複上傳。'
                  : ''),
            });
            continue;
          }
          if (!data.id) throw new Error('缺少上傳結果');
          update(entry.id, {
            status: 'done',
            resourceId: data.id,
            shareUrl: data.url,
          });
          changed = true;
        } catch {
          update(entry.id, {
            status: 'unknown',
            error:
              '連線中斷或等待逾時，請重新整理確認是否已上傳，避免重複上傳。',
          });
        }
      }
      if (changed) await onDone();
    } finally {
      lock.current = false;
      setPending(false);
      setBusy(false);
    }
  };
  return (
    <>
      <input
        ref={picker}
        id="multi-upload-picker"
        aria-label="選擇多個上傳檔案"
        type="file"
        multiple
        hidden
        disabled={disabled}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files || []);
          event.currentTarget.value = '';
          if (!files.length) return;
          setEntries((current) => [
            ...current,
            ...files.map((file) => ({
              id: crypto.randomUUID(),
              file,
              title: file.name,
              description: '',
              parent,
              destination,
              status: 'ready' as const,
              error: '',
              access: privateAccess(),
            })),
          ]);
          setCollapsed(false);
        }}
      />
      {entries.length > 0 && (
        <section className="upload-queue" aria-label="上傳確認清單">
          <header>
            <strong>
              <Upload size={18} />
              上傳確認（{entries.length} 個檔案）
            </strong>
            <div className="upload-header-actions">
              <Button
                size="icon"
                variant="ghost"
                aria-label={collapsed ? '展開上傳清單' : '收合上傳清單'}
                onClick={() => setCollapsed((value) => !value)}
              >
                {collapsed ? <ChevronUp /> : <ChevronDown />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={disabled}
                aria-label="清空上傳清單"
                title="只清空清單，不會刪除已上傳的檔案"
                onClick={() => {
                  setEntries([]);
                  setEditing('');
                }}
              >
                <X />
              </Button>
            </div>
          </header>
          <output className="upload-summary">
            已完成 {entries.filter((entry) => entry.status === 'done').length} /{' '}
            {entries.length} 個檔案
            {pending ? ' · 正在上傳，請保持頁面開啟' : ''}
          </output>
          {!collapsed && (
            <>
              <p className="upload-hint">
                點選檔案可更改名稱、填寫說明或從待上傳清單移除。使用下方按鈕選擇多個檔案並設定存取權或資料夾。
              </p>
              <div className="upload-entries">
                {entries.map((entry) => (
                  <button
                    type="button"
                    className={
                      editing === entry.id
                        ? 'upload-entry active'
                        : 'upload-entry'
                    }
                    key={entry.id}
                    disabled={pending}
                    onClick={() =>
                      setEditing(editing === entry.id ? '' : entry.id)
                    }
                  >
                    <span>
                      <strong>{entry.title.trim() || entry.file.name}</strong>
                      <small>目的地：{entry.destination}</small>
                    </span>
                    <small>{labels[entry.status]}</small>
                  </button>
                ))}
              </div>
              {active && (
                <div className="upload-editor">
                  <p>原始檔名：{active.file.name}</p>
                  {active.error && (
                    <div className="notice" role="alert">
                      {active.error}
                    </div>
                  )}
                  {editable ? (
                    <>
                      <label htmlFor="queued-title">
                        檔案名稱（留白使用原始檔名）
                      </label>
                      <Input
                        id="queued-title"
                        maxLength={180}
                        value={active.title}
                        disabled={pending}
                        onChange={(event) =>
                          update(active.id, { title: event.target.value })
                        }
                      />
                      <label htmlFor="queued-description">說明</label>
                      <Textarea
                        id="queued-description"
                        maxLength={4000}
                        value={active.description}
                        disabled={pending}
                        onChange={(event) =>
                          update(active.id, { description: event.target.value })
                        }
                      />
                      <Button
                        variant="ghost"
                        className="danger"
                        disabled={pending}
                        onClick={() => {
                          setEntries((current) =>
                            current.filter((entry) => entry.id !== active.id),
                          );
                          setEditing('');
                        }}
                      >
                        <Trash2 />
                        移除待上傳檔案
                      </Button>
                    </>
                  ) : (
                    <p>
                      {active.status === 'done'
                        ? '檔案已上傳，可從檔案清單編輯。'
                        : labels[active.status]}
                    </p>
                  )}
                  <p>
                    直接存取權：
                    {active.access.level === 'members'
                      ? '所有已登入成員'
                      : `限制（指定 ${active.access.members.length} 位成員）`}
                  </p>
                  {active.parent && <p>此檔案仍會繼承所在資料夾的存取權。</p>}
                  {active.shareUrl && (
                    <>
                      <label htmlFor="queued-share-link">共享連結</label>
                      <Input
                        id="queued-share-link"
                        readOnly
                        value={active.shareUrl}
                        onFocus={(event) => event.currentTarget.select()}
                      />
                    </>
                  )}
                </div>
              )}
              {entries.some(
                (entry) =>
                  entry.status === 'failed' || entry.status === 'unknown',
              ) && (
                <p className="upload-hint" role="alert">
                  部分檔案未完成，請點選該檔案查看原因。
                </p>
              )}
              <footer>
                <Button
                  variant="outline"
                  disabled={disabled}
                  onClick={() => picker.current?.click()}
                >
                  加入檔案
                </Button>
                <Button
                  variant="outline"
                  disabled={disabled || !selectable.length}
                  onClick={openFolder}
                >
                  <FolderInput />
                  加入資料夾
                </Button>
                <Button
                  variant="outline"
                  disabled={disabled || !selectable.length}
                  onClick={openAccess}
                >
                  <Share2 />
                  管理存取權
                </Button>
                <Button
                  className="upload-confirm"
                  disabled={disabled || !ready.length}
                  onClick={() => void upload()}
                >
                  {pending ? '處理中…' : `確認上傳（${ready.length}）`}
                </Button>
              </footer>
            </>
          )}
        </section>
      )}
      {accessOpen && (
        <UploadAccessDialog
          initial={privateAccess()}
          owner={owner}
          urls={entries
            .filter((e) => accessSelected.has(e.id))
            .flatMap((e) => (e.shareUrl ? [e.shareUrl] : []))}
          batch
          title=""
          pending={pending}
          error={accessError}
          onClose={() => setAccessOpen(false)}
          onSave={saveAccess}
          items={entries.map((entry) => ({
            id: entry.id,
            title: entry.title.trim() || entry.file.name,
            detail: `${entry.destination} · ${labels[entry.status]}`,
            disabled:
              entry.status === 'uploading' || entry.status === 'unknown',
          }))}
          selectedIds={accessSelected}
          onSelectionChange={setAccessSelected}
        />
      )}
      <Dialog
        open={folderOpen}
        onOpenChange={(open) => {
          if (!open && !pending) setFolderOpen(false);
        }}
      >
        <DialogContent className="detail-dialog" showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle>將所選檔案加入資料夾</DialogTitle>
            <DialogDescription>
              選擇要設定的檔案，再選擇目的地。選擇「檔案庫最上層」代表不放入資料夾。
            </DialogDescription>
          </DialogHeader>
          <section
            className="queue-selection"
            aria-label="選擇要加入資料夾的檔案"
          >
            <div className="queue-selection-head">
              <strong>選擇檔案</strong>
              <label>
                <input
                  type="checkbox"
                  checked={
                    selectable.length > 0 &&
                    selectable.every((entry) => folderSelected.has(entry.id))
                  }
                  ref={(node) => {
                    if (node)
                      node.indeterminate =
                        folderSelected.size > 0 &&
                        !selectable.every((entry) =>
                          folderSelected.has(entry.id),
                        );
                  }}
                  onChange={(event) =>
                    setFolderSelected(
                      event.target.checked
                        ? new Set(selectable.map((entry) => entry.id))
                        : new Set(),
                    )
                  }
                />
                全選
              </label>
            </div>
            {entries.map((entry) => (
              <label className="queue-selection-row" aria-label={`選擇 ${entry.title.trim() || entry.file.name}`} key={entry.id}>
                <input
                  type="checkbox"
                  disabled={
                    pending ||
                    entry.status === 'uploading' ||
                    entry.status === 'unknown'
                  }
                  checked={folderSelected.has(entry.id)}
                  onChange={(event) => {
                    const next = new Set(folderSelected);
                    if (event.target.checked) next.add(entry.id);
                    else next.delete(entry.id);
                    setFolderSelected(next);
                  }}
                />
                <span>
                  <strong>{entry.title.trim() || entry.file.name}</strong>
                  <small>
                    目前：{entry.destination} · {labels[entry.status]}
                  </small>
                </span>
              </label>
            ))}
            <output>已選取 {folderSelected.size} 個檔案</output>
          </section>
          {folderError && (
            <div className="notice" role="alert">
              {folderError}
            </div>
          )}
          <div className="form-stack">
            <label htmlFor="upload-folder-destination">目的地</label>
            <select
              id="upload-folder-destination"
              disabled={pending}
              value={folderId}
              onChange={(event) => setFolderId(event.target.value)}
            >
              <option value="">檔案庫最上層（不放入資料夾）</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.title} · {folder.owner_name}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setFolderOpen(false)}
            >
              取消
            </Button>
            <Button
              disabled={pending || !folderSelected.size || Boolean(folderError)}
              onClick={() => void saveFolder()}
            >
              {pending ? '正在套用…' : '套用資料夾'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

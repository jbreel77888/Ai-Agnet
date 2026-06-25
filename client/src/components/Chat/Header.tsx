import { memo, useMemo, useState, useCallback, useEffect } from 'react';
import { useRecoilValue } from 'recoil';
import { useMediaQuery } from '@librechat/client';
import { Bot, FolderOpen, AlertCircle, X } from 'lucide-react';
import { getConfigDefaults, PermissionTypes, Permissions, SystemRoles } from 'librechat-data-provider';
import ModelSelector from './Menus/Endpoints/ModelSelector';
import { useGetStartupConfig } from '~/data-provider';
import ExportAndShareMenu from './ExportAndShareMenu';
import { OpenSidebar, PresetsMenu } from './Menus';
import BookmarkMenu from './Menus/BookmarkMenu';
import { TemporaryChat } from './TemporaryChat';
import AddMultiConvo from './AddMultiConvo';
import { useHasAccess, useAuthContext } from '~/hooks';
import { cn } from '~/utils';
import store from '~/store';

// ── Sandbox Session Check ───────────────────────────────────────────────
// Shows a popup when user opens a new conversation AND there's an active
// sandbox from a previous conversation. Offers two choices:
//   1) Continue with the existing sandbox (recommended for free tier —
//      only 1 sandbox allowed)
//   2) Terminate the old sandbox and start fresh
function SandboxSessionCheck() {
  const [showAlert, setShowAlert] = useState(false);
  const [sandboxInfo, setSandboxInfo] = useState<{ sandboxId: string; status: string } | null>(null);
  const [terminating, setTerminating] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (dismissed) { return; }
    const checkSandbox = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/sandbox/status', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.active) {
          setSandboxInfo({ sandboxId: data.sandboxId, status: data.status || 'running' });
          setShowAlert(true);
        }
      } catch {
        // Ignore errors
      }
    };
    // Check after a short delay to let the page load
    const timer = setTimeout(checkSandbox, 1500);
    return () => clearTimeout(timer);
  }, [dismissed]);

  const handleTerminate = async () => {
    setTerminating(true);
    try {
      const token = localStorage.getItem('token');
      await fetch('/api/sandbox/terminate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      setSandboxInfo(null);
      setShowAlert(false);
      setDismissed(true);
    } catch {
      // Ignore
    }
    setTerminating(false);
  };

  const handleContinue = () => {
    setShowAlert(false);
    setDismissed(true);
  };

  if (!showAlert || !sandboxInfo) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="w-96 rounded-lg border border-border-light bg-surface-primary p-5 shadow-xl">
        <div className="mb-3 flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-yellow-500" />
          <h2 className="text-base font-semibold text-text-primary">جلسة sandbox نشطة</h2>
          <button
            onClick={handleContinue}
            className="mr-auto text-text-secondary hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-3 text-sm text-text-secondary">
          يوجد sandbox نشط من محادثة سابقة. بما أن الباقة المجانية تسمح بـ sandbox واحد فقط،
          يمكنك متابعة استخدام نفس الـ sandbox أو إنهاؤه والبدء من جديد.
        </p>
        <div className="mb-4 rounded-lg border border-border-light bg-surface-secondary p-3">
          <div className="flex justify-between text-xs">
            <span className="text-text-secondary">معرف الـ sandbox:</span>
            <span className="font-mono text-text-primary">
              {sandboxInfo.sandboxId?.slice(0, 20)}...
            </span>
          </div>
          <div className="mt-1 flex justify-between text-xs">
            <span className="text-text-secondary">الحالة:</span>
            <span className="font-mono text-green-500">{sandboxInfo.status}</span>
          </div>
          <div className="mt-2 text-[10px] text-text-secondary">
            💡 الملفات الموجودة في الـ sandbox ستكون متاحة إذا اخترت المتابعة.
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleContinue}
            className="flex-1 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
          >
            متابعة باستخدام الـ sandbox الحالي
          </button>
          <button
            onClick={handleTerminate}
            disabled={terminating}
            className="rounded-lg border border-red-500 px-3 py-2 text-sm font-medium text-red-500 hover:bg-red-50 disabled:opacity-50"
          >
            {terminating ? 'جاري الإنهاء...' : 'إنهاء وبدء جديد'}
          </button>
        </div>
      </div>
    </div>
  );
}

function WorkspaceButton() {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<{ name: string; size: number; type: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sandboxId, setSandboxId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/sandbox/files', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setFiles(data.files || []);
      setSandboxId(data.sandboxId || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل التحميل');
      setFiles([]);
    }
    setLoading(false);
  }, []);

  // Auto-refresh every 5s when panel is open
  useEffect(() => {
    if (!open || !autoRefresh) { return; }
    fetchFiles();
    const interval = setInterval(fetchFiles, 5000);
    return () => clearInterval(interval);
  }, [open, autoRefresh, fetchFiles]);

  const formatSize = (bytes: number) => {
    if (bytes === 0) { return ''; }
    if (bytes < 1024) { return `${bytes}B`; }
    if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)}KB`; }
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  };

  const getFileIcon = (type: string) => {
    if (['png', 'jpg', 'jpeg', 'gif', 'svg'].includes(type)) { return '🖼️'; }
    if (['csv', 'xlsx', 'xls'].includes(type)) { return '📊'; }
    if (['json', 'xml'].includes(type)) { return '📋'; }
    if (['html', 'htm'].includes(type)) { return '🌐'; }
    if (['py', 'js', 'ts', 'sh'].includes(type)) { return '📄'; }
    if (['md', 'txt'].includes(type)) { return '📝'; }
    if (['pdf'].includes(type)) { return '📕'; }
    return '📁';
  };

  return (
    <div className="relative">
      <button
        onClick={() => {
          if (!open) {
            fetchFiles();
          }
          setOpen(!open);
        }}
        className={cn(
          'flex items-center gap-1 rounded-lg border border-border-light bg-surface-secondary px-2.5 py-1.5 text-sm font-medium text-text-primary hover:bg-surface-tertiary',
          open && 'bg-surface-tertiary',
        )}
        title="ملفات الـ sandbox"
      >
        <FolderOpen className="h-4 w-4" />
        {files.length > 0 && (
          <span className="ml-1 rounded-full bg-blue-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {files.length}
          </span>
        )}
      </button>
      {open && (
        <>
          {/* Click-outside overlay */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          {/* Panel */}
          <div className="absolute left-0 top-12 z-50 w-96 rounded-lg border border-border-light bg-surface-primary p-3 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-primary">
                ملفات الـ sandbox
              </h3>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-[10px] text-text-secondary">
                  <input
                    type="checkbox"
                    checked={autoRefresh}
                    onChange={(e) => setAutoRefresh(e.target.checked)}
                    className="h-3 w-3"
                  />
                  تحديث تلقائي
                </label>
                <button
                  onClick={fetchFiles}
                  disabled={loading}
                  className="text-text-secondary hover:text-text-primary disabled:opacity-50"
                  title="تحديث"
                >
                  ↻
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="text-text-secondary hover:text-text-primary"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {sandboxId && (
              <div className="mb-2 rounded border border-border-light bg-surface-secondary p-1.5 text-[10px] text-text-secondary">
                <span className="font-mono">Sandbox: {sandboxId.slice(0, 24)}...</span>
              </div>
            )}
            {loading ? (
              <p className="py-4 text-center text-xs text-text-secondary">جاري التحميل...</p>
            ) : error ? (
              <p className="py-4 text-center text-xs text-red-500">{error}</p>
            ) : files.length === 0 ? (
              <div className="py-4 text-center">
                <p className="text-xs text-text-secondary">لا توجد ملفات بعد</p>
                <p className="mt-1 text-[10px] text-text-secondary">
                  اطلب من الوكيل إنشاء ملف (مثلاً: "اكتب لي ملف hello.txt")
                </p>
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                {files.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded px-2 py-1.5 text-xs hover:bg-surface-secondary"
                  >
                    <div className="flex items-center gap-2 overflow-hidden">
                      <span>{getFileIcon(f.type)}</span>
                      <span className="truncate text-text-primary">{f.name}</span>
                    </div>
                    <span className="ml-2 flex-shrink-0 text-text-secondary">
                      {formatSize(f.size)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2 border-t border-border-light pt-2 text-[10px] text-text-secondary">
              المسار: <span className="font-mono">/home/tl-user/</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const defaultInterface = getConfigDefaults().interface;

function Header() {
  const { data: startupConfig } = useGetStartupConfig();
  const navVisible = useRecoilValue(store.sidebarExpanded);

  const interfaceConfig = useMemo(
    () => startupConfig?.interface ?? defaultInterface,
    [startupConfig],
  );

  const hasAccessToBookmarks = useHasAccess({
    permissionType: PermissionTypes.BOOKMARKS,
    permission: Permissions.USE,
  });

  const hasAccessToMultiConvo = useHasAccess({
    permissionType: PermissionTypes.MULTI_CONVO,
    permission: Permissions.USE,
  });

  const hasAccessToTemporaryChat = useHasAccess({
    permissionType: PermissionTypes.TEMPORARY_CHAT,
    permission: Permissions.USE,
  });

  const { user } = useAuthContext();
  const isAdmin = user?.role === SystemRoles.ADMIN;
  const isSmallScreen = useMediaQuery('(max-width: 768px)');

  return (
    <>
    <SandboxSessionCheck />
    <div className="via-presentation/70 md:from-presentation/80 md:via-presentation/50 2xl:from-presentation/0 absolute top-0 z-10 flex h-[52px] w-full items-center justify-between bg-gradient-to-b from-presentation to-transparent p-2 font-semibold text-text-primary 2xl:via-transparent">
      <div className="hide-scrollbar flex w-full items-center justify-between gap-2 overflow-x-auto">
        <div className="mx-1 flex items-center">
          {isSmallScreen ? <OpenSidebar /> : null}
          {!(navVisible && isSmallScreen) && (
            <div
              className={cn(
                'flex items-center gap-2 pl-2',
                !isSmallScreen ? 'transition-all duration-200 ease-in-out' : '',
              )}
            >
              {isAdmin ? (
                <ModelSelector startupConfig={startupConfig} />
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-border-light bg-surface-secondary px-3 py-1.5 text-sm font-semibold text-text-primary">
                  <Bot className="h-4 w-4" />
                  <span>Ai Norx</span>
                </div>
              )}
              {interfaceConfig.presets === true && interfaceConfig.modelSelect && isAdmin && <PresetsMenu />}
              {hasAccessToBookmarks === true && <BookmarkMenu />}
              {hasAccessToMultiConvo === true && <AddMultiConvo />}
              <WorkspaceButton />
              {isSmallScreen && (
                <>
                  <ExportAndShareMenu
                    isSharedButtonEnabled={startupConfig?.sharedLinksEnabled ?? false}
                  />
                  {hasAccessToTemporaryChat === true && <TemporaryChat />}
                </>
              )}
            </div>
          )}
        </div>

        {!isSmallScreen && (
          <div className="flex items-center gap-2">
            <ExportAndShareMenu
              isSharedButtonEnabled={startupConfig?.sharedLinksEnabled ?? false}
            />
            {hasAccessToTemporaryChat === true && <TemporaryChat />}
          </div>
        )}
      </div>
      {/* Empty div for spacing */}
      <div />
    </div>
    </>
  );
}

const MemoizedHeader = memo(Header);
MemoizedHeader.displayName = 'Header';

export default MemoizedHeader;

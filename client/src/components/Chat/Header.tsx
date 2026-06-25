import { memo, useMemo, useState, useCallback } from 'react';
import { useRecoilValue } from 'recoil';
import { useMediaQuery } from '@librechat/client';
import { Bot, FolderOpen } from 'lucide-react';
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

function WorkspaceButton() {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<{ name: string; size: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const conversationId = useRecoilValue(store.conversationId);

  const fetchFiles = useCallback(async () => {
    if (!conversationId) {
      return;
    }
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/sandbox/files?conversationId=${conversationId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setFiles(data.files || []);
    } catch {
      setFiles([]);
    }
    setLoading(false);
  }, [conversationId]);

  return (
    <>
      <button
        onClick={() => {
          if (!open) {
            fetchFiles();
          }
          setOpen(!open);
        }}
        className="flex items-center gap-1 rounded-lg border border-border-light bg-surface-secondary px-2.5 py-1.5 text-sm font-medium text-text-primary hover:bg-surface-tertiary"
        title="ملفات المشروع"
      >
        <FolderOpen className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-80 rounded-lg border border-border-light bg-surface-primary p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-primary">ملفات المشروع</h3>
            <button
              onClick={() => setOpen(false)}
              className="text-text-secondary hover:text-text-primary"
            >
              ✕
            </button>
          </div>
          {loading ? (
            <p className="text-xs text-text-secondary">جاري التحميل...</p>
          ) : files.length === 0 ? (
            <p className="text-xs text-text-secondary">
              لا توجد ملفات بعد. اطلب من الوكيل إنشاء ملف.
            </p>
          ) : (
            <div className="max-h-60 overflow-y-auto">
              {files.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-1 text-xs"
                >
                  <span className="text-text-primary">{f.name}</span>
                  <span className="text-text-secondary">
                    {f.size > 0 ? `${(f.size / 1024).toFixed(1)}KB` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
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
  );
}

const MemoizedHeader = memo(Header);
MemoizedHeader.displayName = 'Header';

export default MemoizedHeader;

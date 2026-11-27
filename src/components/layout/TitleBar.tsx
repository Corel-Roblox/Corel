import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Download, Minus, Square, Copy, X, WifiOff } from 'lucide-react';
import { Wordmark } from '@/components/common';
import { Button, Tooltip } from '@/components/ui';
import { invoke, isDesktop } from '@/lib/tauri';
import { useEngine } from '@/store/engine';
import { useWorkspace } from '@/store/workspace';
import { cn } from '@/lib/format';

/** Frameless window title bar: drag area, connection state, update button, window controls. */
export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const update = useEngine((s) => s.info?.updateReady);
  const realtime = useWorkspace((s) => s.realtime);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    if (!isDesktop) return;
    const w = getCurrentWindow();
    w.isMaximized().then(setMaximized);
    const un = w.onResized(() => w.isMaximized().then(setMaximized));
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      un.then((f) => f());
    };
  }, []);

  const win = isDesktop ? getCurrentWindow() : null;
  const offlineLabel = !online ? 'You are offline. Changes will fail until you reconnect.' : realtime === 'offline' ? 'Live sync lost. Reconnecting…' : null;

  return (
    <div data-tauri-drag-region className="relative z-30 flex h-[34px] shrink-0 items-center border-b border-line bg-sunken pl-3" onDoubleClick={() => win?.toggleMaximize()}>
      <div data-tauri-drag-region className="pointer-events-none flex items-center">
        <Wordmark />
      </div>
      <div data-tauri-drag-region className="flex flex-1 items-center justify-center gap-2">
        {offlineLabel && (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-warning-soft px-2 py-0.5 text-[11.5px] text-warning" role="status">
            <WifiOff className="size-3" />
            {offlineLabel}
          </span>
        )}
      </div>
      {update && (
        <Tooltip content={`Version ${update} is downloaded. Restart to finish updating.`}>
          <Button size="xs" variant="primary" className="mr-2" icon={<Download className="size-3" />} onClick={() => invoke('restart_for_update')}>
            Restart to update
          </Button>
        </Tooltip>
      )}
      {isDesktop && (
        <div className="flex h-full">
          <WinButton label="Minimize" onClick={() => win?.minimize()}>
            <Minus className="size-3.5" />
          </WinButton>
          <WinButton label={maximized ? 'Restore' : 'Maximize'} onClick={() => win?.toggleMaximize()}>
            {maximized ? <Copy className="size-3 -scale-x-100" /> : <Square className="size-3" />}
          </WinButton>
          <WinButton label="Close" danger onClick={() => win?.close()}>
            <X className="size-3.5" />
          </WinButton>
        </div>
      )}
    </div>
  );
}

function WinButton({ children, label, onClick, danger }: { children: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button aria-label={label} onClick={onClick} className={cn('grid h-full w-11 place-items-center text-fg-muted transition-colors duration-150', danger ? 'hover:bg-[#e81123] hover:text-white' : 'hover:bg-hover hover:text-fg')}>
      {children}
    </button>
  );
}

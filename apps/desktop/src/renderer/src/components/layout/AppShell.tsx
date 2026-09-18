import { Outlet } from 'react-router';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { StatusBar } from './StatusBar';
import { ToastHost } from '../dialogs/ToastHost';
import { ErrorDialog } from '../dialogs/ErrorDialog';
import { RecoveryDialog } from '../dialogs/RecoveryDialog';
import { TasksPanel } from '../dialogs/TasksPanel';
import { GlobalSearch } from '../dialogs/GlobalSearch';
import { AssistantPanel } from '@/assistant/AssistantPanel';
import { useShortcuts } from '@/hooks/useShortcuts';
import { useAppStore } from '@/store/appStore';

export function AppShell() {
  useShortcuts();
  const assistantOpen = useAppStore((s) => s.assistantOpen);
  return (
    <div className="flex h-full w-full overflow-hidden bg-bg">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-y-auto" data-testid="main-content">
            <Outlet />
          </main>
          {assistantOpen ? <AssistantPanel /> : null}
        </div>
        <StatusBar />
      </div>
      <ToastHost />
      <ErrorDialog />
      <RecoveryDialog />
      <TasksPanel />
      <GlobalSearch />
    </div>
  );
}

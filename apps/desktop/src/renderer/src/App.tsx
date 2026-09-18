import { useEffect } from 'react';
import { createHashRouter, RouterProvider } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AppShell } from './components/layout/AppShell';
import { Button } from './components/ui/Button';
import { Spinner } from './components/ui/Misc';
import { HomeScreen } from './screens/HomeScreen';
import { EditorScreen } from './screens/EditorScreen';
import { ProjectsScreen } from './screens/ProjectsScreen';
import { TemplatesScreen } from './screens/TemplatesScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SystemScreen } from './screens/SystemScreen';
import { DiagnosticsScreen } from './screens/DiagnosticsScreen';
import { CreatorScreen } from './screens/GatedScreens';
import { ModelsScreen } from './screens/ModelsScreen';
import { MediaScreen } from './screens/MediaScreen';
import { ExportScreen } from './screens/ExportScreen';
import { useAppStore } from './store/appStore';

const router = createHashRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <HomeScreen /> },
      { path: 'editor/:projectId?', element: <EditorScreen /> },
      { path: 'creator/:projectId?', element: <CreatorScreen /> },
      { path: 'projects', element: <ProjectsScreen /> },
      { path: 'media', element: <MediaScreen /> },
      { path: 'models', element: <ModelsScreen /> },
      { path: 'templates', element: <TemplatesScreen /> },
      { path: 'export', element: <ExportScreen /> },
      { path: 'settings/:section?', element: <SettingsScreen /> },
      { path: 'system', element: <SystemScreen /> },
      { path: 'diagnostics', element: <DiagnosticsScreen /> },
    ],
  },
]);

export function App() {
  const { t } = useTranslation();
  const ready = useAppStore((s) => s.ready);
  const bootError = useAppStore((s) => s.bootError);
  const bootstrap = useAppStore((s) => s.bootstrap);
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);
  if (bootError) {
    return (
      <div className="grid h-full place-items-center bg-bg p-8 text-center">
        <div>
          <h1 className="text-lg font-semibold">{t('app.bootFailed')}</h1>
          <p className="mt-2 max-w-md text-sm text-muted">{bootError.message}</p>
          <Button action="app.reload" variant="primary" className="mt-4" onClick={() => window.location.reload()}>{t('app.reload')}</Button>
        </div>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="grid h-full place-items-center bg-bg" data-testid="app-loading">
        <div className="flex flex-col items-center gap-3 text-muted">
          <Spinner />
          <span className="text-sm">{t('app.loading')}</span>
        </div>
      </div>
    );
  }
  return <RouterProvider router={router} />;
}

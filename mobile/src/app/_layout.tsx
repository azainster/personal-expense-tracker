// Defines the background sync task in global scope, as BGTaskScheduler requires.
import '@/lib/backgroundSync';

import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorView, LoadingView } from '@/components/states';
import { ToastHost } from '@/components/ToastHost';
import { AppProvider, useApp } from '@/state/AppState';
import { useTheme } from '@/theme';

// If anything under the root layout throws while rendering, Expo Router shows this boundary
// (with a Retry button) and hides the splash screen, instead of leaving the splash frozen.
export { ErrorBoundary } from 'expo-router';

// Keep the native splash up while the on-device database opens. RootNavigator hides it.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

function RootNavigator() {
  const { state, actions } = useApp();
  const { colors, dark } = useTheme();
  const settled = state.phase !== 'booting';

  // Hide the splash once boot has settled either way — the app is ready, or the boot error
  // screen is showing. Runs after that screen is committed, so there's no blank flash.
  useEffect(() => {
    if (settled) SplashScreen.hideAsync().catch(() => undefined);
  }, [settled]);

  if (state.phase === 'booting') return <LoadingView />;
  if (state.phase === 'failed') {
    return <ErrorView fullScreen message={state.bootError ?? 'The app could not open its data.'} onRetry={actions.retryBoot} />;
  }

  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerTintColor: colors.accent,
          headerTitleStyle: { color: colors.text },
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
          headerBackButtonDisplayMode: 'minimal',
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="connect" options={{ presentation: 'modal', title: 'Connect Gmail' }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Overview' }} />
        <Stack.Screen name="transaction/[id]" options={{ title: 'Transaction' }} />
        <Stack.Screen name="categorize/[id]" options={{ presentation: 'modal', title: 'Choose category' }} />
        <Stack.Screen name="category/[key]" options={{ title: 'Category' }} />
        <Stack.Screen name="parser-lab" options={{ title: 'Parser lab' }} />
        <Stack.Screen name="trace" options={{ title: 'Parser trace' }} />
        <Stack.Screen name="activity" options={{ title: 'Sync activity' }} />
        <Stack.Screen name="privacy" options={{ title: 'Privacy' }} />
      </Stack>
      <ToastHost />
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <RootNavigator />
      </AppProvider>
    </SafeAreaProvider>
  );
}

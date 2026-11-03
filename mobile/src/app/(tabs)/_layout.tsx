import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useApp } from '@/state/AppState';
import { useTheme } from '@/theme';

export default function TabsLayout() {
  const { colors } = useTheme();
  const { state } = useApp();

  if (!state.onboarded) return <Redirect href="/onboarding" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Overview',
          tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? 'pie-chart' : 'pie-chart-outline'} size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: 'Transactions',
          tabBarBadge: state.reviewCount > 0 ? state.reviewCount : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.warning, color: '#FFFFFF', fontSize: 11 },
          tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? 'list' : 'list-outline'} size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? 'settings' : 'settings-outline'} size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}

import { router, Stack } from 'expo-router';
import { View } from 'react-native';
import { EmptyState } from '@/components/states';
import { Button } from '@/components/ui';
import { spacing, useTheme } from '@/theme';

export default function NotFound() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', padding: spacing.xl }}>
      <Stack.Screen options={{ title: 'Not found' }} />
      <EmptyState icon="compass-outline" title="This screen doesn’t exist" message="The link may be out of date.">
        <Button title="Go to Overview" onPress={() => router.replace('/(tabs)')} />
      </EmptyState>
    </View>
  );
}

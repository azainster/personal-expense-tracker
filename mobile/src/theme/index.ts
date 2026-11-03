import { useColorScheme } from 'react-native';

const light = {
  background: '#F4F5F7',
  surface: '#FFFFFF',
  surfaceMuted: '#EEF0F3',
  text: '#101318',
  textSecondary: '#5E6672',
  textTertiary: '#8C94A0',
  border: '#E2E5EA',
  separator: '#E9EBEF',
  accent: '#2F6FEB',
  accentMuted: '#E6EEFD',
  positive: '#1E8E4E',
  positiveMuted: '#E3F4EA',
  warning: '#B26A00',
  warningMuted: '#FFF2DC',
  danger: '#D1343A',
  dangerMuted: '#FDE7E8',
  chartTrack: '#E7EAEE',
};

const dark: typeof light = {
  background: '#0E1013',
  surface: '#181B20',
  surfaceMuted: '#22262C',
  text: '#F2F4F7',
  textSecondary: '#A3ABB6',
  textTertiary: '#6F7782',
  border: '#2A2F36',
  separator: '#262A30',
  accent: '#5B8FF5',
  accentMuted: '#1C2A45',
  positive: '#3CC27A',
  positiveMuted: '#16301F',
  warning: '#F0A43A',
  warningMuted: '#35270F',
  danger: '#F2666B',
  dangerMuted: '#3A1B1D',
  chartTrack: '#262A30',
};

export type Palette = typeof light;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const type = {
  largeTitle: { fontSize: 32, fontWeight: '700' as const, letterSpacing: 0.2 },
  title: { fontSize: 22, fontWeight: '700' as const },
  headline: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  callout: { fontSize: 15, fontWeight: '400' as const },
  subhead: { fontSize: 14, fontWeight: '400' as const },
  footnote: { fontSize: 13, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '500' as const },
  hero: { fontSize: 40, fontWeight: '700' as const, letterSpacing: -0.5 },
};

export function useTheme(): { colors: Palette; dark: boolean } {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  return { colors: isDark ? dark : light, dark: isDark };
}

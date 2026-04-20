import { useEffect, useState } from 'react';
import { Dimensions, Platform } from 'react-native';

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

export interface BreakpointInfo {
  width: number;
  height: number;
  breakpoint: Breakpoint;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  columns: 1 | 2 | 3;
  maxContentWidth: number;
}

function resolve(width: number, height: number): BreakpointInfo {
  const breakpoint: Breakpoint = width >= 1024 ? 'desktop' : width >= 640 ? 'tablet' : 'mobile';
  return {
    width,
    height,
    breakpoint,
    isMobile: breakpoint === 'mobile',
    isTablet: breakpoint === 'tablet',
    isDesktop: breakpoint === 'desktop',
    columns: breakpoint === 'desktop' ? 3 : breakpoint === 'tablet' ? 2 : 1,
    maxContentWidth: breakpoint === 'desktop' ? 1120 : breakpoint === 'tablet' ? 760 : width,
  };
}

export function useBreakpoint(): BreakpointInfo {
  const initial = Dimensions.get('window');
  const [state, setState] = useState<BreakpointInfo>(() => resolve(initial.width, initial.height));

  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => {
      setState(resolve(window.width, window.height));
    });
    return () => sub.remove();
  }, []);

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    // fallback listener in case Dimensions misses a resize on web
  }

  return state;
}

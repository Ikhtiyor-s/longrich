import { createElement } from 'react';
import type { ReactElement } from 'react';

export interface IconProps {
  size?: number;
  className?: string;
}

type IconChild = ReactElement;

function createIcon(children: IconChild[]) {
  return function Icon({ size = 24, className }: IconProps) {
    return createElement(
      'svg',
      {
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.75,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        width: size,
        height: size,
        className,
      },
      ...children,
    );
  };
}

export const SearchIcon = createIcon([
  createElement('circle', { key: 'c', cx: 11, cy: 11, r: 7 }),
  createElement('line', { key: 'l', x1: 21, y1: 21, x2: 16.5, y2: 16.5 }),
]);

export const MapPinIcon = createIcon([
  createElement('path', {
    key: 'p',
    d: 'M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z',
  }),
  createElement('circle', { key: 'c', cx: 12, cy: 9.5, r: 2.3 }),
]);

export const GlobeIcon = createIcon([
  createElement('circle', { key: 'c', cx: 12, cy: 12, r: 9 }),
  createElement('path', { key: 'p1', d: 'M3 12h18' }),
  createElement('path', {
    key: 'p2',
    d: 'M12 3c2.8 2.6 4.3 5.9 4.3 9s-1.5 6.4-4.3 9c-2.8-2.6-4.3-5.9-4.3-9S9.2 5.6 12 3Z',
  }),
]);

export const ChevronDownIcon = createIcon([
  createElement('polyline', { key: 'p', points: '6 9 12 15 18 9' }),
]);

export const UserIcon = createIcon([
  createElement('circle', { key: 'c', cx: 12, cy: 8, r: 3.5 }),
  createElement('path', { key: 'p', d: 'M4.5 20c1.2-3.6 4.1-5.5 7.5-5.5s6.3 1.9 7.5 5.5' }),
]);

export const HeartIcon = createIcon([
  createElement('path', {
    key: 'p',
    d: 'M12 20s-7.5-4.6-9.6-9.3C.9 7.1 2.6 4 5.8 4c1.9 0 3.4 1 4.2 2.4C10.8 5 12.3 4 14.2 4c3.2 0 4.9 3.1 3.4 6.7C19.5 15.4 12 20 12 20Z',
  }),
]);

export const CartIcon = createIcon([
  createElement('path', {
    key: 'p1',
    d: 'M3 4h2l2.4 12.2a2 2 0 0 0 2 1.6h7.4a2 2 0 0 0 2-1.6L21 8H6',
  }),
  createElement('circle', { key: 'c1', cx: 9, cy: 20, r: 1.4 }),
  createElement('circle', { key: 'c2', cx: 17, cy: 20, r: 1.4 }),
]);

export const GridIcon = createIcon([
  createElement('rect', { key: 'r1', x: 3.5, y: 3.5, width: 7, height: 7, rx: 1.2 }),
  createElement('rect', { key: 'r2', x: 13.5, y: 3.5, width: 7, height: 7, rx: 1.2 }),
  createElement('rect', { key: 'r3', x: 3.5, y: 13.5, width: 7, height: 7, rx: 1.2 }),
  createElement('rect', { key: 'r4', x: 13.5, y: 13.5, width: 7, height: 7, rx: 1.2 }),
]);

export const HomeIcon = createIcon([
  createElement('path', { key: 'p1', d: 'M4 11 12 4l8 7' }),
  createElement('path', { key: 'p2', d: 'M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9' }),
  createElement('path', { key: 'p3', d: 'M10 20v-5h4v5' }),
]);

export const ScanIcon = createIcon([
  createElement('path', { key: 'p1', d: 'M4 8V5a1 1 0 0 1 1-1h3' }),
  createElement('path', { key: 'p2', d: 'M16 4h3a1 1 0 0 1 1 1v3' }),
  createElement('path', { key: 'p3', d: 'M20 16v3a1 1 0 0 1-1 1h-3' }),
  createElement('path', { key: 'p4', d: 'M8 20H5a1 1 0 0 1-1-1v-3' }),
  createElement('line', { key: 'l', x1: 4, y1: 12, x2: 20, y2: 12 }),
]);

export const AlertCircleIcon = createIcon([
  createElement('circle', { key: 'c', cx: 12, cy: 12, r: 9 }),
  createElement('line', { key: 'l1', x1: 12, y1: 8, x2: 12, y2: 13 }),
  createElement('line', { key: 'l2', x1: 12, y1: 16, x2: 12, y2: 16.01 }),
]);

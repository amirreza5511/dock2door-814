import React, { useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Eraser } from 'lucide-react-native';
import C from '@/constants/colors';

type Point = { x: number; y: number };

interface Props {
  /** Called with an SVG document string whenever the signature changes (empty string when cleared). */
  onChange: (svg: string) => void;
  height?: number;
}

/** Build an SVG path `d` attribute from a list of points. */
function toPath(points: Point[]): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  return `M ${first.x.toFixed(1)} ${first.y.toFixed(1)} ` + rest.map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

/** Finger-drawn signature canvas. Emits a self-contained SVG string on change. */
export default function SignaturePad({ onChange, height = 200 }: Props) {
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const [current, setCurrent] = useState<Point[]>([]);
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: height });

  const emit = (all: Point[][]) => {
    const { w, h } = sizeRef.current;
    if (all.length === 0) { onChange(''); return; }
    const paths = all.map((s) => `<path d="${toPath(s)}" fill="none" stroke="#0b0f17" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="${Math.round(h)}" viewBox="0 0 ${Math.round(w)} ${Math.round(h)}"><rect width="100%" height="100%" fill="#ffffff"/>${paths}</svg>`;
    onChange(svg);
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          setCurrent([{ x: locationX, y: locationY }]);
        },
        onPanResponderMove: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          setCurrent((cur) => [...cur, { x: locationX, y: locationY }]);
        },
        onPanResponderRelease: () => {
          setCurrent((cur) => {
            if (cur.length === 0) return cur;
            setStrokes((prev) => {
              const next = [...prev, cur];
              emit(next);
              return next;
            });
            return [];
          });
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onLayout = (e: LayoutChangeEvent) => {
    sizeRef.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height };
  };

  const clear = () => {
    setStrokes([]);
    setCurrent([]);
    onChange('');
  };

  const hasInk = strokes.length > 0 || current.length > 0;

  return (
    <View style={styles.wrap}>
      <View style={[styles.canvas, { height }]} onLayout={onLayout} {...responder.panHandlers}>
        <Svg width="100%" height="100%">
          {strokes.map((s, i) => (
            <Path key={i} d={toPath(s)} fill="none" stroke="#0b0f17" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {current.length > 0 ? (
            <Path d={toPath(current)} fill="none" stroke="#0b0f17" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          ) : null}
        </Svg>
        {!hasInk ? <Text style={styles.placeholder}>Sign here with your finger</Text> : null}
        <View style={styles.baseline} />
      </View>
      <TouchableOpacity style={styles.clearBtn} onPress={clear} disabled={!hasInk}>
        <Eraser size={14} color={hasInk ? C.accent : C.textMuted} />
        <Text style={[styles.clearText, { color: hasInk ? C.accent : C.textMuted }]}>Clear</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  canvas: { backgroundColor: '#ffffff', borderRadius: 12, borderWidth: 1, borderColor: C.border, overflow: 'hidden', justifyContent: 'center' },
  placeholder: { position: 'absolute', alignSelf: 'center', color: '#9ca3af', fontSize: 14, fontWeight: '600' as const },
  baseline: { position: 'absolute', left: 20, right: 20, bottom: 34, height: 1, backgroundColor: '#e5e7eb' },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end', paddingVertical: 4, paddingHorizontal: 8 },
  clearText: { fontSize: 13, fontWeight: '700' as const },
});
